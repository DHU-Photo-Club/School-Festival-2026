import { describe, expect, it } from "vitest";
import { RESULT_COLORS } from "../../src/data/colors.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { answerPatternCount, judge, resultDistribution } from "../../src/shared/diagnosis.ts";
import type {
	MapQuestion,
	MultipleChoiceQuestion,
	ResultColor,
	Scores,
	SliderQuestion,
} from "../../src/shared/types.ts";
import { COLOR_IDS, MAP_CELL_IDS, SLIDER_STOP_IDS } from "../../src/shared/types.ts";
import { sampleAnswer } from "./helpers.ts";

const stops = (scores: Scores[]): SliderQuestion["stops"] =>
	SLIDER_STOP_IDS.map((id, index) => ({
		id,
		caption: id,
		scores: scores[index],
	})) as unknown as SliderQuestion["stops"];

const question = (id: string, scores: Scores[]): SliderQuestion => ({
	id,
	kind: "slider",
	theme: "",
	prompt: "",
	leftLabel: "",
	rightLabel: "",
	stops: stops(scores),
});

const multiple = (
	id: string,
	scores: Scores[],
	minSelections: number,
	maxSelections: number,
): MultipleChoiceQuestion => ({
	id,
	kind: "multiple",
	theme: "",
	prompt: "",
	minSelections,
	maxSelections,
	options: scores.map((score, index) => ({ id: `o${index}`, label: `o${index}`, scores: score })),
});

const map = (id: string, scores: Scores[]): MapQuestion => ({
	id,
	kind: "map",
	theme: "",
	prompt: "",
	leftLabel: "",
	rightLabel: "",
	topLabel: "",
	bottomLabel: "",
	cells: MAP_CELL_IDS.map((cellId, index) => ({
		id: cellId,
		caption: cellId,
		scores: scores[index],
	})) as unknown as MapQuestion["cells"],
});

/** 5段階の回答位置のスライダー上の位置。 */
const STOP = { farLeft: 0, left: 0.25, center: 0.5, right: 0.75, farRight: 1 };
/** テストで全パターンを数えるときの細かさ。2Dマップは区画の中心だけを使う。 */
const COARSE = { slider: 4, map: 3 };

const fixtureColors: ResultColor[] = RESULT_COLORS.map((color, index) => ({ ...color, tieBreakPriority: index }));

