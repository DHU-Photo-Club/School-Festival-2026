import type { Command } from "../shared/machine.ts";
import { advanceDeadlines, applyCommand, initialState, ROLE_COMMANDS } from "../shared/machine.ts";
import type {
	AdminState,
	ClientMessage,
	CommandMessage,
	DeviceStatus,
	DiagnosticMessage,
	ErrorCode,
	ResultStartedMessage,
	RoleState,
	ServerMessage,
	SyncReport,
} from "../shared/protocol.ts";
import { CLOSE_CODES, ERROR_MESSAGES, parseClientMessage, RETRYABLE, toDisplayState } from "../shared/protocol.ts";
import { displayOrderOf, nextFreeScreenId } from "../shared/screens.ts";
import type { DeviceRole, ExhibitState, Question, ResultColor, Role, ScreenRole, Sequence } from "../shared/types.ts";

/** 認証・ペアリングセッションの有効期間（仕様書8.4節）。 */
export const SESSION_TTL_MS = 12 * 60 * 60_000;
/** ペアリングコードの有効期間（仕様書8.4節）。 */
export const PAIRING_TTL_MS = 5 * 60_000;
/** `hello` を待つ時間（仕様書8.5節）。 */
export const HELLO_TIMEOUT_MS = 5_000;
/** 有効メッセージが届かない端末を切断扱いにするまでの時間（仕様書8.6節）。 */
export const STALE_AFTER_MS = 15_000;
/** 冪等性記録の保持期間と件数（仕様書8.5節）。 */
export const IDEMPOTENCY_TTL_MS = 10 * 60_000;
export const IDEMPOTENCY_MAX = 512;
/** 同期精度低下の判定（仕様書8.6節）。 */
export const SYNC_MAX_MIN_RTT_MS = 400;
export const SYNC_MAX_SPREAD_MS = 100;
/** 端末の最終受信時刻だけが変わったときに管理画面へ送る間隔。 */
const ADMIN_REFRESH_MS = 5_000;
/** JSONとして解釈できないメッセージやバイナリフレームを受けた接続を閉じるときのclose code（仕様書8.5節）。 */
const CLOSE_INVALID_PAYLOAD = 1007;
/** 最後の有効メッセージから15秒経過した接続を閉じるときのclose code（仕様書8.5節・8.6節）。 */
const CLOSE_STALE = 1001;
/** 操作権限を別IDのiPadへ移した旧接続を閉じるときのclose code（仕様書9.3節）。 */
const CLOSE_NORMAL = 1000;

/** 同期処理のキー・値ストア。Durable ObjectではSQLiteで実装する。 */
export interface Store {
	get<T>(key: string): T | undefined;
	put(key: string, value: unknown): void;
	delete(key: string): void;
	list<T>(prefix: string): [string, T][];
}

export interface AuthSession {
	/** 管理画面に表示する公開ID。Cookieの値とは別の乱数。 */
	id: string;
	kind: "admin" | "device";
	role: Role;
	screenId: string | null;
	issuedAt: number;
	expiresAt: number;
}

interface PairingCode {
	role: DeviceRole;
	issuedAt: number;
	expiresAt: number;
}

interface ControllerHolder {
	clientId: string;
	authKey: string;
}

interface DeviceRecord {
	lastReceivedAt: number | null;
	preload: DeviceStatus["preload"];
	clockSync: DeviceStatus["clockSync"];
}

interface IdempotencyRecord {
	storedAt: number;
	response: ServerMessage;
}

/** 接続ごとの情報。Durable ObjectではWebSocketのattachmentへ保存する。 */
export interface ConnectionMeta {
	connId: string;
	role: Role;
	authKey: string;
	screenId: string | null;
	connectedAt: number;
	helloAt: number | null;
	clientId: string | null;
	lastReceivedAt: number;
	invalidCount: number;
	/** 診断用iPadのうち操作権限を持つ接続か。 */
	controlling: boolean;
}

export interface Connection {
	readonly meta: ConnectionMeta;
	setMeta(meta: ConnectionMeta): void;
	send(message: ServerMessage): void;
	close(code: number, reason: string): void;
}

export interface CoreOptions {
	store: Store;
	now: () => number;
	randomId: () => string;
	randomDigits: (length: number) => string;
	connections: () => Connection[];
	questions: readonly Question[];
	colors: readonly ResultColor[];
	sequences: readonly Sequence[];
}

