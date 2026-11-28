import type { Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { EXHIBIT } from "../../src/data/exhibit.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { resultPhotoOrder } from "../../src/shared/assignment.ts";
import { initialState } from "../../src/shared/machine.ts";
import { toDisplayState } from "../../src/shared/protocol.ts";
import type { DisplayState } from "../../src/shared/types.ts";
import { answerAllQuestions, ExhibitHarness, STUB_RESULT } from "./fixtures.ts";

test("写真用は待機中に展示タイトルを表示し、管理画面へ接続する", async ({ browser }) => {
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

test("診断結果の選定写真を重複なくランダム表示し、再読み込みで復元、リセットでタイトルへ戻る", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const controller = await harness.openDevice("controller");
	const first = await harness.openDevice("photo");
	const second = await harness.openDevice("photo");
	try {
		await answerAllQuestions(controller.page);
		const shown: string[] = [];
		for (const { page } of [first, second]) {
			await expect(page.locator(".photo.visible img")).toBeVisible();
			const id = await page.locator(".photo.visible img").getAttribute("data-photo-id");
			expect(STUB_RESULT.photoIds).toContain(id);
			shown.push(id!);
			await expect(page.locator("main.photo-display > p")).toHaveCount(0);
		}
		expect(new Set(shown).size).toBe(2);
		await first.page.reload();
		await expect(first.page.locator(".photo.visible img")).toHaveAttribute("data-photo-id", shown[0]);
		await harness.reset();
		for (const { page } of [first, second]) {
			await expect(page.locator("main.photo-display > p")).toHaveText(EXHIBIT.title);
			await expect(page.locator("img")).toHaveCount(0);
		}
	} finally {
		await controller.context.close();
		await first.context.close();
		await second.context.close();
		await harness.close();
	}
});

test("選定順位が後ろの追加写真も表示し、同じ診断の再読み込み・扉の操作では写真を変えない", async ({ page }) => {
	const ids = [...PHOTOS.slice(0, 2), ...PHOTOS.slice(12, 20)].map((photo) => photo.id);
	const state = selected("result", ids);
	const expected = resultPhotoOrder(ids, state.sessionId!)[0];
	// 従来の先頭2枚固定では表示できなかった、追加写真が選ばれるセッション。
	expect(ids.slice(2)).toContain(expected);
	const send = await mockPhoto(page, state);
	await expect(page.locator(".photo.visible img")).toHaveAttribute("data-photo-id", expected);
	await page.reload();
	await expect(page.locator(".photo.visible img")).toHaveAttribute("data-photo-id", expected);
	send({ ...state, doorOpenedAt: serverNow(), revision: state.revision + 1 });
	await expect(page.locator(".photo.visible img")).toHaveAttribute("data-photo-id", expected);
	const next = { ...state, sessionId: "next-photo-session" };
	send(next);
	await expect(page.locator(".photo.visible img")).toHaveAttribute(
		"data-photo-id", resultPhotoOrder(ids, next.sessionId)[0],
	);
});

// 端末とサーバーの時計を1分ずらし、補正された結果開始時刻と状態の更新を確認する。
const serverNow = () => Date.now() + 60_000;
const photoId = PHOTOS[0].id;
function selected(phase: "judging" | "result", photoIds = [photoId]): DisplayState {
	return {
		...toDisplayState(initialState(serverNow())),
		sessionId: "photo-timing-test",
		phase,
		phaseEndsAt: serverNow() + (phase === "judging" ? 2_000 : 60_000),
		result: { name: STUB_RESULT.name, colors: STUB_RESULT.colors, photoIds },
	};
}

async function mockPhoto(page: Page, initial: DisplayState) {
	let state = initial;
	let socket: WebSocketRoute;
	const send = () => socket.send(JSON.stringify({ type: "state", serverTime: serverNow(), state }));
	await page.routeWebSocket(/\/api\/realtime/, (ws) => {
		socket = ws;
		send();
		ws.onMessage((raw) => {
			const message = JSON.parse(String(raw));
			if (message.type === "ping") ws.send(JSON.stringify({ type: "pong", serverTime: serverNow(), clientSentAt: message.clientSentAt }));
		});
	});
	await page.goto("/photo/1");
	return (next: DisplayState) => {
		state = next;
		send();
	};
}

test("判定中は写真を先読みして隠し、補正済みの結果開始時刻に表示する", async ({ page }) => {
	// ページの起動時間を期限に含めないよう、接続後に判定状態を送る。
	const send = await mockPhoto(page, toDisplayState(initialState(serverNow())));
	send(selected("judging"));
	await expect(page.locator("img")).toHaveAttribute("data-photo-id", photoId);
	await expect.poll(() => page.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
	await expect(page.locator("img")).toBeHidden();
	await expect(page.locator("main.photo-display > p")).toHaveText(EXHIBIT.title);
	await expect(page.locator(".photo.visible img")).toBeVisible({ timeout: 4_000 });
	// resultへ進んでも消えず、自然な待機への復帰で写真を消す。
	send(selected("result"));
	await expect(page.locator(".photo.visible img")).toBeVisible();
	send(toDisplayState(initialState(serverNow())));
	await expect(page.locator("img")).toHaveCount(0);
});

test("判定中のリセットで予約表示を取り消し、写真不足や不明IDはタイトルを表示する", async ({ page }) => {
	const send = await mockPhoto(page, selected("judging"));
	await expect(page.locator("img")).toHaveCount(1);
	send(toDisplayState(initialState(serverNow())));
	await expect(page.locator("img")).toHaveCount(0);
	await page.waitForTimeout(2_100);
	await expect(page.locator("main.photo-display > p")).toHaveText(EXHIBIT.title);
	for (const ids of [[], ["unknown-photo"]]) {
		send(selected("result", ids));
		await expect(page.locator("img")).toHaveCount(0);
		await expect(page.locator("main.photo-display > p")).toHaveText(EXHIBIT.title);
	}
});

test("AVIF失敗時はJPEGを表示し、両方失敗したらタイトルを表示する", async ({ page }) => {
	await page.route("**/photos/*.avif", (route) => route.abort());
	const send = await mockPhoto(page, selected("result"));
	await expect(page.locator(".photo.visible img")).toBeVisible();
	await expect.poll(() => page.locator("img").evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(`${photoId}.jpg`);
	await page.route("**/photos/*.jpg", (route) => route.abort());
	// 同じJPEGのデコード済みキャッシュを使わせず、別の写真で両形式の失敗を確認する。
	send({ ...selected("result", [PHOTOS[1].id]), sessionId: "failed-photo" });
	await expect(page.locator("main.photo-display > p")).toHaveText(EXHIBIT.title);
	await expect(page.locator(".photo.visible")).toHaveCount(0);
});
