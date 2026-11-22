import { DurableObject } from "cloudflare:workers";
import { AI_SETTINGS } from "../data/ai.ts";
import { PALETTE } from "../data/palette.ts";
import { PHOTOS } from "../data/photos.ts";
import { QUESTION_VERSION, QUESTIONS } from "../data/questions.ts";
import { SEQUENCES } from "../data/sequences.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import type { PublicResult } from "../shared/result.ts";
import { parseScreenNumber } from "../shared/screens.ts";
import type { Role } from "../shared/types.ts";
import type { Judge } from "./ai/judge.ts";
import { createJudge, createStubJudge } from "./ai/judge.ts";
import type { Connection, ConnectionMeta } from "./core.ts";
import { ExhibitCore } from "./core.ts";
import { DEFAULT_MISTRAL_MODEL, sendPrompt } from "./mistral.ts";

const ROLES: readonly Role[] = ["controller", "display", "photo", "admin"];

/** 推測されにくい結果ID（16桁の16進数）。 */
function newResultId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 結果を決める `Judge`（refs/handoff 実装仕様書2章）。`MISTRAL_API_KEY` があれば Mistral AI で選ぶ。
 * `AI_STUB=1` なら開発用の仮の結果を返す。どちらもなければ `undefined`（結果を決められない）。
 */
function judgeFor(env: Env): Judge | undefined {
	const common = {
		questionVersion: QUESTION_VERSION,
		palette: PALETTE,
		photos: PHOTOS,
		now: () => Date.now(),
		newResultId,
	};
	// E2Eテストは `.dev.vars` にAPIキーがあってもAIへ接続しないよう、仮の選定を優先する。本番では設定しない。
	if (env.AI_STUB === "1") return createStubJudge(common);
	const apiKey = env.MISTRAL_API_KEY?.trim();
	if (apiKey) {
		const config = {
			apiKey,
			model: env.MISTRAL_MODEL?.trim() || DEFAULT_MISTRAL_MODEL,
			baseUrl: env.MISTRAL_BASE_URL?.trim() || undefined,
		};
		return createJudge({
			...common,
			send: (request) => sendPrompt(config, request),
			model: config.model,
			questions: QUESTIONS,
		});
	}
	return undefined;
}

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
			sequences: SEQUENCES,
			photos: PHOTOS,
			judge: judgeFor(env),
			judgingMaxMs: AI_SETTINGS.judgingMaxMs,
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
		const pending = this.core.handleMessage(this.wrap(socket), message);
		await this.schedule();
		if (!pending) return;
		// AIの選定を待つ間も、他の端末のメッセージは処理される。
		// 選定で `judging` の終了時刻が変わったら、alarmを設定し直す。
		try {
			await pending;
		} catch (error) {
			console.error("AIの選定の反映に失敗しました", error);
		}
		await this.schedule();
	}

	async webSocketClose(): Promise<void> {
		this.core.handleClose();
	}

	async webSocketError(): Promise<void> {
		this.core.handleClose();
	}

	/** 結果ページへ公開する部分。Workerから RPC で呼ぶ。なければ `null`。 */
	publicResult(id: string): PublicResult | null {
		return this.core.publicResult(id);
	}

	async alarm(): Promise<void> {
		this.core.handleAlarm();
		await this.schedule();
	}
}
