import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../../src/data/questions.ts";
import {
	answerCandidates,
	cellOf,
	INITIAL_POSITION,
	isValidAnswer,
	nearestStop,
	roundPosition,
	sameAnswer,
	toggleSelection,
	toPercent,
} from "../../src/shared/answer.ts";
import type { MultipleChoiceQuestion, Question, RankedChoiceQuestion } from "../../src/shared/types.ts";

const multiple: MultipleChoiceQuestion = {
	id: "q",
	kind: "multiple",
	prompt: "",
	guide: "",
	minSelections: 2,
	maxSelections: 3,
	options: ["a", "b", "c", "d"].map((id) => ({ id, label: id })),
};

const ranked: RankedChoiceQuestion = {
	id: "r",
	kind: "ranked",
	prompt: "",
	guide: "",
	minSelections: 2,
	maxSelections: 2,
	options: ["a", "b", "c"].map((id) => ({ id, label: id })),
};

/** 仮データから入力方式 `kind` の最初の質問を取り出す。 */
function sample<K extends Question["kind"]>(kind: K): Extract<Question, { kind: K }> {
	const question = QUESTIONS.find((candidate) => candidate.kind === kind);
	if (!question) throw new Error(`質問定義に ${kind} の質問がありません`);
	return question as Extract<Question, { kind: K }>;
}

describe("回答", () => {
	it("複数選択は定義順の組み合わせを、順位つき選択は全ての並びを列挙する", () => {
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
		// 3個から2個の並び: 6通り。
		expect(answerCandidates(ranked)).toHaveLength(6);
		// Q1は「どれとも決められない」を単独で選べる。6個から1〜2個（6 + 15）と単独選択の1通り。
		expect(answerCandidates(sample("multiple"))).toHaveLength(22);
	});

	it("列挙した回答はすべて有効", () => {
		for (const question of [...QUESTIONS, multiple, ranked])
			for (const answer of answerCandidates(question)) expect(isValidAnswer(question, answer)).toBe(true);
	});

	it("スライダーと2Dマップの初期位置は真ん中で、そのまま有効な回答", () => {
		expect(isValidAnswer(sample("slider"), INITIAL_POSITION)).toBe(true);
		expect(isValidAnswer(sample("map"), { x: INITIAL_POSITION, y: INITIAL_POSITION })).toBe(true);
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

	it("順位つき選択は個数、重複、IDを確かめ、並び順は問わない", () => {
		expect(isValidAnswer(ranked, ["b", "a"])).toBe(true);
		expect(isValidAnswer(ranked, ["a"])).toBe(false);
		expect(isValidAnswer(ranked, ["a", "a"])).toBe(false);
		expect(isValidAnswer(ranked, ["a", "b", "c"])).toBe(false);
		expect(isValidAnswer(ranked, ["a", "x"])).toBe(false);
	});

	it("単独選択の選択肢はほかの選択肢と同時に選べない", () => {
		const q1 = sample("multiple");
		expect(isValidAnswer(q1, ["q1_7"])).toBe(true);
		expect(isValidAnswer(q1, ["q1_1", "q1_7"])).toBe(false);
	});

	it("選択肢を押すと、上限、単独選択、選んだ順に従って次の回答を返す", () => {
		const q1 = sample("multiple");
		expect(toggleSelection(q1, [], "q1_3")).toEqual(["q1_3"]);
		// 複数選択は定義順に並べる。
		expect(toggleSelection(q1, ["q1_3"], "q1_1")).toEqual(["q1_1", "q1_3"]);
		// 上限に達したら、選んでいない選択肢は押せない。選択済みの解除はできる。
		expect(toggleSelection(q1, ["q1_1", "q1_3"], "q1_2")).toBeNull();
		expect(toggleSelection(q1, ["q1_1", "q1_3"], "q1_1")).toEqual(["q1_3"]);
		// 単独選択は他を外して置き換え、他を押すと単独選択が外れる。上限でも切り替えられる。
		expect(toggleSelection(q1, ["q1_1", "q1_3"], "q1_7")).toEqual(["q1_7"]);
		expect(toggleSelection(q1, ["q1_7"], "q1_2")).toEqual(["q1_2"]);
		expect(toggleSelection(q1, [], "nope")).toBeNull();
		// 順位つき選択は選んだ順を保ち、外すと繰り上がる。
		expect(toggleSelection(ranked, ["c"], "a")).toEqual(["c", "a"]);
		expect(toggleSelection(ranked, ["c", "a"], "c")).toEqual(["a"]);
		expect(toggleSelection(ranked, ["c", "a"], "b")).toBeNull();
	});

	it("AIへ渡す値は0〜100の整数", () => {
		expect([0, 0.004, 0.005, 0.5, 0.999, 1, 1.5, -1].map(toPercent)).toEqual([0, 0, 1, 50, 100, 100, 100, 0]);
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