describe("judge", () => {
	it("集計する回答パターンは、スライダーと2Dマップを格子状に区切った位置の組み合わせ", () => {
		// 仮データ: スライダー4問、4択の単選択、2Dマップ、6択から1〜2個の複数選択（21通り）。
		// 既定ではスライダーを8区間、2Dマップを9×9区間に分け、各区間の中点を使う。
		expect(answerPatternCount(QUESTIONS)).toBe(8 ** 4 * 4 * 9 ** 2 * 21);
		expect(answerPatternCount(QUESTIONS, COARSE)).toBe(4 ** 4 * 4 * 3 ** 2 * 21);
	});

	it("集計した回答パターンで、定義済み8色のいずれか一つを返す", () => {
		const counts = resultDistribution(QUESTIONS, RESULT_COLORS, COARSE);
		const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
		expect(total).toBe(answerPatternCount(QUESTIONS, COARSE));
		expect(Object.keys(counts).sort()).toEqual([...COLOR_IDS].sort());
	});

	it("全回答経路の集計は、一つずつ判定した結果と一致する", () => {
		const questions = [
			question("q1", [{ red: 2 }, { blue: 1 }, { green: 1, cyan: 1 }, { yellow: 1 }, { violet: 2 }]),
			multiple("q2", [{ red: 1 }, { blue: 1 }, { green: 1 }, { violet: 1 }], 1, 3),
			question("q3", [{ orange: 2 }, { magenta: 1 }, { cyan: 2 }, { red: 1, blue: 1 }, { yellow: 2 }]),
		];
		const expected = Object.fromEntries(COLOR_IDS.map((id) => [id, 0]));
		// スライダーは既定の8区間。4個から1〜3個を選ぶ組み合わせは 4 + 6 + 4 = 14 通り。
		for (let a = 0; a < 8; a += 1)
			for (let b = 0; b < 14; b += 1)
				for (let c = 0; c < 8; c += 1) {
					const answers = {
						q1: sampleAnswer(questions[0], a),
						q2: sampleAnswer(questions[1], b),
						q3: sampleAnswer(questions[2], c),
					};
					expected[judge(questions, fixtureColors, answers)] += 1;
				}
		expect(answerPatternCount(questions)).toBe(8 * 14 * 8);
		expect(resultDistribution(questions, fixtureColors)).toEqual(expected);
	});

	it("スライダーは回答位置の間の位置で、両隣の配点を距離で混ぜる", () => {
		const questions = [question("q1", [{ red: 4 }, { blue: 4 }, { green: 1 }, { yellow: 1 }, { violet: 1 }])];
		// 1/8 は far-left と left のちょうど中間。red 2点、blue 2点で同点になり、固定優先順位で決まる。
		const redFirst = fixtureColors.map((color) => ({ ...color, tieBreakPriority: color.id === "red" ? -1 : 10 }));
		const blueFirst = fixtureColors.map((color) => ({ ...color, tieBreakPriority: color.id === "blue" ? -1 : 10 }));
		expect(judge(questions, redFirst, { q1: 1 / 8 })).toBe("red");
		expect(judge(questions, blueFirst, { q1: 1 / 8 })).toBe("blue");
		// 中間より少し左なら red、少し右なら blue。
		expect(judge(questions, blueFirst, { q1: 0.12 })).toBe("red");
		expect(judge(questions, redFirst, { q1: 0.13 })).toBe("blue");
	});

	it("2Dマップは近くの区画の中心の配点を距離で混ぜ、四隅の近くは隅の区画の配点だけを使う", () => {
		const scores: Scores[] = [{ red: 4 }, { blue: 4 }, {}, { green: 3 }, {}, {}, {}, {}, {}];
		const questions = [map("q1", scores)];
		// 左上の区画の中心より左上（角）は、左上の区画の配点だけ。
		// 辺の近く（左上と上の中心の間で、それより上）は、外周の2区画を距離で混ぜる。
		expect(judge(questions, fixtureColors, { q1: { x: 0.37, y: 0 } })).toBe("blue");
		expect(judge(questions, fixtureColors, { q1: { x: 0, y: 0 } })).toBe("red");
		// 上の行で左上と上の中心の間: 左寄りなら red、右寄りなら blue。
		expect(judge(questions, fixtureColors, { q1: { x: 0.3, y: 1 / 6 } })).toBe("red");
		expect(judge(questions, fixtureColors, { q1: { x: 0.37, y: 1 / 6 } })).toBe("blue");
		// 左の列で左上と左の中心の間: 下寄り（green 3 × 0.8 > red 4 × 0.2）なら green。
		expect(judge(questions, fixtureColors, { q1: { x: 1 / 6, y: 1 / 6 + 0.8 / 3 } })).toBe("green");
	});

	it("複数選択は選んだ選択肢の配点を合計する", () => {
		const questions = [multiple("q1", [{ red: 1 }, { blue: 1 }, { blue: 1 }], 1, 3)];
		expect(judge(questions, fixtureColors, { q1: ["o0"] })).toBe("red");
		expect(judge(questions, fixtureColors, { q1: ["o0", "o1", "o2"] })).toBe("blue");
	});

	it("どの色も一度は結果になる", () => {
		const counts = resultDistribution(QUESTIONS, RESULT_COLORS, COARSE);
		for (const colorId of COLOR_IDS) expect(counts[colorId]).toBeGreaterThan(0);
	});

	it("同じ回答列からは常に同じ結果を返す", () => {
		const answers = Object.fromEntries(QUESTIONS.map((q, index) => [q.id, sampleAnswer(q, index)]));
		const first = judge(QUESTIONS, RESULT_COLORS, answers);
		for (let i = 0; i < 20; i += 1) expect(judge(QUESTIONS, RESULT_COLORS, answers)).toBe(first);
	});

	it("合計点が最も高い色を返す", () => {
		const scores = [{ red: 2 }, { blue: 1 }, { green: 1, cyan: 1 }, { yellow: 1 }, { violet: 2 }];
		const questions = ["q1", "q2", "q3"].map((id) => question(id, scores));
		expect(judge(questions, fixtureColors, { q1: STOP.farLeft, q2: STOP.farLeft, q3: STOP.farRight })).toBe("red");
	});

	it("同点時は後半3問の得点が高い色を優先する", () => {
		const scores = [{ red: 2 }, { blue: 2 }, { green: 1 }, { yellow: 1 }, { violet: 1 }];
		const questions = ["q1", "q2", "q3", "q4"].map((id) => question(id, scores));
		// red は前半の1問目で2点、blue は後半の2問目で2点。合計は同点。
		expect(
			judge(questions, fixtureColors, { q1: STOP.farLeft, q2: STOP.left, q3: STOP.center, q4: STOP.right }),
		).toBe("blue");
	});

	it("それでも同点なら固定優先順位で決める", () => {
		const scores = [{ red: 1, blue: 1 }, { blue: 1 }, { green: 1 }, { yellow: 1 }, { violet: 1 }];
		const questions = ["q1", "q2", "q3"].map((id) => question(id, scores));
		const answers = { q1: STOP.farLeft, q2: STOP.farLeft, q3: STOP.farLeft };
		const first = (id: string) =>
			fixtureColors.map((color) => ({
				...color,
				tieBreakPriority: color.id === id ? 0 : 10 + color.tieBreakPriority,
			}));
		expect(judge(questions, first("red"), answers)).toBe("red");
		expect(judge(questions, first("blue"), answers)).toBe("blue");
	});

	it("回答が欠けているか、入力方式に合わなければ判定しない", () => {
		expect(() => judge(QUESTIONS, RESULT_COLORS, {})).toThrow();
		const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, sampleAnswer(q)]));
		const multipleId = QUESTIONS.find((q) => q.kind === "multiple")?.id ?? "";
		expect(() => judge(QUESTIONS, RESULT_COLORS, { ...answers, [multipleId]: [] })).toThrow();
	});
});
