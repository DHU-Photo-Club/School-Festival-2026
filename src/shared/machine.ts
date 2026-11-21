import { isValidAnswer } from "./answer.ts";
import { judge } from "./diagnosis.ts";
import { normalizeNickname } from "./nickname.ts";
import { findSequence, sequenceBefore } from "./sequence.ts";
import type {
	Answer,
	ColorId,
	ExhibitState,
	Question,
	QuestionId,
	ResultColor,
	Role,
	Sequence,
	SequenceTarget,
} from "./types.ts";

/** `judging` の長さ（仕様書8.2節）。 */
export const JUDGING_MS = 2_000;
/** `result` の長さ（仕様書5章）。 */
export const RESULT_MS = 60_000;
/** `intro` と `question` で操作がないまま `idle` へ戻すまでの時間（仕様書8.2節）。 */
export const INACTIVITY_MS = 5 * 60_000;

export type Command =
	| { name: "start" }
	| { name: "continue"; nickname: string }
	| { name: "answer"; questionId: string; answer: Answer }
	| { name: "back" }
	| { name: "returnToIdle" }
	| { name: "setAccepting"; accepting: boolean }
	| { name: "forceReset" }
	| { name: "previewColor"; colorId: ColorId }
	| { name: "clearPreview" };

export type CommandName = Command["name"];

/** 役割ごとに許可するコマンド（仕様書8.3節）。 */
export const ROLE_COMMANDS: Readonly<Record<Role, readonly CommandName[]>> = {
	controller: ["start", "continue", "answer", "back", "returnToIdle"],
	admin: ["setAccepting", "forceReset", "previewColor", "clearPreview"],
	display: [],
	photo: [],
};

export interface MachineContext {
	now: number;
	questions: readonly Question[];
	colors: readonly ResultColor[];
	sequences: readonly Sequence[];
	newSessionId: () => string;
}

export type RejectCode = "INVALID_PHASE" | "NOT_ACCEPTING" | "INVALID_NICKNAME" | "INVALID_ANSWER";

export type CommandOutcome = { ok: true; state: ExhibitState } | { ok: false; code: RejectCode };

/** Durable Objectを初めて作成したときの状態（仕様書8.1節）。 */
export function initialState(now: number): ExhibitState {
	return {
		sessionId: null,
		phase: "idle",
		nickname: null,
		sequenceId: null,
		questionIndex: null,
		answers: {},
		resultColorId: null,
		previewColorId: null,
		phaseStartedAt: now,
		phaseEndsAt: null,
		revision: 0,
		accepting: true,
	};
}

/**
 * 保存済みの状態を現在の質問定義に合わせる。質問定義を変えてデプロイした後に、変更前に保存した
 * 回答が残っている場合に使う。定義に合わない回答を除き、範囲外の `questionIndex` は最終問にする。
 * 変更がなければ同じオブジェクトを返す。
 */
export function reconcileState(state: ExhibitState, questions: readonly Question[]): ExhibitState {
	const answers: Record<QuestionId, Answer> = {};
	for (const question of questions) {
		const answer = state.answers[question.id];
		if (isValidAnswer(question, answer)) answers[question.id] = answer;
	}
	const answersChanged = Object.keys(answers).length !== Object.keys(state.answers).length;
	const indexOutOfRange = state.questionIndex !== null && state.questionIndex >= questions.length;
	if (!answersChanged && !indexOutOfRange) return state;
	return {
		...state,
		answers,
		questionIndex: indexOutOfRange ? Math.max(0, questions.length - 1) : state.questionIndex,
	};
}

/** セッション状態を初期化して `idle` へ戻す。`accepting` は変更しない（仕様書8.2節）。 */
function toIdle(state: ExhibitState, at: number): ExhibitState {
	return {
		...state,
		sessionId: null,
		phase: "idle",
		nickname: null,
		sequenceId: null,
		questionIndex: null,
		answers: {},
		resultColorId: null,
		previewColorId: null,
		phaseStartedAt: at,
		phaseEndsAt: null,
		revision: state.revision + 1,
	};
}

/** 段階 `target` へ時刻 `at` に入るときの差分。 */
function enterTarget(target: SequenceTarget, at: number): Partial<ExhibitState> {
	return {
		phase: target,
		sequenceId: null,
		questionIndex: target === "question" ? 0 : null,
		phaseStartedAt: at,
		phaseEndsAt: at + INACTIVITY_MS,
	};
}

/** 段階 `target` へ入る差分。直前に再生するシーケンスがあれば、先に `sequence` へ入る。 */
function enterWithSequence(target: SequenceTarget, at: number, sequences: readonly Sequence[]): Partial<ExhibitState> {
	const sequence = sequenceBefore(sequences, target);
	if (!sequence) return enterTarget(target, at);
	return {
		phase: "sequence",
		sequenceId: sequence.id,
		questionIndex: null,
		phaseStartedAt: at,
		phaseEndsAt: at + sequence.durationMs,
	};
}

