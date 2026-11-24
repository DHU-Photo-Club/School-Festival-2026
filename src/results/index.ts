// 結果ページのWorker（仕様書10章）。来場者がQRコードで開く結果ページだけを、施設回線の外から配信する。
// 展示の本体は会場サーバー（src/server/）で動き、結果が決まるたびに `PUT /api/results/{id}` で送ってくる。
import type { ResultsEnv } from "./handler.ts";
import { handleRequest } from "./handler.ts";

export default {
	fetch: (request, env) => handleRequest(request, env),
} satisfies ExportedHandler<Env & Pick<ResultsEnv, "RESULTS_UPLOAD_TOKEN">>;
