import { expect, test } from "@playwright/test";
import { SEQUENCES } from "../../src/data/sequences.ts";
import { NICKNAME_MAX_LENGTH } from "../../src/shared/nickname.ts";
import { ExhibitHarness } from "./fixtures.ts";

test("ニックネームの入力欄は画面の余白に収まり、空や長すぎる名前は送信しない", async ({ browser }) => {
	const sequence = SEQUENCES.find((candidate) => candidate.before === "intro");
	const harness = await ExhibitHarness.open(browser);
	const controller = await harness.openDevice("controller");
	const { page } = controller;
	try {
		await page.getByRole("button", { name: "はじめる" }).click();
		// intro の前にシーケンスがあれば、その再生を終えてから入力欄が表示される。
		const input = page.getByRole("textbox", { name: "ニックネームを入力して下さい" });
		await expect(input).toBeVisible({ timeout: (sequence?.durationMs ?? 0) + 10_000 });
		await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

		const submit = page.getByRole("button", { name: "進む" });
		const main = page.locator("main");
		// 空欄や空白だけで押すと、送信せずに入力欄へフォーカスを戻す。
		await input.fill("   ");
		await input.blur();
		await submit.click();
		await expect(input).toBeFocused();
		await expect(main).toHaveAttribute("data-phase", "intro");

		// 長すぎる名前は案内を表示して送信しない。絵文字も一文字として数える。
		await input.fill("あ".repeat(NICKNAME_MAX_LENGTH + 1));
		await expect(page.getByText(`${NICKNAME_MAX_LENGTH}文字までにしてください`)).toBeVisible();
		await expect(input).toHaveAttribute("aria-invalid", "true");
		await submit.click();
		await expect(main).toHaveAttribute("data-phase", "intro");
		await input.fill("🎨".repeat(NICKNAME_MAX_LENGTH));
		await expect(input).toHaveAttribute("aria-invalid", "false");

		const field = page.locator(".nickname-field");
		for (const width of [1920, 820, 390]) {
			await page.setViewportSize({ width, height: 1180 });
			const box = await field.boundingBox();
			expect(box).not.toBeNull();
			expect(box?.x).toBeGreaterThanOrEqual(24);
			expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - 24);
			// `.screen` は横方向のはみ出しを隠すため、文書全体ではなく見出しの要素で内容の幅を比べる。
			expect(
				await page.locator(".intro h1").evaluate((element) => element.scrollWidth <= element.clientWidth),
			).toBe(true);
		}
	} finally {
		await controller.context.close();
		await harness.close();
	}
});