export type AuthCheck = { ok: true; session: AuthSession } | { ok: false; status: 401 | 403 };

const KEY_STATE = "state";
const KEY_CONTROLLER = "controller";
const KEY_SYNC = "sync";
const KEY_SYNC_EARLY = "sync-early";
const PREFIX_SESSION = "session:";
const PREFIX_PAIRING = "pairing:";
const PREFIX_IDEMPOTENCY = "idem:";
const PREFIX_DEVICE = "device:";

const deviceKey = (role: Role, screenId: string | null) =>
	role === "display" || role === "photo" ? `${role}:${screenId}` : role;

/**
 * 展示状態の正本。要求を一件ずつ同期的に処理し、保存と配信を一回の処理として行う（仕様書8.1節）。
 */
export class ExhibitCore {
	private lastAdminRefreshAt = 0;
	private lastInternalErrorAt: number | null = null;

	constructor(private readonly options: CoreOptions) {}

	// ---- 状態 ----

	private load(): ExhibitState {
		const stored = this.options.store.get<ExhibitState>(KEY_STATE);
		// `sequenceId` を追加する前に保存した状態には値がない。
		if (stored) return { ...stored, sequenceId: stored.sequenceId ?? null };
		const created = initialState(this.options.now());
		this.options.store.put(KEY_STATE, created);
		return created;
	}

	/** 期限切れの状態を進めてから現在状態を返す。進んだ場合は保存して配信する。 */
	current(): ExhibitState {
		const state = this.load();
		const advanced = advanceDeadlines(state, this.options.now(), this.options.sequences);
		if (advanced !== state) this.commit(state, advanced, null);
		return advanced;
	}

	private commit(previous: ExhibitState, next: ExhibitState, sender: Connection | null): void {
		this.options.store.put(KEY_STATE, next);
		if (Object.keys(previous.answers).length > 0 && Object.keys(next.answers).length === 0) {
			this.purgeAnswerRecords();
		}
		if (previous.phase === "judging" && next.phase !== "judging" && previous.sessionId) {
			this.openSyncReport(previous, next);
		}
		const senderId = sender ? sender.meta.connId : null;
		for (const connection of this.liveConnections()) {
			const meta = connection.meta;
			// 接続オブジェクトは取得ごとに作り直すため、送信元は connId で判定する。
			if (senderId !== null && meta.connId === senderId) continue;
			const view = this.viewFor(meta, next);
			if (view) connection.send({ version: 1, type: "state", revision: next.revision, state: view });
		}
	}

	// ---- 役割別の配信範囲（仕様書8.5節） ----

	private viewFor(meta: ConnectionMeta, state: ExhibitState): RoleState | null {
		if (meta.helloAt === null) return null;
		switch (meta.role) {
			case "controller":
				return meta.controlling ? state : null;
			case "display":
			case "photo":
				return toDisplayState(state);
			case "admin":
				return this.adminView(state);
		}
	}

	private adminView(state: ExhibitState): AdminState {
		const { answers: _answers, ...rest } = state;
		const now = this.options.now();
		const live = this.liveConnections();
		const status = (role: DeviceRole, screenId: string | null): DeviceStatus => {
			const record = this.options.store.get<DeviceRecord>(PREFIX_DEVICE + deviceKey(role, screenId));
			const connection = live.find(
				(candidate) =>
					candidate.meta.role === role &&
					candidate.meta.helloAt !== null &&
					(role === "controller" ? candidate.meta.controlling : candidate.meta.screenId === screenId),
			);
			return {
				role,
				screenId,
				connected: connection !== undefined && now - connection.meta.lastReceivedAt < STALE_AFTER_MS,
				lastReceivedAt: connection?.meta.lastReceivedAt ?? record?.lastReceivedAt ?? null,
				preload: record?.preload ?? null,
				clockSync: record?.clockSync ?? null,
			};
		};
		return {
			...rest,
			devices: [
				status("controller", null),
				...this.registeredScreens().map((screenId) => status("display", screenId)),
				...this.registeredScreens("photo").map((screenId) => status("photo", screenId)),
			],
			controllerAssigned: this.options.store.get<ControllerHolder>(KEY_CONTROLLER) !== undefined,
			syncReport: this.options.store.get<SyncReport>(KEY_SYNC) ?? null,
			lastInternalErrorAt: this.lastInternalErrorAt,
		};
	}

