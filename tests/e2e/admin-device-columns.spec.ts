import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ExhibitHarness } from "./fixtures.ts";

const groups = [
	{ role: "controller", label: "診断用iPad" },
	{ role: "display", label: "展示ディスプレイ" },
	{ role: "photo", label: "写真用" },
	{ role: "light", label: "電球の中継" },
	{ role: "sound", label: "サウンド" },
] as const;

/** 画面を開かずに、WebSocketだけで展示ディスプレイと写真用を12台ずつと、電球の中継とサウンド用を1台ずつ接続する。 */
async function connectScreens(page: Page, count: number): Promise<void> {
	await page.goto("/result/red");
	await page.evaluate((total) => {
		for (const role of ["display", "photo"]) {
			for (let screen = 1; screen <= total; screen += 1) {
				new WebSocket(`ws://${location.host}/api/realtime?role=${role}&screen=${screen}`);
			}
		}
		new WebSocket(`ws://${location.host}/api/realtime?role=light`);
		new WebSocket(`ws://${location.host}/api/realtime?role=sound`);
	}, count);
}

async function groupBoxes(page: Page) {
	const boxes = await Promise.all(
		groups.map(({ label }) => page.getByRole("group", { name: label, exact: true }).boundingBox()),
	);
	return boxes.map((box) => {
		if (!box) throw new Error("group not found");
		return box;
	});
}

test("端末一覧は種別ごとの5列で表示し、列ごとにスクロールし、狭い画面では縦に並べる", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const { page } = harness.admin;
	const sockets = await browser.newContext();
	try {
		await page.setViewportSize({ width: 1920, height: 1080 });
		for (const { label } of groups) {
			const group = page.getByRole("group", { name: label, exact: true });
			await expect(group.getByRole("heading", { name: label, level: 3 })).toBeVisible();
		}
		await expect(page.getByRole("group", { name: "写真用", exact: true })).toContainText(
			"接続している端末はありません。",
		);

		await connectScreens(await sockets.newPage(), 12);
		const displays = page.getByRole("group", { name: "展示ディスプレイ", exact: true });
		const photos = page.getByRole("group", { name: "写真用", exact: true });
		await expect(displays.locator(".device-card")).toHaveCount(12);
		await expect(photos.locator(".device-card")).toHaveCount(12);
		await expect(displays.getByTestId("device-display-1")).toContainText("展示ディスプレイ 1");
		await expect(displays.getByTestId("device-display-1")).toContainText("接続中");
		await expect(displays).toContainText("12台接続");
		const lights = page.getByRole("group", { name: "電球の中継", exact: true });
		await expect(lights.getByTestId("device-light")).toContainText("接続中");
		const sound = page.getByRole("group", { name: "サウンド", exact: true });
		await expect(sound.getByTestId("device-sound")).toContainText("接続中");
		await expect(sound.getByTestId("device-audio")).toHaveText("未報告");

		for (const width of [1920, 1280]) {
			await page.setViewportSize({ width, height: 1080 });
			const boxes = await groupBoxes(page);
			for (let index = 1; index < boxes.length; index += 1) {
				expect(Math.abs(boxes[index - 1].y - boxes[index].y)).toBeLessThan(1);
				expect(boxes[index - 1].x + boxes[index - 1].width).toBeLessThan(boxes[index].x);
			}
			for (const group of [displays, photos]) {
				expect(
					await group.locator(".device-list").evaluate((list) => list.scrollHeight > list.clientHeight),
				).toBe(true);
			}
			expect(
				await page.evaluate(() => ({
					horizontal: document.documentElement.scrollWidth > window.innerWidth,
					vertical: document.documentElement.scrollHeight > window.innerHeight,
				})),
			).toEqual({ horizontal: false, vertical: false });
		}

		await displays.locator(".device-list").evaluate((list) => (list.scrollTop = list.scrollHeight));
		await expect(displays.getByTestId("device-display-12")).toBeInViewport({ ratio: 0.99 });
		expect(await photos.locator(".device-list").evaluate((list) => list.scrollTop)).toBe(0);

		await page.setViewportSize({ width: 390, height: 844 });
		const mobile = await groupBoxes(page);
		for (let index = 1; index < mobile.length; index += 1) {
			expect(mobile[index - 1].y + mobile[index - 1].height).toBeLessThan(mobile[index].y);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await photos.getByTestId("device-photo-12").scrollIntoViewIfNeeded();
		await expect(photos.getByTestId("device-photo-12")).toBeInViewport({ ratio: 0.99 });

		// 端末を閉じると一覧から消える。
		await sockets.close();
		await expect(displays.locator(".device-card")).toHaveCount(0);
	} finally {
		await sockets.close();
		await harness.close();
	}
});
