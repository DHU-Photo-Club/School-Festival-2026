import { expect, test } from "@playwright/test";
import { EXHIBIT } from "../../src/data/exhibit.ts";
import { ExhibitHarness } from "./fixtures.ts";

test("写真用は写真を表示せず、展示タイトルだけを表示する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const first = await harness.openDevice("photo");
	const second = await harness.openDevice("photo");
	try {
		for (const { page } of [first, second]) {
			await expect(page.locator("main.photo-display")).toContainText(EXHIBIT.title);
			await expect(page.locator("img")).toHaveCount(0);
		}
		await expect(first.page).toHaveTitle("写真用 1 | あなた色写真展");
		await expect(harness.admin.page.getByTestId("device-photo-1")).toContainText("接続中");
		await expect(harness.admin.page.getByTestId("device-photo-2")).toContainText("接続中");
		await expect(harness.admin.page.locator('[data-testid^="device-display-"]')).toHaveCount(0);
	} finally {
		await first.context.close();
		await second.context.close();
		await harness.close();
	}
});