	private refreshAdmins(state: ExhibitState = this.load()): void {
		this.lastAdminRefreshAt = this.options.now();
		for (const connection of this.liveConnections()) {
			if (connection.meta.role !== "admin" || connection.meta.helloAt === null) continue;
			connection.send({ version: 1, type: "state", revision: state.revision, state: this.adminView(state) });
		}
	}

	private liveConnections(): Connection[] {
		return this.options.connections();
	}

	// ---- 認証（仕様書8.4節） ----

	/** 認証セッションを発行する。`authKey` はCookieの値から作ったキー。 */
	issueSession(authKey: string, kind: AuthSession["kind"], role: Role, screenId: string | null): AuthSession {
		const now = this.options.now();
		this.pruneSessions(now);
		const session: AuthSession = {
			id: this.options.randomId(),
			kind,
			role,
			screenId,
			issuedAt: now,
			expiresAt: now + SESSION_TTL_MS,
		};
		this.options.store.put(PREFIX_SESSION + authKey, session);
		return session;
	}

	/**
	 * 失効済みの認証セッションを削除する。管理セッションは認証なしで発行するため、
	 * Cookieを保存しないブラウザが再接続のたびに発行しても、行数は有効期間の分に収まる。
	 */
	private pruneSessions(now: number): void {
		for (const [key, session] of this.options.store.list<AuthSession>(PREFIX_SESSION)) {
			if (now >= session.expiresAt) this.options.store.delete(key);
		}
	}

	/** 有効な認証セッションを返す。失効済みなら削除して `null` を返す。 */
	resolveSession(authKey: string | null): AuthSession | null {
		if (!authKey) return null;
		const session = this.options.store.get<AuthSession>(PREFIX_SESSION + authKey);
		if (!session) return null;
		if (this.options.now() >= session.expiresAt) {
			this.options.store.delete(PREFIX_SESSION + authKey);
			return null;
		}
		return session;
	}

	/** WebSocket Upgrade要求の認可（仕様書8.4節）。 */
	authorizeRealtime(authKey: string | null, role: string | null, screenId: string | null): AuthCheck {
		const session = this.resolveSession(authKey);
		if (!session) return { ok: false, status: 401 };
		if (session.role !== role) return { ok: false, status: 403 };
		if ((session.role === "display" || session.role === "photo") && session.screenId !== screenId)
			return { ok: false, status: 403 };
		return { ok: true, session };
	}

	/** 認証セッションを失効させ、その接続を閉じる。 */
	revokeSession(authKey: string): void {
		this.options.store.delete(PREFIX_SESSION + authKey);
		const holder = this.options.store.get<ControllerHolder>(KEY_CONTROLLER);
		if (holder?.authKey === authKey) this.options.store.delete(KEY_CONTROLLER);
		for (const connection of this.liveConnections()) {
			if (connection.meta.authKey !== authKey) continue;
			this.sendError(connection, null, "UNAUTHENTICATED");
			connection.close(CLOSE_CODES.sessionExpired, "session revoked");
		}
		this.refreshAdmins();
	}

	/** 管理画面の一覧に表示する端末セッション。 */
	listDeviceSessions(): (AuthSession & { lastReceivedAt: number | null; connected: boolean })[] {
		const now = this.options.now();
		const live = this.liveConnections();
		return this.options.store
			.list<AuthSession>(PREFIX_SESSION)
			.filter(([, session]) => session.kind === "device" && now < session.expiresAt)
			.map(([key, session]) => {
				const authKey = key.slice(PREFIX_SESSION.length);
				const connection = live.find(
					(candidate) => candidate.meta.authKey === authKey && candidate.meta.helloAt,
				);
				const record = this.options.store.get<DeviceRecord>(
					PREFIX_DEVICE + deviceKey(session.role, session.screenId),
				);
				return {
					...session,
					lastReceivedAt: connection?.meta.lastReceivedAt ?? record?.lastReceivedAt ?? null,
					connected: connection !== undefined && now - connection.meta.lastReceivedAt < STALE_AFTER_MS,
				};
			})
			.sort((a, b) => a.issuedAt - b.issuedAt);
	}

