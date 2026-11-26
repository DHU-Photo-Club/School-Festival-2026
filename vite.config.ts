import path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { exhibitChecks } from "./scripts/exhibit-checks.ts";
import { readWranglerConfig } from "./src/server/config.ts";
import { exhibitServer } from "./src/server/vite-plugin.ts";

const wrangler = readWranglerConfig();

export default defineConfig(({ command, isPreview }) => {
	// E2Eテスト専用の開発サーバー（`vite dev` かつ `DPC_E2E_SERVER=1`）の設定。
	// `vite preview` も command は "serve" になるため、isPreview で除外する。
	// 通常の開発サーバーと並行して起動する前提で、キャッシュと展示状態を分ける。
	// - cacheDir: 依存関係の最適化キャッシュを分ける。同じディレクトリを使うと更新が競合する。
	// - dataFile: ":memory:": 展示状態をファイルに保存せず、サーバーの終了時に破棄する。
	//   実行中に設定ファイルを変更してサーバーが再起動した場合も状態が消え、以降のテストが失敗する。
	// - aiStub: AIの選定を仮の選定に置き換える。`.env` のAPIキーより優先する。
	const e2e = command === "serve" && !isPreview && process.env.DPC_E2E_SERVER === "1";
	return {
		cacheDir: e2e ? "node_modules/.vite-e2e" : undefined,
		plugins: [
			exhibitChecks(),
			tailwindcss(),
			svelte(),
			// AIへ接続せず、決まった二色を返す仮の選定を使う（src/server/ai/judge.ts）。
			exhibitServer(e2e ? { dataFile: ":memory:", aiStub: true } : {}),
		],
		resolve: {
			// shadcn-svelte のコンポーネントが参照する別名（tsconfig.json の paths と合わせる）。
			alias: { $lib: path.resolve("./src/client/lib") },
		},
		define: {
			// QRコードと結果URLの正本（仕様書10.1節）。
			__PUBLIC_ORIGIN__: JSON.stringify(wrangler.vars.PUBLIC_ORIGIN),
		},
		server: {
			allowedHosts: [".trycloudflare.com"],
		},
	};
});
