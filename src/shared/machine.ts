import { isValidAnswer } from "./answer.ts";
import { normalizeNickname } from "./nickname.ts";
import { findSequence, sequenceBefore } from "./sequence.ts";
import type {
	Answer,
	ExhibitState,
	PaletteId,
	Question,
	QuestionId,
	Role,
	Sequence,
	SequenceTarget,
	SessionResult,
} from "./types.ts";

/** `judging` の最短の長さ（仕様書8.2節）。AIの選定が早く終わっても、色を選んでいる演出としてこの時間（10秒）は待たせる。 */
export const JUDGING_MS = 10_000;
/** `judging` の最長の長さの既定値。AIの選定に使う時間の上限（`src/data/ai.ts` の `judgingMaxMs`）を渡す。 */
export const DEFAULT_JUDGING_MAX_MS = 30_000;
/**
 * `judging` を早めに終えるとき、終了時刻を少なくともこの時間だけ先にする。全画面へ新しい
 * `phaseEndsAt` が届いてから同時に結果へ切り替えるため。展示ディスプレイの破片が二色へ色づく時間
 * （`src/shared/motion.ts` の `SHARD_TINT_MS`）もこの値に合わせる。
 */
export const SETTLE_MARGIN_MS = 800;

export type Command =
	| { name: "start" }
	| { name: "continue"; nickname: string }
	| { name: "answer"; questionId: string; answer: Answer }
	| { name: "back" }
	| { name: "openDoor" }
	| { name: "setAccepting"; accepting: boolean }
	| { name: "forceReset" }
	| { name: "previewColor"; colorId: PaletteId }
	| { name: "clearPreview" };

export type CommandName = Command["name"];

/** 役割ごとに許可するコマンド（仕様書8.3節）。 */
export const ROLE_COMMANDS: Readonly<Record<Role, readonly CommandName[]>> = {
	controller: ["start", "continue", "answer", "back", "openDoor"],
	admin: ["setAccepting", "forceReset", "previewColor", "clearPreview"],
	display: [],
	photo: [],
	light: [],
	sound: [],
};

export interface MachineContext {
	now: number;
	questions: readonly Question[];
	sequences: readonly Sequence[];
	newSessionId: () => string;
	/** `judging` の最長の長さ。省略すると `DEFAULT_JUDGING_MAX_MS`。 */
	judgingMaxMs?: number;
}

export type RejectCode = "INVALID_PHASE" | "NOT_ACCEPTING" | "INVALID_NICKNAME" | "INVALID_ANSWER";

export type CommandOutcome =
	| {
			ok: true;
			state: ExhibitState;
			/** `judging` へ入ったときの全問の回答。AIの選定に渡す。 */
			judgedAnswers?: Readonly<Record<QuestionId, Answer>>;
	  }
	| { ok: false; code: RejectCode };

/** 保存した状態がないときの初期状態（仕様書8.1節）。 */
export function initialState(now: number): ExhibitState {
	return {
		sessionId: null,
		phase: "idle",
		nickname: null,
		sequenceId: null,
		questionIndex: null,
		answers: {},
		result: null,
		judgeFailed: false,
		previewColorId: null,
		phaseStartedAt: now,
		phaseEndsAt: null,
		answeredAt: null,
		doorOpenedAt: null,
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
		result: null,
		judgeFailed: false,
		previewColorId: null,
		phaseStartedAt: at,
		phaseEndsAt: null,
		answeredAt: null,
		doorOpenedAt: null,
		revision: state.revision + 1,
	};
}

/**
 * AIの選定に失敗したとき、回答を保ったまま最終問へ戻す（refs/handoff 実装仕様書8章。固定計算で
 * 代わりの結果を作らない）。iPadは `judgeFailed` を見て、もう一度「次へ」を押すよう案内する。
 */
