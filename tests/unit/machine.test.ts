import { describe, expect, it } from "vitest";
import { RESULT_COLORS } from "../../src/data/colors.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import type { Command } from "../../src/shared/machine.ts";
import {
	advanceDeadlines,
	applyCommand,
	INACTIVITY_MS,
	initialState,
	JUDGING_MS,
	RESULT_MS,
} from "../../src/shared/machine.ts";
import { sequenceDuration, sequenceTime } from "../../src/shared/sequence.ts";
import type { ExhibitState, Sequence } from "../../src/shared/types.ts";

let ids = 0;
const newSessionId = () => {
	ids += 1;
	return `session-${ids}`;
};
const context = (now: number, sequences: readonly Sequence[] = []) => ({
	now,
	questions: QUESTIONS,
	colors: RESULT_COLORS,
	sequences,
	newSessionId,
});

function apply(
	state: ExhibitState,
	command: Command,
	now = state.phaseStartedAt,
	sequences: readonly Sequence[] = [],
): ExhibitState {
	const outcome = applyCommand(state, command, context(now, sequences));
	if (!outcome.ok) throw new Error(outcome.code);
	return outcome.state;
}

function toLastQuestion(now: number): ExhibitState {
	let state = apply(apply(initialState(now), { name: "start" }, now), { name: "continue" }, now);
	for (const q of QUESTIONS.slice(0, -1))
		state = apply(state, { name: "answer", questionId: q.id, stopId: "left" }, now);
	return state;
}

/** シーケンスを定義しない展示の期限処理。 */
const advance = (state: ExhibitState, now: number) => advanceDeadlines(state, now, []);

const finalAnswer = (state: ExhibitState, now: number) =>
	apply(state, { name: "answer", questionId: QUESTIONS[6].id, stopId: "far-left" }, now);

