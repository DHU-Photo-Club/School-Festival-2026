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
