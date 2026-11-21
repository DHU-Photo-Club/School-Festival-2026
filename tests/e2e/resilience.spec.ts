import { expect, test } from "@playwright/test";
import { RESULT_COLORS } from "../../src/data/colors.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { resultPhotoFor } from "../../src/shared/assignment.ts";
import { COLOR_IDS } from "../../src/shared/types.ts";
import type { Device } from "./fixtures.ts";
import {
	answerQuestion,
	controllableNetwork,
	ExhibitHarness,
	enterNickname,
	expectedResultView,
	expectQuestion,
	waitForResultPhotos,
} from "./fixtures.ts";

async function startQuestions(ipad: Device) {
	await ipad.page.getByRole("button", { name: "はじめる" }).click();
	await enterNickname(ipad.page);
	await expectQuestion(ipad.page, 0);
}

async function answerAll(ipad: Device) {
	await startQuestions(ipad);
	await answerQuestions(ipad);
}

async function answerQuestions(ipad: Device) {
	for (let index = 0; index < QUESTIONS.length; index += 1) {
		await expectQuestion(ipad.page, index);
		await answerQuestion(ipad.page, QUESTIONS[index], index * 3);
		await ipad.page.getByRole("button", { name: "次へ" }).click();
	}
	await expect(ipad.page.getByText("あなたの色は")).toBeVisible({ timeout: 6_000 });
}

test("強制リセットで全端末が待機へ戻り、回答と結果とQRコードが残らない", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.openDisplays(1);
	const ipad = await harness.openDevice("controller");

	await startQuestions(ipad);
	await answerQuestion(ipad.page, QUESTIONS[0], 4);
	await ipad.page.getByRole("button", { name: "次へ" }).click();
	await expectQuestion(ipad.page, 1);
	// iPad操作と強制リセットをほぼ同時に送っても最終状態は idle。
	// 強制リセットが先に反映されると「次へ」が画面から消えるため、iPad側のクリックは失敗を許容する。
	// 上限の2秒は、押せるボタンのクリックが送信を終えるのに十分な長さで、待機を打ち切るのに十分短い値。
	await answerQuestion(ipad.page, QUESTIONS[1], 1);
	const next = ipad.page.getByRole("button", { name: "次へ" });
	// クリック前に押せる状態を確かめ、iPad側の送信が最初から成立しないまま通過することを防ぐ。
	await expect(next).toBeEnabled();
	await Promise.all([
		next.click({ timeout: 2_000 }).catch(() => {}),
		harness.admin.page.getByRole("button", { name: "強制リセット" }).click(),
	]);
	await expect(ipad.page.getByRole("button", { name: "はじめる" })).toBeVisible();
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");
	await expect(harness.admin.page.getByTestId("phase")).toContainText("idle");

	// 次の来場者は新しい診断で、最初の質問は未回答から始まる。
	await startQuestions(ipad);
	await expect(ipad.page.getByRole("button", { name: "次へ" })).toBeDisabled();

	await answerQuestions(ipad);
	await harness.admin.page.getByRole("button", { name: "強制リセット" }).click();
	await expect(ipad.page.getByRole("button", { name: "はじめる" })).toBeVisible();
	await expect(ipad.page.locator(".qr")).toHaveCount(0);
	await expect(ipad.page.getByText("あなたの色は")).toHaveCount(0);
	await expect(harness.admin.page.getByTestId("result-color")).toHaveText("—");

	await display.context.close();
	await ipad.context.close();
	await harness.close();
});

test("通信断中のiPadは操作できず、復旧後はサーバーの状態を表示する", async ({ browser }) => {
	test.setTimeout(120_000);
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.openDisplays(1);
	let network: Awaited<ReturnType<typeof controllableNetwork>> | undefined;
	const ipad = await harness.openDevice("controller", {}, async (context) => {
		network = await controllableNetwork(context);
	});
	await startQuestions(ipad);
	await answerQuestion(ipad.page, QUESTIONS[0], 2);

	await network?.down();
	await expect(ipad.page.getByText("再接続しています")).toBeVisible({ timeout: 25_000 });
	await expect(ipad.page.getByRole("button", { name: "次へ" })).toBeDisabled();
	// 通信断の間にほかの端末から状態が変わる。
	await harness.admin.page.getByRole("button", { name: "強制リセット" }).click();
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");

	await network?.up();
	await expect(ipad.page.getByText("再接続しています")).toHaveCount(0, { timeout: 30_000 });
	await expect(ipad.page.getByRole("button", { name: "はじめる" })).toBeVisible();
	await expect(harness.admin.page.getByTestId("device-controller")).toContainText("接続中");

	await display.context.close();
	await ipad.context.close();
	await harness.close();
});

test("切断した展示ディスプレイは管理画面で切断表示になり、再接続すると接続中へ戻る", async ({ browser }) => {
	test.setTimeout(120_000);
	const harness = await ExhibitHarness.open(browser);
	let network: Awaited<ReturnType<typeof controllableNetwork>> | undefined;
	const display = await harness.openDevice("display", {}, async (context) => {
		network = await controllableNetwork(context);
	});
	const row = harness.admin.page.getByTestId("device-display-1");
	await expect(row).toContainText("接続中");
	await network?.down();
	await expect(row).toContainText("切断", { timeout: 30_000 });
	// 切断中も展示画面は最後の表示を維持し、来場者向けの警告を出さない。
	await expect(display.page.getByText("再接続")).toHaveCount(0);
	await network?.up();
	await expect(row).toContainText("接続中", { timeout: 30_000 });
	await display.context.close();
	await harness.close();
});

test("result 開始から60秒後に操作がなくても待機表示へ戻る", async ({ browser }) => {
	test.setTimeout(150_000);
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.openDisplays(1);
	const ipad = await harness.openDevice("controller");
	await answerAll(ipad);
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "result");
	await ipad.page.waitForTimeout(55_000);
	await expect(ipad.page.getByText("あなたの色は")).toBeVisible();
	await expect(ipad.page.getByRole("button", { name: "はじめる" })).toBeVisible({ timeout: 10_000 });
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");
	await display.context.close();
	await ipad.context.close();
	await harness.close();
});

test("結果写真を読み込めない画面は開始時刻を遅らせずタイポグラフィを表示する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	// 展示ディスプレイ1に割り当てられる各色の写真の取得を失敗させる。
	const assigned = COLOR_IDS.flatMap((colorId) => resultPhotoFor(PHOTOS, colorId, 0)?.id ?? []);
	const { context, page } = await harness.openDevice("display", {}, (context) =>
		context.route(new RegExp(`/photos/(${assigned.join("|")}).(avif|jpg)$`), (route) => route.abort()),
	);
	const other = await harness.openDevice("display");
	await waitForResultPhotos(other.page);

	const ipad = await harness.openDevice("controller");
	await answerAll(ipad);
	const name = await ipad.page.locator(".color-name").innerText();
	const color = RESULT_COLORS.find((candidate) => candidate.name === name);
	await expect(page.locator("main.display")).toHaveAttribute("data-result-view", "typography");
	await expect(page.locator(".color-name")).toHaveText(name);
	await expect(page.locator(".color-name")).toHaveCSS("color", hexToRgb(color?.foregroundColor ?? ""));
	await expect(other.page.locator("main.display")).toHaveAttribute(
		"data-result-view",
		expectedResultView(color?.id ?? "red", 1),
	);

	await context.close();
	await other.context.close();
	await ipad.context.close();
	await harness.close();
});

function hexToRgb(hex: string): string {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