	/** 公開IDから端末セッションを失効させる。 */
	revokeDeviceSessionById(id: string): boolean {
		const entry = this.options.store
			.list<AuthSession>(PREFIX_SESSION)
			.find(([, session]) => session.kind === "device" && session.id === id);
		if (!entry) return false;
		this.revokeSession(entry[0].slice(PREFIX_SESSION.length));
		return true;
	}

	/**
	 * 有効な端末セッションを持つ画面を役割別に返す。
	 * 既定の展示ディスプレイ一覧は、写真の割り当てと結果同期の対象を決める。
	 */
	registeredScreens(role: ScreenRole = "display"): string[] {
		const now = this.options.now();
		const screens = this.options.store
			.list<AuthSession>(PREFIX_SESSION)
			.filter(([, session]) => session.role === role && session.screenId !== null && now < session.expiresAt)
			.map(([, session]) => session.screenId as string);
		return [...new Set(screens)].sort((a, b) => (displayOrderOf(a, role) ?? 0) - (displayOrderOf(b, role) ?? 0));
	}

	/** 一回限りのペアリングコードを発行する（仕様書8.4節）。展示ディスプレイの画面IDは登録時に決める。 */
	issuePairingCode(role: DeviceRole): { ok: true; code: string; expiresAt: number } {
		const now = this.options.now();
		this.prunePairingCodes(now);
		let code = this.options.randomDigits(6);
		while (this.options.store.get<PairingCode>(PREFIX_PAIRING + code)) code = this.options.randomDigits(6);
		const record: PairingCode = {
			role,
			issuedAt: now,
			expiresAt: now + PAIRING_TTL_MS,
		};
		this.options.store.put(PREFIX_PAIRING + code, record);
		return { ok: true, code, expiresAt: record.expiresAt };
	}

	private prunePairingCodes(now: number): void {
		for (const [key, record] of this.options.store.list<PairingCode>(PREFIX_PAIRING)) {
			if (now >= record.expiresAt) this.options.store.delete(key);
		}
	}

	/** ペアリングコードを端末セッションへ交換する。コードは成功時に失効する。 */
	pair(code: string, authKey: string): { ok: true; session: AuthSession } | { ok: false } {
		const record = this.options.store.get<PairingCode>(PREFIX_PAIRING + code);
		if (!record) return { ok: false };
		if (this.options.now() >= record.expiresAt) {
			this.options.store.delete(PREFIX_PAIRING + code);
			return { ok: false };
		}
		this.options.store.delete(PREFIX_PAIRING + code);
		const screenId =
			record.role === "controller" ? null : nextFreeScreenId(this.registeredScreens(record.role), record.role);
		const session = this.issueSession(authKey, "device", record.role, screenId);
		this.refreshAdmins();
		return { ok: true, session };
	}

	// ---- WebSocket ----

	/** 認可済みのWebSocketを受け入れたときの接続情報。 */
	createConnectionMeta(authKey: string, session: AuthSession, connId: string): ConnectionMeta {
		const now = this.options.now();
		return {
			connId,
			role: session.role,
			authKey,
			screenId: session.screenId,
			connectedAt: now,
			helloAt: null,
			clientId: null,
			lastReceivedAt: now,
			invalidCount: 0,
			controlling: false,
		};
	}

	handleMessage(connection: Connection, raw: string | ArrayBuffer): void {
		const state = this.current();
		if (typeof raw !== "string") {
			// バイナリフレームは使用しない（仕様書8.5節）。
			connection.close(CLOSE_INVALID_PAYLOAD, "binary frames are not supported");
			return;
		}
		if (!this.resolveSession(connection.meta.authKey)) {
			this.sendError(connection, null, "UNAUTHENTICATED");
			connection.close(CLOSE_CODES.sessionExpired, "session expired");
			return;
		}

		const parsed = parseClientMessage(raw);
		if (!parsed.ok) {
			if (parsed.notJson) {
				connection.close(CLOSE_INVALID_PAYLOAD, "message is not JSON");
				return;
			}
			if (parsed.code === "PROTOCOL_MISMATCH") {
				this.sendError(connection, parsed.requestId, "PROTOCOL_MISMATCH");
				connection.close(CLOSE_CODES.protocolMismatch, "protocol mismatch");
				return;
			}
			this.rejectInvalid(connection, parsed.requestId);
			return;
		}

		const message = parsed.message;
		if (message.type !== "hello" && connection.meta.helloAt === null) {
			this.rejectInvalid(connection, "requestId" in message ? message.requestId : null);
			return;
		}
		const now = this.options.now();
		const meta = { ...connection.meta, lastReceivedAt: now, invalidCount: 0 };
		connection.setMeta(meta);
		this.dispatch(connection, message, state);
		if (now - this.lastAdminRefreshAt >= ADMIN_REFRESH_MS) this.refreshAdmins();
	}

