import { backgroundColor, foregroundColor } from "./palette.ts";
import type { Palette, PaletteId, Photo, Question, Sequence } from "./types.ts";
import { MAP_CELL_IDS, PALETTE_IDS, QUESTION_KINDS, SEQUENCE_TARGETS, SLIDER_STOP_IDS } from "./types.ts";

/** 写真IDとシーケンスIDの形式（仕様書12.1節）。 */
export const PHOTO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 質問IDと選択肢IDの形式。refs/handoff の `Q1`、`q1_1` を使えるよう、英数字、ハイフン、アンダースコアにする。 */
export const QUESTION_ID_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;
/** 色名などの文字と背景の最小コントラスト比（仕様書7.2.2節）。 */
export const MIN_CONTRAST = 4.5;

function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2のコントラスト比。 */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** 単選択、複数選択、順位つき選択の選択肢の数の範囲。 */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;

/** 空白を除いて文字が残るか。 */
const filled = (text: unknown) => typeof text === "string" && text.trim().length > 0;

/** 質問の形式ごとの確認。 */
function validateQuestionShape(question: Question): string[] {
	const label = `質問 ${question.id}`;
	const errors: string[] = [];
	if (!QUESTION_ID_PATTERN.test(question.id))
		errors.push(`${label} のIDは英数字、ハイフン、アンダースコアで書きます`);
	if (!filled(question.prompt)) errors.push(`${label} の質問文がありません`);
	if (!filled(question.guide)) errors.push(`${label} の案内文がありません`);
	switch (question.kind) {
		case "slider": {
			if (question.stops.map((stop) => stop.id).join(",") !== SLIDER_STOP_IDS.join(","))
				errors.push(`${label} の回答位置が不正です`);
			if (!filled(question.leftLabel) || !filled(question.rightLabel))
				errors.push(`${label} の左右端の語がありません`);
			for (const stop of question.stops)
				if (!filled(stop.caption)) errors.push(`${label} ${stop.id} の補助文がありません`);
			const bounds = question.interpretation.map((range) => range.upTo);
			if (
				bounds.length === 0 ||
				bounds.at(-1) !== 100 ||
				bounds.some((bound, i) => !Number.isInteger(bound) || (i > 0 && bound <= bounds[i - 1])) ||
				question.interpretation.some((range) => !filled(range.label))
			)
				errors.push(`${label} の補助ラベルは上限の昇順で、最後を100にします`);
			break;
		}
		case "map":
			if (question.cells.map((cell) => cell.id).join(",") !== MAP_CELL_IDS.join(","))
				errors.push(`${label} の区画が不正です`);
			if (
				[question.leftLabel, question.rightLabel, question.topLabel, question.bottomLabel].some(
					(t) => !filled(t),
				)
			)
				errors.push(`${label} の4辺の語がありません`);
			if (!filled(question.axisIds.horizontal) || !filled(question.axisIds.vertical))
				errors.push(`${label} の軸の名前がありません`);
			for (const cell of question.cells)
				if (!filled(cell.caption)) errors.push(`${label} ${cell.id} の補助文がありません`);
			break;
		case "single":
		case "multiple":
		case "ranked": {
			const { options } = question;
			if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS)
				errors.push(`${label} の選択肢は${MIN_OPTIONS}〜${MAX_OPTIONS}個にします`);
			const ids = options.map((option) => option.id);
			if (new Set(ids).size !== ids.length) errors.push(`${label} の選択肢IDが重複しています`);
			for (const option of options) {
				if (!QUESTION_ID_PATTERN.test(option.id))
					errors.push(`${label} の選択肢ID ${option.id} は英数字、ハイフン、アンダースコアで書きます`);
				if (!filled(option.label)) errors.push(`${label} ${option.id} の表示文がありません`);
				if (option.exclusive && question.kind !== "multiple")
					errors.push(`${label} ${option.id} の単独選択は複数選択の質問だけで使えます`);
			}
			if (question.kind !== "single") {
				const { minSelections: min, maxSelections: max } = question;
				if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max || max > options.length)
					errors.push(`${label} の選択数は 1 <= minSelections <= maxSelections <= 選択肢の数 にします`);
			}
			break;
		}
		default:
			errors.push(`${label} の kind は ${QUESTION_KINDS.join("、")} のいずれかにします`);
	}
	return errors;
}

