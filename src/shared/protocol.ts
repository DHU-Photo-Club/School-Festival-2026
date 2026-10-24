import type { Command } from './machine.ts';
import { COLOR_IDS, SLIDER_STOP_IDS } from './types.ts';
import type { ColorId, DeviceRole, DisplayState, ExhibitState, SliderStopId } from './types.ts';

export const PROTOCOL_VERSION = 1;

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'PROTOCOL_MISMATCH'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'STALE_REVISION'
  | 'INVALID_PHASE'
  | 'CONTROLLER_IN_USE'
  | 'NOT_ACCEPTING'
  | 'INTERNAL_ERROR';

/** 利用者向けの固定文言（仕様書8.5節）。 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  INVALID_MESSAGE: 'メッセージを処理できませんでした。',
  PROTOCOL_MISMATCH: '画面を再読み込みしてください。',
  UNAUTHENTICATED: '端末の登録が切れました。スタッフにお声がけください。',
  FORBIDDEN: 'この端末ではその操作はできません。',
  STALE_REVISION: '表示状態を更新しました。もう一度操作してください。',
  INVALID_PHASE: '表示状態を更新しました。もう一度操作してください。',
  CONTROLLER_IN_USE: '別の端末で診断を操作しています。',
  NOT_ACCEPTING: 'ただいま受付を停止しています。',
  INTERNAL_ERROR: 'ただいま操作できません。スタッフにお声がけください。',
};

/** 再送で解決する見込みがあるか。 */
export const RETRYABLE: Readonly<Record<ErrorCode, boolean>> = {
  INVALID_MESSAGE: false,
  PROTOCOL_MISMATCH: false,
  UNAUTHENTICATED: false,
  FORBIDDEN: false,
  STALE_REVISION: false,
  INVALID_PHASE: false,
  CONTROLLER_IN_USE: false,
  NOT_ACCEPTING: false,
  INTERNAL_ERROR: true,
};

/** WebSocketのclose code（仕様書8.5節）。 */
export const CLOSE_CODES = {
  invalidMessages: 4000,
  sessionExpired: 4001,
  protocolMismatch: 4002,
  helloTimeout: 4008,
  controllerMoved: 4009,
} as const;

export interface HelloMessage {
  version: 1;
  type: 'hello';
  clientId: string;
}

export interface CommandMessage {
  version: 1;
  type: 'command';
  requestId: string;
  expectedRevision?: number;
  command: Command;
}

export interface PingMessage {
  version: 1;
  type: 'ping';
  pingId: string;
  clientSentAt: number;
}

export interface ResultStartedMessage {
  version: 1;
  type: 'resultStarted';
  requestId: string;
  sessionId: string;
  screenId: string;
  actualStartedAt: number;
}

/**
 * 運用通知。`qrGenerationFailed` は仕様書10.4節。
 * `preloadReport`（仕様書7.2.5節）と `clockSync`（仕様書8.6節）は、仕様書が管理画面への報告を求めながら
 * メッセージ形式を定めていないため、同じ `diagnostic` で送る（docs/progress.md 参照）。
 */
export type Diagnostic =
  | { name: 'qrGenerationFailed'; sessionId: string; colorId: ColorId; occurredAt: number }
  | { name: 'preloadReport'; succeeded: number; failedPhotoIds: string[] }
  | { name: 'clockSync'; minRoundTripTime: number; offsetSpread: number };

export type DiagnosticMessage = { version: 1; type: 'diagnostic'; requestId: string } & Diagnostic;

export type ClientMessage = HelloMessage | CommandMessage | PingMessage | ResultStartedMessage | DiagnosticMessage;

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'INVALID_MESSAGE' | 'PROTOCOL_MISMATCH'; requestId: string | null; notJson: boolean };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100;
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isColorId = (value: unknown): value is ColorId => COLOR_IDS.includes(value as ColorId);

function parseCommand(value: unknown): Command | null {
  if (!isObject(value) || typeof value.name !== 'string') return null;
  switch (value.name) {
    case 'start':
    case 'continue':
    case 'back':
    case 'returnToIdle':
    case 'forceReset':
    case 'releaseController':
    case 'clearPreview':
      return { name: value.name };
    case 'answer':
      if (!isId(value.questionId) || !SLIDER_STOP_IDS.includes(value.stopId as SliderStopId)) return null;
      return { name: 'answer', questionId: value.questionId, stopId: value.stopId as SliderStopId };
    case 'setAccepting':
      if (typeof value.accepting !== 'boolean') return null;
      return { name: 'setAccepting', accepting: value.accepting };
    case 'previewColor':
      if (!isColorId(value.colorId)) return null;
      return { name: 'previewColor', colorId: value.colorId };
    default:
      return null;
  }
}

function parseDiagnostic(value: Json): Diagnostic | null {
  switch (value.name) {
    case 'qrGenerationFailed':
      if (!isId(value.sessionId) || !isColorId(value.colorId) || !isTime(value.occurredAt)) return null;
      return { name: 'qrGenerationFailed', sessionId: value.sessionId, colorId: value.colorId, occurredAt: value.occurredAt };
    case 'preloadReport':
      if (!Number.isSafeInteger(value.succeeded) || (value.succeeded as number) < 0) return null;
      if (!Array.isArray(value.failedPhotoIds) || !value.failedPhotoIds.every(isId)) return null;
      return { name: 'preloadReport', succeeded: value.succeeded as number, failedPhotoIds: value.failedPhotoIds };
    case 'clockSync':
      if (!isTime(value.minRoundTripTime) || !isTime(value.offsetSpread)) return null;
      return { name: 'clockSync', minRoundTripTime: value.minRoundTripTime, offsetSpread: value.offsetSpread };
    default:
      return null;
  }
}

