import { judge } from "./diagnosis.ts";
import type { ColorId, ExhibitState, Question, ResultColor, Role, SliderStopId } from "./types.ts";

/** `judging` の長さ（仕様書8.7節）。 */
export const JUDGING_MS = 2_000;
/** `result` の長さ（仕様書5章）。 */
export const RESULT_MS = 60_000;
/** `intro` と `question` で操作がないまま `idle` へ戻すまでの時間（仕様書8.2節）。 */
export const INACTIVITY_MS = 5 * 60_000;

export type Command =
	| { name: "start" }
	| { name: "continue" }
	| { name: "answer"; questionId: string; stopId: SliderStopId }
	| { name: "back" }
	| { name: "returnToIdle" }
	| { name: "setAccepting"; accepting: boolean }
	| { name: "forceReset" }
	| { name: "releaseController" }
	| { name: "previewColor"; colorId: ColorId }
	| { name: "clearPreview" };

export type CommandName = Command["name"];

/** 役割ごとに許可するコマンド（仕様書8.5節）。 */
export const ROLE_COMMANDS: Readonly<Record<Role, readonly CommandName[]>> = {
	controller: ["start", "continue", "answer", "back", "returnToIdle"],
	admin: ["setAccepting", "forceReset", "releaseController", "previewColor", "clearPreview"],
	display: [],
	photo: [],
};

export interface MachineContext {
	now: number;
	questions: readonly Question[];
	colors: readonly ResultColor[];
	newSessionId: () => string;
}

export type CommandOutcome = { ok: true; state: ExhibitState } | { ok: false; code: "INVALID_PHASE" | "NOT_ACCEPTING" };

/** Durable Objectを初めて作成したときの状態（仕様書8.1節）。 */
export function initialState(now: number): ExhibitState {
	return {
		sessionId: null,
		phase: "idle",
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

/** セッション状態を初期化して `idle` へ戻す。`accepting` は変更しない（仕様書8.2節）。 */
function toIdle(state: ExhibitState, at: number): ExhibitState {
	return {
		...state,
		sessionId: null,
		phase: "idle",
		questionIndex: null,
		answers: {},
		resultColorId: null,
		previewColorId: null,
		phaseStartedAt: at,
		phaseEndsAt: null,
		revision: state.revision + 1,
	};
}

/**
 * コマンドを現在状態へ適用する。役割と `expectedRevision` の確認は呼び出し側で行う。
 * 受理した場合は `revision` を1加算した状態を返す。`releaseController` は展示状態を変えないので扱わない。
 */
export function applyCommand(state: ExhibitState, command: Command, context: MachineContext): CommandOutcome {
	const { now } = context;
	const reject = (code: "INVALID_PHASE" | "NOT_ACCEPTING"): CommandOutcome => ({ ok: false, code });
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
				phase: "intro",
				previewColorId: null,
				phaseStartedAt: now,
				phaseEndsAt: now + INACTIVITY_MS,
			});
		case "continue":
			if (state.phase !== "intro") return reject("INVALID_PHASE");
			return accept({
				phase: "question",
				questionIndex: 0,
				phaseStartedAt: now,
				phaseEndsAt: now + INACTIVITY_MS,
			});
		case "answer": {
			if (state.phase !== "question" || state.questionIndex === null) return reject("INVALID_PHASE");
			const question = context.questions[state.questionIndex];
			if (!question || question.id !== command.questionId) return reject("INVALID_PHASE");
			if (!question.stops.some((stop) => stop.id === command.stopId)) return reject("INVALID_PHASE");
			const answers = { ...state.answers, [question.id]: command.stopId };
			if (state.questionIndex < context.questions.length - 1) {
				return accept({ answers, questionIndex: state.questionIndex + 1, phaseEndsAt: now + INACTIVITY_MS });
			}
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
		case "releaseController":
			return reject("INVALID_PHASE");
	}
}

/**
 * 期限を過ぎた状態を順に進める（仕様書8.2節）。遷移先の開始時刻は実行時刻ではなく期限の時刻とする。
 * 期限内なら同じ状態オブジェクトを返す。
 */
export function advanceDeadlines(state: ExhibitState, now: number): ExhibitState {
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
		} else {
			current = toIdle(current, deadline);
		}
	}
	return current;
}
