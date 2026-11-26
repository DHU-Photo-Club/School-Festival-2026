import type { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { parseScreenNumber } from "../shared/screens.ts";
import type { Role } from "../shared/types.ts";
import type { Exhibit } from "./exhibit.ts";

const ROLES: readonly Role[] = ["controller", "display", "photo", "light", "admin"];
/** 一件のメッセージの上限。端末が送るのは操作と `ping` だけで、これより十分小さい。 */
const MAX_PAYLOAD = 64 * 1024;
/**
 * WebSocketのping（プロトコルの制御フレーム）を送る間隔。次の送信までにpongが届かない接続は切る。
 * 電源断などで切断が届かない端末へ、状態を送り続けないようにする。
 */
const HEARTBEAT_MS = 30_000;

function reject(socket: Duplex, status: number, text: string): void {
	socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * `/api/realtime?role=display&screen=2` のWebSocket接続を `server`（Node.jsのHTTPサーバー）で受け入れる。
 * それ以外のパスのアップグレード（Viteの開発サーバーのHMRなど）には触れない。
 */
export function attachRealtime(server: EventEmitter, exhibit: Exhibit): () => void {
	const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

	const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
		let url: URL;
		try {
			url = new URL(request.url ?? "/", "http://localhost");
		} catch {
			return reject(socket, 400, "Bad Request");
		}
		if (url.pathname !== "/api/realtime") return;
		const role = url.searchParams.get("role") as Role;
		if (!ROLES.includes(role)) return reject(socket, 400, "Unknown role");
		const screen =
			role === "display" || role === "photo" ? parseScreenNumber(url.searchParams.get("screen")) : null;
		if ((role === "display" || role === "photo") && screen === null) return reject(socket, 400, "Invalid screen");

		wss.handleUpgrade(request, socket, head, (ws) => {
			alive.add(ws);
			ws.on("pong", () => alive.add(ws));
			ws.on("message", (data, isBinary) => {
				const message = isBinary ? new ArrayBuffer(0) : data.toString();
				exhibit
					.message(ws, message)
					.catch((error: unknown) => console.error("メッセージの処理に失敗しました", error));
			});
			ws.on("close", () => exhibit.close(ws));
			ws.on("error", () => exhibit.close(ws));
			try {
				exhibit.open(ws, { role, screen });
			} catch (error) {
				console.error("接続の受け入れに失敗しました", error);
				ws.terminate();
			}
		});
	};

	const alive = new WeakSet<WebSocket>();
	const heartbeat = setInterval(() => {
		for (const client of wss.clients) {
			if (!alive.has(client)) {
				client.terminate();
				continue;
			}
			alive.delete(client);
			client.ping();
		}
	}, HEARTBEAT_MS);

	server.on("upgrade", onUpgrade);
	return () => {
		clearInterval(heartbeat);
		server.off("upgrade", onUpgrade);
		for (const client of wss.clients) client.terminate();
		wss.close();
	};
}
