import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** 補正の面が画面上の点 (x, y) を写した先。 */
async function mapped(page: Page, x: number, y: number) {
	return page.evaluate(
		([px, py]) => {
			const surface = document.querySelector(".keystone .surface") as HTMLElement;
			const point = new DOMMatrix(getComputedStyle(surface).transform).transformPoint(new DOMPoint(px, py));
			return [Math.round(point.x / point.w), Math.round(point.y / point.w)];
		},
		[x, y],
	);
}

test("展示ディスプレイでKを押して角を動かすと台形補正が掛かり、再読み込みしても残り、Rで消える", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/display/1");
	await expect(page.locator("main.display")).toHaveAttribute("data-phase", "idle");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "none");

	await page.keyboard.press("k");
	await expect(page.getByTestId("keystone-editor")).toBeVisible();
	// 左上の角を右下へドラッグする。
	await page.mouse.move(8, 8);
	await page.mouse.down();
	await page.mouse.move(100, 60, { steps: 4 });
	await page.mouse.move(192, 108, { steps: 4 });
	await page.mouse.up();
	// 右下の角を選び、矢印キーで左へ10px、上へ1px動かす。
	await page.keyboard.press("3");
	await page.keyboard.press("Shift+ArrowLeft");
	await page.keyboard.press("ArrowUp");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "applied");
	expect(await mapped(page, 0, 0)).toEqual([192, 108]);
	expect(await mapped(page, 1920, 1080)).toEqual([1910, 1079]);
	expect(await mapped(page, 1920, 0)).toEqual([1920, 0]);

	await page.keyboard.press("Escape");
	await expect(page.getByTestId("keystone-editor")).toHaveCount(0);

	await page.reload();
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "applied");
	expect(await mapped(page, 0, 0)).toEqual([192, 108]);
	// 補正はパスごとに残すので、別の画面には掛からない。
	await page.goto("/display/2");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "none");

	await page.goto("/display/1");
	await page.keyboard.press("k");
	await page.keyboard.press("r");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "none");
	await page.reload();
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "none");
});

test("画面分割でも、全画面に置いた中身ごと台形補正の面に収まってゆがむ", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 960 });
	// 四隅を同じだけ右へずらす（平行移動）。中身は補正の面を基準にするので、同じだけ右へずれる。
	await page.addInitScript(() => {
		localStorage.setItem(
			"dpc-keystone:/display/split/1",
			JSON.stringify([
				[0.1, 0],
				[0.1, 0],
				[0.1, 0],
				[0.1, 0],
			]),
		);
	});
	await page.goto("/display/split/1");
	await expect(page.locator("main.display")).toHaveAttribute("data-phase", "idle");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "applied");
	const box = await page.locator(".split").boundingBox();
	expect(box && [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]).toEqual([
		192, 0, 1920, 960,
	]);
});
