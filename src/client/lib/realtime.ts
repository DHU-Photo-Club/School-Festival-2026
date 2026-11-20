import type { ClockSample } from "../../shared/clock.ts";
import { estimateClock } from "../../shared/clock.ts";
import type { Command } from "../../shared/machine.ts";
import type { ClientMessage, Diagnostic, RoleState, ServerMessage } from "../../shared/protocol.ts";
import { CLOSE_CODES } from "../../shared/protocol.ts";
import type { Role } from "../../shared/types.ts";

/** 応答待ちの再送タイマー（仕様書8.5節）。 */
const RESEND_AFTER_MS = 3_000;
const MAX_RESENDS = 2;
/** 生存確認と時刻補正（仕様書8.6節）。 */
const PING_INTERVAL_MS = 5_000;
const PONG_TIMEOUT_MS = 15_000;
const SYNC_BURST_COUNT = 5;
const SYNC_BURST_GAP_MS = 200;
const SYNC_INTERVAL_MS = 30_000;
/** 再接続の指数バックオフ。 */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** 別のiPadが操作中のときに再確認する間隔。 */
const CONTROLLER_RETRY_MS = 3_000;
/** 認証確認を待つ上限。超えた場合は認証が有効とみなして再接続を続ける。 */
const AUTH_CHECK_TIMEOUT_MS = 5_000;

export type ConnectionStatus =
	| "connecting"
	| "open"
	| "reconnecting"
	| "unauthenticated"
	| "controllerInUse"
	| "closed";

export type Reply = Extract<ServerMessage, { type: "ack" | "error" }>;
export type AlertMessage = Extract<ServerMessage, { type: "alert" }>;

type RequestBody =
	| { type: "command"; expectedRevision?: number; command: Command }
	| { type: "resultStarted"; sessionId: string; screenId: string; actualStartedAt: number }
	| ({ type: "diagnostic" } & Diagnostic);

interface PendingRequest {
	requestId: string;
	payload: string;
	resolve: (reply: Reply) => void;
	resends: number;
	resentAfterReconnect: boolean;
	sent: boolean;
	stalled: boolean;
	timer: ReturnType<typeof setTimeout> | null;
}

export interface RealtimeOptions {
	role: Role;
	screenId?: string;
	onState: (state: RoleState, revision: number) => void;
	onStatus: (status: ConnectionStatus) => void;
	/** 再送しても応答がない要求があるとき `true`（仕様書8.5節）。 */
	onStalled?: (stalled: boolean) => void;
	onAlert?: (alert: AlertMessage) => void;
	/**
	 * 端末セッションが有効かを確かめる。welcome 前に接続が閉じたとき（セッション失効・プロトコル不一致・
	 * 操作権限の移動を通知するclose codeを除く）と、`CONTROLLER_IN_USE` を受けて接続が閉じたときに呼ぶ。
	 * 停止済みの場合は呼ばない。
	 */
	checkAuth: () => Promise<boolean>;
}

const clientNow = () => performance.timeOrigin + performance.now();

/**
 * v4 UUIDを返す。`crypto.randomUUID` は安全なコンテキスト（HTTPSまたは `localhost` など）でのみ定義され、
 * LAN内のHTTP開発サーバーでは使えないため、開発時は `crypto.getRandomValues` から組み立てる。
 * 本番はHTTPSで配信するため、常に `crypto.randomUUID` を使う。
 */
