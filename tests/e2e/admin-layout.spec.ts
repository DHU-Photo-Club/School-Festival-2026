import { expect, test } from "@playwright/test";
import { RESULT_COLORS } from "../../src/data/colors.ts";
import { ExhibitHarness } from "./fixtures.ts";

const PANELS = ["展示状態", "結果色の表示確認", "端末"];

test("管理画面はFHD内に全パネルを配置し、狭い画面でも横にはみ出さない", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const { page } = harness.admin;
	try {
		await expect(page).toHaveTitle("運営管理 | あなた色写真展");
		await page.setViewportSize({ width: 1920, height: 1080 });
		const panels = page.locator(".dashboard > section");
		await expect(panels).toHaveCount(PANELS.length);
		for (const panel of await panels.all()) {
			await expect(panel).toBeInViewport({ ratio: 1 });
		}
		expect(
			await page.evaluate(() => ({
				horizontal: document.documentElement.scrollWidth > window.innerWidth,
				vertical: document.documentElement.scrollHeight > window.innerHeight,
			})),
		).toEqual({ horizontal: false, vertical: false });

		await page.setViewportSize({ width: 390, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await page.getByRole("heading", { name: "端末", exact: true }).scrollIntoViewIfNeeded();
		await expect(page.getByRole("heading", { name: "端末", exact: true })).toBeInViewport();
	} finally {
		await harness.close();
	}
});

test("管理画面は展示状態を受信する前から全パネルを表示する", async ({ browser }) => {
	const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
	try {
		const page = await context.newPage();
		// サーバーへ接続せずに保留し、最初の state が届かない状態にする。
		await page.routeWebSocket(/\/api\/realtime/, () => {});
		await page.goto("/admin");
		await expect(page.locator(".dashboard > section")).toHaveCount(PANELS.length);
		for (const name of PANELS) {
			await expect(page.getByRole("heading", { name, exact: true, level: 2 })).toBeVisible();
		}
		await expect(page.getByTestId("admin-loading")).toHaveCount(4);
		await expect(page.getByRole("button", { name: "強制リセット" })).toBeDisabled();
		await expect(page.getByRole("button", { name: "受付状態を取得中" })).toBeDisabled();
		// 結果色は固定のデータのため先に表示するが、展示状態を受信するまで操作できない。
		for (const color of RESULT_COLORS) {
			await expect(page.getByRole("button", { name: color.name })).toBeDisabled();
		}
	} finally {
		await context.close();
	}
});
