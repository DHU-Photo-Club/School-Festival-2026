import { expect, type Page, test } from "@playwright/test";
import { PALETTE } from "../../src/data/palette.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { SEQUENCES } from "../../src/data/sequences.ts";
import { type LabLoop, labCycle } from "../../src/shared/lab.ts";
import { sequenceBefore } from "../../src/shared/sequence.ts";
import { IPAD_VIEWPORT } from "./fixtures.ts";

// 演出の調整用ループ（docs/visual-language.md 8章）。サーバーへ接続せず、台本どおりに画面が進むことを確かめる。
test.use({ viewport: IPAD_VIEWPORT });

/** ループの一周の長さ。 */
function cycleLength(loop: LabLoop): number {
	const lead = sequenceBefore(SEQUENCES, "intro");
	return labCycle({ loop, color: "all" }, { index: 0, startedAt: 0, lead, questionCount: QUESTIONS.length }).lengthMs;
}

/**
 * 一周の区切りは端末の時計で決まるので、ページの時計を周の始まりに合わせてから開く。時計は合わせたあとも
 * 実時間で進む。
 */
async function openAtCycleStart(page: Page, url: string, loop: LabLoop) {
	await page.clock.install({ time: 1_000 * cycleLength(loop) });
	await page.goto(url);
}

test("診断用iPadのループ door は、結果、扉への案内の順に進み、待機へ戻って繰り返す", async ({ page }) => {
	await openAtCycleStart(page, "/?loop=door&color=jade", "door");
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
	await openAtCycleStart(page, "/?loop=answer", "answer");
	await expect(page.getByRole("heading", { name: QUESTIONS[0].prompt })).toBeVisible();
	await expect(page.getByRole("heading", { name: QUESTIONS[1].prompt })).toBeVisible({ timeout: 5_000 });
	await page.keyboard.press("h");
	await expect(page.locator(".lab-hud")).toHaveCount(0);
});

test("展示ディスプレイのループ result は、色名を出してから待機へ戻る", async ({ page }) => {
	const jade = PALETTE.colors.find((color) => color.id === "jade")?.name ?? "";
	await openAtCycleStart(page, "/display/1?loop=result&color=jade", "result");
	await expect(page.locator(".lab-hud")).toContainText("result / jade");
	await expect(page.locator(".color-name")).toContainText(jade, { timeout: 15_000 });
	await expect(page.locator(".color-name")).toHaveCount(0, { timeout: 15_000 });
});

test("展示ディスプレイのループ door は、色名が出た結果から始めて扉を開く", async ({ page }) => {
	await openAtCycleStart(page, "/display/1?loop=door&color=jade", "door");
	await expect(page.locator(".display")).toHaveAttribute("data-phase", "result");
	// 判定を経ずに、色名を初めから見せる。
	await expect(page.locator(".color-name")).toBeVisible({ timeout: 1_000 });
	await expect
		.poll(() => page.locator(".door").evaluate((element) => Number(getComputedStyle(element).opacity)), {
			timeout: 8_000,
		})
		.toBeGreaterThan(0.9);
});

test("画面分割の二つのタブで開いたループは、開いた時刻がずれても同じ周の同じ場面を見せる", async ({ browser }) => {
	const length = cycleLength("result");
	const open = async (screen: number, startAt: number) => {
		const page = await browser.newPage();
		await page.clock.install({ time: startAt });
		await page.goto(`/display/split/${screen}?loop=result`);
		return page;
	};
	// 左のタブは周の初めに、右のタブは同じ周の6.5秒後（結果の途中）に開く。
	const origin = 1_000 * length;
	const left = await open(1, origin);
	const right = await open(2, origin + 6_500);
	await left.clock.pauseAt(origin + 8_000);
	await right.clock.pauseAt(origin + 8_000);
	const shown = (page: Page) =>
		page
			.locator(".display")
			.evaluate((element) => [element.getAttribute("data-phase"), element.getAttribute("data-result-color")]);
	await expect.poll(() => shown(left)).toEqual(["result", expect.any(String)]);
	expect(await shown(right)).toEqual(await shown(left));
	await left.close();
	await right.close();
});
