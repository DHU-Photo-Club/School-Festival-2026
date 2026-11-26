import type { Command } from "./machine.ts";
import type { Answer, DeviceRole, DisplayState, ExhibitState, PaletteId } from "./types.ts";
import { PALETTE_IDS } from "./types.ts";

/** クライアントからサーバーへのメッセージ。 */
export type ClientMessage = { type: "command"; command: Command } | { type: "ping"; clientSentAt: number };

/** サーバーからクライアントへのメッセージ。 */
export type ServerMessage =
	| { type: "state"; serverTime: number; state: RoleState }
	| { type: "pong"; clientSentAt: number; serverTime: number };

/** 管理画面の端末一覧の一行。接続中のWebSocketごとに一行。 */
export interface DeviceStatus {
	role: DeviceRole;
	/** 展示ディスプレイと写真用の画面番号（1始まり）。診断用iPadと電球の中継は `null`。 */
	screen: number | null;
	/** 最後にメッセージを受信してから15秒以内なら `true`。 */
	connected: boolean;
	lastReceivedAt: number;
}

export type AdminState = Omit<ExhibitState, "answers" | "nickname"> & { devices: DeviceStatus[] };

export type RoleState = ExhibitState | DisplayState | AdminState;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);
/** `continue` で受け取るニックネームの、正規化前の最大長（UTF-16コード単位）。 */
const MAX_RAW_NICKNAME = 200;
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 100;
/** 複数選択と順位つき選択の回答で受け取る選択肢IDの最大数。 */
const MAX_ANSWER_IDS = 20;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/**
 * 回答はID、IDの配列、数（スライダーの位置）、`{ x, y }`（2Dマップの位置）のいずれか。
 * 値の範囲と質問の形式に合うかは状態遷移で確かめる。
 */
const isAnswer = (value: unknown): value is Answer =>
	isId(value) ||
	isFiniteNumber(value) ||
	(Array.isArray(value) && value.length <= MAX_ANSWER_IDS && value.every(isId)) ||
	(isObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y));

function parseCommand(value: unknown): Command | null {
	if (!isObject(value) || typeof value.name !== "string") return null;
	switch (value.name) {
		case "start":
		case "back":
		case "returnToIdle":
		case "forceReset":
		case "clearPreview":
			return { name: value.name };
		case "continue":
			// 長さと文字の検証は状態遷移で行い、不正なら現在状態を送り直して確定待ちを解除させる。
			if (typeof value.nickname !== "string" || value.nickname.length > MAX_RAW_NICKNAME) return null;
			return { name: "continue", nickname: value.nickname };
		case "answer":
			if (!isId(value.questionId) || !isAnswer(value.answer)) return null;
			// 2Dマップの位置は x と y だけを受け取る。
			return {
				name: "answer",
				questionId: value.questionId,
				answer: isObject(value.answer)
					? { x: value.answer.x as number, y: value.answer.y as number }
					: value.answer,
			};
		case "setAccepting":
			if (typeof value.accepting !== "boolean") return null;
			return { name: "setAccepting", accepting: value.accepting };
		case "previewColor":
			if (!PALETTE_IDS.includes(value.colorId as PaletteId)) return null;
			return { name: "previewColor", colorId: value.colorId as PaletteId };
		default:
			return null;
	}
}

/** クライアントからのメッセージを検証する。形が正しくなければ `null`。不明なフィールドは無視する。 */
export function parseClientMessage(raw: string): ClientMessage | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isObject(data)) return null;
	switch (data.type) {
		case "command": {
			const command = parseCommand(data.command);
			return command ? { type: "command", command } : null;
		}
		case "ping":
			if (typeof data.clientSentAt !== "number" || !Number.isFinite(data.clientSentAt)) return null;
			return { type: "ping", clientSentAt: data.clientSentAt };
		default:
			return null;
	}
}

/** 展示ディスプレイと写真用へ配信する範囲だけを取り出す。回答内容と結果ページのIDは含めない。 */
export function toDisplayState(state: ExhibitState): DisplayState {
	return {
		sessionId: state.sessionId,
		phase: state.phase,
		sequenceId: state.sequenceId,
		result: state.result
			? { name: state.result.name, colors: state.result.colors, photoIds: state.result.photoIds }
			: null,
		previewColorId: state.previewColorId,
		phaseStartedAt: state.phaseStartedAt,
		phaseEndsAt: state.phaseEndsAt,
		// この項目を持たない保存済みの状態は、波紋を出さない。
		answeredAt: state.answeredAt ?? null,
		revision: state.revision,
	};
}
