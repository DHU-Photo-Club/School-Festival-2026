import { cloudflare } from "@cloudflare/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { exhibitChecks, readWranglerConfig } from "./scripts/exhibit-checks.ts";

const wrangler = readWranglerConfig();

export default defineConfig(({ command, isPreview }) => {
	// E2Eテスト専用の開発サーバー（`vite dev` かつ `DPC_E2E_SERVER=1`）の設定。
	// `vite preview` も command は "serve" になるため、isPreview で除外する。
	// 通常の開発サーバーと並行して起動する前提で、キャッシュと永続状態を分ける。
	// - cacheDir: 依存関係の最適化キャッシュを分ける。同じディレクトリを使うと更新が競合する。
	// - persistState: false: `.wrangler/state` を使わず、Durable Objectの状態をサーバーの終了時に破棄する。
	//   実行中に設定ファイルを変更してサーバーが再起動した場合も状態が消え、以降のテストが失敗する。
	// - inspectorPort: false: Worker用のデバッガを起動しない。
	const e2e = command === "serve" && !isPreview && process.env.DPC_E2E_SERVER === "1";
	return {
		cacheDir: e2e ? "node_modules/.vite-e2e" : undefined,
		plugins: [
			exhibitChecks(),
			svelte(),
			cloudflare(e2e ? { persistState: false, inspectorPort: false } : undefined),
		],
		define: {
			// QRコードと結果URLの正本（仕様書10.1節）。
			__PUBLIC_ORIGIN__: JSON.stringify(wrangler.vars.PUBLIC_ORIGIN),
		},
	};
});