describe("状態遷移", () => {
	it("初期状態は仕様書8.1節のとおり", () => {
		expect(initialState(10)).toEqual({
			sessionId: null,
			phase: "idle",
			sequenceId: null,
			questionIndex: null,
			answers: {},
			resultColorId: null,
			previewColorId: null,
			phaseStartedAt: 10,
			phaseEndsAt: null,
			revision: 0,
			accepting: true,
		});
	});

	it("受理した更新ごとに revision を1ずつ増やす", () => {
		const intro = apply(initialState(0), { name: "start" }, 5);
		expect(intro).toMatchObject({ phase: "intro", revision: 1, phaseEndsAt: 5 + INACTIVITY_MS });
		expect(intro.sessionId).not.toBeNull();
		const question = apply(intro, { name: "continue" }, 6);
		expect(question).toMatchObject({
			phase: "question",
			questionIndex: 0,
			revision: 2,
			sessionId: intro.sessionId,
		});
	});

	it("セッション開始ごとに異なる sessionId を発行し、idle へ戻ると null になる", () => {
		const first = apply(initialState(0), { name: "start" });
		const reset = apply(first, { name: "forceReset" });
		const second = apply(reset, { name: "start" });
		expect(reset.sessionId).toBeNull();
		expect(second.sessionId).not.toBe(first.sessionId);
	});

	it("回答で次の質問へ進み、戻ると既存回答を保持し、再確定で上書きする", () => {
		let state = apply(apply(initialState(0), { name: "start" }), { name: "continue" });
		state = apply(state, { name: "answer", questionId: QUESTIONS[0].id, stopId: "far-right" }, 100);
		expect(state.questionIndex).toBe(1);
		expect(state.phaseEndsAt).toBe(100 + INACTIVITY_MS);
		state = apply(state, { name: "back" }, 200);
		expect(state.questionIndex).toBe(0);
		expect(state.answers[QUESTIONS[0].id]).toBe("far-right");
		state = apply(state, { name: "answer", questionId: QUESTIONS[0].id, stopId: "left" }, 300);
		expect(state.answers[QUESTIONS[0].id]).toBe("left");
	});

	it("戻って変更した回答だけが判定へ反映される", () => {
		const answerAll = (first: "far-left" | "far-right", changeTo?: "far-left" | "far-right") => {
			let state = apply(apply(initialState(0), { name: "start" }), { name: "continue" });
			state = apply(state, { name: "answer", questionId: QUESTIONS[0].id, stopId: first });
			if (changeTo) {
				state = apply(state, { name: "back" });
				state = apply(state, { name: "answer", questionId: QUESTIONS[0].id, stopId: changeTo });
			}
			for (const q of QUESTIONS.slice(1))
				state = apply(state, { name: "answer", questionId: q.id, stopId: "center" });
			return state.resultColorId;
		};
		expect(answerAll("far-left", "far-right")).toBe(answerAll("far-right"));
		expect(answerAll("far-right", "far-left")).toBe(answerAll("far-left"));
	});

	it("表示中ではない質問への回答と、最初の質問での「戻る」を拒否する", () => {
		const state = apply(apply(initialState(0), { name: "start" }), { name: "continue" });
		expect(
			applyCommand(state, { name: "answer", questionId: QUESTIONS[1].id, stopId: "left" }, context(0)),
		).toEqual({
			ok: false,
			code: "INVALID_PHASE",
		});
		expect(applyCommand(state, { name: "back" }, context(0))).toEqual({ ok: false, code: "INVALID_PHASE" });
	});

	it("最終回答で judging へ進み、結果色を設定して answers を消去する", () => {
		const judging = finalAnswer(toLastQuestion(0), 1_000);
		expect(judging).toMatchObject({
			phase: "judging",
			questionIndex: null,
			answers: {},
			phaseStartedAt: 1_000,
			phaseEndsAt: 1_000 + JUDGING_MS,
		});
		expect(judging.resultColorId).not.toBeNull();
	});

	it("judging は2秒後に result へ、result は60秒後に idle へ進む", () => {
		const judging = finalAnswer(toLastQuestion(0), 1_000);
		expect(advance(judging, 2_999)).toBe(judging);
		const result = advance(judging, 3_000);
		expect(result).toMatchObject({
			phase: "result",
			phaseStartedAt: 3_000,
			phaseEndsAt: 3_000 + RESULT_MS,
			revision: judging.revision + 1,
			resultColorId: judging.resultColorId,
		});
		const idle = advance(result, 3_000 + RESULT_MS);
		expect(idle).toMatchObject({
			phase: "idle",
			sessionId: null,
			resultColorId: null,
			phaseEndsAt: null,
			revision: result.revision + 1,
		});
	});

	it("alarm が遅れても期限の時刻を開始時刻にして順に進める", () => {
		const judging = finalAnswer(toLastQuestion(0), 1_000);
		expect(advance(judging, 3_500).phaseStartedAt).toBe(3_000);
		expect(advance(judging, 3_000 + RESULT_MS + 10)).toMatchObject({
			phase: "idle",
			phaseStartedAt: 3_000 + RESULT_MS,
			revision: judging.revision + 2,
		});
	});

	it("intro と question は最終操作から5分で idle へ戻り、回答を消去する", () => {
		let state = apply(apply(initialState(0), { name: "start" }), { name: "continue" }, 10);
		state = apply(state, { name: "answer", questionId: QUESTIONS[0].id, stopId: "left" }, 1_000);
		expect(advance(state, 1_000 + INACTIVITY_MS - 1).phase).toBe("question");
		expect(advance(state, 1_000 + INACTIVITY_MS)).toMatchObject({
			phase: "idle",
			answers: {},
			questionIndex: null,
			sessionId: null,
		});
		expect(advance(apply(initialState(0), { name: "start" }, 0), INACTIVITY_MS).phase).toBe("idle");
	});

	it("受付停止中は start を拒否し、リセットでは accepting を変えない", () => {
		const stopped = apply(initialState(0), { name: "setAccepting", accepting: false });
		expect(applyCommand(stopped, { name: "start" }, context(0))).toEqual({ ok: false, code: "NOT_ACCEPTING" });
		expect(apply(stopped, { name: "forceReset" }).accepting).toBe(false);
	});

	it("進行中に受付停止しても現在の診断は続く", () => {
		const stopped = apply(apply(initialState(0), { name: "start" }), { name: "setAccepting", accepting: false });
		expect(apply(stopped, { name: "continue" }).phase).toBe("question");
	});

	it("previewColor は idle だけで受理し、clearPreview、start、forceReset で消える", () => {
		const preview = apply(initialState(0), { name: "previewColor", colorId: "cyan" });
		expect(preview.previewColorId).toBe("cyan");
		expect(apply(preview, { name: "clearPreview" }).previewColorId).toBeNull();
		expect(apply(preview, { name: "start" }).previewColorId).toBeNull();
		expect(apply(preview, { name: "forceReset" }).previewColorId).toBeNull();
		expect(applyCommand(initialState(0), { name: "clearPreview" }, context(0)).ok).toBe(false);
		const intro = apply(initialState(0), { name: "start" });
		expect(applyCommand(intro, { name: "previewColor", colorId: "red" }, context(0)).ok).toBe(false);
	});

	it("result 以外では returnToIdle を拒否する", () => {
		expect(applyCommand(initialState(0), { name: "returnToIdle" }, context(0)).ok).toBe(false);
	});
});

