import { expect, test } from "@playwright/test";
import { RESULT_COLORS } from "../../src/data/colors.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { resultPhotoFor } from "../../src/shared/assignment.ts";
import { COLOR_IDS } from "../../src/shared/types.ts";
import type { Device } from "./fixtures.ts";
import { controllableNetwork, ExhibitHarness, expectedResultView, tapStop } from "./fixtures.ts";

async function startQuestions(ipad: Device) {
	await ipad.page.getByRole("button", { name: "診断をはじめる" }).click();
	await ipad.page.getByRole("button", { name: "進む" }).click();
	await expect(ipad.page.getByText(`1 / ${QUESTIONS.length}`)).toBeVisible();
}

async function answerAll(ipad: Device) {
	await startQuestions(ipad);
	await answerQuestions(ipad);
}

async function answerQuestions(ipad: Device) {
	for (let index = 0; index < QUESTIONS.length; index += 1) {
		await expect(ipad.page.getByText(`${index + 1} / ${QUESTIONS.length}`)).toBeVisible();
		await tapStop(ipad.page, (index * 3) % 5);
		await ipad.page.getByRole("button", { name: "次へ" }).click();
	}
	await expect(ipad.page.getByText("あなたの色は")).toBeVisible({ timeout: 6_000 });
}

test("強制リセットで全端末が待機へ戻り、回答と結果とQRコードが残らない", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.pairDisplays(1);
	const ipad = await harness.pair("controller");

	await startQuestions(ipad);
	await tapStop(ipad.page, 4);
	await ipad.page.getByRole("button", { name: "次へ" }).click();
	await expect(ipad.page.getByText(`2 / ${QUESTIONS.length}`)).toBeVisible();
	// iPad操作と強制リセットをほぼ同時に送っても最終状態は idle。
	await tapStop(ipad.page, 1);
	await Promise.all([
		ipad.page.getByRole("button", { name: "次へ" }).click(),
		harness.admin.page.getByRole("button", { name: "強制リセット" }).click(),
	]);
	await expect(ipad.page.getByRole("button", { name: "診断をはじめる" })).toBeVisible();
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");
	await expect(harness.admin.page.getByTestId("phase")).toContainText("idle");

	// 次の来場者は新しい診断で、最初の質問は未回答から始まる。
	await startQuestions(ipad);
	await expect(ipad.page.getByRole("button", { name: "次へ" })).toBeDisabled();

	await answerQuestions(ipad);
	await harness.admin.page.getByRole("button", { name: "強制リセット" }).click();
	await expect(ipad.page.getByRole("button", { name: "診断をはじめる" })).toBeVisible();
	await expect(ipad.page.locator(".qr")).toHaveCount(0);
	await expect(ipad.page.getByText("あなたの色は")).toHaveCount(0);
	await expect(harness.admin.page.getByTestId("result-color")).toHaveText("—");

	await display.context.close();
	await ipad.context.close();
	await harness.close();
});

test("二台目のiPadは操作中の案内を表示し、管理画面で解放すると操作端末にできる", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const first = await harness.pair("controller");
	await expect(first.page.getByRole("button", { name: "診断をはじめる" })).toBeVisible();
	const second = await harness.pair("controller");
	await expect(second.page.getByText("別の端末で診断を操作しています。")).toBeVisible();
	await harness.admin.page.getByRole("button", { name: "操作端末を解放" }).click();
	await expect(first.page.getByRole("heading", { name: "端末の登録" })).toBeVisible();
	await expect(second.page.getByText("別の端末で診断を操作しています。")).toHaveCount(0, { timeout: 15_000 });
	await second.page.getByRole("button", { name: "診断をはじめる" }).click();
	await expect(second.page.getByRole("button", { name: "進む" })).toBeVisible();
	await first.context.close();
	await second.context.close();
	await harness.close();
});

