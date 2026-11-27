import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ExhibitHarness, palette } from "./fixtures.ts";

/** 画面分割の一つのタブを開く。 */
async function openPart(browser: Browser, screen: number, viewport = { width: 1920, height: 960 }) {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	await page.goto(`/display/split/${screen}`);
	await expect(page.locator("main.display")).toHaveAttribute("data-phase", "idle");
	return { context, page };
}

/** 二台を合わせた画面と扉の、このタブの表示領域での位置と大きさ、色面のcanvasの解像度。 */
async function layout(page: Page) {
	return page.evaluate(() => {
		const rect = (selector: string) => {
			const box = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
			return {
				x: Math.round(box.x),
				y: Math.round(box.y),
				width: Math.round(box.width),
				height: Math.round(box.height),
			};
		};
		const canvas = document.querySelector("main.display canvas") as HTMLCanvasElement;
		return { display: rect("main.display"), door: rect(".door"), canvas: [canvas.width, canvas.height] };
	});
}

test("画面分割では二つのタブが36:9の一つの画面の左半分と右半分を描き、それぞれの画面番号で接続する", async ({
	browser,
}) => {
	const harness = await ExhibitHarness.open(browser);
	const left = await openPart(browser, 1);
	const right = await openPart(browser, 2);
	// どちらのタブも3840×960の一つの画面を描き、右のタブはそれを1920px左へずらして右半分を見せる。
	// 扉は画面の中央（二台の継ぎ目）にまたがる。
	const wall = { width: 3840, height: 960 };
	const door = { width: 312, height: 749 };
	await expect
		.poll(() => layout(left.page))
		.toEqual({
			display: { x: 0, y: 0, ...wall },
			door: { x: 1920 - 156, y: 960 - 749, ...door },
			canvas: [1920, 480],
		});
	await expect
		.poll(() => layout(right.page))
		.toEqual({
			display: { x: -1920, y: 0, ...wall },
			door: { x: -156, y: 960 - 749, ...door },
			canvas: [1920, 480],
		});
	await expect(harness.admin.page.getByTestId("device-display-1")).toContainText("接続中");
	await expect(harness.admin.page.getByTestId("device-display-2")).toContainText("接続中");

	// 一つの画面として、二つのタブは同じ色を見せる。
	const wisteria = palette("wisteria");
	await harness.admin.page.getByRole("button", { name: wisteria.name, exact: true }).click();
	for (const { page } of [left, right]) {
		await expect(page.locator("main.display")).toHaveAttribute("data-result-color", "wisteria");
		await expect(page.locator(".color-name")).toHaveText(wisteria.name);
	}
	await harness.admin.page.getByRole("button", { name: "表示確認を終了" }).click();
	await left.context.close();
	await right.context.close();
	await harness.close();
});

test("画面分割はディスプレイの縦横比が18:9と違うと、18:9の枠を中央に置いて余りを黒で埋める", async ({ browser }) => {
	const right = await openPart(browser, 2, { width: 1920, height: 1080 });
	await expect
		.poll(async () => (await layout(right.page)).display)
		.toEqual({ x: -1920, y: 60, width: 3840, height: 960 });
	await right.context.close();
});

test("画面分割の画面番号は1と2だけ", async ({ page }) => {
	await page.goto("/display/split/3");
	await expect(page.getByText("ページが見つかりません")).toBeVisible();
});