function toFailedQuestion(state: ExhibitState, at: number): ExhibitState {
	return {
		...state,
		phase: "question",
		result: null,
		judgeFailed: true,
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
		phaseEndsAt: null,
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
	const accept = (next: Partial<ExhibitState>): Extract<CommandOutcome, { ok: true }> => ({
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
				return accept({
					answers,
					answeredAt: now,
					judgeFailed: false,
					questionIndex: state.questionIndex + 1,
				});
			}
			// 最終問でも未回答の質問が残っていれば（質問定義の変更で回答を除いた場合）、その質問へ戻す。
			const missing = context.questions.findIndex(
				(candidate) => !isValidAnswer(candidate, answers[candidate.id]),
			);
			if (missing !== -1) {
				return accept({
					answers,
					answeredAt: now,
					judgeFailed: false,
					questionIndex: missing,
				});
			}
			// 回答はAIの選定が終わるまで保持する。失敗したら最終問へ戻すため、`questionIndex` も残す。
			const judging = accept({
				phase: "judging",
				answers,
				answeredAt: now,
				result: null,
				judgeFailed: false,
				phaseStartedAt: now,
				phaseEndsAt: now + (context.judgingMaxMs ?? DEFAULT_JUDGING_MAX_MS),
			});
			return { ...judging, judgedAnswers: answers };
		}
		case "back":
			if (state.phase !== "question" || state.questionIndex === null || state.questionIndex < 1) {
				return reject("INVALID_PHASE");
			}
			return accept({
				questionIndex: state.questionIndex - 1,
				judgeFailed: false,
			});
		case "openDoor":
			// 扉は一回の結果で一度だけ開く。
			if (state.phase !== "result" || (state.doorOpenedAt ?? null) !== null) return reject("INVALID_PHASE");
			return accept({ doorOpenedAt: now });
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
 * AIの選定の結果で `judging` を締める。結果があれば設定して回答を消し、終了時刻を `judging` の開始から
 * `JUDGING_MS` 後と、現在から `SETTLE_MARGIN_MS` 後の遅いほうへ早める（元の終了時刻より遅くはしない）。
 * `null`（選定の失敗）なら、回答を保ったまま最終問へ戻す。
 * 選定を待っていたセッションの `judging` でなければ `null` を返す。
 */
export function settleJudging(
	state: ExhibitState,
	sessionId: string,
	result: SessionResult | null,
	now: number,
): ExhibitState | null {
	if (state.phase !== "judging" || state.sessionId !== sessionId || state.phaseEndsAt === null) return null;
	if (!result) return toFailedQuestion(state, now);
	const endsAt = Math.min(state.phaseEndsAt, Math.max(state.phaseStartedAt + JUDGING_MS, now + SETTLE_MARGIN_MS));
	return { ...state, result, answers: {}, phaseEndsAt: endsAt, revision: state.revision + 1 };
}

/**
 * 期限を過ぎた `sequence` と `judging` を進める（仕様書8.2節）。遷移先の開始時刻は期限の時刻とする。
 * `sequence` の定義が削除されていた場合は、ニックネームの入力状況から遷移先を決める。
 * `judging` は結果があれば `result` へ進み、なければ（AIの選定が時間切れ）最終問へ戻す。
 */
export function advanceDeadlines(state: ExhibitState, now: number, sequences: readonly Sequence[]): ExhibitState {
	const deadline = state.phaseEndsAt;
	if (deadline === null) return state;
	if (state.phase !== "sequence" && state.phase !== "judging") {
		// 保存済みのセッションに残っている旧版の自動リセット期限を解除する。
		return { ...state, phaseEndsAt: null, revision: state.revision + 1 };
	}
	if (now < deadline) return state;
	if (state.phase === "sequence") {
		const sequence = findSequence(sequences, state.sequenceId);
		const target = sequence?.before ?? (state.nickname === null ? "intro" : "question");
		return { ...state, ...enterTarget(target, deadline), revision: state.revision + 1 };
	}
	if (!state.result) return toFailedQuestion(state, deadline);
	return {
		...state,
		phase: "result",
		questionIndex: null,
		answers: {},
		phaseStartedAt: deadline,
		phaseEndsAt: null,
		revision: state.revision + 1,
	};
}
