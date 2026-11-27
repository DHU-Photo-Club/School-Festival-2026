import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const fullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement === document.documentElement);

for (const path of ["/display/1", "/display/split/1", "/photo/1"]) {
	test(`${path} はFで全画面になり、もう一度Fで戻る`, async ({ page }) => {
		await page.goto(path);
		await expect(page.locator(".keystone")).toBeVisible();
		expect(await fullscreen(page)).toBe(false);
		await page.keyboard.press("f");
		await expect.poll(() => fullscreen(page)).toBe(true);
		await page.keyboard.press("f");
		await expect.poll(() => fullscreen(page)).toBe(false);
	});
}

test("展示ディスプレイはダブルクリックでも全画面を切り替える", async ({ page }) => {
	await page.goto("/display/1");
	await expect(page.locator(".keystone")).toBeVisible();
	await page.mouse.dblclick(200, 200);
	await expect.poll(() => fullscreen(page)).toBe(true);
	await page.mouse.dblclick(200, 200);
	await expect.poll(() => fullscreen(page)).toBe(false);
});

test("診断用iPadはFで全画面にしない", async ({ page }) => {
	await page.goto("/");
	await page.keyboard.press("f");
	await page.waitForTimeout(300);
	expect(await fullscreen(page)).toBe(false);
});
