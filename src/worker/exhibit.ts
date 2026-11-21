import { DurableObject } from "cloudflare:workers";
import { RESULT_COLORS } from "../data/colors.ts";
import { QUESTIONS } from "../data/questions.ts";
import { SEQUENCES } from "../data/sequences.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { parseScreenNumber } from "../shared/screens.ts";
import type { Role } from "../shared/types.ts";
import type { Connection, ConnectionMeta } from "./core.ts";
import { ExhibitCore } from "./core.ts";

const ROLES: readonly Role[] = ["controller", "display", "photo", "admin"];

/** 展示全体で一つのDurable Object。展示状態を保存し、接続した全端末へ配信する。 */
export class Exhibit extends DurableObject<Env> {
	private readonly core: ExhibitCore;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.core = new ExhibitCore({
			store: {
				get: <T>(key: string) => ctx.storage.kv.get<T>(key),
				put: (key, value) => ctx.storage.kv.put(key, value),
			},
			now: () => Date.now(),
			randomId: () => crypto.randomUUID(),
			connections: () =>
				ctx
					.getWebSockets()
					.filter((socket) => socket.readyState === WebSocket.OPEN)
					.map((socket) => this.wrap(socket)),
			questions: QUESTIONS,
			colors: RESULT_COLORS,
			sequences: SEQUENCES,
		});
	}

	private wrap(socket: WebSocket): Connection {
		return {
			get meta() {
				return socket.deserializeAttachment() as ConnectionMeta;
			},
			setMeta: (meta) => socket.serializeAttachment(meta),
			send: (message: ServerMessage) => {
				try {
					socket.send(JSON.stringify(message));
				} catch {
					// 切断済みの接続への送信失敗は無視する。
				}
			},
		};
	}

	private async schedule(): Promise<void> {
		const wakeAt = this.core.nextWakeAt();
		if (wakeAt === null) await this.ctx.storage.deleteAlarm();
		else await this.ctx.storage.setAlarm(Math.max(wakeAt, Date.now() + 10));
	}

	/** `/api/realtime?role=display&screen=2` のWebSocket接続を受け入れる。 */
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
		const url = new URL(request.url);
		const role = url.searchParams.get("role") as Role;
		if (!ROLES.includes(role)) return new Response("Unknown role", { status: 400 });
		const screen =
			role === "display" || role === "photo" ? parseScreenNumber(url.searchParams.get("screen")) : null;
		if ((role === "display" || role === "photo") && screen === null) {
			return new Response("Invalid screen", { status: 400 });
		}

		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ role, screen, lastReceivedAt: Date.now() } satisfies ConnectionMeta);
		this.core.open(this.wrap(server));
		await this.schedule();
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		this.core.handleMessage(this.wrap(socket), message);
		await this.schedule();
	}

	async webSocketClose(): Promise<void> {
		this.core.handleClose();
	}

	async webSocketError(): Promise<void> {
		this.core.handleClose();
	}

	async alarm(): Promise<void> {
		this.core.handleAlarm();
		await this.schedule();
	}
}
