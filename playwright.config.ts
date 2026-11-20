import { defineConfig, devices } from "@playwright/test";

// 通常の開発サーバーとは別のポートで、E2Eテスト専用の開発サーバーを起動する。`E2E_PORT` で変更できる。
// Viteは使用中のポートを避けて5173番から順に番号を上げるため、その範囲から離れた番号にする。
const port = Number(process.env.E2E_PORT || 4180);

export default defineConfig({
	testDir: "tests/e2e",
	// 展示状態は一つのDurable Objectで共有するため、テストは順に実行する。
	workers: 1,
	fullyParallel: false,
	timeout: 120_000,
	expect: { timeout: 10_000 },
	reporter: [["list"]],
	use: {
		baseURL: `http://localhost:${port}`,
		...devices["Desktop Chrome"],
		trace: "retain-on-failure",
		// 1回の操作で要素の出現を待つ時間（click、locator.evaluate の要素待ちなど）と、waitForResponse などの
		// 待機の上限。評価中の処理そのものには上限がない。既定値は無制限で、
		// 要素が見つからない場合にテスト全体の上限まで待つ。
		// シーケンスの再生中は「進む」などが表示されないため、そのクリックは表示待ちとなり、この上限まで待つ。
		actionTimeout: 15_000,
		// ページ遷移の上限。指定しない場合は無制限で、テスト全体の上限まで待つ。
		navigationTimeout: 30_000,
	},
	webServer: {
		command: `pnpm exec vite dev --port ${port} --strictPort`,
		env: { DPC_E2E_SERVER: "1" },
		url: `http://localhost:${port}`,
		// 既に起動しているサーバーは、E2E用の設定で起動したものか判別できないため使わない。
		// 前回の実行が異常終了してポートが使用中のままの場合は、そのプロセスを終了するか `E2E_PORT` を変える。
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
