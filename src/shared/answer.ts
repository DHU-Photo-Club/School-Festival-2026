import type { Answer, MapPoint, MultipleChoiceQuestion, Question, Scores } from "./types.ts";
import { MAP_SIZE, SLIDER_STOP_IDS } from "./types.ts";

interface ScoredItem {
	id: string;
	scores: Scores;
}

/** 質問で配点を持つ項目。単選択と複数選択は選択肢、スライダーは回答位置、2Dマップは区画。 */
export function answerItems(question: Question): readonly ScoredItem[] {
	switch (question.kind) {
		case "single":
		case "multiple":
			return question.options;
		case "slider":
			return question.stops;
		case "map":
			return question.cells;
	}
}

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

/**
 * 回答が質問の形式に合っているか。単選択は定義済みの選択肢ID、複数選択は定義済みの選択肢IDを重複なく
 * 定義順に並べ、個数が下限以上かつ上限以下の配列、スライダーは0〜1の数、2Dマップは各座標が0〜1の位置。
 */
export function isValidAnswer(question: Question, answer: unknown): answer is Answer {
	switch (question.kind) {
		case "single":
			return typeof answer === "string" && question.options.some((option) => option.id === answer);
		case "slider":
			return isUnit(answer);
		case "map":
			return isMapPoint(answer);
		case "multiple": {
			if (!isList(answer)) return false;
			if (answer.length < question.minSelections || answer.length > question.maxSelections) return false;
			const ids = question.options.map((option) => option.id);
			let previous = -1;
			for (const id of answer) {
				const index = typeof id === "string" ? ids.indexOf(id) : -1;
				if (index <= previous) return false;
				previous = index;
			}
			return true;
		}
	}
}

/** 隣り合う2点の間の位置 `u`（0〜`count - 1`）を、左右の点の番号と重みにする。 */
function between(u: number, count: number): [number, number][] {
	const clamped = Math.min(count - 1, Math.max(0, u));
	const index = Math.min(Math.floor(clamped), count - 2);
	const fraction = clamped - index;
	return [
		[index, 1 - fraction],
		[index + 1, fraction],
	];
}

/** スライダーの位置 `x`（0〜1）に効く回答位置の番号と重み。重みの合計は1。 */
export function sliderWeights(x: number): [number, number][] {
	return between(x * (SLIDER_STOP_IDS.length - 1), SLIDER_STOP_IDS.length).filter(([, weight]) => weight > 0);
}

/**
 * 2Dマップの位置に効く区画の番号と重み。重みの合計は1。区画の中心の間は縦横それぞれ距離で混ぜる
 * （双線形補間）。横または縦の位置が外周の区画の中心より外側にあるときは、その向きの位置を外周の
 * 区画の中心とみなす。辺の近くでは外周の2区画を混ぜ、四隅の近くではその隅の区画だけを使う。
 */
export function mapWeights(point: MapPoint): [number, number][] {
	const axis = (value: number) => between(value * MAP_SIZE - 0.5, MAP_SIZE);
	const result: [number, number][] = [];
	for (const [row, rowWeight] of axis(point.y))
		for (const [column, columnWeight] of axis(point.x)) {
			const weight = rowWeight * columnWeight;
			if (weight > 0) result.push([row * MAP_SIZE + column, weight]);
		}
	return result;
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

const scale = (scores: Scores, weight: number): Scores =>
	Object.fromEntries(Object.entries(scores).map(([colorId, points]) => [colorId, (points ?? 0) * weight]));

/**
 * 回答で加点する配点の一覧。単選択と複数選択は選んだ選択肢の配点、スライダーと2Dマップは近くの
 * 回答位置や区画の配点に距離の重みを掛けたもの。回答の形式は `isValidAnswer` で確かめてから渡す。
 */
export function answerScores(question: Question, answer: Answer): Scores[] {
	switch (question.kind) {
		case "single":
		case "multiple": {
			const selected = typeof answer === "string" ? [answer] : isList(answer) ? answer : [];
			return question.options.filter((option) => selected.includes(option.id)).map((option) => option.scores);
		}
		case "slider":
			return sliderWeights(answer as number).map(([index, weight]) =>
				scale(question.stops[index].scores, weight),
			);
		case "map":
			return mapWeights(answer as MapPoint).map(([index, weight]) => scale(question.cells[index].scores, weight));
	}
}

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

/** 分布の集計で、スライダーと2Dマップの位置を区切る細かさ（一辺を等しい幅に分ける区間の数。1以上の整数）。 */
export interface SampleResolution {
	slider: number;
	map: number;
}

/**
 * 既定の細かさ。スライダーは8区間、2Dマップは9×9区間。細かくしても各色の割合の変化が1ポイント前後に
 * 収まり、集計が数秒で終わる値にした。
 */
export const DEFAULT_RESOLUTION: SampleResolution = { slider: 8, map: 9 };

/**
 * 0から1までを `count` 個の等しい幅の区間に分け、各区間の中点を並べた配列。端を含めて等分すると、
 * 端の点が他の点の半分の幅しか表さないのに同じ1件として数えるため、中点を使って各点が同じ幅
 * （2Dマップでは面積）を表すようにする。
 */
const steps = (count: number) => Array.from({ length: count }, (_, index) => (index + 0.5) / count);

/** 複数選択で選べる組み合わせ。各組み合わせは選択肢の定義順に並べる。 */
function selections(question: MultipleChoiceQuestion): string[][] {
	const ids = question.options.map((option) => option.id);
	const result: string[][] = [];
	const visit = (start: number, picked: string[]) => {
		if (picked.length >= question.minSelections) result.push([...picked]);
		if (picked.length === question.maxSelections) return;
		for (let index = start; index < ids.length; index += 1) visit(index + 1, [...picked, ids[index]]);
	};
	visit(0, []);
	return result;
}

/**
 * 分布の集計に使う回答の一覧。単選択と複数選択は取りうる回答のすべて、スライダーと2Dマップは
 * `resolution` で指定した数の区間に分けた各区間の中点（2Dマップは縦横それぞれ分割した組）（連続値のため、すべては数えられない）。
 */
export function answerCandidates(question: Question, resolution = DEFAULT_RESOLUTION): Answer[] {
	switch (question.kind) {
		case "single":
			return question.options.map((option) => option.id);
		case "multiple":
			return selections(question);
		case "slider":
			return steps(resolution.slider);
		case "map":
			return steps(resolution.map).flatMap((y) => steps(resolution.map).map((x) => ({ x, y })));
	}
}