/**
 * コマンドを現在状態へ適用する。役割の確認は呼び出し側で行う。
 * 受理した場合は `revision` を1加算した状態を返す。現在状態で実行できないコマンドは拒否するため、
 * 同じ操作が二度届いても二度目は拒否される（例: 表示中ではない質問への回答）。
 */
export function applyCommand(state: ExhibitState, command: Command, context: MachineContext): CommandOutcome {
	const { now } = context;
	const reject = (code: RejectCode): CommandOutcome => ({ ok: false, code });
	const accept = (next: Partial<ExhibitState>): CommandOutcome => ({
		ok: true,
		state: { ...state, ...next, revision: state.revision + 1 },
	});

	switch (command.name) {
		case "start":
			if (state.phase !== "idle") return reject("INVALID_PHASE");
			if (!state.accepting) return reject("NOT_ACCEPTING");
			return accept({
				sessionId: context.newSessionId(),
				previewColorId: null,
				...enterWithSequence("intro", now, context.sequences),
			});
		case "continue": {
			if (state.phase !== "intro") return reject("INVALID_PHASE");
			const nickname = normalizeNickname(command.nickname);
			if (nickname === null) return reject("INVALID_NICKNAME");
			return accept({ nickname, ...enterWithSequence("question", now, context.sequences) });
		}
		case "answer": {
			if (state.phase !== "question" || state.questionIndex === null) return reject("INVALID_PHASE");
			const question = context.questions[state.questionIndex];
			if (!question || question.id !== command.questionId) return reject("INVALID_PHASE");
			if (!isValidAnswer(question, command.answer)) return reject("INVALID_ANSWER");
			const answers = { ...state.answers, [question.id]: command.answer };
			if (state.questionIndex < context.questions.length - 1) {
				return accept({ answers, questionIndex: state.questionIndex + 1, phaseEndsAt: now + INACTIVITY_MS });
			}
			// 最終問でも未回答の質問が残っていれば（質問定義の変更で回答を除いた場合）、その質問へ戻す。
			const missing = context.questions.findIndex(
				(candidate) => !isValidAnswer(candidate, answers[candidate.id]),
			);
			if (missing !== -1) return accept({ answers, questionIndex: missing, phaseEndsAt: now + INACTIVITY_MS });
			return accept({
				phase: "judging",
				resultColorId: judge(context.questions, context.colors, answers),
				questionIndex: null,
				answers: {},
				phaseStartedAt: now,
				phaseEndsAt: now + JUDGING_MS,
			});
		}
		case "back":
			if (state.phase !== "question" || state.questionIndex === null || state.questionIndex < 1) {
				return reject("INVALID_PHASE");
			}
			return accept({ questionIndex: state.questionIndex - 1, phaseEndsAt: now + INACTIVITY_MS });
		case "returnToIdle":
			if (state.phase !== "result") return reject("INVALID_PHASE");
			return { ok: true, state: toIdle(state, now) };
		case "setAccepting":
			return accept({ accepting: command.accepting });
		case "forceReset":
			return { ok: true, state: toIdle(state, now) };
		case "previewColor":
			if (state.phase !== "idle") return reject("INVALID_PHASE");
			return accept({ previewColorId: command.colorId });
		case "clearPreview":
			if (state.previewColorId === null) return reject("INVALID_PHASE");
			return accept({ previewColorId: null });
	}
}

/**
 * 期限を過ぎた状態を順に進める（仕様書8.2節）。遷移先の開始時刻は実行時刻ではなく期限の時刻とする。
 * `sequence` は再生を終えたら `before` の段階へ進む。シーケンスの定義が見つからなければ `idle` へ戻す。
 * 期限内なら同じ状態オブジェクトを返す。
 */
export function advanceDeadlines(state: ExhibitState, now: number, sequences: readonly Sequence[]): ExhibitState {
	let current = state;
	while (current.phaseEndsAt !== null && now >= current.phaseEndsAt) {
		const deadline = current.phaseEndsAt;
		if (current.phase === "judging") {
			current = {
				...current,
				phase: "result",
				phaseStartedAt: deadline,
				phaseEndsAt: deadline + RESULT_MS,
				revision: current.revision + 1,
			};
		} else if (current.phase === "sequence") {
			const sequence = findSequence(sequences, current.sequenceId);
			current = sequence
				? { ...current, ...enterTarget(sequence.before, deadline), revision: current.revision + 1 }
				: toIdle(current, deadline);
		} else {
			current = toIdle(current, deadline);
		}
	}
	return current;
}
