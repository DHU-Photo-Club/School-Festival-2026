import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5173);

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
	},
	webServer: {
		command: `pnpm exec vite dev --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		reuseExistingServer: true,
		timeout: 120_000,
	},
});