test("通信断中のiPadは操作できず、復旧後は welcome のサーバー状態を表示する", async ({ browser }) => {
	test.setTimeout(120_000);
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.pairDisplays(1);
	let network: Awaited<ReturnType<typeof controllableNetwork>> | undefined;
	const ipad = await harness.pair("controller", {}, async (context) => {
		network = await controllableNetwork(context);
	});
	await startQuestions(ipad);
	await tapStop(ipad.page, 2);

	await network?.down();
	await expect(ipad.page.getByText("再接続しています")).toBeVisible({ timeout: 25_000 });
	await expect(ipad.page.getByRole("button", { name: "次へ" })).toBeDisabled();
	// 通信断の間にほかの端末から状態が変わる。
	await harness.admin.page.getByRole("button", { name: "強制リセット" }).click();
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");

	await network?.up();
	await expect(ipad.page.getByText("再接続しています")).toHaveCount(0, { timeout: 30_000 });
	await expect(ipad.page.getByRole("button", { name: "診断をはじめる" })).toBeVisible();
	await expect(harness.admin.page.getByTestId("device-controller")).toContainText("接続中");

	await display.context.close();
	await ipad.context.close();
	await harness.close();
});

test("切断した展示ディスプレイは管理画面で切断表示になり、再接続すると接続中へ戻る", async ({ browser }) => {
	test.setTimeout(120_000);
	const harness = await ExhibitHarness.open(browser);
	let network: Awaited<ReturnType<typeof controllableNetwork>> | undefined;
	const display = await harness.pair("display", {}, async (context) => {
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
	const [display] = await harness.pairDisplays(1);
	const ipad = await harness.pair("controller");
	await answerAll(ipad);
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "result");
	await ipad.page.waitForTimeout(55_000);
	await expect(ipad.page.getByText("あなたの色は")).toBeVisible();
	await expect(ipad.page.getByRole("button", { name: "診断をはじめる" })).toBeVisible({ timeout: 10_000 });
	await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");
	await display.context.close();
	await ipad.context.close();
	await harness.close();
});

test("結果写真を読み込めない画面は開始時刻を遅らせずタイポグラフィを表示する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const code = await harness.issueCode("display");
	const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
	// display-1 に割り当てられる各色の写真の取得を失敗させる。
	const assigned = COLOR_IDS.flatMap((colorId) => resultPhotoFor(PHOTOS, colorId, 0)?.id ?? []);
	await context.route(new RegExp(`/photos/(${assigned.join("|")})\\.(avif|jpg)$`), (route) => route.abort());
	await context.request.post("/api/pair", { data: { code } });
	const page = await context.newPage();
	await page.goto("/display/display-1");
	const other = await harness.pair("display");
	await expect(harness.admin.page.getByTestId("device-display-1")).toContainText("失敗", { timeout: 15_000 });
	await expect(harness.admin.page.getByTestId("device-display-2")).toContainText("準備完了");

	const ipad = await harness.pair("controller");
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
	// 写真のない画面も同じ結果開始時刻で計測される。
	await expect(harness.admin.page.getByTestId("sync-spread")).not.toHaveText("—");
	const spread = Number((await harness.admin.page.getByTestId("sync-spread").innerText()).replace("ms", ""));
	expect(spread).toBeLessThanOrEqual(200);

	await context.close();
	await other.context.close();
	await ipad.context.close();
	await harness.close();
});

test("QRコード生成失敗の通知は結果と60秒タイマーを止めず、管理画面に qrGenerationFailed を表示する", async ({
	browser,
}) => {
	const harness = await ExhibitHarness.open(browser);
	const ipad = await harness.pair("controller");
	await answerAll(ipad);
	// iPadの端末セッションで、10.4節の diagnostic をそのまま送る。
	const sent = await ipad.page.evaluate(async () => {
		const state = await new Promise<{ sessionId: string; resultColorId: string }>((resolve) => {
			const socket = new WebSocket(`ws://${location.host}/api/realtime?role=controller`);
			socket.addEventListener("open", () =>
				socket.send(
					JSON.stringify({
						version: 1,
						type: "hello",
						clientId: localStorage.getItem("dpc-client-id:controller"),
					}),
				),
			);
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.type === "welcome") {
					socket.send(
						JSON.stringify({
							version: 1,
							type: "diagnostic",
							requestId: crypto.randomUUID(),
							name: "qrGenerationFailed",
							sessionId: message.state.sessionId,
							colorId: message.state.resultColorId,
							occurredAt: Date.now(),
						}),
					);
				}
				if (message.type === "ack") resolve(message);
			});
		});
		return state;
	});
	expect(sent).toMatchObject({ type: "ack" });
	await expect(harness.admin.page.getByTestId("alert")).toContainText("qrGenerationFailed");
	await expect(harness.admin.page.getByTestId("phase")).toContainText("result");
	await ipad.context.close();
	await harness.close();
});

function hexToRgb(hex: string): string {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
