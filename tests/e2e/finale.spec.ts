import { expect, test } from "@playwright/test";
import { QUESTIONS } from "../../src/data/questions.ts";
import { ExhibitHarness, enterNickname, expectQuestion, answerQuestion } from "./fixtures.ts";

for (const renderer of ["webgl", "canvas"] as const) test(`最終回答の集約から爆発・結果へ進む（${renderer}）`, async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const display = await harness.openDevice("display", {}, renderer === "canvas" ? (context) => context.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
			if (type.startsWith("webgl")) return null;
			return Reflect.apply(original, this, [type, ...args]);
		} as typeof original;
	}) : undefined);
	const ipad = await harness.openDevice("controller");
	const errors: string[] = [];
	display.page.on("pageerror", (error) => errors.push(error.message));
	try {
		await ipad.page.getByRole("button", { name: "はじめる" }).click();
		await enterNickname(ipad.page);
		for (const [i, question] of QUESTIONS.entries()) {
			await expectQuestion(ipad.page, i);
			await answerQuestion(ipad.page, question, i * 3);
			await ipad.page.getByRole("button", { name: "次へ", exact: true }).click();
		}
		const shards = display.page.locator("canvas.shards");
		await expect(shards).toHaveAttribute("data-mode", "gather");
		await expect(shards).toHaveAttribute("data-mode", "burst", { timeout: 15000 });
		await expect(shards).toHaveAttribute("data-mode", "dispersed");
		await expect(display.page.locator(".layer")).toHaveCSS("opacity", "1");
		const late = await harness.openDevice("display");
		await expect(late.page.locator("canvas.shards")).toHaveAttribute("data-mode", "dispersed");
		await late.context.close();
		await harness.reset();
		await expect(shards).toHaveAttribute("data-mode", "normal");
		expect(errors).toEqual([]);
	} finally {
		await ipad.context.close(); await display.context.close(); await harness.close();
	}
});
