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

async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.locator("main.display")).toHaveAttribute("data-phase", "idle");
	// `.env` の補正を受け取ってから調整を受け付ける。
	await page.waitForLoadState("networkidle");
}

test("環境変数の台形補正を、そのパスの画面にだけ掛ける", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	// playwright.config.ts の KEYSTONE_DISPLAY_9。
	await open(page, "/display/9");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "applied");
	expect(await mapped(page, 0, 0)).toEqual([192, 54]);
	expect(await mapped(page, 1920, 0)).toEqual([1728, 0]);
	expect(await mapped(page, 1920, 1080)).toEqual([1920, 1080]);
	await open(page, "/display/1");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "none");
});

test("Kで角を動かすと.envへ書き写す一行を表示し、書き写すまでは下書きとして再読み込みしても残る", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await open(page, "/display/1");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "none");

	await page.keyboard.press("k");
	await expect(page.getByTestId("keystone-editor")).toBeVisible();
	await expect(page.getByTestId("keystone-status")).toHaveText(".envの値と同じ");
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
	await expect(page.getByTestId("keystone-status")).toContainText("未反映");
	await expect(page.getByTestId("keystone-env")).toHaveValue(
		"KEYSTONE_DISPLAY_1=[[0.1,0.1],[0,0],[-0.00521,-0.00093],[0,0]]",
	);

	await page.keyboard.press("Escape");
	await expect(page.getByTestId("keystone-editor")).toHaveCount(0);
	await page.reload();
	await page.waitForLoadState("networkidle");
	expect(await mapped(page, 0, 0)).toEqual([192, 108]);

	// Rで.envの値（補正なし）に戻すと、下書きも消える。
	await page.keyboard.press("k");
	await page.keyboard.press("r");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "none");
	await page.reload();
	await page.waitForLoadState("networkidle");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "none");
});

test("下書きは、調整を始めたときの.envの値が変わったら捨てる", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	// 別の.envの値から始めた下書き。書き写して再起動したあとと同じ状況。
	await page.addInitScript(() => {
		localStorage.setItem(
			"dpc-keystone:/display/9",
			JSON.stringify({
				base: [
					[0, 0],
					[0, 0],
					[0, 0],
					[0, 0],
				],
				value: [
					[0.2, 0],
					[0, 0],
					[0, 0],
					[0, 0],
				],
			}),
		);
	});
	await open(page, "/display/9");
	expect(await mapped(page, 0, 0)).toEqual([192, 54]);
	expect(await page.evaluate(() => localStorage.getItem("dpc-keystone:/display/9"))).toBeNull();
});

test("画面分割でも、全画面に置いた中身ごと台形補正の面に収まってゆがむ", async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 960 });
	await open(page, "/display/split/1");
	// 四隅を同じだけ右へずらす（平行移動）。中身は補正の面を基準にするので、同じだけ右へずれる。
	await page.keyboard.press("k");
	for (const corner of ["1", "2", "3", "4"]) {
		await page.keyboard.press(corner);
		for (let step = 0; step < 4; step++) await page.keyboard.press("Shift+ArrowRight");
	}
	await page.keyboard.press("Escape");
	await expect(page.locator(".keystone")).toHaveAttribute("data-keystone", "applied");
	const box = await page.locator(".split").boundingBox();
	expect(box && [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]).toEqual([
		40, 0, 1920, 960,
	]);
	await page.keyboard.press("k");
	await page.keyboard.press("r");
});