describe("シーケンス", () => {
	const opening: Sequence = { id: "opening", before: "intro", durationMs: 1_500 };
	const warmup: Sequence = { id: "warmup", before: "question", durationMs: 2_000 };
	const sequences = [opening, warmup];

	it("start で intro の前のシーケンスへ入り、再生時間で期限を決める", () => {
		const state = apply(initialState(0), { name: "start" }, 100, sequences);
		expect(state).toMatchObject({
			phase: "sequence",
			sequenceId: "opening",
			questionIndex: null,
			phaseStartedAt: 100,
			phaseEndsAt: 1_600,
		});
		expect(state.sessionId).not.toBeNull();
	});

	it("再生を終えると期限の時刻から before の段階へ進む", () => {
		const state = apply(initialState(0), { name: "start" }, 100, sequences);
		expect(advanceDeadlines(state, 1_599, sequences)).toBe(state);
		expect(advanceDeadlines(state, 1_700, sequences)).toMatchObject({
			phase: "intro",
			sequenceId: null,
			sessionId: state.sessionId,
			phaseStartedAt: 1_600,
			phaseEndsAt: 1_600 + INACTIVITY_MS,
			revision: state.revision + 1,
		});
	});

	it("continue で question の前のシーケンスへ入り、終えると最初の質問を表示する", () => {
		const intro = advanceDeadlines(apply(initialState(0), { name: "start" }, 0, sequences), 1_500, sequences);
		const state = apply(intro, { name: "continue" }, 2_000, sequences);
		expect(state).toMatchObject({ phase: "sequence", sequenceId: "warmup", phaseEndsAt: 4_000 });
		expect(advanceDeadlines(state, 4_000, sequences)).toMatchObject({
			phase: "question",
			questionIndex: 0,
			phaseStartedAt: 4_000,
			phaseEndsAt: 4_000 + INACTIVITY_MS,
		});
	});

	it("再生中の iPad 操作を拒否し、forceReset では idle へ戻す", () => {
		const state = apply(initialState(0), { name: "start" }, 0, sequences);
		for (const command of [{ name: "start" }, { name: "continue" }, { name: "back" }] as const) {
			expect(applyCommand(state, command, context(0, sequences))).toEqual({ ok: false, code: "INVALID_PHASE" });
		}
		expect(apply(state, { name: "forceReset" }, 0, sequences)).toMatchObject({
			phase: "idle",
			sequenceId: null,
			sessionId: null,
		});
	});

	it("alarm が大きく遅れても、期限の時刻を開始時刻にして sequence から intro、idle へ順に進める", () => {
		const state = apply(initialState(0), { name: "start" }, 0, sequences);
		expect(advanceDeadlines(state, 1_500 + INACTIVITY_MS + 10, sequences)).toMatchObject({
			phase: "idle",
			phaseStartedAt: 1_500 + INACTIVITY_MS,
			revision: state.revision + 2,
		});
	});

	it("再生時間はサーバーの期限を正とし、再生位置を0から再生時間までに収める", () => {
		expect(sequenceDuration(opening, { phaseStartedAt: 100, phaseEndsAt: 2_100 })).toBe(2_000);
		expect(sequenceDuration(opening, { phaseStartedAt: 100, phaseEndsAt: null })).toBe(1_500);
		expect(sequenceTime(1_500, 100, 50)).toBe(0);
		expect(sequenceTime(1_500, 100, 600)).toBe(500);
		expect(sequenceTime(1_500, 100, 9_000)).toBe(1_500);
	});

	it("定義が見つからないシーケンスは期限で idle へ戻す", () => {
		const state = apply(initialState(0), { name: "start" }, 0, sequences);
		expect(advanceDeadlines(state, 1_500, [])).toMatchObject({ phase: "idle", sequenceId: null });
	});

	it("再生時間が0のシーケンスは再生しない", () => {
		const empty: Sequence = { id: "empty", before: "intro", durationMs: 0 };
		expect(apply(initialState(0), { name: "start" }, 0, [empty]).phase).toBe("intro");
	});
});
