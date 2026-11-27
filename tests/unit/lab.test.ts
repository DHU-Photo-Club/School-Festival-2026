import { describe, expect, it } from "vitest";
import { LAB_LOOPS, LabPlayer, labCycle, parseLab } from "../../src/shared/lab.ts";
import { JUDGING_MS, RESULT_MS } from "../../src/shared/machine.ts";
import { FINALE_SETTLE_MS } from "../../src/shared/finale.ts";
import type { ExhibitState } from "../../src/shared/types.ts";
import { PALETTE_IDS } from "../../src/shared/types.ts";

const lead = { id: "opening", durationMs: 3_600 };
const questionCount = 5;

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
			const cycle = labCycle({ loop, color: "all" }, { index: 0, startedAt: 1_000, lead, questionCount });
			expect(cycle).toEqual(
				labCycle({ loop, color: "all" }, { index: 0, startedAt: 1_000, lead, questionCount }),
			);
			expect(cycle.steps.length).toBeGreaterThan(0);
			expect(cycle.steps[0].atMs).toBe(0);
			for (const [index, step] of cycle.steps.entries()) {
				expect(step.atMs).toBeLessThan(cycle.lengthMs);
				// 同じ段階のまま状態だけが変わる場面（扉を開く）は、段階の開始時刻を変えない。
				const previous = cycle.steps[index - 1];
				const kept =
					previous?.state.phase === step.state.phase &&
					previous.state.phaseStartedAt === step.state.phaseStartedAt;
				// 結果の途中から始める台本（door）は、最初の場面の段階を一周の開始より前に始める。
				const resumed = index === 0 && step.state.phase === "result";
				if (resumed) expect(step.state.phaseStartedAt).toBeLessThan(1_000);
				else if (!kept) expect(step.state.phaseStartedAt).toBe(1_000 + step.atMs);
				if (index > 0) expect(step.atMs).toBeGreaterThan(cycle.steps[index - 1].atMs);
			}
		}
	});

	it("door では、結果を見せている途中で扉を開き、段階の開始時刻は変えない", () => {
		const cycle = labCycle({ loop: "door", color: "jade" }, { index: 0, startedAt: 1_000, lead, questionCount });
		const shown = cycle.steps.find((step) => step.state.phase === "result" && step.state.doorOpenedAt === null);
		const opened = cycle.steps.find((step) => step.state.doorOpenedAt !== null);
		expect(opened?.state.phase).toBe("result");
		expect(opened?.state.doorOpenedAt).toBe(1_000 + (opened?.atMs ?? 0));
		expect(opened?.state.phaseStartedAt).toBe(shown?.state.phaseStartedAt);
	});

	it("door は、色名が出終えた結果から始め、判定を含まない", () => {
		const cycle = labCycle({ loop: "door", color: "jade" }, { index: 0, startedAt: 10_000, lead, questionCount });
		expect(cycle.steps.map((step) => step.state.phase)).toEqual(["result", "result", "idle"]);
		const [first] = cycle.steps;
		expect(first.state.phaseStartedAt).toBe(10_000 - FINALE_SETTLE_MS);
		expect(first.state.phaseEndsAt).toBe(first.state.phaseStartedAt + RESULT_MS);
	});

	it("周ごとにセッションと、`all` では結果の色が変わる。色を指定すると同じ色を繰り返す", () => {
		const first = labCycle({ loop: "result", color: "all" }, { index: 0, startedAt: 0, lead, questionCount });
		const second = labCycle({ loop: "result", color: "all" }, { index: 1, startedAt: 0, lead, questionCount });
		expect(first.colorId).toBe(PALETTE_IDS[0]);
		expect(second.colorId).toBe(PALETTE_IDS[1]);
		expect(first.steps[0].state.sessionId).not.toBe(second.steps[0].state.sessionId);
		expect(
			labCycle({ loop: "result", color: "sky" }, { index: 5, startedAt: 0, lead, questionCount }).colorId,
		).toBe("sky");
		const judging = first.steps.find((step) => step.state.phase === "judging");
		// 一画面目は指定の色を見せ、二色目はパレットで約半周離れた別の色にする。
		const [one, two] = judging?.state.result?.colors ?? [];
		expect(one).toBe(first.colorId);
		expect(two).not.toBe(first.colorId);
	});

	it("opening は、シーケンスを経て intro、質問の順に進む。シーケンスがなければ飛ばす", () => {
		const phases = (leadArg: typeof lead | null) =>
			labCycle(
				{ loop: "opening", color: "all" },
				{ index: 0, startedAt: 0, lead: leadArg, questionCount },
			).steps.map((step) => step.state.phase);
		expect(phases(lead)).toEqual(["idle", "sequence", "intro", "question"]);
		expect(phases(null)).toEqual(["idle", "intro", "question"]);
	});

	it("judging は、結果が届く前に塵を見せ、判定の最短の長さのあとに結果へ移る", () => {
		const cycle = labCycle({ loop: "judging", color: "all" }, { index: 0, startedAt: 0, lead, questionCount });
		const judging = cycle.steps.filter((step) => step.state.phase === "judging");
		expect(judging[0].state.result).toBeNull();
		expect(judging[1].state.result).not.toBeNull();
		const result = cycle.steps.find((step) => step.state.phase === "result");
		expect(result?.atMs).toBe(judging[0].atMs + JUDGING_MS);
		expect(judging[0].state.phaseEndsAt).toBe(result?.state.phaseStartedAt);
	});

	it("answer は、一問目から始め、回答の時刻に次の質問へ進む。段階の開始時刻は変えない", () => {
		const cycle = labCycle({ loop: "answer", color: "all" }, { index: 0, startedAt: 500, lead, questionCount });
		const [question, answered] = cycle.steps;
		expect(question.state).toMatchObject({ phase: "question", questionIndex: 0, answeredAt: null });
		expect(answered.state).toMatchObject({
			phase: "question",
			questionIndex: 1,
			answeredAt: 500 + answered.atMs,
			phaseStartedAt: question.state.phaseStartedAt,
		});
	});

	it("診断用iPadが使う項目を持つ。質問中は番号を持ち、結果の前の質問は最終問にする", () => {
		for (const loop of LAB_LOOPS) {
			const cycle = labCycle({ loop, color: "jade" }, { index: 0, startedAt: 0, lead, questionCount });
			for (const { state } of cycle.steps) {
				expect(state.accepting).toBe(true);
				if (state.phase === "question") expect(state.questionIndex).not.toBeNull();
				if (state.result) expect(state.result.id).toBe(state.sessionId);
			}
		}
		const judging = labCycle({ loop: "judging", color: "jade" }, { index: 0, startedAt: 0, lead, questionCount });
		expect(judging.steps[0].state.questionIndex).toBe(questionCount - 1);
		// 質問が一問だけなら、回答しても同じ質問のまま。
		const single = labCycle({ loop: "answer", color: "jade" }, { index: 0, startedAt: 0, lead, questionCount: 1 });
		expect(single.steps.map((step) => step.state.questionIndex)).toEqual([0, 0]);
	});
});

