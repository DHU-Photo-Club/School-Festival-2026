import type { Answer, ChoiceQuestion, MapPoint, Question } from "./types.ts";
import { MAP_SIZE, SLIDER_STOP_IDS } from "./types.ts";

/** `readonly` の配列にも効く `Array.isArray`。 */
const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** 0以上1以下の有限の数か。 */
const isUnit = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** 2Dマップの位置として正しいか。 */
export function isMapPoint(value: unknown): value is MapPoint {
	if (typeof value !== "object" || value === null || isList(value)) return false;
	const point = value as Record<string, unknown>;
	return isUnit(point.x) && isUnit(point.y);
}

/** 位置を小数第3位までに丸める。iPadから送る回答の値をそろえる。 */
export const roundPosition = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

/** スライダーと2Dマップの初期位置（refs/handoff 実装仕様書3章。初期位置のままでも回答として有効）。 */
export const INITIAL_POSITION = 0.5;

/**
 * 選択肢IDの配列が、複数選択または順位つき選択の回答として正しいか。定義済みのIDを重複なく、
 * 個数が下限以上かつ上限以下で並べる。単独選択の選択肢（`exclusive`）は一つだけで選ぶ。
 * 複数選択は選択肢の定義順に並べる。順位つき選択の並びは順位なので、順序は問わない。
 */
function isValidSelection(question: Exclude<ChoiceQuestion, { kind: "single" }>, answer: unknown): boolean {
	if (!isList(answer)) return false;
	if (answer.length < question.minSelections || answer.length > question.maxSelections) return false;
	const ids = question.options.map((option) => option.id);
	const indices = answer.map((id) => (typeof id === "string" ? ids.indexOf(id) : -1));
	if (indices.some((index) => index < 0)) return false;
	if (new Set(indices).size !== indices.length) return false;
	if (answer.length > 1 && indices.some((index) => question.options[index].exclusive)) return false;
	if (question.kind === "multiple") return indices.every((index, i) => i === 0 || indices[i - 1] < index);
	return true;
}

/**
 * 回答が質問の形式に合っているか（refs/handoff 実装仕様書3章「入力完了」）。単選択は定義済みの選択肢ID、
 * 複数選択と順位つき選択は `isValidSelection`、スライダーは0〜1の数、2Dマップは各座標が0〜1の位置。
 */
export function isValidAnswer(question: Question, answer: unknown): answer is Answer {
	switch (question.kind) {
		case "single":
			return typeof answer === "string" && question.options.some((option) => option.id === answer);
		case "multiple":
		case "ranked":
			return isValidSelection(question, answer);
		case "slider":
			return isUnit(answer);
		case "map":
			return isMapPoint(answer);
	}
}

/**
 * 複数選択と順位つき選択で、選択肢 `id` を押したときの次の回答（refs/handoff 実装仕様書3章）。
 * - 選択済みなら外す。順位つき選択では残りが繰り上がる。
 * - 単独選択の選択肢を押すと、ほかをすべて外してそれだけにする。ほかの選択肢を押すと単独選択の選択肢を外す。
 * - 上限まで選んでいると、選択済みの解除と単独選択の選択肢への切り替えだけを受け付け、それ以外は `null`。
 * 複数選択は定義順、順位つき選択は選んだ順に並べる。
 */
export function toggleSelection(
	question: Exclude<ChoiceQuestion, { kind: "single" }>,
	selected: readonly string[],
	id: string,
): string[] | null {
	const option = question.options.find((candidate) => candidate.id === id);
	if (!option) return null;
	let next: string[];
	if (selected.includes(id)) next = selected.filter((candidate) => candidate !== id);
	else if (option.exclusive) next = [id];
	else {
		const kept = selected.filter((candidate) => !question.options.find((o) => o.id === candidate)?.exclusive);
		if (kept.length >= question.maxSelections) return null;
		next = [...kept, id];
	}
	if (question.kind === "multiple") {
		return question.options.filter((candidate) => next.includes(candidate.id)).map((candidate) => candidate.id);
	}
	return next;
}

/** スライダーの位置に最も近い回答位置の番号。画面の補助文に使う。 */
export const nearestStop = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * (SLIDER_STOP_IDS.length - 1));

/** 2Dマップの位置を含む区画の番号（上の行から左→右の順）。画面の補助文に使う。 */
export function cellOf(point: MapPoint): number {
	const axis = (value: number) => Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(value * MAP_SIZE)));
	return axis(point.y) * MAP_SIZE + axis(point.x);
}

/** 区画 `index` の中心の位置。 */
export function cellCenter(index: number): MapPoint {
	return {
		x: ((index % MAP_SIZE) + 0.5) / MAP_SIZE,
		y: (Math.floor(index / MAP_SIZE) + 0.5) / MAP_SIZE,
	};
}

/** 0〜1の位置を、AIへ渡す0〜100の整数にする（refs/handoff 実装仕様書3章。刻み1）。 */
export const toPercent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100);

/** 二つの回答が同じか。どちらかが未回答（`null` か `undefined`）なら `false`。 */
export function sameAnswer(a: Answer | null | undefined, b: Answer | null | undefined): boolean {
	if (a === null || a === undefined || b === null || b === undefined) return false;
	if (typeof a !== "object" || typeof b !== "object") return a === b;
	if (isList(a) || isList(b)) {
		if (!isList(a) || !isList(b)) return false;
		return a.length === b.length && a.every((id, index) => id === b[index]);
	}
	return a.x === b.x && a.y === b.y;
}

/** 複数選択と順位つき選択で選べる組み合わせ。複数選択は定義順、順位つき選択は全ての並びを含む。 */
function selections(question: Exclude<ChoiceQuestion, { kind: "single" }>): string[][] {
	const ids = question.options.map((option) => option.id);
	const result: string[][] = [];
	const visit = (picked: string[]) => {
		if (picked.length >= question.minSelections && isValidSelection(question, picked)) result.push([...picked]);
		if (picked.length === question.maxSelections) return;
		for (const id of ids) {
			if (picked.includes(id)) continue;
			if (question.kind === "multiple" && picked.length > 0 && ids.indexOf(id) < ids.indexOf(picked.at(-1) ?? ""))
				continue;
			visit([...picked, id]);
		}
	};
	visit([]);
	return result;
}

/**
 * テストと確認用の回答の候補。単選択、複数選択、順位つき選択は取りうる回答のすべて、
 * スライダーは両端と中央、2Dマップは四隅と中央。
 */
export function answerCandidates(question: Question): Answer[] {
	switch (question.kind) {
		case "single":
			return question.options.map((option) => option.id);
		case "multiple":
		case "ranked":
			return selections(question);
		case "slider":
			return [0.5, 0, 1, 0.25, 0.75];
		case "map":
			return [
				{ x: 0.5, y: 0.5 },
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
				{ x: 0, y: 1 },
				{ x: 1, y: 0 },
			];
	}
}