	private rejectInvalid(connection: Connection, requestId: string | null): void {
		const meta = { ...connection.meta, invalidCount: connection.meta.invalidCount + 1 };
		connection.setMeta(meta);
		this.sendError(connection, requestId, "INVALID_MESSAGE");
		if (meta.invalidCount >= 3) connection.close(CLOSE_CODES.invalidMessages, "too many invalid messages");
	}

	private dispatch(connection: Connection, message: ClientMessage, state: ExhibitState): void {
		switch (message.type) {
			case "hello":
				this.handleHello(connection, message.clientId, state);
				return;
			case "ping":
				connection.send({
					version: 1,
					type: "pong",
					pingId: message.pingId,
					clientSentAt: message.clientSentAt,
					serverTime: this.options.now(),
				});
				return;
			case "command":
				this.withIdempotency(connection, message.requestId, () =>
					this.handleCommand(connection, message, state),
				);
				return;
			case "resultStarted":
				this.withIdempotency(connection, message.requestId, () =>
					this.handleResultStarted(connection, message, state),
				);
				return;
			case "diagnostic":
				this.withIdempotency(connection, message.requestId, () =>
					this.handleDiagnostic(connection, message, state),
				);
				return;
		}
	}

	private handleHello(connection: Connection, clientId: string, state: ExhibitState): void {
		const now = this.options.now();
		let meta: ConnectionMeta = { ...connection.meta, clientId, helloAt: now };
		if (meta.role === "controller") {
			const holder = this.options.store.get<ControllerHolder>(KEY_CONTROLLER);
			if (holder && holder.clientId !== clientId && this.holderConnected(holder, connection, now)) {
				connection.setMeta({ ...meta, controlling: false });
				this.sendError(connection, null, "CONTROLLER_IN_USE");
				return;
			}
			this.options.store.put(KEY_CONTROLLER, { clientId, authKey: meta.authKey } satisfies ControllerHolder);
			meta = { ...meta, controlling: true };
			for (const other of this.liveConnections()) {
				// Durable Objectの接続オブジェクトは取得ごとに作り直すため、同一性は connId で判定する。
				const otherMeta = other.meta;
				if (otherMeta.connId === meta.connId || otherMeta.role !== "controller" || !otherMeta.controlling)
					continue;
				other.setMeta({ ...otherMeta, controlling: false });
				if (otherMeta.clientId === clientId) {
					// 同じiPadの新しい接続へ操作権限を移す（仕様書9.3節）。
					other.close(CLOSE_CODES.controllerMoved, "controller moved to a new connection");
				} else {
					// 操作権限を失った別IDの接続。CONTROLLER_IN_USE を送って閉じ、クライアントは3秒ごとに再確認する。
					this.sendError(other, null, "CONTROLLER_IN_USE");
					other.close(CLOSE_NORMAL, "controller taken over");
				}
			}
		}
		connection.setMeta(meta);
		this.touchDevice(meta, now);
		// 再接続した画面は読み込みをやり直すため、前の接続の先読み報告を消す（仕様書7.2.5節）。
		if (meta.role === "display") this.updateDevice(meta, { preload: null });
		const view = this.viewFor(meta, state);
		if (view) connection.send({ version: 1, type: "welcome", serverTime: this.options.now(), state: view });
		this.refreshAdmins(state);
	}

	/**
	 * 操作権限を持つiPadが接続中か。認証セッションが有効で、15秒以内に受信した接続がある場合に限る。
	 * 該当しない場合、操作権限は別の `clientId` のiPadへ移せる（仕様書9.3節）。
	 */
	private holderConnected(holder: ControllerHolder, except: Connection, now: number): boolean {
		if (!this.resolveSession(holder.authKey)) return false;
		const exceptId = except.meta.connId;
		return this.liveConnections().some(({ meta }) => {
			return (
				meta.connId !== exceptId &&
				meta.role === "controller" &&
				meta.controlling &&
				meta.clientId === holder.clientId &&
				now - meta.lastReceivedAt < STALE_AFTER_MS
			);
		});
	}

