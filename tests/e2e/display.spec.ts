import { expect, test } from "@playwright/test";
import { DISPLAY_QUESTION_LINES } from "../../src/data/display-questions.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import {
	answerQuestion,
	backgroundHex,
	bloomHasGraphics,
	canvasDigest,
	canvasHasGraphics,
	canvasPixel,
	ExhibitHarness,
	enterNickname,
	expectQuestion,
	palette,
	STUB_RESULT,
	stubScreenColor,
} from "./fixtures.ts";

test("待機中は写真を置かず、すべての画面が破片を描く", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const displays = await harness.openDisplays(3);
	for (const display of displays) {
		await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");
		await expect(display.page.locator("main.display img")).toHaveCount(0);
		await expect.poll(() => canvasHasGraphics(display.page)).toBe(true);
		await expect.poll(() => bloomHasGraphics(display.page)).toBe(true);
	}
	for (const display of displays) await display.context.close();
	await harness.close();
});

test("intro で「あなた色写真展へようこそ」がゆっくり現れ、説明の文へ入れ替わり、質問で消える", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.openDisplays(1);
	const ipad = await harness.openDevice("controller");
	const welcome = display.page.locator(".welcome");
	await expect(welcome).toHaveText("あなた色写真展へようこそ");
	await expect(welcome).toHaveCSS("opacity", "0");
	await ipad.page.getByRole("button", { name: "はじめる" }).click();
	await expect(ipad.page.locator("main.screen")).toHaveCSS("background-color", "rgb(0, 0, 0)");
	await expect(ipad.page.getByRole("heading")).toHaveCount(0);
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "intro");
	await expect(welcome).toHaveCSS("opacity", "1", { timeout: 6_000 });
	// 説明の文を現れ終えるまで、iPadにニックネームの入力欄は出ない。
	const nicknameField = ipad.page.getByRole("textbox", { name: "ニックネームを入力して下さい" });
	await expect(nicknameField).toHaveCount(0);
	// 「ようこそ」を見せたあと、それが消えて、説明の文が三行で現れる。
	const description = display.page.locator(".description");
	await expect(description.locator("span")).toHaveText(["あなた色写真展は", "あなたの気分や感性によって", "変化する写真展です"]);
	await expect(welcome).toHaveCSS("opacity", "0", { timeout: 10_000 });
	// 説明の文が現れている途中でも、入力欄は出ない。現れ終えると出る。
	await expect(nicknameField).toHaveCount(0);
	await expect(description).toHaveCSS("opacity", "1", { timeout: 10_000 });
	await expect(ipad.page.locator("main.screen")).toHaveCSS("background-color", "rgb(0, 0, 0)");
	await expect(display.page.locator(".description")).toHaveCSS("opacity", "0", { timeout: 10_000 });
	await expect(display.page.locator(".invitation")).toHaveCSS("opacity", "1", { timeout: 3_000 });
	await expect(display.page.locator(".invitation span")).toHaveText(["さあ、あなただけの色を", "見つけましょう"]);
	await expect(nicknameField).toHaveCount(0);
	await expect(nicknameField).toBeVisible({ timeout: 15_000 });
	await expect(ipad.page.locator("main.screen")).not.toHaveClass(/blank-intro/);
	const nicknamePrompt = display.page.locator(".nickname-prompt:not(.question-prompt)");
	await expect(nicknamePrompt).toHaveCSS("opacity", "1");
	await expect(nicknamePrompt).toHaveText("ニックネームを入力して下さい");
	await expect(nicknamePrompt.locator("p span")).toHaveText(["ニックネームを", "入力して下さい"]);
	expect(await nicknamePrompt.evaluate((node) => getComputedStyle(node).fontSize)).toBe(
		await display.page.locator(".invitation").evaluate((node) => getComputedStyle(node).fontSize),
	);
	await expect(nicknamePrompt.locator("svg")).toBeVisible();
	await expect(display.page.locator(".invitation")).toHaveCSS("opacity", "0");
	await enterNickname(ipad.page);
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "question");
	await expect(description).toHaveCSS("opacity", "0", { timeout: 4_000 });
	await expect(nicknamePrompt).toHaveCSS("opacity", "0", { timeout: 4_000 });
	await display.context.close();
	await ipad.context.close();
	await harness.close();
});

test("管理画面の表示確認で全画面がパレットの色の完了状態を表示し、終了で待機へ戻る", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const displays = await harness.openDisplays(3);
	const wisteria = palette("wisteria");
	await harness.admin.page.getByRole("button", { name: wisteria.name, exact: true }).click();
	for (const display of displays) {
		await expect(display.page.locator("main.display")).toHaveAttribute("data-result-color", "wisteria");
		await expect.poll(() => canvasPixel(display.page, 0.01, 0.01)).toBe(backgroundHex(wisteria));
		await expect(display.page.locator(".color-name")).toHaveText(wisteria.name);
	}
	await harness.admin.page.getByRole("button", { name: "表示確認を終了" }).click();
	for (const display of displays) {
		await expect.poll(() => canvasPixel(display.page, 0.01, 0.01)).toBe("#0B0B0B");
	}
	for (const display of displays) await display.context.close();
	await harness.close();
});

