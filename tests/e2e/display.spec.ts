import { expect, test } from "@playwright/test";
import { QUESTIONS } from "../../src/data/questions.ts";
import type { Device } from "./fixtures.ts";
import {
	answerQuestion,
	backgroundHex,
	bloomHasGraphics,
	canvasDigest,
	canvasHasGraphics,
	canvasPixel,
	ExhibitHarness,
	enterNickname,
	expectedResultView,
	expectQuestion,
	palette,
	STUB_RESULT,
	stubScreenColor,
	waitForResultPhotos,
} from "./fixtures.ts";

/** 現在枠の待機写真のIDと不透明度。 */
async function currentIdle(device: Device) {
	return device.page.evaluate(() => {
		const slot = document.querySelector<HTMLElement>('[data-slot="current"]');
		return {
			id: slot?.querySelector("img")?.dataset.photoId ?? null,
			opacity: Number(slot?.style.opacity ?? "NaN"),
		};
	});
}

/** 待機枠の先頭からの経過時間（ms）。展示画面の補正済み時刻ではなく、管理画面と同じサーバー時刻の近似。 */
async function waitForFramePosition(device: Device, from: number, to: number) {
	await expect
		.poll(
			async () => {
				const { opacity } = await currentIdle(device);
				return opacity > from && opacity < to;
			},
			{ timeout: 12_000, intervals: [20] },
		)
		.toBe(true);
}

test("待機写真は8秒ごとに進み、先頭1秒だけクロスフェードし、同じ写真を複数画面へ表示しない", async ({ browser }) => {
	test.setTimeout(90_000);
	const harness = await ExhibitHarness.open(browser);
	const displays = await harness.openDisplays(3);
	await expect.poll(async () => (await currentIdle(displays[0])).opacity).toBe(1);

	const ids = await Promise.all(displays.map(async (display) => (await currentIdle(display)).id));
	expect(new Set(ids).size).toBe(3);

	// クロスフェード中（不透明度が0と1の間）を観測し、その後は1で止まる。
	await waitForFramePosition(displays[0], 0.05, 0.95);
	const fadingId = (await currentIdle(displays[0])).id;
	expect(fadingId).not.toBe(ids[0]);
	await expect.poll(async () => (await currentIdle(displays[0])).opacity, { timeout: 2_000 }).toBe(1);
	// 次の切り替えまで同じ写真のまま（8秒枠）。
	await displays[0].page.waitForTimeout(5_000);
	expect((await currentIdle(displays[0])).id).toBe(fadingId);

	const later = await Promise.all(displays.map(async (display) => (await currentIdle(display)).id));
	expect(new Set(later).size).toBe(3);
	// 画面ごとにプレイリストを1つずつずらして表示する。
	expect(later[1]).toBe(ids[2]);

	for (const display of displays) await display.context.close();
	await harness.close();
});

test("reduced-motion の待機表示はクロスフェードせず即時に切り替える", async ({ browser }) => {
	test.setTimeout(60_000);
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.openDisplays(1, { reducedMotion: "reduce" });
	const first = (await currentIdle(display)).id;
	await expect
		.poll(async () => (await currentIdle(display)).id, { timeout: 12_000, intervals: [20] })
		.not.toBe(first);
	for (let i = 0; i < 10; i += 1) {
		expect((await currentIdle(display)).opacity).toBe(1);
		await display.page.waitForTimeout(50);
	}
	await display.context.close();
	await harness.close();
});

test("管理画面の表示確認で全画面がパレットの色の完了状態を表示し、終了で待機へ戻る", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const displays = await harness.openDisplays(3);
	for (const display of displays) await waitForResultPhotos(display.page);
	const wisteria = palette("wisteria");
	await harness.admin.page.getByRole("button", { name: wisteria.name, exact: true }).click();
	for (const display of displays) {
		await expect(display.page.locator("main.display")).toHaveAttribute("data-result-color", "wisteria");
		await expect.poll(() => canvasPixel(display.page, 0.5, 0.01)).toBe(backgroundHex(wisteria));
		// 写真はセッションごとに選ぶため、表示確認は色名のタイポグラフィで見せる。
		await expect(display.page.locator("main.display")).toHaveAttribute("data-result-view", "typography");
		await expect(display.page.locator(".color-name")).toHaveText(wisteria.name);
	}
	await harness.admin.page.getByRole("button", { name: "表示確認を終了" }).click();
	for (const display of displays) {
		await expect.poll(() => canvasPixel(display.page, 0.5, 0.01)).toBe("#0B0B0B");
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
			// 一問確定しても、輪はふくらまず構図は変わらない。
			await expect(shown).not.toHaveAttribute("data-revision", revision);
			await displays[0].page.waitForTimeout(300);
			expect(await canvasDigest(displays[0].page)).toBe(still);
		}
	}

	// 判定: 即時に黒（判定は2秒なので、その間に黒になることを確かめる）。
	// 画面中央は輪の内側で、破片のブルームも届かない（中央から最も近い破片まで、広い段のぼかし幅の約5倍ある）。
	await expect
		.poll(() => canvasPixel(displays[0].page, 0.5, 0.5), { timeout: 1_800, intervals: [20] })
		.toBe("#000000");
	await expect(page.locator(".color-name")).toHaveText(STUB_RESULT.name, { timeout: 5_000 });

	// 結果: 基準色の全面から完了状態へ一回だけ切り替わる。画面ごとに二色を交互に見せる。
	for (const [displayOrder, display] of displays.entries()) {
		await expect
			.poll(() => canvasPixel(display.page, 0.5, 0.01), { timeout: 5_000 })
			.toBe(backgroundHex(stubScreenColor(displayOrder)));
		// 結果では破片とともにブルームも消える。
		await expect.poll(() => bloomHasGraphics(display.page)).toBe(false);
		await expect(display.page.locator("main.display")).toHaveAttribute(
			"data-result-view",
			expectedResultView(STUB_RESULT.photoIds, displayOrder),
		);
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
	// 5画面すべてが別々の待機写真を表示する。
	await expect.poll(async () => (await currentIdle(displays[4])).opacity).toBe(1);
	const ids = await Promise.all(displays.map(async (display) => (await currentIdle(display)).id));
	expect(new Set(ids).size).toBe(5);
	for (const display of displays) await display.context.close();
	await harness.close();
});
