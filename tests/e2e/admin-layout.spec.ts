import { expect, test } from "@playwright/test";
import { ExhibitHarness } from "./fixtures.ts";

test("管理画面はFHD内に全パネルを配置し、端末一覧をパネル内でスクロールする", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const { page } = harness.admin;
	try {
		await expect(page).toHaveTitle("運営管理 | あなた色写真展");
		await page.setViewportSize({ width: 1920, height: 1080 });
		const panels = page.locator(".dashboard > section");
		await expect(panels).toHaveCount(6);
		for (const panel of await panels.all()) {
			await expect(panel).toBeInViewport({ ratio: 1 });
		}
		const pairing = page.getByRole("form", { name: "展示ディスプレイのコード発行" });
		await expect(pairing.getByRole("button", { name: "コードを発行" })).toBeInViewport();
		await pairing.getByRole("button", { name: "コードを発行" }).click();
		await expect(pairing.getByTestId("pairing-code")).toBeVisible();

		await page.route("**/api/admin/sessions", (route) =>
			route.fulfill({
				json: {
					sessions: Array.from({ length: 40 }, (_, index) => ({
						id: `session-${index}`,
						role: "display",
						screenId: `display-${index + 1}`,
						issuedAt: Date.now(),
						expiresAt: Date.now() + 60_000,
						lastReceivedAt: null,
						connected: false,
					})),
				},
			}),
		);
		await expect(page.locator(".registration-panel tbody tr")).toHaveCount(40);
		// 登録パネルでは、コード発行の欄を残したままセッションの表だけをスクロールする。
		expect(
			await page
				.locator(".registration-panel [data-slot=table-container]")
				.evaluate((table) => table.scrollHeight > table.clientHeight),
		).toBe(true);
		await expect(pairing.getByRole("button", { name: "コードを発行" })).toBeInViewport();
		expect(
			await page.evaluate(() => ({
				horizontal: document.documentElement.scrollWidth > window.innerWidth,
				vertical: document.documentElement.scrollHeight > window.innerHeight,
			})),
		).toEqual({ horizontal: false, vertical: false });

		await page.setViewportSize({ width: 390, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await page.getByRole("heading", { name: "端末の登録" }).scrollIntoViewIfNeeded();
		await expect(page.getByRole("heading", { name: "端末の登録" })).toBeInViewport();
	} finally {
		await harness.close();
	}
});
