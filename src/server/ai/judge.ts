import { AI_SETTINGS, PHOTO_POLICY } from "../../data/ai.ts";
import { paletteColor } from "../../shared/palette.ts";
import type { ContentMatch } from "../../shared/photo-selection.ts";
import { selectPhotos } from "../../shared/photo-selection.ts";
import type { ColorOutput, ResultRecord } from "../../shared/result.ts";
import type { Answer, Palette, PaletteId, Photo, Question, QuestionId } from "../../shared/types.ts";
import type { PromptRequest } from "../mistral.ts";
import type { Checked } from "./color.ts";
import { checkColorOutput } from "./color.ts";
import { answerInput, readJson } from "./input.ts";
import { checkPhotoOutput, photoCatalogInput } from "./photos.ts";
import { COLOR_SELECTION_PROMPT, PHOTO_SELECTION_PROMPT } from "./prompts.ts";

/** 回答から結果を決める。決められなければ `null`。例外は投げない。 */
export type Judge = (
	answers: Readonly<Record<QuestionId, Answer>>,
	signal: AbortSignal,
) => Promise<ResultRecord | null>;

export interface JudgeOptions {
	/** プロンプトを送り、返答の本文を返す。 */
	send: (request: PromptRequest) => Promise<string>;
	model: string;
	questionVersion: string;
	questions: readonly Question[];
	palette: Palette;
	photos: readonly Photo[];
	now: () => number;
	newResultId: () => string;
	log?: (message: string) => void;
	/** 再試行の回数と、一回の呼び出しの時間の上限。省略すると `AI_SETTINGS`。 */
	settings?: { retries: number; callTimeoutMs: number };
}

/** 返答の上限。日本語の説明文を含む。 */
const COLOR_MAX_TOKENS = 2_000;
const PHOTO_MAX_TOKENS = 2_000;

const json = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * AIで結果を決める `Judge` を作る（refs/handoff 実装仕様書2章）。
 * 1. 色の選定: 回答全体から二色、色名、読み取りを選ばせ、出力を検証する。失敗したら再試行し、
 *    それでも失敗したら `null`（展示は最終問へ戻ってやり直す。固定計算で代わりの結果を作らない）。
 * 2. 写真の選定: 確定した二色と回答から、内容の合う写真を判定させる。失敗したら再試行し、それでも
 *    失敗したら色の適合だけで選ぶ（内容は根拠不足として段階2まで）。二色は変えない。
 */
export function createJudge(options: JudgeOptions): Judge {
	const log = options.log ?? ((message: string) => console.error(message));
	const settings = options.settings ?? AI_SETTINGS;
	const questionIds = options.questions.map((question) => question.id);

	/** 一回の呼び出しを、検証に通るまで `settings.retries` 回までやり直す。 */
	async function ask<T>(
		label: string,
		request: Omit<PromptRequest, "signal">,
		check: (value: unknown) => Checked<T>,
		signal: AbortSignal,
	): Promise<T | null> {
		for (let attempt = 0; attempt <= settings.retries; attempt += 1) {
			if (signal.aborted) return null;
			try {
				const reply = await options.send({
					...request,
					signal: AbortSignal.any([signal, AbortSignal.timeout(settings.callTimeoutMs)]),
				});
				const checked = check(readJson(reply));
				if (checked.ok) return checked.value;
				log(`${label}の出力を使えません（${attempt + 1}回目）: ${checked.error}: ${reply}`);
			} catch (error) {
				log(
					`${label}に失敗しました（${attempt + 1}回目）: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		return null;
	}

	return async (answers, signal) => {
		const input = answerInput(options.questionVersion, options.questions, answers);
		const color = await ask<ColorOutput>(
			"色の選定",
			{
				system: COLOR_SELECTION_PROMPT,
				prompt: `風景色パレット:\n${json(options.palette)}\n\n回答データ:\n${json(input)}`,
				maxTokens: COLOR_MAX_TOKENS,
			},
			(value) => checkColorOutput(value, options.palette, questionIds),
			signal,
		);
		if (!color) return null;

		const resolved = color.colors.map((choice) => paletteColor(options.palette.colors, choice.id));
		const photoReply = await ask<{ matches: ContentMatch[]; dropped: number }>(
			"写真の選定",
			{
				system: PHOTO_SELECTION_PROMPT,
				prompt: `確定した二色:\n${json(resolved)}\n\n回答データ:\n${json(input)}\n\n写真カタログ:\n${json(photoCatalogInput(options.photos))}`,
				maxTokens: PHOTO_MAX_TOKENS,
			},
			(value) => checkPhotoOutput(value, options.photos, questionIds),
			signal,
		);
		if (photoReply && photoReply.dropped > 0) log(`写真の選定で使えない項目を${photoReply.dropped}件除きました`);
		const photos = selectPhotos({
			photos: options.photos,
			colors: color.colors.map((choice) => choice.id),
			contentMatches: photoReply?.matches ?? null,
			count: PHOTO_POLICY.sessionPhotoCount,
			policyVersion: PHOTO_POLICY.version,
		});
		return {
			schemaVersion: "color-result-v1",
			id: options.newResultId(),
			createdAt: options.now(),
			questionVersion: options.questionVersion,
			paletteVersion: options.palette.version,
			model: options.model,
			answers,
			color,
			photos,
		};
	};
}

/** 仮の選定が返す色名と二色。E2Eテストの期待値にも使う。 */
export const STUB_NAME = "開発用の仮の色";
export const STUB_COLORS: readonly [PaletteId, PaletteId] = ["emerald", "amber"];

/**
 * 開発とE2Eテスト用の仮の `Judge`（`AI_STUB=1`）。AIへ接続せず、決まった二色と、色の適合だけで選んだ写真を
 * 返す。結果であることが分かるよう、色名と説明に「開発用」と書く。本番では使わない。
 */
export function createStubJudge(
	options: Pick<JudgeOptions, "questionVersion" | "palette" | "photos" | "now" | "newResultId">,
): Judge {
	return async (answers) => ({
		schemaVersion: "color-result-v1",
		id: options.newResultId(),
		createdAt: options.now(),
		questionVersion: options.questionVersion,
		paletteVersion: options.palette.version,
		model: "stub",
		answers,
		color: {
			paletteVersion: options.palette.version,
			name: STUB_NAME,
			nameReason: "開発用の仮の結果です。AIは使っていません。",
			reading: "開発用の仮の結果です。回答は読み取っていません。",
			colors: [
				{ id: STUB_COLORS[0], reason: "開発用の仮の色です。", evidence: ["Q1"] },
				{ id: STUB_COLORS[1], reason: "開発用の仮の色です。", evidence: ["Q5"] },
			],
			relationship: "開発用の仮の組み合わせです。",
		},
		photos: selectPhotos({
			photos: options.photos,
			colors: STUB_COLORS,
			contentMatches: null,
			count: PHOTO_POLICY.sessionPhotoCount,
			policyVersion: PHOTO_POLICY.version,
		}),
	});
}