test("reduced-motion でも全状態が色面の切り替えと静止した構図で成立する", async ({ browser }) => {
	test.setTimeout(120_000);
	const harness = await ExhibitHarness.open(browser);
	const displays = await harness.openDisplays(3, { reducedMotion: "reduce" });
	const ipad = await harness.openDevice("controller", { reducedMotion: "reduce" });
	const { page } = ipad;
	await page.getByRole("button", { name: "はじめる" }).click();
	await enterNickname(page);

	// 質問: 灰色の破片が静止して表示される。
	// 属性は状態の受信で、canvas は次の描画フレームで変わるため、描画を待ってから比べる。
	await expect(displays[0].page.locator("main.display")).toHaveAttribute("data-phase", "question");
	await expect.poll(() => canvasHasGraphics(displays[0].page)).toBe(true);
	await expect.poll(() => canvasHasGraphics(displays[1].page)).toBe(true);
	// 破片の周りにブルームが描かれる。
	await expect.poll(() => bloomHasGraphics(displays[0].page)).toBe(true);
	const still = await canvasDigest(displays[0].page);
	await displays[0].page.waitForTimeout(1_000);
	expect(await canvasDigest(displays[0].page)).toBe(still);
	// 破片に色を付けないので、全画面が同じ構図になる（どの画面も同じ大きさで開くので、画素のハッシュで比べられる）。
	expect(await canvasDigest(displays[1].page)).toBe(still);

	for (let index = 0; index < QUESTIONS.length; index += 1) {
		await expectQuestion(page, index);
		await answerQuestion(page, QUESTIONS[index], 2);
		const shown = displays[0].page.locator("main.display");
		const revision = (await shown.getAttribute("data-revision")) ?? "";
		await page.getByRole("button", { name: "次へ" }).click();
		if (index < QUESTIONS.length - 1) {
			// 一問確定しても、構図は変わらない。
			await expect(shown).not.toHaveAttribute("data-revision", revision);
			await displays[0].page.waitForTimeout(300);
			expect(await canvasDigest(displays[0].page)).toBe(still);
		}
	}

	// 判定: 即時に黒（判定は最短10秒なので、その間に黒になることを確かめる）。
	// 画面中央は輪の内側で、破片のブルームも届かない（中央から最も近い破片まで、広い段のぼかし幅の約5倍ある）。
	await expect
		.poll(() => canvasPixel(displays[0].page, 0.5, 0.5), { timeout: 1_800, intervals: [20] })
		.toBe("#000000");
	await expect(page.locator(".color-name")).toHaveText(STUB_RESULT.name, { timeout: 15_000 });

	// 結果: 基準色の全面から完了状態へ一回だけ切り替わる。画面ごとに二色を交互に見せる。
	for (const [displayOrder, display] of displays.entries()) {
		await expect
			.poll(() => canvasPixel(display.page, 0.01, 0.01), { timeout: 5_000 })
			.toBe(backgroundHex(stubScreenColor(displayOrder)));
		// 結果でも破片とブルームは残る。
		await expect.poll(() => bloomHasGraphics(display.page)).toBe(true);
		await expect(display.page.locator(".color-name")).toHaveText(stubScreenColor(displayOrder).name);
	}
	await page.getByRole("button", { name: "最初に戻る" }).click();
	for (const display of displays)
		await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");

	for (const device of [...displays, ipad]) await device.context.close();
	await harness.close();
});

test("開いた台数の展示ディスプレイで動き、管理画面に接続中の台数だけ並ぶ", async ({ browser }) => {
	test.setTimeout(120_000);
	const harness = await ExhibitHarness.open(browser);
	const displays = await harness.openDisplays(5, { viewport: { width: 960, height: 540 } });
	await expect(harness.admin.page.locator('[data-testid^="device-display-"]')).toHaveCount(5);
	for (let index = 1; index <= 5; index += 1) {
		await expect(harness.admin.page.getByTestId(`device-display-${index}`)).toContainText("接続中");
	}
	// 5画面すべてが写真を置かず、破片を描く。
	for (const display of displays) {
		await expect(display.page.locator("main.display img")).toHaveCount(0);
		await expect.poll(() => canvasHasGraphics(display.page)).toBe(true);
	}
	for (const display of displays) await display.context.close();
	await harness.close();
});

test("展示に各質問文を表示し、戻る・途中接続・判定への移行にも追従する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.openDisplays(1);
	const ipad = await harness.openDevice("controller");
	try {
		await ipad.page.getByRole("button", { name: "はじめる" }).click();
		await enterNickname(ipad.page);
		for (const [index, question] of QUESTIONS.entries()) {
			await expectQuestion(ipad.page, index);
			await expect(display.page.locator(".question-prompt p span")).toHaveText([...DISPLAY_QUESTION_LINES[question.id]]);
			await expect(display.page.locator(".question-prompt svg")).toHaveCount(0);
			if (index === 1) {
				await ipad.page.getByRole("button", { name: "戻る", exact: true }).click();
				await expectQuestion(ipad.page, 0);
				await expect(display.page.locator(".question-prompt p span")).toHaveText([...DISPLAY_QUESTION_LINES[QUESTIONS[0].id]]);
				await ipad.page.getByRole("button", { name: "次へ", exact: true }).click();
				await expectQuestion(ipad.page, 1);
				await expect(display.page.locator(".question-prompt p span")).toHaveText([...DISPLAY_QUESTION_LINES[question.id]]);
				const late = await harness.openDevice("display");
				await expect(late.page.locator(".question-prompt p span")).toHaveText([...DISPLAY_QUESTION_LINES[question.id]]);
				await late.context.close();
			}
			await answerQuestion(ipad.page, question, index * 3);
			await ipad.page.getByRole("button", { name: "次へ", exact: true }).click();
			if (index < QUESTIONS.length - 1) {
				// リングの縮小完了（450ms）に合わせて更新され、以前の音声待ち（1660ms）を待たない。
				await expect(display.page.locator(".question-prompt p span")).toHaveText(
					[...DISPLAY_QUESTION_LINES[QUESTIONS[index + 1].id]], { timeout: 1_000 },
				);
			}
		}
		await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "judging");
		await expect(display.page.locator(".question-prompt")).toHaveCount(0);
	} finally {
		await display.context.close();
		await ipad.context.close();
		await harness.close();
	}
});