	private handleCommand(connection: Connection, message: CommandMessage, state: ExhibitState): ServerMessage {
		const { meta } = connection;
		const command: Command = message.command;
		if (!ROLE_COMMANDS[meta.role].includes(command.name)) {
			return this.errorMessage(message.requestId, "FORBIDDEN");
		}
		if (meta.role === "controller" && !meta.controlling) {
			return this.errorMessage(message.requestId, "CONTROLLER_IN_USE");
		}
		if (command.name !== "forceReset" && message.expectedRevision !== state.revision) {
			return this.errorMessage(message.requestId, "STALE_REVISION", this.viewFor(meta, state));
		}

		if (command.name === "releaseController") {
			const holder = this.options.store.get<ControllerHolder>(KEY_CONTROLLER);
			this.options.store.delete(KEY_CONTROLLER);
			if (holder) this.revokeSession(holder.authKey);
			return {
				version: 1,
				type: "ack",
				requestId: message.requestId,
				revision: state.revision,
				state: this.adminView(state),
			};
		}

		const outcome = applyCommand(state, command, {
			now: this.options.now(),
			questions: this.options.questions,
			colors: this.options.colors,
			sequences: this.options.sequences,
			newSessionId: this.options.randomId,
		});
		if (!outcome.ok) return this.errorMessage(message.requestId, outcome.code, this.viewFor(meta, state));
		this.commit(state, outcome.state, connection);
		return {
			version: 1,
			type: "ack",
			requestId: message.requestId,
			revision: outcome.state.revision,
			state: this.viewFor(meta, outcome.state) ?? undefined,
		};
	}

	private handleResultStarted(
		connection: Connection,
		message: ResultStartedMessage,
		state: ExhibitState,
	): ServerMessage {
		const { meta } = connection;
		if (meta.role !== "display") return this.errorMessage(message.requestId, "FORBIDDEN");
		if (meta.screenId !== message.screenId) return this.errorMessage(message.requestId, "FORBIDDEN");
		const report = this.options.store.get<SyncReport>(KEY_SYNC);
		if (state.phase === "judging" && state.sessionId === message.sessionId) {
			// 画面の補正済み時刻がサーバーより先に結果開始時刻を過ぎた場合。結果へ進むときに計測へ加える。
			const early = this.options.store.get<Record<string, number>>(KEY_SYNC_EARLY) ?? {};
			this.options.store.put(KEY_SYNC_EARLY, { ...early, [message.screenId]: message.actualStartedAt });
			return { version: 1, type: "ack", requestId: message.requestId, revision: state.revision };
		}
		if (!report || report.sessionId !== message.sessionId) {
			return this.errorMessage(message.requestId, "INVALID_PHASE");
		}
		const entries = report.entries.map((entry) =>
			entry.screenId === message.screenId && entry.excludedReason === null && entry.actualStartedAt === null
				? { ...entry, actualStartedAt: message.actualStartedAt }
				: entry,
		);
		this.options.store.put(KEY_SYNC, summarizeSync({ ...report, entries }));
		this.refreshAdmins(state);
		return { version: 1, type: "ack", requestId: message.requestId, revision: state.revision };
	}