describe("台本の再生", () => {
	it("時刻になった場面を一度ずつ流し込み、一周を過ぎると次の周を始める", () => {
		const states: ExhibitState[] = [];
		let cycles = 0;
		const player = new LabPlayer(
			{ loop: "answer", color: "all" },
			{ lead, questionCount },
			{ onCycle: () => cycles++, onState: (state) => states.push(state) },
		);
		const { lengthMs } = labCycle({ loop: "answer", color: "all" }, { index: 0, startedAt: 0, lead, questionCount });
		// 周の区切りは時計の0時から一周の長さごと。
		const origin = 7 * lengthMs;
		const cycle = labCycle({ loop: "answer", color: "all" }, { index: 7, startedAt: origin, lead, questionCount });
		player.advance(origin);
		player.advance(origin);
		expect(states).toHaveLength(1);
		expect(states[0].sessionId).toBe("lab-7");
		expect(player.advance(origin + cycle.steps[1].atMs)).toContain("answer");
		expect(states.map((state) => state.questionIndex)).toEqual([0, 1]);
		expect(cycles).toBe(1);
		player.advance(origin + lengthMs);
		expect(cycles).toBe(2);
		expect(states.at(-1)?.sessionId).toBe("lab-8");
		// 次の周は、前の周の終わりの時刻を開始時刻にする。
		expect(states.at(-1)?.phaseStartedAt).toBe(origin + lengthMs);
	});

	it("一周の長さは周によらず一定", () => {
		for (const loop of LAB_LOOPS) {
			const lengths = new Set(
				[0, 1, 2, 3, 17].map(
					(index) => labCycle({ loop, color: "all" }, { index, startedAt: 0, lead, questionCount }).lengthMs,
				),
			);
			expect(lengths.size).toBe(1);
		}
	});

	it("別々の時刻に再生を始めた画面も、同じ時刻には同じ周の同じ場面を流し込む", () => {
		for (const loop of LAB_LOOPS) {
			const options = { loop, color: "all" } as const;
			const { lengthMs } = labCycle(options, { index: 0, startedAt: 0, lead, questionCount });
			const latest = (startAt: number, until: number) => {
				let state: ExhibitState | null = null;
				const player = new LabPlayer(options, { lead, questionCount }, { onState: (next) => (state = next) });
				for (let now = startAt; now <= until; now += 250) player.advance(now);
				player.advance(until);
				return state;
			};
			const base = 1_000 * lengthMs;
			for (const offset of [0.2, 0.55, 0.9, 1.3]) {
				const until = base + offset * lengthMs + lengthMs;
				// 一方は周の初めから、もう一方は周の途中から始める。
				expect(latest(base + 3_217, until)).toEqual(latest(base + 0.6 * lengthMs, until));
			}
		}
	});
});
