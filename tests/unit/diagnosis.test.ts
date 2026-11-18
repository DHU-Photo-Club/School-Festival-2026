import { describe, expect, it } from "vitest";
import { RESULT_COLORS } from "../../src/data/colors.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { judge, resultDistribution } from "../../src/shared/diagnosis.ts";
import type { Question, ResultColor, SliderStopId } from "../../src/shared/types.ts";
import { COLOR_IDS, SLIDER_STOP_IDS } from "../../src/shared/types.ts";

const stops = (scores: Question["stops"][number]["scores"][]): Question["stops"] =>
	SLIDER_STOP_IDS.map((id, index) => ({ id, caption: id, scores: scores[index] })) as unknown as Question["stops"];

const question = (id: string, scores: Question["stops"][number]["scores"][]): Question => ({
	id,
	theme: "",
	prompt: "",
	leftLabel: "",
	rightLabel: "",
	stops: stops(scores),
});

const fixtureColors: ResultColor[] = RESULT_COLORS.map((color, index) => ({ ...color, tieBreakPriority: index }));

describe("judge", () => {
	it("7問すべての回答経路で、定義済み8色のいずれか一つを返す（78,125通り）", () => {
		const counts = resultDistribution(QUESTIONS, RESULT_COLORS);
		const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
		expect(QUESTIONS).toHaveLength(7);
		expect(total).toBe(5 ** 7);
		expect(Object.keys(counts).sort()).toEqual([...COLOR_IDS].sort());
	});

	it("どの色も一度は結果になる", () => {
		const counts = resultDistribution(QUESTIONS, RESULT_COLORS);
		for (const colorId of COLOR_IDS) expect(counts[colorId]).toBeGreaterThan(0);
	});

	it("同じ回答列からは常に同じ結果を返す", () => {
		const answers = Object.fromEntries(QUESTIONS.map((q, index) => [q.id, SLIDER_STOP_IDS[index % 5]]));
		const first = judge(QUESTIONS, RESULT_COLORS, answers);
		for (let i = 0; i < 20; i += 1) expect(judge(QUESTIONS, RESULT_COLORS, answers)).toBe(first);
	});

	it("合計点が最も高い色を返す", () => {
		const scores = [{ red: 2 }, { blue: 1 }, { green: 1, cyan: 1 }, { yellow: 1 }, { violet: 2 }];
		const questions = ["q1", "q2", "q3"].map((id) => question(id, scores));
		expect(judge(questions, fixtureColors, { q1: "far-left", q2: "far-left", q3: "far-right" })).toBe("red");
	});

	it("同点時は後半3問の得点が高い色を優先する", () => {
		const scores = [{ red: 2 }, { blue: 2 }, { green: 1 }, { yellow: 1 }, { violet: 1 }];
		const questions = ["q1", "q2", "q3", "q4"].map((id) => question(id, scores));
		// red は前半の1問目で2点、blue は後半の2問目で2点。合計は同点。
		expect(judge(questions, fixtureColors, { q1: "far-left", q2: "left", q3: "center", q4: "right" })).toBe("blue");
	});

	it("それでも同点なら固定優先順位で決める", () => {
		const scores = [{ red: 1, blue: 1 }, { blue: 1 }, { green: 1 }, { yellow: 1 }, { violet: 1 }];
		const questions = ["q1", "q2", "q3"].map((id) => question(id, scores));
		const answers: Record<string, SliderStopId> = { q1: "far-left", q2: "far-left", q3: "far-left" };
		const first = (id: string) =>
			fixtureColors.map((color) => ({
				...color,
				tieBreakPriority: color.id === id ? 0 : 10 + color.tieBreakPriority,
			}));
		expect(judge(questions, first("red"), answers)).toBe("red");
		expect(judge(questions, first("blue"), answers)).toBe("blue");
	});

	it("回答が欠けていれば判定しない", () => {
		expect(() => judge(QUESTIONS, RESULT_COLORS, {})).toThrow();
	});
});