	private handleDiagnostic(connection: Connection, message: DiagnosticMessage, state: ExhibitState): ServerMessage {
		const { meta } = connection;
		const ack: ServerMessage = { version: 1, type: "ack", requestId: message.requestId, revision: state.revision };
		switch (message.name) {
			case "qrGenerationFailed": {
				if (meta.role !== "controller") return this.errorMessage(message.requestId, "FORBIDDEN");
				if (!meta.controlling) return this.errorMessage(message.requestId, "CONTROLLER_IN_USE");
				if (message.sessionId !== state.sessionId || message.colorId !== state.resultColorId) {
					return this.errorMessage(message.requestId, "INVALID_PHASE");
				}
				for (const admin of this.liveConnections()) {
					if (admin.meta.role !== "admin" || admin.meta.helloAt === null) continue;
					admin.send({
						version: 1,
						type: "alert",
						name: "qrGenerationFailed",
						sessionId: message.sessionId,
						colorId: message.colorId,
						occurredAt: message.occurredAt,
					});
				}
				return ack;
			}
			case "preloadReport": {
				if (meta.role !== "display") return this.errorMessage(message.requestId, "FORBIDDEN");
				this.updateDevice(meta, {
					preload: { succeeded: message.succeeded, failedPhotoIds: message.failedPhotoIds },
				});
				this.refreshAdmins(state);
				return ack;
			}
			case "clockSync": {
				if (meta.role === "admin") return this.errorMessage(message.requestId, "FORBIDDEN");
				this.updateDevice(meta, {
					clockSync: {
						minRoundTripTime: message.minRoundTripTime,
						offsetSpread: message.offsetSpread,
						degraded:
							message.minRoundTripTime > SYNC_MAX_MIN_RTT_MS || message.offsetSpread > SYNC_MAX_SPREAD_MS,
					},
				});
				this.refreshAdmins(state);
				return ack;
			}
		}
	}

	/** 認証セッションIDと `requestId` の組で応答を保存し、再送には保存済みの応答を返す（仕様書8.5節）。 */
	private withIdempotency(connection: Connection, requestId: string, handle: () => ServerMessage): void {
		const now = this.options.now();
		const key = `${PREFIX_IDEMPOTENCY}${connection.meta.authKey}:${requestId}`;
		const stored = this.options.store.get<IdempotencyRecord>(key);
		if (stored && now - stored.storedAt < IDEMPOTENCY_TTL_MS) {
			connection.send(stored.response);
			return;
		}
		let response: ServerMessage;
		try {
			response = handle();
		} catch (error) {
			// 状態を変更せず、管理画面に障害を表示する。再送で解決しうるため応答を保存しない（仕様書8.5節）。
			console.error("request failed", error instanceof Error ? error.name : "Error");
			this.lastInternalErrorAt = now;
			this.refreshAdmins();
			connection.send(this.errorMessage(requestId, "INTERNAL_ERROR"));
			return;
		}
		this.options.store.put(key, { storedAt: now, response } satisfies IdempotencyRecord);
		this.pruneIdempotency(now);
		connection.send(response);
	}

	/**
	 * 回答を含む応答の冪等性記録を消す。最終回答の受理、強制リセット、放置による初期化で回答を消去するとき、
	 * 冪等性記録に残った回答も同じ処理で消す（仕様書13章）。消した要求が再送されても
	 * `expectedRevision` が一致しないため、状態は変わらない。
	 */
	private purgeAnswerRecords(): void {
		for (const [key, record] of this.options.store.list<IdempotencyRecord>(PREFIX_IDEMPOTENCY)) {
			const state = "state" in record.response ? record.response.state : undefined;
			const answers = state && "answers" in state ? (state as ExhibitState).answers : {};
			if (Object.keys(answers).length > 0) this.options.store.delete(key);
		}
	}

	private pruneIdempotency(now: number): void {
		const records = this.options.store.list<IdempotencyRecord>(PREFIX_IDEMPOTENCY);
		const fresh: [string, IdempotencyRecord][] = [];
		for (const entry of records) {
			if (now - entry[1].storedAt >= IDEMPOTENCY_TTL_MS) this.options.store.delete(entry[0]);
			else fresh.push(entry);
		}
		if (fresh.length <= IDEMPOTENCY_MAX) return;
		fresh.sort((a, b) => a[1].storedAt - b[1].storedAt);
		for (const [key] of fresh.slice(0, fresh.length - IDEMPOTENCY_MAX)) this.options.store.delete(key);
	}

	handleClose(connection: Connection): void {
		const { meta } = connection;
		if (meta.helloAt !== null && meta.role !== "admin") this.touchDevice(meta, meta.lastReceivedAt);
		this.refreshAdmins();
	}

	private touchDevice(meta: ConnectionMeta, lastReceivedAt: number): void {
		if (meta.role === "admin" || (meta.role === "controller" && !meta.controlling)) return;
		this.updateDevice(meta, { lastReceivedAt });
	}

	private updateDevice(meta: ConnectionMeta, patch: Partial<DeviceRecord>): void {
		const key = PREFIX_DEVICE + deviceKey(meta.role, meta.screenId);
		const record = this.options.store.get<DeviceRecord>(key) ?? {
			lastReceivedAt: null,
			preload: null,
			clockSync: null,
		};
		this.options.store.put(key, { ...record, ...patch });
	}

