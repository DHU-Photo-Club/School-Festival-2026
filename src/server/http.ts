import type { ServerResponse } from "node:http";
import { goneResponse, notFoundResponse, resultAvailability } from "../shared/result-page.ts";
import type { Exhibit } from "./exhibit.ts";

/** `/result/*` の応答。`page` は結果ページのSPA（`index.html`）を `Cache-Control: no-store` で返す。 */
export type ResultReply = { kind: "page" } | { kind: "response"; response: Response };

/**
 * 会場サーバーでの `/result/{id}` と `/result/{id}/data`（仕様書10.1節）。来場者は結果ページのWorkerで開くが、
 * 会場の端末からの確認とE2Eテストのため、会場サーバーでも同じ判定で返す。
 */
export function resultReply(pathname: string, exhibit: Exhibit, publishedUntil: string): ResultReply {
	const availability = resultAvailability(pathname, Date.now(), publishedUntil);
	if (availability.status === 404) return { kind: "response", response: notFoundResponse() };
	if (availability.status === 410) return { kind: "response", response: goneResponse() };
	const result = exhibit.publicResult(availability.id);
	if (!result) return { kind: "response", response: notFoundResponse() };
	if (availability.kind === "data") {
		return { kind: "response", response: Response.json(result, { headers: { "Cache-Control": "no-store" } }) };
	}
	return { kind: "page" };
}

/** Fetch APIの `Response` をNode.jsの応答へ書き出す。 */
export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
	res.statusCode = response.status;
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});
	res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * `Range: bytes=...` の一つの範囲を `[start, end]`（両端を含む）へ直す。サウンド用の画面のBGM（`<audio>` のループ）が
 * 先頭へ戻るときに使う。ヘッダーがない、または複数の範囲なら `null`（全体を返す）、満たせない範囲なら `"unsatisfiable"`。
 */
export function parseRange(header: string | undefined, size: number): [number, number] | null | "unsatisfiable" {
	if (header === undefined) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match || (match[1] === "" && match[2] === "")) return null;
	let start: number;
	let end: number;
	if (match[1] === "") {
		// `bytes=-500` は末尾の500バイト。
		const suffix = Number(match[2]);
		if (suffix === 0) return "unsatisfiable";
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
	}
	if (start >= size || start > end) return "unsatisfiable";
	return [start, end];
}
