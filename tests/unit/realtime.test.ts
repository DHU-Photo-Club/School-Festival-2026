import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionStatus } from "../../src/client/lib/realtime.ts";
import { RealtimeClient } from "../../src/client/lib/realtime.ts";
import { initialState } from "../../src/shared/machine.ts";
import type { ServerMessage } from "../../src/shared/protocol.ts";
import { ERROR_MESSAGES } from "../../src/shared/protocol.ts";

type Listener = (event: { code?: number; data?: unknown }) => void;

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

	close(code = 1000): void {
		if (this.readyState === FakeWebSocket.CLOSED) return;
		this.readyState = FakeWebSocket.CLOSED;
		queueMicrotask(() => this.emit("close", { code }));
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.emit("open", {});
	}

	receive(message: ServerMessage): void {
		this.emit("message", { data: JSON.stringify(message) });
	}

	private emit(type: string, event: { code?: number; data?: unknown }): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

const controllerInUse = {
	version: 1,
	type: "error",
	requestId: null,
	code: "CONTROLLER_IN_USE",
	message: ERROR_MESSAGES.CONTROLLER_IN_USE,
	retryable: false,
} satisfies ServerMessage;
const welcome = {
	version: 1,
	type: "welcome",
	serverTime: 0,
	state: initialState(0),
} satisfies ServerMessage;

/** 接続で最初に送った `hello` の `clientId`。 */
const helloClientId = (socket: FakeWebSocket) =>
	(JSON.parse(socket.sent[0]) as { type: string; clientId: string }).clientId;

function startClient(authValid: boolean | (() => Promise<boolean>)) {
	const statuses: ConnectionStatus[] = [];
	const checkAuth = vi.fn(typeof authValid === "function" ? authValid : async () => authValid);
	const client = new RealtimeClient({
		role: "controller",
		onState: () => {},
		onStatus: (status) => statuses.push(status),
		checkAuth,
	});
	client.start();
	return { client, statuses, checkAuth };
}

/** realtime.ts の時刻同期で1回に送る ping の数。 */
const SYNC_BURST_COUNT = 5;

const latestSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

