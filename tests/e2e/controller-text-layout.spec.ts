import { expect, test } from "@playwright/test";
import { ExhibitHarness } from "./fixtures.ts";

test("診断の文章は画面の余白を除いた幅を使い、収まる文章を折り返さない", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const controller = await harness.pair("controller");
	const { page } = controller;
	try {
		const start = page.getByRole("button", { name: "診断をはじめる" });
		await expect(start).toBeVisible();
		for (const viewport of [
			{ width: 820, height: 1180 },
			{ width: 1920, height: 1080 },
		]) {
			await page.setViewportSize(viewport);
			const paragraph = page.locator(".top .muted");
			const metrics = await paragraph.evaluate((element) => {
				const range = document.createRange();
				range.selectNodeContents(element);
				return {
					lines: range.getClientRects().length,
					width: element.parentElement!.getBoundingClientRect().width,
				};
			});
			expect(metrics.lines).toBe(1);
			expect(metrics.width).toBe(viewport.width - 48);
		}

		await start.click();
		await expect(page.locator(".intro")).toBeVisible();
		for (const width of [1920, 820, 390]) {
			await page.setViewportSize({ width, height: 1180 });
			expect(await page.locator(".intro").evaluate((element) => element.getBoundingClientRect().width)).toBe(
				width - 48,
			);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		}
	} finally {
		await controller.context.close();
		await harness.close();
	}
});
