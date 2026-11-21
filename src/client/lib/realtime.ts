import type { ClockSample } from "../../shared/clock.ts";
import { bestOffset } from "../../shared/clock.ts";
import type { Command } from "../../shared/machine.ts";
import type { ClientMessage, RoleState, ServerMessage } from "../../shared/protocol.ts";
import type { Role } from "../../shared/types.ts";

/** 生存確認と時刻補正の `ping` の間隔。 */
const PING_INTERVAL_MS = 5_000;
/** この時間 `pong` が届かなければ通信断として接続し直す。 */
const PONG_TIMEOUT_MS = 15_000;
/** 時刻補正に使う直近の計測の件数（30秒分）。 */
const CLOCK_SAMPLES = 6;
/** 再接続の待ち時間。失敗するたびに倍にし、上限で止める。 */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

export interface RealtimeOptions {
	role: Role;
	/** 展示ディスプレイと写真用の画面番号。 */
	screen?: number;
	onState: (state: RoleState) => void;
	onStatus: (status: ConnectionStatus) => void;
}

const clientNow = () => performance.timeOrigin + performance.now();

/**
 * 同一オリジンのWebSocketで展示状態を受信し、コマンドを送る。
 * サーバーはコマンドを受理しても拒否しても、送信元へ `state` を送る。
 */
export class RealtimeClient {
	/** サーバー時刻 - クライアント時刻。 */
	private offset = 0;
	private socket: WebSocket | null = null;
	private stopped = true;
	private attempt = 0;
	private lastPongAt = 0;
	private samples: ClockSample[] = [];
	private timers: ReturnType<typeof setInterval>[] = [];
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly options: RealtimeOptions) {}

	/** 補正済みサーバー時刻。 */
	serverNow(): number {
		return clientNow() + this.offset;
	}

	/** `performance.now()` や `requestAnimationFrame` の時刻をサーバー時刻へ直す。 */
	toServerTime(performanceTime: number): number {
		return performance.timeOrigin + performanceTime + this.offset;
	}

	start(): void {
		if (!this.stopped) return;
		this.stopped = false;
		this.attempt = 0;
		this.timers.push(
			setInterval(() => this.ping(), PING_INTERVAL_MS),
			setInterval(() => this.checkLiveness(), 1_000),
		);
		this.options.onStatus("connecting");
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		for (const timer of this.timers) clearInterval(timer);
		this.timers = [];
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		const socket = this.socket;
		this.socket = null;
		socket?.close(1000, "stopped");
	}

	/** コマンドを送る。未接続なら送らずに `false` を返す。 */
	send(command: Command): boolean {
		return this.sendRaw({ type: "command", command });
	}

	private sendRaw(message: ClientMessage): boolean {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
		this.socket.send(JSON.stringify(message));
		return true;
	}

	private connect(): void {
		if (this.stopped) return;
		const url = new URL("/api/realtime", location.href);
		url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
		url.searchParams.set("role", this.options.role);
		if (this.options.screen !== undefined) url.searchParams.set("screen", String(this.options.screen));
		const socket = new WebSocket(url);
		this.socket = socket;
		this.lastPongAt = clientNow();
		let opened = false;
		socket.addEventListener("message", (event) => {
			if (socket !== this.socket || typeof event.data !== "string") return;
			let message: ServerMessage;
			try {
				message = JSON.parse(event.data) as ServerMessage;
			} catch {
				return;
			}
			if (!opened) {
				opened = true;
				this.attempt = 0;
				// 計測が届くまでは、片道の遅延を含む値で補正しておく。
				if (this.samples.length === 0) this.offset = message.serverTime - clientNow();
				this.options.onStatus("open");
				this.ping();
			}
			this.handle(message);
		});
		socket.addEventListener("close", () => {
			if (socket === this.socket) this.reconnect();
		});
	}

	private handle(message: ServerMessage): void {
		if (message.type === "state") {
			this.options.onState(message.state);
			return;
		}
		this.lastPongAt = clientNow();
		this.samples = [
			...this.samples,
			{ clientSentAt: message.clientSentAt, clientReceivedAt: clientNow(), serverTime: message.serverTime },
		].slice(-CLOCK_SAMPLES);
		this.offset = bestOffset(this.samples) ?? this.offset;
	}

	private ping(): void {
		this.sendRaw({ type: "ping", clientSentAt: clientNow() });
	}

	/** `pong` が途絶えたら、切断を待たずに接続し直す。 */
	private checkLiveness(): void {
		if (this.socket?.readyState !== WebSocket.OPEN) return;
		if (clientNow() - this.lastPongAt > PONG_TIMEOUT_MS) this.reconnect();
	}

	private reconnect(): void {
		const socket = this.socket;
		this.socket = null;
		socket?.close(1000, "reconnecting");
		if (this.stopped) return;
		this.options.onStatus("reconnecting");
		const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempt);
		this.attempt += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}
}
