import { describe, expect, it } from "vitest";
import { PHOTOS } from "../../src/data/photos.ts";
import type { ResultsEnv } from "../../src/results/handler.ts";
import { handleRequest, parsePublicResult } from "../../src/results/handler.ts";

const ID = "0123456789abcdef";
const shared = PHOTOS.find((photo) => photo.shareAllowed);
const unshared = PHOTOS.find((photo) => !photo.shareAllowed);

const body = (overrides: Record<string, unknown> = {}) => ({
	id: ID,
	name: "朝の湖",
	nameReason: "理由",
	reading: "読み取り",
	relationship: "関係",
	colors: [
		{ id: "sky", reason: "空" },
		{ id: "jade", reason: "水" },
	],
	photoIds: [shared?.id, unshared?.id].filter(Boolean),
	...overrides,
});

/** KVと静的ファイルを模した環境。 */
function fakeEnv(publishedUntil = "2999-01-01T00:00:00Z") {
	const kv = new Map<string, { value: string; options: unknown }>();
	const env: ResultsEnv = {
		RESULTS_UPLOAD_TOKEN: "secret",
		RESULTS_PUBLISHED_UNTIL: publishedUntil,
		RESULTS: {
			put: async (key, value, options) => void kv.set(key, { value, options }),
			get: async (key: string) => kv.get(key)?.value ?? null,
		},
		ASSETS: {
			fetch: async (request: Request) => new Response(`asset ${new URL(request.url).pathname}`),
		},
	};
	return { env, kv };
}

const call = (request: Request, env: ResultsEnv) => handleRequest(request, env);
const put = (token: string, data: unknown, id = ID) =>
	new Request(`https://w.example/api/results/${id}`, {
		method: "PUT",
		headers: { Authorization: `Bearer ${token}` },
		body: JSON.stringify(data),
	});

describe("結果ページのWorker", () => {
	it("配布を許可していない写真と余分な項目を捨てる", () => {
		const parsed = parsePublicResult(body({ answers: { q1: 1 } }), ID);
		expect(parsed?.photoIds).toEqual([shared?.id]);
		expect(parsed).not.toHaveProperty("answers");
		expect(parsePublicResult(body({ id: "ffffffffffffffff" }), ID)).toBeNull();
		expect(
			parsePublicResult(
				body({
					colors: [
						{ id: "black", reason: "x" },
						{ id: "sky", reason: "y" },
					],
				}),
				ID,
			),
		).toBeNull();
		expect(parsePublicResult(body({ name: "" }), ID)).toBeNull();
		expect(
			parsePublicResult(
				body({
					colors: [
						{ id: "sky", reason: "x" },
						{ id: "sky", reason: "y" },
					],
				}),
				ID,
			),
		).toBeNull();
	});

	it("トークンが合えば保存し、結果ページとデータを no-store で返す", async () => {
		const { env, kv } = fakeEnv();
		expect((await call(put("wrong", body()), env)).status).toBe(401);
		expect((await call(put("secret", body()), env)).status).toBe(204);
		expect(kv.get(ID)?.options).toEqual({ expiration: Math.floor(Date.parse("2999-01-01T00:00:00Z") / 1000) });

		const data = await call(new Request(`https://w.example/result/${ID}/data`), env);
		expect(data.headers.get("cache-control")).toBe("no-store");
		expect(await data.json()).toMatchObject({ id: ID, name: "朝の湖", photoIds: [shared?.id] });

		const page = await call(new Request(`https://w.example/result/${ID}`), env);
		expect(page.status).toBe(200);
		expect(page.headers.get("cache-control")).toBe("no-store");
		expect(await page.text()).toBe("asset /");
	});

	it("保存していない結果はページを返してデータを404にする。展示用の画面のパスは404、静的ファイルは返す", async () => {
		const { env } = fakeEnv();
		expect((await call(new Request(`https://w.example/result/${ID}`), env)).status).toBe(200);
		expect((await call(new Request(`https://w.example/result/${ID}/data`), env)).status).toBe(404);
		expect((await call(new Request("https://w.example/result/red"), env)).status).toBe(404);
		expect((await call(new Request("https://w.example/admin"), env)).status).toBe(404);
		expect((await call(new Request("https://w.example/"), env)).status).toBe(404);
		expect((await call(new Request("https://w.example/api/realtime"), env)).status).toBe(404);
		expect(await (await call(new Request("https://w.example/fonts/MOBO-Regular.otf"), env)).text()).toBe(
			"asset /fonts/MOBO-Regular.otf",
		);
	});

	it("公開終了後は受け取らず、結果ページを410にする", async () => {
		const { env } = fakeEnv("2000-01-01T00:00:00Z");
		expect((await call(put("secret", body()), env)).status).toBe(410);
		expect((await call(new Request(`https://w.example/result/${ID}`), env)).status).toBe(410);
	});

	it("トークンを設定していなければ受け取らない", async () => {
		const { env } = fakeEnv();
		expect((await call(put("", body()), { ...env, RESULTS_UPLOAD_TOKEN: undefined })).status).toBe(401);
	});
});