	// ---- 結果同期の計測（仕様書8.7節） ----

	private openSyncReport(judging: ExhibitState, next: ExhibitState): void {
		const resultStartAt = judging.phaseEndsAt ?? next.phaseStartedAt;
		const live = this.liveConnections();
		const entries = this.registeredScreens().map((screenId) => {
			const connection = live.find(
				(candidate) =>
					candidate.meta.role === "display" &&
					candidate.meta.screenId === screenId &&
					candidate.meta.helloAt !== null,
			);
			let excludedReason: string | null = null;
			if (!connection || resultStartAt - connection.meta.lastReceivedAt >= STALE_AFTER_MS) {
				excludedReason = "開始時点で切断";
			} else if ((connection.meta.helloAt ?? 0) > resultStartAt) {
				excludedReason = "結果開始後に接続";
			}
			return { screenId, actualStartedAt: null as number | null, excludedReason };
		});
		const early = this.options.store.get<Record<string, number>>(KEY_SYNC_EARLY) ?? {};
		this.options.store.delete(KEY_SYNC_EARLY);
		for (const entry of entries) {
			if (entry.excludedReason === null && early[entry.screenId] !== undefined)
				entry.actualStartedAt = early[entry.screenId];
		}
		if (next.phase !== "result") return;
		this.options.store.put(
			KEY_SYNC,
			summarizeSync({
				sessionId: judging.sessionId as string,
				judgingStartedAt: judging.phaseStartedAt,
				resultStartAt,
				entries,
				syncSpread: null,
				startLatency: null,
			}),
		);
	}

	// ---- 期限 ----

	/** 期限の処理。alarmから呼ぶ。 */
	handleAlarm(): void {
		this.current();
		const now = this.options.now();
		for (const connection of this.liveConnections()) {
			const { meta } = connection;
			if (meta.helloAt === null && now - meta.connectedAt >= HELLO_TIMEOUT_MS) {
				connection.close(CLOSE_CODES.helloTimeout, "hello timeout");
			} else if (!this.resolveSession(meta.authKey)) {
				this.sendError(connection, null, "UNAUTHENTICATED");
				connection.close(CLOSE_CODES.sessionExpired, "session expired");
			} else if (now - meta.lastReceivedAt >= STALE_AFTER_MS) {
				connection.close(CLOSE_STALE, "no message for 15 seconds");
			}
		}
		this.refreshAdmins();
	}

	/** 次にalarmを実行する時刻。期限も接続もなければ `null`。 */
	nextWakeAt(): number | null {
		const candidates: number[] = [];
		const state = this.load();
		if (state.phaseEndsAt !== null) candidates.push(state.phaseEndsAt);
		for (const { meta } of this.liveConnections()) {
			candidates.push(
				meta.helloAt === null ? meta.connectedAt + HELLO_TIMEOUT_MS : meta.lastReceivedAt + STALE_AFTER_MS,
			);
			const session = this.options.store.get<AuthSession>(PREFIX_SESSION + meta.authKey);
			if (session) candidates.push(session.expiresAt);
		}
		return candidates.length > 0 ? Math.min(...candidates) : null;
	}

	// ---- 応答 ----

	private errorMessage(requestId: string | null, code: ErrorCode, state?: RoleState | null): ServerMessage {
		return {
			version: 1,
			type: "error",
			requestId,
			code,
			message: ERROR_MESSAGES[code],
			retryable: RETRYABLE[code],
			...(state ? { state } : {}),
		};
	}

	private sendError(connection: Connection, requestId: string | null, code: ErrorCode): void {
		connection.send(this.errorMessage(requestId, code));
	}
}

/** 計測対象の画面だけで同期差と開始遅延を求める。 */
export function summarizeSync(report: SyncReport): SyncReport {
	const times = report.entries
		.filter((entry) => entry.excludedReason === null && entry.actualStartedAt !== null)
		.map((entry) => entry.actualStartedAt as number);
	if (times.length === 0) return { ...report, syncSpread: null, startLatency: null };
	return {
		...report,
		syncSpread: Math.max(...times) - Math.min(...times),
		startLatency: Math.max(...times) - report.judgingStartedAt,
	};
}