export const randomId: () => string = import.meta.env.DEV
	? () => {
			const bytes = crypto.getRandomValues(new Uint8Array(16));
			bytes[6] = (bytes[6] & 0x0f) | 0x40;
			bytes[8] = (bytes[8] & 0x3f) | 0x80;
			const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
	: () => crypto.randomUUID();

function storedClientId(role: Role): string {
	const key = `dpc-client-id:${role}`;
	try {
		const existing = localStorage.getItem(key);
		if (existing) return existing;
		const created = randomId();
		localStorage.setItem(key, created);
		return created;
	} catch {
		return randomId();
	}
}

/** 同一オリジンのWSSで展示状態を受信し、要求を送る。 */
export class RealtimeClient {
	/** サーバー時刻 - クライアント時刻。 */
	offset = 0;
	status: ConnectionStatus = "connecting";
	private socket: WebSocket | null = null;
	private welcomed = false;
	private stopped = false;
	private attempt = 0;
	private revision = -1;
	private lastPongAt = 0;
	private readonly clientId: string;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly burst = new Map<string, number>();
	private samples: ClockSample[] = [];
	private timers: ReturnType<typeof setInterval>[] = [];
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private stalled = false;
	private measured = false;
	/**
	 * stop() のたびに進める番号。start() は先に stop() を呼ぶため、再起動でも進む。
	 * 認証確認や再接続を待つ間に停止または再起動されたかの判定に使う。
	 */
	private generation = 0;
	/** 時刻同期の計測ごと、および stop() のたびに進める番号。前の計測の ping を送らないために使う。 */
	private syncRound = 0;

	constructor(private readonly options: RealtimeOptions) {
		this.clientId = storedClientId(options.role);
	}

	/** 補正済みサーバー時刻。 */
	serverNow(): number {
		return clientNow() + this.offset;
	}

	/** `performance.now()` の値をサーバー時刻へ直す。 */
	toServerTime(performanceTime: number): number {
		return performance.timeOrigin + performanceTime + this.offset;
	}

	get online(): boolean {
		return this.status === "open";
	}

	start(): void {
		// 続けて呼ばれても、前回の定期実行・再接続の予約・接続を残さない。
		this.stop();
		this.stopped = false;
		this.attempt = 0;
		this.setStatus("connecting");
		this.timers.push(
			setInterval(() => this.ping(), PING_INTERVAL_MS),
			setInterval(() => this.checkLiveness(), 1_000),
			setInterval(() => this.syncClock(), SYNC_INTERVAL_MS),
		);
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		this.generation += 1;
		this.syncRound += 1;
		for (const timer of this.timers) clearInterval(timer);
		this.timers = [];
		this.clearReconnect();
		this.socket?.close(1000, "stopped");
		this.socket = null;
	}

	private setStatus(status: ConnectionStatus): void {
		this.status = status;
		this.options.onStatus(status);
	}

	private setStalled(stalled: boolean): void {
		if (this.stalled === stalled) return;
		this.stalled = stalled;
		this.options.onStalled?.(stalled);
	}

	private connect(): void {
		if (this.stopped) return;
		const url = new URL("/api/realtime", location.href);
		url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
		url.searchParams.set("role", this.options.role);
		if (this.options.screenId) url.searchParams.set("screenId", this.options.screenId);
		const socket = new WebSocket(url);
		this.socket = socket;
		this.welcomed = false;
		socket.addEventListener("open", () => {
			if (socket !== this.socket) return;
			this.lastPongAt = clientNow();
			this.sendRaw({ version: 1, type: "hello", clientId: this.clientId });
		});
		socket.addEventListener("message", (event) => {
			if (socket !== this.socket || typeof event.data !== "string") return;
			let message: ServerMessage;
			try {
				message = JSON.parse(event.data) as ServerMessage;
			} catch {
				// 破損したフレームは破棄する。pong の途絶は生存確認が検出し、再接続する。
				return;
			}
			this.handle(message);
		});
		socket.addEventListener("close", (event) => {
			if (socket !== this.socket) return;
			void this.handleClose(event.code);
		});
	}

	private async handleClose(code: number): Promise<void> {
		const wasWelcomed = this.welcomed;
		this.socket = null;
		this.welcomed = false;
		if (this.stopped) return;
		if (code === CLOSE_CODES.sessionExpired) return this.setStatus("unauthenticated");
		if (code === CLOSE_CODES.protocolMismatch || code === CLOSE_CODES.controllerMoved) {
			this.stopped = true;
			return this.setStatus("closed");
		}
		const closedAt = clientNow();
		const generation = this.generation;
		const verify = !wasWelcomed || this.status === "controllerInUse";
		const authValid = !verify || (await this.checkAuthWithin(AUTH_CHECK_TIMEOUT_MS));
		// 認証確認を待つ間に stop() または start() が呼ばれた場合は、古い切断の結果で再接続しない。
		if (this.stopped || generation !== this.generation) return;
		if (!authValid) {
			this.stopped = true;
			return this.setStatus("unauthenticated");
		}
		if (this.status === "controllerInUse") {
			// 切断から3秒後に再確認する。認証確認に3秒以上かかった場合は待たずに再接続するため、
			// 切断から次の接続までの時間は、最長で認証確認の打ち切り（5秒）になる。
			return this.scheduleReconnect(Math.max(0, CONTROLLER_RETRY_MS - (clientNow() - closedAt)));
		}
		this.setStatus("reconnecting");
		const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempt);
		this.attempt += 1;
		this.scheduleReconnect(delay);
	}

	/** `delayMs` 後に接続し直す。予約した後に stop() または start() が呼ばれた場合は接続しない。 */
	private scheduleReconnect(delayMs: number): void {
		this.clearReconnect();
		const generation = this.generation;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (generation === this.generation) this.connect();
		}, delayMs);
	}

	private clearReconnect(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}

	/**
	 * 認証が有効かを確かめる。失敗した場合と `timeoutMs` 以内に応答がない場合は `true` を返し、
	 * 再接続を止めない。失効している場合はサーバーが接続を拒否するため、再接続のたびに確認を繰り返す。
	 */
	private checkAuthWithin(timeoutMs: number): Promise<boolean> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => resolve(true), timeoutMs);
			// checkAuth が同期的に例外を投げた場合も、確認できなかったものとして有効とみなす。
			Promise.resolve()
				.then(() => this.options.checkAuth())
				.then(
					(valid) => {
						clearTimeout(timer);
						resolve(valid);
					},
					() => {
						clearTimeout(timer);
						resolve(true);
					},
				);
		});
	}

	private handle(message: ServerMessage): void {
		switch (message.type) {
			case "welcome":
				this.welcomed = true;
				this.attempt = 0;
				this.lastPongAt = clientNow();
				// 計測済みの補正値があれば、片道の遅延を含む welcome の値で上書きしない。
				if (!this.measured) this.offset = message.serverTime - clientNow();
				this.revision = -1;
				this.applyState(message.state, message.state.revision);
				this.setStatus("open");
				this.syncClock();
				this.resendAfterReconnect();
				return;
			case "state":
				this.applyState(message.state, message.revision);
				return;
			case "ack":
			case "error":
				if (message.state) this.applyState(message.state, message.state.revision);
				if (message.type === "error" && message.requestId === null) {
					if (message.code === "CONTROLLER_IN_USE") {
						this.setStatus("controllerInUse");
						this.socket?.close(1000, "controller in use");
					} else if (message.code === "UNAUTHENTICATED") {
						this.stopped = true;
						this.setStatus("unauthenticated");
					}
					return;
				}
				if (message.requestId) this.settle(message.requestId, message);
				return;
			case "pong":
				this.lastPongAt = clientNow();
				if (this.burst.has(message.pingId)) {
					this.burst.delete(message.pingId);
					this.samples.push({
						clientSentAt: message.clientSentAt,
						clientReceivedAt: clientNow(),
						serverTime: message.serverTime,
					});
					if (this.samples.length === SYNC_BURST_COUNT) this.finishSync();
				}
				return;
			case "alert":
				this.options.onAlert?.(message);
				return;
		}
	}

	private applyState(state: RoleState, revision: number): void {
		if (revision < this.revision) return;
		this.revision = revision;
		this.options.onState(state, revision);
	}

	private sendRaw(message: ClientMessage): boolean {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
		this.socket.send(JSON.stringify(message));
		return true;
	}

	// ---- 生存確認と時刻補正（仕様書8.6節） ----

	private ping(id = randomId()): void {
		if (!this.welcomed) return;
		this.sendRaw({ version: 1, type: "ping", pingId: id, clientSentAt: clientNow() });
	}

	private checkLiveness(): void {
		if (!this.socket || !this.welcomed) return;
		if (clientNow() - this.lastPongAt > PONG_TIMEOUT_MS) {
			// 15秒間 pong がなければ通信断として扱い、接続し直す（仕様書8.8節）。
			const socket = this.socket;
			this.socket = null;
			socket.close(1000, "pong timeout");
			void this.handleClose(1006);
		}
	}

	private syncClock(): void {
		if (!this.welcomed) return;
		this.samples = [];
		this.burst.clear();
		// 新しい計測を始めた場合、または stop() が呼ばれた場合は、前の計測の残りの ping を送らない。
		this.syncRound += 1;
		const round = this.syncRound;
		for (let i = 0; i < SYNC_BURST_COUNT; i += 1) {
			setTimeout(() => {
				if (round !== this.syncRound) return;
				const id = randomId();
				this.burst.set(id, i);
				this.ping(id);
			}, i * SYNC_BURST_GAP_MS);
		}
	}

	private finishSync(): void {
		const estimate = estimateClock(this.samples);
		if (!estimate) return;
		this.offset = estimate.offset;
		this.measured = true;
		if (this.options.role !== "admin") {
			void this.request({
				type: "diagnostic",
				name: "clockSync",
				minRoundTripTime: estimate.minRoundTripTime,
				offsetSpread: estimate.offsetSpread,
			});
		}
	}

	// ---- 要求と再送（仕様書8.5節） ----

	/** 要求を送り、同じ `requestId` の `ack` または `error` を待つ。未接続なら接続後に送る。 */
	request(body: RequestBody): Promise<Reply> {
		const requestId = randomId();
		const payload = JSON.stringify({ version: 1, requestId, ...body });
		return new Promise((resolve) => {
			const entry: PendingRequest = {
				requestId,
				payload,
				resolve,
				resends: 0,
				resentAfterReconnect: false,
				sent: false,
				stalled: false,
				timer: null,
			};
			this.pending.set(requestId, entry);
			if (this.welcomed) this.transmit(entry);
		});
	}

	private transmit(entry: PendingRequest): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
		this.socket.send(entry.payload);
		entry.sent = true;
		if (entry.timer) clearTimeout(entry.timer);
		entry.timer = setTimeout(() => this.onTimeout(entry), RESEND_AFTER_MS);
	}

	private onTimeout(entry: PendingRequest): void {
		entry.timer = null;
		if (!this.pending.has(entry.requestId)) return;
		if (!this.welcomed) return;
		if (!entry.resentAfterReconnect && entry.resends < MAX_RESENDS) {
			entry.resends += 1;
			this.transmit(entry);
			return;
		}
		entry.stalled = true;
		this.setStalled(true);
	}

	private resendAfterReconnect(): void {
		for (const entry of this.pending.values()) {
			if (!entry.sent) {
				this.transmit(entry);
			} else if (!entry.resentAfterReconnect) {
				entry.resentAfterReconnect = true;
				this.transmit(entry);
			}
		}
	}

	private settle(requestId: string, reply: Reply): void {
		const entry = this.pending.get(requestId);
		if (!entry) return;
		if (entry.timer) clearTimeout(entry.timer);
		this.pending.delete(requestId);
		if (![...this.pending.values()].some((other) => other.stalled)) this.setStalled(false);
		entry.resolve(reply);
	}
}
