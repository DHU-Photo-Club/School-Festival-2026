import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionStatus } from "../../src/client/lib/realtime.ts";
import { RealtimeClient } from "../../src/client/lib/realtime.ts";
import { initialState } from "../../src/shared/machine.ts";
import type { RoleState, ServerMessage } from "../../src/shared/protocol.ts";

type Listener = (event: { data?: unknown }) => void;

/** ブラウザの WebSocket を模したテスト用の接続。イベントはテストから発生させる。 */
class FakeWebSocket {
	static readonly OPEN = 1;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];
	readyState = 0;
	readonly sent: string[] = [];
	private readonly listeners = new Map<string, Listener[]>();

	constructor(readonly url: URL) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: Listener): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		if (this.readyState === FakeWebSocket.CLOSED) return;
		this.readyState = FakeWebSocket.CLOSED;
		queueMicrotask(() => this.emit("close", {}));
	}

	/** 接続が開き、サーバーが最初の `state` を送ったところまで進める。 */
	open(serverTime = 0): void {
		this.readyState = FakeWebSocket.OPEN;
		this.receive({ type: "state", serverTime, state: initialState(0) });
	}

	receive(message: ServerMessage): void {
		this.emit("message", { data: JSON.stringify(message) });
	}

	private emit(type: string, event: { data?: unknown }): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

const latestSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
const sentTypes = (socket: FakeWebSocket) => socket.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);

function startClient(options: { role?: "controller" | "display"; screen?: number } = {}) {
	const statuses: ConnectionStatus[] = [];
	const states: RoleState[] = [];
	const client = new RealtimeClient({
		role: options.role ?? "controller",
		screen: options.screen,
		onState: (state) => states.push(state),
		onStatus: (status) => statuses.push(status),
	});
	client.start();
	return { client, statuses, states };
}

describe("RealtimeClient", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeWebSocket.instances = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
		vi.stubGlobal("location", { href: "http://localhost/", protocol: "http:" });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("役割と画面番号をURLで伝え、最初の state で接続中になる", () => {
		const { statuses, states } = startClient({ role: "display", screen: 2 });
		const socket = latestSocket();
		expect(socket.url.searchParams.get("role")).toBe("display");
		expect(socket.url.searchParams.get("screen")).toBe("2");
		expect(statuses).toEqual(["connecting"]);
		socket.open();
		expect(statuses).toEqual(["connecting", "open"]);
		expect(states).toHaveLength(1);
	});

	it("接続中だけコマンドを送れる", () => {
		const { client } = startClient();
		expect(client.send({ name: "start" })).toBe(false);
		latestSocket().open();
		expect(client.send({ name: "start" })).toBe(true);
		expect(JSON.parse(latestSocket().sent.at(-1) as string)).toEqual({
			type: "command",
			command: { name: "start" },
		});
	});

	it("切断したら待ち時間を倍にしながら接続し直し、接続できたら待ち時間を戻す", async () => {
		const { statuses } = startClient();
		latestSocket().open();
		latestSocket().close();
		await vi.advanceTimersByTimeAsync(0);
		expect(statuses.at(-1)).toBe("reconnecting");
		await vi.advanceTimersByTimeAsync(500);
		expect(FakeWebSocket.instances).toHaveLength(2);
		latestSocket().close();
		await vi.advanceTimersByTimeAsync(999);
		expect(FakeWebSocket.instances).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(FakeWebSocket.instances).toHaveLength(3);
		latestSocket().open();
		latestSocket().close();
		await vi.advanceTimersByTimeAsync(500);
		expect(FakeWebSocket.instances).toHaveLength(4);
	});

	it("15秒 pong が届かなければ接続し直す", async () => {
		const { statuses } = startClient();
		const first = latestSocket();
		first.open();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(sentTypes(first)).toContain("ping");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(first.readyState).toBe(FakeWebSocket.CLOSED);
		expect(statuses.at(-1)).toBe("reconnecting");
		await vi.advanceTimersByTimeAsync(500);
		expect(FakeWebSocket.instances).toHaveLength(2);
	});

	it("往復時間が最も短い pong でサーバー時刻を補正する", () => {
		vi.setSystemTime(0);
		const { client } = startClient();
		const socket = latestSocket();
		socket.open(0);
		const sentAt = performance.timeOrigin + performance.now();
		vi.advanceTimersByTime(100);
		socket.receive({ type: "pong", clientSentAt: sentAt, serverTime: sentAt + 50 + 1_000 });
		expect(client.serverNow() - (performance.timeOrigin + performance.now())).toBeCloseTo(1_000, 0);
		const slowSentAt = performance.timeOrigin + performance.now();
		vi.advanceTimersByTime(400);
		socket.receive({ type: "pong", clientSentAt: slowSentAt, serverTime: slowSentAt + 200 + 5_000 });
		expect(client.serverNow() - (performance.timeOrigin + performance.now())).toBeCloseTo(1_000, 0);
	});

	it("停止したら接続し直さない", async () => {
		const { client } = startClient();
		latestSocket().open();
		client.stop();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(FakeWebSocket.instances).toHaveLength(1);
	});
});
