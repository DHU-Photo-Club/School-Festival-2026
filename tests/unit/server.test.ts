import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultPublisher } from "../../src/server/publisher.ts";
import type { SqliteStore } from "../../src/server/store.ts";
import { openStore } from "../../src/server/store.ts";
import type { PublicResult } from "../../src/shared/result.ts";

const result = (id: string): PublicResult => ({
	id,
	name: "朝の湖",
	nameReason: "理由",
	reading: "読み取り",
	relationship: "関係",
	colors: [
		{ id: "sky", reason: "空" },
		{ id: "jade", reason: "水" },
	],
	photoIds: [],
});

describe("SQLiteのストア", () => {
	it("JSONで保存し、前方一致でキーの順に読み、消せる", () => {
		const store = openStore(":memory:");
		store.put("outbox:b", { n: 2 });
		store.put("outbox:a", { n: 1 });
		store.put("outboy", { n: 3 });
		store.put("state", { phase: "idle", nested: [1, null] });
		expect(store.get("state")).toEqual({ phase: "idle", nested: [1, null] });
		expect(store.list("outbox:")).toEqual([{ n: 1 }, { n: 2 }]);
		store.put("outbox:a", { n: 10 });
		store.delete("outbox:b");
		expect(store.list("outbox:")).toEqual([{ n: 10 }]);
		expect(store.get("missing")).toBeUndefined();
		store.close();
	});
});

describe("結果ページへの送信", () => {
	let store: SqliteStore;
	afterEach(() => {
		vi.useRealTimers();
		store.close();
	});

	it("トークン付きで PUT し、送れたら送信待ちから消す", async () => {
		store = openStore(":memory:");
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		const publisher = new ResultPublisher({ store, origin: "https://x.example", token: "secret", fetch });
		publisher.enqueue(result("0123456789abcdef"));
		await publisher.flush();
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://x.example/api/results/0123456789abcdef");
		expect(init.method).toBe("PUT");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
		expect(JSON.parse(init.body as string)).toEqual(result("0123456789abcdef"));
		expect(publisher.backlog()).toBe(0);
		publisher.close();
	});

	it("送れなければ送信待ちに残し、間隔をあけて送り直す", async () => {
		vi.useFakeTimers();
		store = openStore(":memory:");
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(new Response(null, { status: 204 }));
		const log = vi.fn();
		const publisher = new ResultPublisher({
			store,
			origin: "https://x.example",
			token: "t",
			fetch,
			retryMs: 1000,
			log,
		});
		store.put("outbox:0123456789abcdef", result("0123456789abcdef"));
		await publisher.flush();
		expect(publisher.backlog()).toBe(1);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("offline"));
		await vi.advanceTimersByTimeAsync(1000);
		await publisher.flush();
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(publisher.backlog()).toBe(0);
		publisher.close();
	});

	it("再起動の前に送れなかった結果を flush で送る。公開期間の終了（410）は送り直さない", async () => {
		store = openStore(":memory:");
		store.put("outbox:0123456789abcdef", result("0123456789abcdef"));
		const fetch = vi.fn(async () => new Response("gone", { status: 410 }));
		const publisher = new ResultPublisher({ store, origin: "https://x.example", token: "t", fetch, log: () => {} });
		await publisher.flush();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(publisher.backlog()).toBe(0);
		publisher.close();
	});

	it("内容の不備（400）は送り直さず、トークンの不一致（401）は送信待ちに残す", async () => {
		store = openStore(":memory:");
		store.put("outbox:0000000000000001", result("0000000000000001"));
		store.put("outbox:0000000000000002", result("0000000000000002"));
		const fetch = vi.fn(async (url: string | URL | Request) =>
			String(url).endsWith("1") ? new Response("bad", { status: 400 }) : new Response("no", { status: 401 }),
		);
		const publisher = new ResultPublisher({ store, origin: "https://x.example", token: "t", fetch, log: () => {} });
		await publisher.flush();
		expect(store.list<PublicResult>("outbox:").map((item) => item.id)).toEqual(["0000000000000002"]);
		publisher.close();
	});

	it("SQLiteの読み書きに失敗しても、次の flush で送れる", async () => {
		store = openStore(":memory:");
		const list = store.list.bind(store);
		let broken = true;
		store.list = <T>(prefix: string): T[] => {
			if (broken) throw new Error("disk I/O error");
			return list<T>(prefix);
		};
		store.put("outbox:0123456789abcdef", result("0123456789abcdef"));
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		const log = vi.fn();
		const publisher = new ResultPublisher({ store, origin: "https://x.example", token: "t", fetch, log });
		await publisher.flush();
		expect(log).toHaveBeenCalledWith(expect.stringContaining("disk I/O error"));
		broken = false;
		await publisher.flush();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(publisher.backlog()).toBe(0);
		publisher.close();
	});
});