/** クライアントからのメッセージを検証する。不明なフィールドは無視する（仕様書8.5節）。 */
export function parseClientMessage(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'INVALID_MESSAGE', requestId: null, notJson: true };
  }
  const requestId = isObject(data) && isId(data.requestId) ? data.requestId : null;
  const invalid: ParseResult = { ok: false, code: 'INVALID_MESSAGE', requestId, notJson: false };
  if (!isObject(data)) return invalid;
  if (data.version !== PROTOCOL_VERSION) {
    return { ok: false, code: 'PROTOCOL_MISMATCH', requestId, notJson: false };
  }

  switch (data.type) {
    case 'hello':
      if (!isId(data.clientId)) return invalid;
      return { ok: true, message: { version: 1, type: 'hello', clientId: data.clientId } };
    case 'command': {
      if (!requestId) return invalid;
      const command = parseCommand(data.command);
      if (!command) return invalid;
      if (data.expectedRevision === undefined) {
        if (command.name !== 'forceReset') return invalid;
        return { ok: true, message: { version: 1, type: 'command', requestId, command } };
      }
      if (!isRevision(data.expectedRevision)) return invalid;
      return {
        ok: true,
        message: { version: 1, type: 'command', requestId, expectedRevision: data.expectedRevision, command },
      };
    }
    case 'ping':
      if (!isId(data.pingId) || !isTime(data.clientSentAt)) return invalid;
      return { ok: true, message: { version: 1, type: 'ping', pingId: data.pingId, clientSentAt: data.clientSentAt } };
    case 'resultStarted':
      if (!requestId || !isId(data.sessionId) || !isId(data.screenId) || !isTime(data.actualStartedAt)) return invalid;
      return {
        ok: true,
        message: {
          version: 1,
          type: 'resultStarted',
          requestId,
          sessionId: data.sessionId,
          screenId: data.screenId,
          actualStartedAt: data.actualStartedAt,
        },
      };
    case 'diagnostic': {
      if (!requestId) return invalid;
      const diagnostic = parseDiagnostic(data);
      if (!diagnostic) return invalid;
      return { ok: true, message: { version: 1, type: 'diagnostic', requestId, ...diagnostic } };
    }
    default:
      return invalid;
  }
}

/** 展示ディスプレイへ配信する範囲だけを取り出す（仕様書8.5節）。 */
export function toDisplayState(state: ExhibitState): DisplayState {
  return {
    sessionId: state.sessionId,
    phase: state.phase,
    resultColorId: state.resultColorId,
    previewColorId: state.previewColorId,
    phaseStartedAt: state.phaseStartedAt,
    phaseEndsAt: state.phaseEndsAt,
    revision: state.revision,
  };
}

export interface DeviceStatus {
  role: DeviceRole;
  screenId: string | null;
  connected: boolean;
  lastReceivedAt: number | null;
  /** 展示ディスプレイの先読み報告（仕様書7.2.5節）。 */
  preload: { succeeded: number; failedPhotoIds: string[] } | null;
  /** 時刻補正の精度（仕様書8.6節）。 */
  clockSync: { minRoundTripTime: number; offsetSpread: number; degraded: boolean } | null;
}

export interface SyncEntry {
  screenId: string;
  actualStartedAt: number | null;
  excludedReason: string | null;
}

/** 結果同期の計測（仕様書8.7節、13章）。 */
export interface SyncReport {
  sessionId: string;
  judgingStartedAt: number;
  resultStartAt: number;
  entries: SyncEntry[];
  /** 計測対象の `actualStartedAt` の最大値と最小値の差。 */
  syncSpread: number | null;
  /** `judging.phaseStartedAt` から計測対象の `actualStartedAt` 最大値まで。 */
  startLatency: number | null;
}

export type AdminState = Omit<ExhibitState, 'answers'> & {
  devices: DeviceStatus[];
  controllerAssigned: boolean;
  syncReport: SyncReport | null;
  /** サーバー内部の失敗が最後に起きた時刻（仕様書8.5節 INTERNAL_ERROR）。 */
  lastInternalErrorAt: number | null;
};

export type RoleState = ExhibitState | DisplayState | AdminState;

export type ServerMessage =
  | { version: 1; type: 'welcome'; serverTime: number; state: RoleState }
  | { version: 1; type: 'state'; revision: number; state: RoleState }
  | { version: 1; type: 'ack'; requestId: string; revision: number; state?: RoleState }
  | {
      version: 1;
      type: 'error';
      requestId: string | null;
      code: ErrorCode;
      message: string;
      retryable: boolean;
      state?: RoleState;
    }
  | { version: 1; type: 'pong'; pingId: string; clientSentAt: number; serverTime: number }
  | {
      version: 1;
      type: 'alert';
      name: 'qrGenerationFailed';
      sessionId: string;
      colorId: ColorId;
      occurredAt: number;
    };
