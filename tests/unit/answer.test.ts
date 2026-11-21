import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../../src/data/questions.ts";
import {
	answerCandidates,
	answerScores,
	cellCenter,
	cellOf,
	isValidAnswer,
	mapWeights,
	nearestStop,
	roundPosition,
	sameAnswer,
	sliderWeights,
} from "../../src/shared/answer.ts";
import type { MultipleChoiceQuestion, Question } from "../../src/shared/types.ts";

const multiple: MultipleChoiceQuestion = {
	id: "q",
	kind: "multiple",
	theme: "",
	prompt: "",
	minSelections: 2,
	maxSelections: 3,
	options: ["a", "b", "c", "d"].map((id) => ({ id, label: id, scores: { red: 1 } })),
};

/** 仮データから入力方式 `kind` の最初の質問を取り出す。 */
function sample<K extends Question["kind"]>(kind: K): Extract<Question, { kind: K }> {
	const question = QUESTIONS.find((candidate) => candidate.kind === kind);
	if (!question) throw new Error(`仮データに ${kind} の質問がありません`);
	return question as Extract<Question, { kind: K }>;
}

describe("回答", () => {
	it("選択式は取りうる回答を、スライダーと2Dマップは等しい幅に分けた区間の中点を列挙する", () => {
		expect(answerCandidates(sample("single"))).toEqual(sample("single").options.map((option) => option.id));
		expect(answerCandidates(sample("slider"), { slider: 5, map: 3 })).toEqual([0.1, 0.3, 0.5, 0.7, 0.9]);
		expect(answerCandidates(sample("slider"))).toHaveLength(8);
		// 3×3に分けると、中点は区画の中心と一致する。
		expect(answerCandidates(sample("map"), { slider: 5, map: 3 })).toEqual(
			[0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => cellCenter(index)),
		);
		expect(answerCandidates(sample("map"))).toHaveLength(81);
		// 4個から2〜3個: 6 + 4 通り。各組み合わせは定義順。
		expect(answerCandidates(multiple)).toEqual([
			["a", "b"],
			["a", "b", "c"],
			["a", "b", "d"],
			["a", "c"],
			["a", "c", "d"],
			["a", "d"],
			["b", "c"],
			["b", "c", "d"],
			["b", "d"],
			["c", "d"],
		]);
	});

	it("列挙した回答はすべて有効", () => {
		for (const question of [...QUESTIONS, multiple])
			for (const answer of answerCandidates(question)) expect(isValidAnswer(question, answer)).toBe(true);
	});

	it("スライダーは0〜1の数、2Dマップは各座標が0〜1の位置だけを受け付ける", () => {
		const slider = sample("slider");
		for (const answer of [0, 0.42, 1]) expect(isValidAnswer(slider, answer)).toBe(true);
		for (const answer of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "center", { x: 0.5, y: 0.5 }, null])
			expect(isValidAnswer(slider, answer)).toBe(false);
		const map = sample("map");
		for (const answer of [
			{ x: 0, y: 1 },
			{ x: 0.3, y: 0.7 },
		])
			expect(isValidAnswer(map, answer)).toBe(true);
		for (const answer of [{ x: 0.5 }, { x: -0.1, y: 0.5 }, { x: 0.5, y: 2 }, { x: "0.5", y: 0.5 }, [0.5, 0.5], 0.5])
			expect(isValidAnswer(map, answer)).toBe(false);
	});

	it("複数選択は個数、重複、並び順、IDを確かめる", () => {
		expect(isValidAnswer(multiple, ["a"])).toBe(false);
		expect(isValidAnswer(multiple, ["a", "b", "c", "d"])).toBe(false);
		expect(isValidAnswer(multiple, ["b", "a"])).toBe(false);
		expect(isValidAnswer(multiple, ["a", "a"])).toBe(false);
		expect(isValidAnswer(multiple, ["a", "x"])).toBe(false);
		expect(isValidAnswer(multiple, "a")).toBe(false);
		expect(isValidAnswer(multiple, null)).toBe(false);
	});

	it("スライダーの重みは両隣の回答位置への距離で決まり、合計は1", () => {
		expect(sliderWeights(0)).toEqual([[0, 1]]);
		expect(sliderWeights(1)).toEqual([[4, 1]]);
		expect(sliderWeights(0.5)).toEqual([[2, 1]]);
		expect(sliderWeights(0.375)).toEqual([
			[1, 0.5],
			[2, 0.5],
		]);
		for (const x of [0.01, 0.33, 0.61, 0.99]) {
			const total = sliderWeights(x).reduce((sum, [, weight]) => sum + weight, 0);
			expect(total).toBeCloseTo(1, 12);
		}
	});

	it("2Dマップの重みは近くの区画の中心への距離で決まり、合計は1", () => {
		// 区画の中心ではその区画だけ。外周の中心より外側も外周の区画だけ。
		expect(mapWeights(cellCenter(4))).toEqual([[4, 1]]);
		expect(mapWeights({ x: 0, y: 0 })).toEqual([[0, 1]]);
		expect(mapWeights({ x: 1, y: 1 })).toEqual([[8, 1]]);
		// 4区画の中心の真ん中では4区画が4分の1ずつ。
		const quarter = mapWeights({ x: 1 / 3, y: 1 / 3 });
		expect(quarter.map(([index]) => index)).toEqual([0, 1, 3, 4]);
		for (const [, weight] of quarter) expect(weight).toBeCloseTo(0.25, 12);
		for (const point of [
			{ x: 0.1, y: 0.9 },
			{ x: 0.45, y: 0.2 },
			{ x: 0.77, y: 0.6 },
		]) {
			const total = mapWeights(point).reduce((sum, [, weight]) => sum + weight, 0);
			expect(total).toBeCloseTo(1, 12);
		}
	});

	it("重みを掛けた配点を返す", () => {
		const scored = {
			...multiple,
			options: multiple.options.map((option, index) => ({ ...option, scores: { blue: index + 1 } })),
		};
		expect(answerScores(scored, ["b", "d"])).toEqual([{ blue: 2 }, { blue: 4 }]);
		const slider = sample("slider");
		expect(answerScores(slider, 0.5)).toEqual([slider.stops[2].scores]);
		const halfway = answerScores(slider, 0.375);
		expect(halfway).toHaveLength(2);
		for (const [colorId, points] of Object.entries(slider.stops[1].scores))
			expect(halfway[0][colorId as keyof (typeof halfway)[0]]).toBe((points ?? 0) / 2);
	});

	it("補助文に使う回答位置と区画は、最も近い回答位置と位置を含む区画", () => {
		expect([0, 0.12, 0.13, 0.5, 0.87, 0.88, 1].map(nearestStop)).toEqual([0, 0, 1, 2, 3, 4, 4]);
		expect(cellOf({ x: 0, y: 0 })).toBe(0);
		expect(cellOf({ x: 0.5, y: 0.1 })).toBe(1);
		expect(cellOf({ x: 0.99, y: 0.5 })).toBe(5);
		expect(cellOf({ x: 1, y: 1 })).toBe(8);
		expect(roundPosition(0.12345)).toBe(0.123);
		expect(roundPosition(1.2)).toBe(1);
		expect(roundPosition(-0.2)).toBe(0);
	});

	it("同じ回答かを比べる", () => {
		expect(sameAnswer("left", "left")).toBe(true);
		expect(sameAnswer("left", "right")).toBe(false);
		expect(sameAnswer(["a", "b"], ["a", "b"])).toBe(true);
		expect(sameAnswer(["a", "b"], ["a"])).toBe(false);
		expect(sameAnswer("a", ["a"])).toBe(false);
		expect(sameAnswer(0.25, 0.25)).toBe(true);
		expect(sameAnswer(0.25, 0.26)).toBe(false);
		expect(sameAnswer({ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.2 })).toBe(true);
		expect(sameAnswer({ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.3 })).toBe(false);
		expect(sameAnswer({ x: 0.1, y: 0.2 }, ["a"])).toBe(false);
		expect(sameAnswer(null, null)).toBe(false);
		expect(sameAnswer(["a"], undefined)).toBe(false);
	});
});
