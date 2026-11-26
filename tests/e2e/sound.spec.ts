import { expect, test } from "@playwright/test";
import { answerAllQuestions, ExhibitHarness, IPAD_VIEWPORT } from "./fixtures.ts";

test("サウンド用の画面は全音源を読み込んで鳴らし始め、再生状態を管理画面へ知らせ、展示の進行を追う", async ({
	browser,
}) => {
	const harness = await ExhibitHarness.open(browser);
	const sound = await browser.newContext();
	const ipad = await browser.newContext({ viewport: IPAD_VIEWPORT });
	try {
		const page = await sound.newPage();
		const errors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto("/sound");
		// 自動再生を止めるブラウザでは、画面の操作で音を出す。
		const start = page.getByRole("button", { name: "音を出す" });
		const status = page.getByTestId("audio-status");
		await expect(status).not.toHaveText("音源を読み込んでいます", { timeout: 30_000 });
		if (await start.isVisible()) await start.click();
		await expect(status).toHaveText("再生中", { timeout: 30_000 });
		await expect(page.getByRole("heading", { name: "読み込めなかった音源" })).toHaveCount(0);

		// 全停止と再開。
		await page.getByRole("button", { name: "すべての音を止める" }).click();
		await expect(page.getByTestId("halt-note")).toBeVisible();
		await page.getByRole("button", { name: "音を再開する" }).click();
		await expect(page.getByTestId("halt-note")).toHaveCount(0);
		await expect(status).toHaveText("再生中");

		const card = harness.admin.page.getByRole("group", { name: "サウンド", exact: true });
		await expect(card.getByTestId("device-audio")).toHaveText("再生中");

		const controller = await ipad.newPage();
		await controller.goto("/");
		await answerAllQuestions(controller);
		await expect(page.getByTestId("sound-phase")).toHaveText("結果");
		await controller.getByRole("button", { name: "最初に戻る" }).click();
		await expect(page.getByTestId("sound-phase")).toHaveText("待機");
		expect(errors).toEqual([]);
	} finally {
		await ipad.close();
		await sound.close();
		await harness.close();
	}
});
