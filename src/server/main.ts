// 会場サーバー（本番）。`pnpm build` の成果物（dist/）と `/api/realtime`、`/result/*` を同じポートで配信する。
// 起動: `pnpm start`（`.env` があれば読む）。仕様書14章「会場サーバーの起動」を参照。
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { validatePublicOrigin, validatePublishedUntil } from "../shared/data-validation.ts";
import { ROOT, readWranglerConfig, serverConfig } from "./config.ts";
import { Exhibit } from "./exhibit.ts";
import { resultReply, writeResponse } from "./http.ts";
import { attachRealtime } from "./realtime.ts";

const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".jpg": "image/jpeg",
	".png": "image/png",
	".ico": "image/x-icon",
	".otf": "font/otf",
	".woff2": "font/woff2",
};

/** `dist/` の中のファイルなら、その絶対パスとサイズ。`..` などで外へ出るパスは `null`。 */
async function distFile(pathname: string): Promise<{ path: string; size: number } | null> {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const path = normalize(join(DIST, decoded));
	if (path !== DIST && !path.startsWith(DIST + sep)) return null;
	try {
		const info = await stat(path);
		return info.isFile() ? { path, size: info.size } : null;
	} catch {
		return null;
	}
}

const index = join(DIST, "index.html");
if (!existsSync(index)) {
	console.error("dist/index.html がありません。先に `pnpm build` を実行してください。");
	process.exit(1);
}

// 一件の処理の失敗で展示全体を止めないよう、想定外の例外はログに出して動き続ける。
process.on("uncaughtException", (error) => console.error("想定外の例外が起きました", error));
process.on("unhandledRejection", (error) => console.error("想定外の例外が起きました", error));

const config = serverConfig(process.env);
// 結果の送り先の設定の誤りは、展示は動くが結果ページが開けない形で現れるため、起動時に知らせる。
for (const problem of [
	...validatePublicOrigin(config.publicOrigin, readWranglerConfig().name),
	...validatePublishedUntil(config.resultsPublishedUntil),
	...(config.publicOrigin.includes("tbd-subdomain") ? ["PUBLIC_ORIGIN が仮の値のままです"] : []),
	...(Date.parse(config.resultsPublishedUntil) <= Date.now() ? ["RESULTS_PUBLISHED_UNTIL を過ぎています"] : []),
]) {
	console.warn(`wrangler.jsonc: ${problem}`);
}
const exhibit = new Exhibit(config);

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	try {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { Allow: "GET, HEAD" }).end();
			return;
		}
		let file: { path: string; size: number } | null;
		let cacheControl: string;
		if (url.pathname.startsWith("/result/")) {
			const reply = resultReply(url.pathname, exhibit, config.resultsPublishedUntil);
			if (reply.kind === "response") return await writeResponse(res, reply.response);
			file = await distFile("/index.html");
			cacheControl = "no-store";
		} else if (url.pathname.startsWith("/api/")) {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
			return;
		} else {
			file = await distFile(url.pathname);
			// ハッシュ付きのファイル名で出力するビルド成果物だけを長く保存させる。
			cacheControl = url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
			// SPA: ファイルでないパスは `index.html` を返し、画面はパスから決める（仕様書9.2節）。
			if (!file && !extname(url.pathname)) file = await distFile("/index.html");
		}
		if (!file) {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
			return;
		}
		res.writeHead(200, {
			"Content-Type": CONTENT_TYPES[extname(file.path)] ?? "application/octet-stream",
			"Content-Length": file.size,
			"Cache-Control": file.path === index ? "no-store" : cacheControl,
		});
		if (req.method === "HEAD") res.end();
		else await pipeline(createReadStream(file.path), res);
	} catch (error) {
		// 端末が読み込みの途中で切断した場合は、ログに出さない。
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ECONNRESET" || code === "EPIPE") return;
		console.error(error);
		if (!res.headersSent) res.writeHead(500).end();
		else res.destroy();
	}
});

const detach = attachRealtime(server, exhibit);
// 開発サーバーと違い、ほかにアップグレードを受ける処理がないため、`/api/realtime` 以外の要求は閉じる。
server.on("upgrade", (request, socket) => {
	if (URL.parse(request.url ?? "/", "http://localhost")?.pathname !== "/api/realtime") socket.destroy();
});

server.listen(PORT, HOST, () => {
	console.log(`会場サーバーを起動しました（ポート ${PORT}）`);
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) console.log(`  http://${entry.address}:${PORT}/`);
		}
	}
});

function shutdown(): void {
	detach();
	server.close();
	exhibit.dispose();
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
