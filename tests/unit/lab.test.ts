import { describe, expect, it } from "vitest";
import { LAB_LOOPS, labCycle, parseLab } from "../../src/shared/lab.ts";
import { JUDGING_MS } from "../../src/shared/machine.ts";
import { PALETTE_IDS } from "../../src/shared/types.ts";

const lead = { id: "opening", durationMs: 3_600 };

describe("演出の調整用ループ", () => {
	it("演出名と色をURLから読む。演出名が不正なら通常の展示ディスプレイとして動く", () => {
		expect(parseLab("?loop=result&color=jade")).toEqual({ loop: "result", color: "jade" });
		expect(parseLab("?loop=answer")).toEqual({ loop: "answer", color: "all" });
		expect(parseLab("?loop=answer&color=nope")).toEqual({ loop: "answer", color: "all" });
		expect(parseLab("?loop=nope")).toBeNull();
		expect(parseLab("")).toBeNull();
	});

	it("どの演出も、時刻順の場面を一周の長さの内側に並べる。同じ入力には同じ台本を返す", () => {
		for (const loop of LAB_LOOPS) {
			const cycle = labCycle({ loop, color: "all" }, { index: 0, startedAt: 1_000, lead });
			expect(cycle).toEqual(labCycle({ loop, color: "all" }, { index: 0, startedAt: 1_000, lead }));
			expect(cycle.steps.length).toBeGreaterThan(0);
			expect(cycle.steps[0].atMs).toBe(0);
			for (const [index, step] of cycle.steps.entries()) {
				expect(step.atMs).toBeLessThan(cycle.lengthMs);
				expect(step.state.phaseStartedAt).toBe(1_000 + step.atMs);
				if (index > 0) expect(step.atMs).toBeGreaterThan(cycle.steps[index - 1].atMs);
			}
		}
	});

	it("周ごとにセッションと、`all` では結果の色が変わる。色を指定すると同じ色を繰り返す", () => {
		const first = labCycle({ loop: "result", color: "all" }, { index: 0, startedAt: 0, lead });
		const second = labCycle({ loop: "result", color: "all" }, { index: 1, startedAt: 0, lead });
		expect(first.colorId).toBe(PALETTE_IDS[0]);
		expect(second.colorId).toBe(PALETTE_IDS[1]);
		expect(first.steps[0].state.sessionId).not.toBe(second.steps[0].state.sessionId);
		expect(labCycle({ loop: "result", color: "sky" }, { index: 5, startedAt: 0, lead }).colorId).toBe("sky");
		const judging = first.steps.find((step) => step.state.phase === "judging");
		expect(judging?.state.result?.colors).toEqual([first.colorId, first.colorId]);
	});

	it("opening は、シーケンスを経て intro、質問の順に進む。シーケンスがなければ飛ばす", () => {
		const phases = (leadArg: typeof lead | null) =>
			labCycle({ loop: "opening", color: "all" }, { index: 0, startedAt: 0, lead: leadArg }).steps.map(
				(step) => step.state.phase,
			);
		expect(phases(lead)).toEqual(["idle", "sequence", "intro", "question"]);
		expect(phases(null)).toEqual(["idle", "intro", "question"]);
	});

	it("judging は、結果が届く前に塵を見せ、判定の最短の長さのあとに結果へ移る", () => {
		const cycle = labCycle({ loop: "judging", color: "all" }, { index: 0, startedAt: 0, lead });
		const judging = cycle.steps.filter((step) => step.state.phase === "judging");
		expect(judging[0].state.result).toBeNull();
		expect(judging[1].state.result).not.toBeNull();
		const result = cycle.steps.find((step) => step.state.phase === "result");
		expect(result?.atMs).toBe(judging[0].atMs + JUDGING_MS);
		expect(judging[0].state.phaseEndsAt).toBe(result?.state.phaseStartedAt);
	});

	it("answer は、回答の時刻より前の質問から始める", () => {
		const cycle = labCycle({ loop: "answer", color: "all" }, { index: 0, startedAt: 500, lead });
		const [step] = cycle.steps;
		expect(step.state.phase).toBe("question");
		expect(step.state.answeredAt).toBeGreaterThan(step.state.phaseStartedAt);
	});
});
