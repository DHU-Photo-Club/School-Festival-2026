// 演出の調整用に、一つの演出だけを繰り返し再生するための台本（開発サーバー専用。展示の本番では使わない）。
// サーバーを介さずに、展示ディスプレイが受け取る状態（`DisplayState`）の列を時刻つきで作る。
// 描画は本番と同じ `onState` と `computeScene` を通るので、調整した見た目がそのまま本番になる。

import { INTRO_NICKNAME_AT_MS } from "../data/sound.ts";
import { JUDGING_MS, RESULT_MS } from "./machine.ts";
import { ANSWER_PULSE_IN_MS } from "./motion.ts";
import { RIPPLE_MS } from "./ripple.ts";
import type { DisplayState, PaletteId } from "./types.ts";
import { PALETTE_IDS } from "./types.ts";

/** 単体で繰り返せる演出。 */
export const LAB_LOOPS = ["idle", "opening", "answer", "judging", "result"] as const;
export type LabLoop = (typeof LAB_LOOPS)[number];

/** 各演出が何を繰り返すか（HUDと使い方の案内に出す）。 */
export const LAB_LOOP_NOTES: Readonly<Record<LabLoop, string>> = {
	idle: "質問中の輪から待機の小さな輪へ縮む",
	opening: "待機 → シーケンス → intro（ようこそ、説明、色を見つける案内）→ 質問中の灰色の輪",
	answer: "回答の縮みと波紋",
	judging: "最終問の回答 → 暗転と塵 → 色づき → 結果",
	result: "色づき → 結果の広がり → 色名 → 待機へ戻る",
};

export interface LabOptions {
	loop: LabLoop;
	/** 結果で見せる色。`all` は一周ごとに全色を順に見せる。 */
	color: PaletteId | "all";
}

/** `?loop=result&color=jade` を読む。演出名が不正なら `null`（通常の展示ディスプレイとして動く）。 */
export function parseLab(search: string): LabOptions | null {
	const params = new URLSearchParams(search);
	const loop = params.get("loop");
	if (!LAB_LOOPS.includes(loop as LabLoop)) return null;
	const color = params.get("color");
	return {
		loop: loop as LabLoop,
		color: PALETTE_IDS.includes(color as PaletteId) ? (color as PaletteId) : "all",
	};
}

/** 台本の一場面。`atMs` は一周の開始からの時刻。 */
export interface LabStep {
	atMs: number;
	state: DisplayState;
}

export interface LabCycle {
	/** 一周の長さ（ミリ秒）。 */
	lengthMs: number;
	/** この周で結果として見せる色。結果を使わない演出では `null`。 */
	colorId: PaletteId | null;
	steps: LabStep[];
}

/** `intro` の直前に再生するシーケンス。 */
export interface LabLead {
	id: string;
	durationMs: number;
}

export interface LabContext {
	/** 何周目か（0から）。 */
	index: number;
	/** 一周の開始時刻（補正済みサーバー時刻に相当する時刻）。 */
	startedAt: number;
	lead: LabLead | null;
}

/** 結果を見せている時間。広がり（最長2.6秒）と沈み、色名が現れ終えたあと、しばらく眺められる長さ。 */
const RESULT_HOLD_MS = 7_000;
/** `idle` の質問中の輪が縮み終えて、しばらく見せる長さ。 */
const IDLE_HOLD_MS = 4_000;
/** 質問中の輪を見せる長さ。 */
const QUESTION_HOLD_MS = 4_000;

/** 一周の台本を作る。同じ入力には同じ台本を返す。 */
export function labCycle(options: LabOptions, context: LabContext): LabCycle {
	const { index, startedAt } = context;
	const colorId = options.color === "all" ? PALETTE_IDS[index % PALETTE_IDS.length] : options.color;
	const sessionId = `lab-${index}`;
	let revision = index * 100;

	const state = (at: number, over: Partial<DisplayState>): LabStep => ({
		atMs: at,
		state: {
			sessionId,
			phase: "idle",
			sequenceId: null,
			previewColorId: null,
			phaseStartedAt: startedAt + at,
			phaseEndsAt: null,
			answeredAt: null,
			revision: ++revision,
			result: null,
			...over,
		},
	});
	const at = (ms: number) => startedAt + ms;
	const result: DisplayState["result"] = { name: "lab", colors: [colorId, colorId], photoIds: [] };

	switch (options.loop) {
		case "idle": {
			// 縮む3.0秒のあと、小さな輪をしばらく見せる。
			return {
				lengthMs: 2_000 + 3_000 + IDLE_HOLD_MS,
				colorId: null,
				steps: [state(0, { phase: "question" }), state(2_000, { phase: "idle" })],
			};
		}
		case "opening": {
			const leadMs = context.lead?.durationMs ?? 0;
			// `intro` は、ナレーション03を読み終えて少し見せるまで。
			const introAt = IDLE_HOLD_MS + leadMs;
			const introMs = INTRO_NICKNAME_AT_MS + 3_000 - leadMs;
			const questionAt = introAt + Math.max(1_000, introMs);
			const steps: LabStep[] = [state(0, { phase: "idle" })];
			if (context.lead) {
				steps.push(
					state(IDLE_HOLD_MS, {
						phase: "sequence",
						sequenceId: context.lead.id,
						phaseEndsAt: at(IDLE_HOLD_MS + leadMs),
					}),
				);
			}
			steps.push(state(introAt, { phase: "intro" }), state(questionAt, { phase: "question" }));
			return { lengthMs: questionAt + QUESTION_HOLD_MS, colorId: null, steps };
		}
		case "answer": {
			const answeredAt = 1_000;
			return {
				lengthMs: answeredAt + ANSWER_PULSE_IN_MS + RIPPLE_MS + 700,
				colorId: null,
				steps: [state(0, { phase: "question", answeredAt: at(answeredAt) })],
			};
		}
		case "judging": {
			const judgingAt = 1_500;
			const resultAt = judgingAt + JUDGING_MS;
			const judging = { phase: "judging", answeredAt: at(judgingAt), phaseEndsAt: at(resultAt) } as const;
			return {
				lengthMs: resultAt + 4_000,
				colorId,
				steps: [
					state(0, { phase: "question" }),
					state(judgingAt, judging),
					// 結果は判定の途中で届く。届く前の塵と、届いたあとの色づきを見分けられるよう、半ばにする。
					state(judgingAt + 5_000, { ...judging, result }),
					state(resultAt, { phase: "result", phaseEndsAt: at(resultAt + RESULT_MS), result }),
				],
			};
		}
		case "result": {
			const judgingAt = 1_000;
			// 暗転（1.2秒）が済んでから色づく（0.8秒）長さ。
			const resultAt = judgingAt + 2_400;
			const idleAt = resultAt + RESULT_HOLD_MS;
			return {
				lengthMs: idleAt + 4_000,
				colorId,
				steps: [
					state(0, { phase: "question" }),
					state(judgingAt, {
						phase: "judging",
						answeredAt: at(judgingAt),
						phaseEndsAt: at(resultAt),
						result,
					}),
					state(resultAt, { phase: "result", phaseEndsAt: at(resultAt + RESULT_MS), result }),
					state(idleAt, { phase: "idle" }),
				],
			};
		}
	}
}