describe("操作権限の再確認", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeWebSocket.instances = [];
		vi.stubGlobal("WebSocket", FakeWebSocket);
		vi.stubGlobal("location", { href: "http://localhost/", protocol: "http:" });
		const storage = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("hello が CONTROLLER_IN_USE で拒否されたら、3秒後に接続し直す", async () => {
		const { client, statuses } = startClient(true);
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(2_999);
		expect(FakeWebSocket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(statuses.at(-1)).toBe("controllerInUse");
		// 再確認でも同じ clientId を送る。別IDとして扱われると操作権限を奪ってしまう。
		latestSocket().open();
		expect(helloClientId(latestSocket())).toBe(helloClientId(FakeWebSocket.instances[0]));
		client.stop();
	});

	it("認証確認が失敗しても、3秒後に接続し直す", async () => {
		const { client, statuses } = startClient(() => Promise.reject(new TypeError("network")));
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(statuses.at(-1)).toBe("controllerInUse");
		client.stop();
	});

	it("認証確認の応答がなくても、5秒で打ち切ってすぐ接続し直す", async () => {
		const { client, statuses } = startClient(() => new Promise<boolean>(() => {}));
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(4_999);
		expect(FakeWebSocket.instances).toHaveLength(1);
		// 打ち切った時点で3秒を過ぎているため、待たずに接続し直す。
		await vi.advanceTimersByTimeAsync(2);
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(statuses.at(-1)).toBe("controllerInUse");
		client.stop();
	});

	it("初回接続で認証確認の応答がなくても、5秒で打ち切って再接続中として接続し直す", async () => {
		const { client, statuses } = startClient(() => new Promise<boolean>(() => {}));
		latestSocket().close(1006);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(statuses.at(-1)).toBe("reconnecting");
		await vi.advanceTimersByTimeAsync(500);
		expect(FakeWebSocket.instances).toHaveLength(2);
		client.stop();
	});

	it("操作中の接続が切れたら、認証確認をせず指数バックオフで接続し直す", async () => {
		const { client, statuses, checkAuth } = startClient(true);
		latestSocket().open();
		latestSocket().receive(welcome);
		latestSocket().close(1006);
		await vi.advanceTimersByTimeAsync(499);
		expect(FakeWebSocket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(checkAuth).not.toHaveBeenCalled();
		expect(statuses.at(-1)).toBe("reconnecting");
		client.stop();
	});

	it("初回接続が切れて端末セッションも失効していれば、ペアリングへ戻す", async () => {
		const { client, statuses } = startClient(false);
		latestSocket().close(1006);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(statuses.at(-1)).toBe("unauthenticated");
		client.stop();
	});

	it("認証確認を待つ間に再起動したら、古い確認の結果で接続を作らない", async () => {
		const { client } = startClient(() => new Promise<boolean>(() => {}));
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(1_000);
		client.stop();
		client.start();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(FakeWebSocket.instances).toHaveLength(2);
		client.stop();
	});

	it("再起動後の接続も認証確認中に切れたら、古い確認の結果で接続を作らない", async () => {
		const answers: Array<(valid: boolean) => void> = [];
		const { client } = startClient(() => new Promise<boolean>((resolve) => answers.push(resolve)));
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(1_000);
		client.stop();
		client.start();
		latestSocket().close(1006);
		await vi.advanceTimersByTimeAsync(0);
		expect(answers).toHaveLength(2);
		// 再起動前の確認が先に返っても、新しい接続を作るのは再起動後の切断の分だけ。
		answers[0](true);
		answers[1](true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(FakeWebSocket.instances).toHaveLength(3);
		client.stop();
	});

	it("再確認までの待ち時間は単調な時計で測り、壁時計の変更に影響されない", async () => {
		const answers: Array<(valid: boolean) => void> = [];
		const { client } = startClient(() => new Promise<boolean>((resolve) => answers.push(resolve)));
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(100);
		const realDateNow = Date.now;
		try {
			// 認証確認を待つ間に、端末の時計だけが1分進んだ場合。
			Date.now = () => realDateNow() + 60_000;
			answers[0](true);
			await vi.advanceTimersByTimeAsync(2_899);
			expect(FakeWebSocket.instances).toHaveLength(1);
		} finally {
			Date.now = realDateNow;
		}
		await vi.advanceTimersByTimeAsync(1);
		expect(FakeWebSocket.instances).toHaveLength(2);
		client.stop();
	});

	it("認証確認を待つ間に停止したら、接続し直さない", async () => {
		const { client } = startClient(() => new Promise<boolean>(() => {}));
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(1_000);
		client.stop();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it("再接続を予約した後に停止したら、接続し直さない", async () => {
		const { client } = startClient(true);
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(1_000);
		client.stop();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it("再接続を予約した後に start() し直したら、予約していた接続は作らない", async () => {
		const { client } = startClient(true);
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(1_000);
		client.start();
		expect(FakeWebSocket.instances).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(FakeWebSocket.instances).toHaveLength(2);
		client.stop();
	});

	it("接続中に start() し直したら、前の接続を閉じる", async () => {
		const { client } = startClient(true);
		latestSocket().open();
		latestSocket().receive(welcome);
		client.start();
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(FakeWebSocket.instances).toHaveLength(2);
		client.stop();
	});

	it("start() し直しても定期実行を重ねて登録せず、状態を接続中へ戻す", async () => {
		const { client, statuses } = startClient(true);
		latestSocket().open();
		latestSocket().receive(welcome);
		// welcome で始まった時刻同期の ping を送り切ってから数える。
		await vi.advanceTimersByTimeAsync(1_000);
		const timers = vi.getTimerCount();
		client.start();
		expect(vi.getTimerCount()).toBe(timers);
		expect(statuses).toEqual(["connecting", "open", "connecting"]);
		client.stop();
	});

	it("時刻同期の途中で start() し直したら、前の計測の ping を新しい接続へ送らない", async () => {
		const { client } = startClient(true);
		latestSocket().open();
		latestSocket().receive(welcome);
		client.start();
		latestSocket().open();
		latestSocket().receive(welcome);
		// 5秒間隔の ping が届かない範囲だけ進める。
		await vi.advanceTimersByTimeAsync(1_000);
		const pings = latestSocket().sent.filter((raw) => (JSON.parse(raw) as { type: string }).type === "ping");
		expect(pings).toHaveLength(SYNC_BURST_COUNT);
		client.stop();
	});

	it("時刻同期の途中で接続し直したら、前の計測の ping を新しい接続へ送らない", async () => {
		const { client } = startClient(true);
		latestSocket().open();
		latestSocket().receive(welcome);
		await vi.advanceTimersByTimeAsync(100);
		latestSocket().close(1006);
		await vi.advanceTimersByTimeAsync(500);
		expect(FakeWebSocket.instances).toHaveLength(2);
		latestSocket().open();
		latestSocket().receive(welcome);
		// 5秒間隔の ping が届かない範囲だけ進める。
		await vi.advanceTimersByTimeAsync(1_000);
		const pings = latestSocket().sent.filter((raw) => (JSON.parse(raw) as { type: string }).type === "ping");
		expect(pings).toHaveLength(SYNC_BURST_COUNT);
		client.stop();
	});

	it("認証確認が同期的に例外を投げても、3秒後に接続し直す", async () => {
		const { client } = startClient(() => {
			throw new Error("sync");
		});
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(FakeWebSocket.instances).toHaveLength(2);
		client.stop();
	});

	it("再確認中に端末セッションが失効していれば、接続し直さずペアリングへ戻す", async () => {
		const { client, statuses } = startClient(false);
		latestSocket().open();
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(statuses.at(-1)).toBe("unauthenticated");
		client.stop();
	});

	it("操作中に権限を移された接続も、端末セッションが失効していればペアリングへ戻す", async () => {
		const { client, statuses, checkAuth } = startClient(false);
		latestSocket().open();
		latestSocket().receive(welcome);
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(checkAuth).toHaveBeenCalledTimes(1);
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(statuses.at(-1)).toBe("unauthenticated");
		client.stop();
	});

	it("操作中に権限を移された接続は、端末セッションが有効なら3秒後に接続し直す", async () => {
		const { client, statuses } = startClient(true);
		latestSocket().open();
		latestSocket().receive(welcome);
		latestSocket().receive(controllerInUse);
		await vi.advanceTimersByTimeAsync(2_999);
		expect(FakeWebSocket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(statuses.at(-1)).toBe("controllerInUse");
		client.stop();
	});
});
