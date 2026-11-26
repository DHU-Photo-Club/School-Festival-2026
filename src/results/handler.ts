// 結果ページのWorkerの処理（仕様書10章）。入口は src/results/index.ts。
import { PALETTE } from "../data/palette.ts";
import { PHOTOS } from "../data/photos.ts";
import type { PublicResult } from "../shared/result.ts";
import { RESULT_ID_PATTERN } from "../shared/result.ts";
import { goneResponse, notFoundResponse, resultAvailability } from "../shared/result-page.ts";

/**
 * 結果ページのWorkerの環境（`wrangler.jsonc`）のうち、ここで使う部分。Workersの型に頼らず、単体テストで偽の環境を渡せるようにする。
 * `RESULTS_UPLOAD_TOKEN` は `wrangler secret put RESULTS_UPLOAD_TOKEN` で設定し、会場サーバーの `.env` と同じ値にする。
 * 設定していなければ結果を受け取らない。
 */
export interface ResultsEnv {
	RESULTS: {
		get(key: string, type: "text"): Promise<string | null>;
		put(key: string, value: string, options: { expiration: number }): Promise<void>;
	};
	ASSETS: { fetch(request: Request): Promise<Response> };
	RESULTS_PUBLISHED_UNTIL: string;
	RESULTS_UPLOAD_TOKEN?: string;
}

/**
 * 結果ページが読む静的ファイル。それ以外のパスは404にし、展示用の画面を開けないようにする。
 * `/assets/` には展示用の画面のスクリプトも入るが、展示状態や結果は別の経路でしか読めないため、取得されてもよい。
 */
const STATIC_PREFIXES = ["/assets/", "/fonts/", "/photos/"];
/** 受け付ける本文の上限。一件の結果は数KB。 */
const MAX_BODY_BYTES = 32 * 1024;
/** 文字列の項目ごとの上限。AIの出力はこれより十分短い。 */
const MAX_TEXT_LENGTH = 2_000;

const PALETTE_IDS = new Set<string>(PALETTE.colors.map((color) => color.id));
const SHAREABLE_PHOTO_IDS = new Set(PHOTOS.filter((photo) => photo.shareAllowed).map((photo) => photo.id));

const text = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH;

/** 会場サーバーから届いた結果の確認。形の合わない項目があれば `null`。余分な項目は捨てる。 */
export function parsePublicResult(value: unknown, id: string): PublicResult | null {
	if (typeof value !== "object" || value === null) return null;
	const body = value as Record<string, unknown>;
	if (body.id !== id) return null;
	if (!text(body.name) || !text(body.nameReason) || !text(body.reading) || !text(body.relationship)) return null;
	const colors = body.colors;
	if (!Array.isArray(colors) || colors.length !== 2) return null;
	const pairs: { id: PublicResult["colors"][number]["id"]; reason: string }[] = [];
	for (const color of colors as unknown[]) {
		if (typeof color !== "object" || color === null) return null;
		const { id: colorId, reason } = color as Record<string, unknown>;
		if (typeof colorId !== "string" || !PALETTE_IDS.has(colorId) || !text(reason)) return null;
		if (pairs.some((pair) => pair.id === colorId)) return null;
		pairs.push({ id: colorId as PublicResult["colors"][number]["id"], reason });
	}
	const photoIds = body.photoIds;
	if (!Array.isArray(photoIds) || !photoIds.every((photoId) => typeof photoId === "string")) return null;
	return {
		id,
		name: body.name,
		nameReason: body.nameReason,
		reading: body.reading,
		relationship: body.relationship,
		colors: [pairs[0], pairs[1]],
		// 配布を許可していない写真は、送られてきても公開しない（仕様書10.2節）。
		photoIds: (photoIds as string[]).filter((photoId) => SHAREABLE_PHOTO_IDS.has(photoId)),
	};
}

/** トークンの比較。長さ以外の情報を処理時間から読まれないよう、すべてのバイトを比べる。 */
function sameToken(given: string, expected: string): boolean {
	const encoder = new TextEncoder();
	const a = encoder.encode(given);
	const b = encoder.encode(expected);
	if (a.byteLength !== b.byteLength) return false;
	let diff = 0;
	for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/** `PUT /api/results/{id}`: 会場サーバーから結果を受け取り、公開終了日時まで保存する。 */
async function putResult(request: Request, env: ResultsEnv, id: string): Promise<Response> {
	if (request.method !== "PUT") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "PUT" } });
	const token = env.RESULTS_UPLOAD_TOKEN?.trim();
	const given = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
	if (!token || !sameToken(given, token)) return new Response("Unauthorized", { status: 401 });
	if (!RESULT_ID_PATTERN.test(id)) return new Response("Invalid result id", { status: 400 });

	const until = Date.parse(env.RESULTS_PUBLISHED_UNTIL);
	if (Number.isNaN(until) || Date.now() >= until)
		return new Response("Results are no longer published", { status: 410 });

	const raw = await request.text();
	if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return new Response("Too Large", { status: 413 });
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}
	const result = parsePublicResult(parsed, id);
	if (!result) return new Response("Invalid result", { status: 400 });

	// 公開終了日時に消えるようにする。KVの期限は60秒より先でなければならないため、終了の直前に届いた結果は
	// 終了から最長61秒後に消える（終了後は `/result/*` が410を返すため読めない）。
	const expiration = Math.max(Math.floor(until / 1000), Math.ceil(Date.now() / 1000) + 61);
	await env.RESULTS.put(id, JSON.stringify(result), { expiration });
	return new Response(null, { status: 204 });
}

/** 結果ページのWorkerの応答。 */
export async function handleRequest(request: Request, env: ResultsEnv): Promise<Response> {
	const url = new URL(request.url);

	const upload = url.pathname.match(/^\/api\/results\/([^/]+)$/);
	if (upload) return putResult(request, env, upload[1]);
	if (url.pathname.startsWith("/api/")) return new Response("Not Found", { status: 404 });

	if (url.pathname.startsWith("/result/")) {
		const availability = resultAvailability(url.pathname, Date.now(), env.RESULTS_PUBLISHED_UNTIL);
		if (availability.status === 404) return notFoundResponse();
		if (availability.status === 410) return goneResponse();
		if (availability.kind === "data") {
			const result = await env.RESULTS.get(availability.id, "text");
			if (!result) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
			return new Response(result, {
				headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
			});
		}
		// 結果は会場サーバーから遅れて届き、KVの反映にも時間がかかるため、まだ保存していない結果IDでも
		// ページは返す。ページはデータが届くまで読み直す（src/client/result/ResultPage.svelte）。
		const spa = await env.ASSETS.fetch(new Request(new URL("/", url), request));
		const response = new Response(spa.body, spa);
		response.headers.set("Cache-Control", "no-store");
		return response;
	}

	if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return env.ASSETS.fetch(request);
	return notFoundResponse();
}
