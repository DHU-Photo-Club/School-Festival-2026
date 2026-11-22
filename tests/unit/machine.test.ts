import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../../src/data/questions.ts";
import type { Command } from "../../src/shared/machine.ts";
import {
	advanceDeadlines,
	applyCommand,
	DEFAULT_JUDGING_MAX_MS,
	INACTIVITY_MS,
	initialState,
	JUDGING_MS,
	RESULT_MS,
	reconcileState,
	SETTLE_MARGIN_MS,
	settleJudging,
} from "../../src/shared/machine.ts";
import { sequenceDuration, sequenceTime } from "../../src/shared/sequence.ts";
import type { ExhibitState, Sequence, SessionResult } from "../../src/shared/types.ts";
import { sampleAnswer } from "./helpers.ts";

let ids = 0;
const newSessionId = () => {
	ids += 1;
	return `session-${ids}`;
};
const context = (now: number, sequences: readonly Sequence[] = []) => ({
	now,
	questions: QUESTIONS,
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
	let state = apply(apply(initialState(now), { name: "start" }, now), { name: "continue", nickname: "テスト" }, now);
	for (const q of QUESTIONS.slice(0, -1))
		state = apply(state, { name: "answer", questionId: q.id, answer: sampleAnswer(q, 1) }, now);
	return state;
}

/** シーケンスを定義しない展示の期限処理。 */
const advance = (state: ExhibitState, now: number) => advanceDeadlines(state, now, []);

const LAST = QUESTIONS[QUESTIONS.length - 1];

const finalAnswer = (state: ExhibitState, now: number) =>
	apply(state, { name: "answer", questionId: LAST.id, answer: sampleAnswer(LAST, 1) }, now);

const RESULT: SessionResult = {
	id: "0123456789abcdef",
	name: "ミドリノヒカリ",
	reading: "読み取り",
	colors: ["emerald", "amber"],
	photoIds: ["sdi0225"],
};

/** 最終回答から、AIの選定が `settledAt` に終わったときの状態。 */
function judged(now: number, settledAt = now): ExhibitState {
	const judging = finalAnswer(toLastQuestion(now), now);
	const settled = settleJudging(judging, judging.sessionId ?? "", RESULT, settledAt);
	if (!settled) throw new Error("judging を締められなかった");
	return settled;
}

describe("状態遷移", () => {
	it("初期状態は仕様書8.1節のとおり", () => {
		expect(initialState(10)).toEqual({
			sessionId: null,
			phase: "idle",
			nickname: null,
			sequenceId: null,
			questionIndex: null,
			answers: {},
			result: null,
			judgeFailed: false,
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
		const question = apply(intro, { name: "continue", nickname: "テスト" }, 6);
		expect(question).toMatchObject({
			phase: "question",
			questionIndex: 0,
			revision: 2,
			sessionId: intro.sessionId,
		});
	});

	it("continue で正規化したニックネームを保存し、result まで保持して idle で消す", () => {
		const intro = apply(initialState(0), { name: "start" });
		expect(intro.nickname).toBeNull();
		const question = apply(intro, { name: "continue", nickname: "  ゆ​き  	 ちゃん " });
		expect(question.nickname).toBe("ゆき ちゃん");
		const result = advance(judged(0), JUDGING_MS);
		expect(result).toMatchObject({ phase: "result", nickname: "テスト" });
		expect(apply(result, { name: "returnToIdle" }).nickname).toBeNull();
		expect(apply(question, { name: "forceReset" }).nickname).toBeNull();
		expect(advance(question, INACTIVITY_MS).nickname).toBeNull();
	});

	it("空や長すぎるニックネームの continue を拒否する", () => {
		const intro = apply(initialState(0), { name: "start" });
		for (const nickname of ["", "   ", "​", "あ".repeat(13)]) {
			expect(applyCommand(intro, { name: "continue", nickname }, context(0))).toEqual({
				ok: false,
				code: "INVALID_NICKNAME",
			});
		}
		expect(apply(intro, { name: "continue", nickname: "あ".repeat(12) }).nickname).toBe("あ".repeat(12));
	});

	it("セッション開始ごとに異なる sessionId を発行し、idle へ戻ると null になる", () => {
		const first = apply(initialState(0), { name: "start" });
		const reset = apply(first, { name: "forceReset" });
		const second = apply(reset, { name: "start" });
		expect(reset.sessionId).toBeNull();
		expect(second.sessionId).not.toBe(first.sessionId);
	});

	it("回答で次の質問へ進み、戻ると既存回答を保持し、再確定で上書きする", () => {
		let state = apply(apply(initialState(0), { name: "start" }), { name: "continue", nickname: "テスト" });
		state = apply(state, { name: "answer", questionId: "Q1", answer: ["q1_1"] }, 100);
		expect(state.questionIndex).toBe(1);
		expect(state.phaseEndsAt).toBe(100 + INACTIVITY_MS);
		state = apply(state, { name: "back" }, 200);
		expect(state.questionIndex).toBe(0);
		expect(state.answers.Q1).toEqual(["q1_1"]);
		state = apply(state, { name: "answer", questionId: "Q1", answer: ["q1_2", "q1_4"] }, 300);
		expect(state.answers.Q1).toEqual(["q1_2", "q1_4"]);
	});

	it("戻って変更した回答だけがAIの選定へ渡る", () => {
		let state = apply(apply(initialState(0), { name: "start" }), { name: "continue", nickname: "テスト" });
		state = apply(state, { name: "answer", questionId: "Q1", answer: ["q1_1"] });
		state = apply(state, { name: "back" });
		state = apply(state, { name: "answer", questionId: "Q1", answer: ["q1_6"] });
		for (const q of QUESTIONS.slice(1, -1))
			state = apply(state, { name: "answer", questionId: q.id, answer: sampleAnswer(q, 2) });
		const outcome = applyCommand(
			state,
			{ name: "answer", questionId: LAST.id, answer: ["q5_1", "q5_2"] },
			context(0),
		);
		if (!outcome.ok) throw new Error(outcome.code);
		expect(outcome.judgedAnswers?.Q1).toEqual(["q1_6"]);
		expect(Object.keys(outcome.judgedAnswers ?? {})).toEqual(QUESTIONS.map((q) => q.id));
	});

	it("質問の入力方式に合わない回答を拒否する", () => {
		let state = apply(apply(initialState(0), { name: "start" }), { name: "continue", nickname: "テスト" });
		const rejected = (answer: unknown) =>
			applyCommand(
				state,
				{ name: "answer", questionId: QUESTIONS[state.questionIndex ?? 0].id, answer: answer as string },
				context(0),
			);
		const invalid = { ok: false, code: "INVALID_ANSWER" };
		// 複数選択: 個数の範囲外、重複、定義順でない並び、単一のID、未定義のID、単独選択との組み合わせを拒否する。
		expect(QUESTIONS[0].kind).toBe("multiple");
		for (const answer of [
			[],
			["q1_1", "q1_2", "q1_3"],
			["q1_1", "q1_1"],
			["q1_2", "q1_1"],
			"q1_1",
			["nope"],
			["q1_1", "q1_7"],
		])
			expect(rejected(answer)).toEqual(invalid);
		state = apply(state, { name: "answer", questionId: "Q1", answer: ["q1_7"] });
		state = apply(state, { name: "answer", questionId: "Q2", answer: ["q2_1", "q2_3"] });
		// スライダー: 位置は0〜1。
		expect(QUESTIONS[2].kind).toBe("slider");
		for (const answer of ["left", [0.5], -0.1, 1.5, { x: 0.5, y: 0.5 }]) expect(rejected(answer)).toEqual(invalid);
		state = apply(state, { name: "answer", questionId: "Q3", answer: 0.25 });
		// 2Dマップ: 各座標が0〜1。
		expect(QUESTIONS[3].kind).toBe("map");
		for (const answer of ["center", 0.5, { x: 1.2, y: 0.5 }, { x: 0.5 }, [0.5, 0.5]])
			expect(rejected(answer)).toEqual(invalid);
		state = apply(state, { name: "answer", questionId: "Q4", answer: { x: 0.9, y: 0.8 } });
		// 順位つき選択: ちょうど2つ。選んだ順を保つため、定義順でなくてもよい。
		expect(QUESTIONS[4].kind).toBe("ranked");
		for (const answer of [["q5_1"], ["q5_1", "q5_1"], ["q5_1", "q5_2", "q5_3"], ["nope", "q5_1"]])
			expect(rejected(answer)).toEqual(invalid);
		const judging = apply(state, { name: "answer", questionId: "Q5", answer: ["q5_3", "q5_1"] });
		expect(judging.answers).toMatchObject({
			Q1: ["q1_7"],
			Q4: { x: 0.9, y: 0.8 },
			Q5: ["q5_3", "q5_1"],
		});
	});

	it("質問定義の変更で合わなくなった保存済みの回答を除き、最終問の後に未回答の質問へ戻す", () => {
		let state = apply(apply(initialState(0), { name: "start" }), { name: "continue", nickname: "テスト" });
		for (const q of QUESTIONS.slice(0, -1))
			state = apply(state, { name: "answer", questionId: q.id, answer: sampleAnswer(q, 1) });
		// 変更前の定義では単選択だった質問に、選択肢IDが文字列で保存されている。
		const stale = { ...state, answers: { ...state.answers, [QUESTIONS[1].id]: "q2_1" } };
		const reconciled = reconcileState(stale, QUESTIONS);
		expect(reconciled.answers).not.toHaveProperty(QUESTIONS[1].id);
		expect(reconcileState(state, QUESTIONS)).toBe(state);
		const back = apply(reconciled, { name: "answer", questionId: LAST.id, answer: sampleAnswer(LAST) });
		expect(back).toMatchObject({ phase: "question", questionIndex: 1 });
		const judging = apply(back, {
			name: "answer",
			questionId: QUESTIONS[1].id,
			answer: sampleAnswer(QUESTIONS[1]),
		});
		expect(judging.questionIndex).toBe(2);
		// 範囲外の questionIndex は最終問にする。
		expect(reconcileState({ ...state, questionIndex: 99 }, QUESTIONS).questionIndex).toBe(QUESTIONS.length - 1);
	});

	it("表示中ではない質問への回答と、最初の質問での「戻る」を拒否する", () => {
		const state = apply(apply(initialState(0), { name: "start" }), { name: "continue", nickname: "テスト" });
		expect(
			applyCommand(state, { name: "answer", questionId: QUESTIONS[1].id, answer: ["q2_1"] }, context(0)),
		).toEqual({
			ok: false,
			code: "INVALID_PHASE",
		});
		expect(applyCommand(state, { name: "back" }, context(0))).toEqual({ ok: false, code: "INVALID_PHASE" });
	});

	it("最終回答で judging へ進み、AIの選定が終わるまで回答と質問番号を保つ", () => {
		const judging = finalAnswer(toLastQuestion(0), 1_000);
		expect(judging).toMatchObject({
			phase: "judging",
			questionIndex: QUESTIONS.length - 1,
			result: null,
			judgeFailed: false,
			phaseStartedAt: 1_000,
			phaseEndsAt: 1_000 + DEFAULT_JUDGING_MAX_MS,
		});
		expect(Object.keys(judging.answers)).toHaveLength(QUESTIONS.length);
		const custom = applyCommand(
			toLastQuestion(0),
			{ name: "answer", questionId: LAST.id, answer: sampleAnswer(LAST) },
			{ ...context(0), judgingMaxMs: 9_000 },
		);
		expect(custom.ok && custom.state.phaseEndsAt).toBe(9_000);
	});

	it("選定が早く終わったら結果を設定して answers を消し、judging を最短の長さまで縮める", () => {
		const early = judged(1_000, 1_100);
		expect(early).toMatchObject({ phase: "judging", result: RESULT, answers: {}, phaseEndsAt: 1_000 + JUDGING_MS });
		// 最短の長さを過ぎてから終わったら、全画面へ届くまでの余裕を取る。
		const late = judged(1_000, 10_000);
		expect(late.phaseEndsAt).toBe(10_000 + SETTLE_MARGIN_MS);
		// 元の期限より遅くはしない。
		const judging = finalAnswer(toLastQuestion(1_000), 1_000);
		const end = 1_000 + DEFAULT_JUDGING_MAX_MS;
		expect(settleJudging(judging, judging.sessionId ?? "", RESULT, end - 100)?.phaseEndsAt).toBe(end);
	});

	it("選定に失敗したら回答を保ったまま最終問へ戻し、次の操作で judgeFailed を下ろす", () => {
		const judging = finalAnswer(toLastQuestion(0), 1_000);
		const failed = settleJudging(judging, judging.sessionId ?? "", null, 5_000);
		expect(failed).toMatchObject({
			phase: "question",
			questionIndex: QUESTIONS.length - 1,
			judgeFailed: true,
			result: null,
			phaseStartedAt: 5_000,
			phaseEndsAt: 5_000 + INACTIVITY_MS,
			answers: judging.answers,
		});
		if (!failed) throw new Error("失敗の状態がない");
		expect(apply(failed, { name: "back" }).judgeFailed).toBe(false);
		expect(apply(failed, { name: "answer", questionId: LAST.id, answer: sampleAnswer(LAST) })).toMatchObject({
			phase: "judging",
			judgeFailed: false,
		});
	});

	it("別のセッションや judging 以外では選定の結果を使わない", () => {
		const judging = finalAnswer(toLastQuestion(0), 1_000);
		expect(settleJudging(judging, "other", RESULT, 1_100)).toBeNull();
		expect(
			settleJudging(apply(judging, { name: "forceReset" }), judging.sessionId ?? "", RESULT, 1_100),
		).toBeNull();
	});

	it("judging は期限に結果があれば result へ、なければ最終問へ進み、result は60秒後に idle へ進む", () => {
		const settled = judged(1_000, 1_100);
		expect(advance(settled, 2_999)).toBe(settled);
		const result = advance(settled, 3_000);
		expect(result).toMatchObject({
			phase: "result",
			questionIndex: null,
			phaseStartedAt: 3_000,
			phaseEndsAt: 3_000 + RESULT_MS,
			revision: settled.revision + 1,
			result: RESULT,
		});
		const idle = advance(result, 3_000 + RESULT_MS);
		expect(idle).toMatchObject({
			phase: "idle",
			sessionId: null,
			result: null,
			phaseEndsAt: null,
			revision: result.revision + 1,
		});
		const timedOut = advance(finalAnswer(toLastQuestion(0), 1_000), 1_000 + DEFAULT_JUDGING_MAX_MS);
		expect(timedOut).toMatchObject({
			phase: "question",
			judgeFailed: true,
			phaseStartedAt: 1_000 + DEFAULT_JUDGING_MAX_MS,
		});
	});

	it("alarm が遅れても期限の時刻を開始時刻にして順に進める", () => {
		const settled = judged(1_000, 1_100);
		expect(advance(settled, 3_500).phaseStartedAt).toBe(3_000);
		expect(advance(settled, 3_000 + RESULT_MS + 10)).toMatchObject({
			phase: "idle",
			phaseStartedAt: 3_000 + RESULT_MS,
			revision: settled.revision + 2,
		});
	});

	it("intro と question は最終操作から5分で idle へ戻り、回答を消去する", () => {
		let state = apply(apply(initialState(0), { name: "start" }), { name: "continue", nickname: "テスト" }, 10);
		state = apply(state, { name: "answer", questionId: "Q1", answer: ["q1_1"] }, 1_000);
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
		expect(apply(stopped, { name: "continue", nickname: "テスト" }).phase).toBe("question");
	});

	it("previewColor は idle だけで受理し、clearPreview、start、forceReset で消える", () => {
		const preview = apply(initialState(0), { name: "previewColor", colorId: "jade" });
		expect(preview.previewColorId).toBe("jade");
		expect(apply(preview, { name: "clearPreview" }).previewColorId).toBeNull();
		expect(apply(preview, { name: "start" }).previewColorId).toBeNull();
		expect(apply(preview, { name: "forceReset" }).previewColorId).toBeNull();
		expect(applyCommand(initialState(0), { name: "clearPreview" }, context(0)).ok).toBe(false);
		const intro = apply(initialState(0), { name: "start" });
		expect(applyCommand(intro, { name: "previewColor", colorId: "rose" }, context(0)).ok).toBe(false);
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
		const state = apply(intro, { name: "continue", nickname: "テスト" }, 2_000, sequences);
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
		for (const command of [
			{ name: "start" },
			{ name: "continue", nickname: "テスト" },
			{ name: "back" },
		] as const) {
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
