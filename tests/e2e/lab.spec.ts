import { expect, test } from "@playwright/test";
import { PALETTE } from "../../src/data/palette.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { IPAD_VIEWPORT } from "./fixtures.ts";

// 演出の調整用ループ（docs/visual-language.md 8章）。サーバーへ接続せず、台本どおりに画面が進むことを確かめる。
test.use({ viewport: IPAD_VIEWPORT });

test("診断用iPadのループ door は、結果、扉への案内の順に進み、待機へ戻って繰り返す", async ({ page }) => {
	await page.goto("/?loop=door&color=jade");
	const hud = page.locator(".lab-hud");
	await expect(hud).toContainText("door / jade");
	await expect(page.getByRole("button", { name: "扉を開く" })).toBeVisible({ timeout: 10_000 });
	await expect(page.getByText("扉へお進み下さい")).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole("button", { name: "はじめる" })).toBeVisible({ timeout: 20_000 });
	await expect(hud).toContainText("#2", { timeout: 10_000 });
	// サーバーへ接続しないので、再接続の案内は出さない。
	await expect(page.getByText("再接続しています")).toHaveCount(0);
});

test("診断用iPadのループ answer は、一問目から二問目へ進む", async ({ page }) => {
	await page.goto("/?loop=answer");
	await expect(page.getByRole("heading", { name: QUESTIONS[0].prompt })).toBeVisible();
	await expect(page.getByRole("heading", { name: QUESTIONS[1].prompt })).toBeVisible({ timeout: 5_000 });
	await page.keyboard.press("h");
	await expect(page.locator(".lab-hud")).toHaveCount(0);
});

test("展示ディスプレイのループ result は、色名を出してから待機へ戻る", async ({ page }) => {
	const jade = PALETTE.colors.find((color) => color.id === "jade")?.name ?? "";
	await page.goto("/display/1?loop=result&color=jade");
	await expect(page.locator(".lab-hud")).toContainText("result / jade");
	await expect(page.locator(".color-title")).toContainText(jade, { timeout: 15_000 });
	await expect(page.locator(".color-title")).toHaveCount(0, { timeout: 15_000 });
});

test("展示ディスプレイのループ door は、色名が出た結果から始めて扉を開く", async ({ page }) => {
	await page.goto("/display/1?loop=door&color=jade");
	await expect(page.locator(".display")).toHaveAttribute("data-phase", "result");
	// 判定を経ずに、色名を初めから見せる。
	await expect(page.locator(".color-title")).toBeVisible({ timeout: 1_000 });
	await expect
		.poll(() => page.locator(".door").evaluate((element) => Number(getComputedStyle(element).opacity)), {
			timeout: 8_000,
		})
		.toBeGreaterThan(0.9);
});
