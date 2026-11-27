import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { keystonesFromEnv } from "../shared/keystone.ts";
import type { ServerConfig } from "./config.ts";
import { ROOT, serverConfig } from "./config.ts";
import { Exhibit } from "./exhibit.ts";
import { keystoneResponse, resultReply, writeResponse } from "./http.ts";
import { attachRealtime } from "./realtime.ts";

/**
 * 開発サーバー（`vite dev`）に会場サーバーの `/api/realtime` と `/result/*` を載せる。
 * 環境変数は `.env` から読む。展示状態は `data/dev.sqlite` に保存し、本番の `data/exhibit.sqlite` と分ける。
 * 開発中の結果が来場者向けの結果ページに載らないよう、`.env` に `RESULTS_UPLOAD_TOKEN` があっても結果を送らない。
 * `overrides` はE2Eテストの開発サーバーが使う（vite.config.ts）。
 */
export function exhibitServer(overrides: Partial<ServerConfig> = {}): Plugin {
	return {
		name: "exhibit-server",
		apply: "serve",
		configureServer(server) {
			const env = { ...loadEnv(server.config.mode, ROOT, ""), ...process.env };
			const config = serverConfig(env, {
				dataFile: join(ROOT, "data", "dev.sqlite"),
				resultsUploadToken: undefined,
				...overrides,
			});
			for (const problem of keystonesFromEnv(env).problems) console.warn(`.env: ${problem}`);
			const exhibit = new Exhibit(config);
			const httpServer = server.httpServer;
			const detach = httpServer ? attachRealtime(httpServer, exhibit) : () => {};
			httpServer?.once("close", () => {
				detach();
				exhibit.dispose();
			});

			server.middlewares.use(async (req, res, next) => {
				const url = new URL(req.url ?? "/", "http://localhost");
				if (url.pathname === "/api/keystone")
					return await writeResponse(res, keystoneResponse(config.keystones));
				if (!url.pathname.startsWith("/result/")) return next();
				try {
					const reply = resultReply(url.pathname, exhibit, config.resultsPublishedUntil);
					if (reply.kind === "response") return await writeResponse(res, reply.response);
					// Viteの `index.html` の応答は `Cache-Control: no-cache` になるため、自分で変換して返す。
					const html = await server.transformIndexHtml(
						url.pathname,
						await readFile(join(ROOT, "index.html"), "utf8"),
					);
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
					res.end(html);
				} catch (error) {
					next(error);
				}
			});
		},
	};
}