/** パレット、診断定義、写真カタログの整合性を確認し、問題の一覧を返す。 */
export function validateExhibitData(input: {
	palette: Palette;
	questions: readonly Question[];
	photos: readonly Photo[];
}): string[] {
	const errors: string[] = [];
	const { palette, questions, photos } = input;

	const colorIds = palette.colors.map((color) => color.id);
	if (colorIds.join(",") !== PALETTE_IDS.join(","))
		errors.push(`パレットの色IDは ${PALETTE_IDS.join("、")} の順にします`);
	for (const color of palette.colors) {
		if (!filled(color.name)) errors.push(`パレット ${color.id} の色名がありません`);
		if (!(color.h >= 0 && color.h < 360) || !(color.s >= 0 && color.s <= 100) || !(color.l >= 0 && color.l <= 100))
			errors.push(`パレット ${color.id} の HSL が範囲外です`);
		if (contrastRatio(foregroundColor(color), backgroundColor(color)) < MIN_CONTRAST)
			errors.push(`パレット ${color.id} の文字色と背景色のコントラスト比が4.5:1未満です`);
	}

	const photoIds = new Set<string>();
	for (const photo of photos) {
		const label = `写真 ${photo.id}`;
		if (!PHOTO_ID_PATTERN.test(photo.id)) errors.push(`写真ID ${photo.id} の形式が不正です`);
		if (photoIds.has(photo.id)) errors.push(`写真ID ${photo.id} が重複しています`);
		photoIds.add(photo.id);
		if (!Number.isInteger(photo.idleOrder) || photo.idleOrder < 0)
			errors.push(`${label} の idleOrder は0以上の整数にします`);
		if (!Number.isInteger(photo.width) || photo.width <= 0 || !Number.isInteger(photo.height) || photo.height <= 0)
			errors.push(`${label} の寸法は正の整数にします`);
		for (const id of [...photo.colorTags.overall, ...photo.colorTags.partial]) {
			if (!PALETTE_IDS.includes(id as PaletteId)) errors.push(`${label} の色タグ ${id} はパレットにありません`);
		}
		if ([...photo.contentTags, ...photo.moodTags].some((tag) => !filled(tag)))
			errors.push(`${label} に空のタグがあります`);
		if (!filled(photo.description)) errors.push(`${label} の説明がありません`);
		if (photo.shareAllowed && !photo.creditName)
			errors.push(`${label} は配布を許可していますが creditName がありません`);
	}

	const questionIds = questions.map((question) => question.id);
	if (new Set(questionIds).size !== questionIds.length) errors.push("質問IDが重複しています");
	for (const question of questions) errors.push(...validateQuestionShape(question));

	return errors;
}

/**
 * `PUBLIC_ORIGIN` の確認（仕様書10.1節）。HTTPSで、末尾スラッシュがなく、
 * 結果ページのWorker名から決まる `https://{workerName}.{subdomain}.workers.dev` と一致する必要がある。
 */
export function validatePublicOrigin(origin: string, workerName: string): string[] {
	const errors: string[] = [];
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return ["PUBLIC_ORIGIN がURLではありません"];
	}
	if (url.protocol !== "https:") errors.push("PUBLIC_ORIGIN はHTTPSにします");
	if (origin.endsWith("/") || url.origin !== origin)
		errors.push("PUBLIC_ORIGIN はパスと末尾スラッシュなしのoriginにします");
	const escaped = workerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (!new RegExp(`^${escaped}\\.[a-z0-9-]+\\.workers\\.dev$`).test(url.hostname)) {
		errors.push(`PUBLIC_ORIGIN がデプロイ先 ${workerName}.<subdomain>.workers.dev と一致しません`);
	}
	return errors;
}

/** `RESULTS_PUBLISHED_UNTIL` はISO 8601形式のUTC時刻にする（仕様書10.1節）。 */
export function validatePublishedUntil(value: string): string[] {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
		return ["RESULTS_PUBLISHED_UNTIL はISO 8601形式のUTC時刻にします"];
	}
	return [];
}

/** シーケンス定義の整合性を確認し、問題の一覧を返す。 */
export function validateSequences(sequences: readonly Sequence[]): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	const targets = new Set<string>();
	for (const sequence of sequences) {
		const label = `シーケンス ${sequence.id}`;
		if (!PHOTO_ID_PATTERN.test(sequence.id)) errors.push(`${label} のIDは英小文字、数字、ハイフンで書きます`);
		if (ids.has(sequence.id)) errors.push(`${label} のIDが重複しています`);
		ids.add(sequence.id);
		if (!SEQUENCE_TARGETS.includes(sequence.before)) errors.push(`${label} の before が不正です`);
		else if (targets.has(sequence.before)) errors.push(`${sequence.before} の前に再生するシーケンスが複数あります`);
		else targets.add(sequence.before);
		if (!Number.isSafeInteger(sequence.durationMs) || sequence.durationMs <= 0)
			errors.push(`${label} の durationMs は正の整数にします`);
	}
	return errors;
}
