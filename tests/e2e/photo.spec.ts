import { expect, test } from "@playwright/test";
import { RESULT_COLORS } from "../../src/data/colors.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { idlePlaylist } from "../../src/shared/assignment.ts";
import { IDLE_FRAME_MS } from "../../src/shared/motion.ts";
import { ExhibitHarness, tapStop } from "./fixtures.ts";

const playlist = idlePlaylist(PHOTOS);

test("管理画面から写真用を登録し、診断中も8秒周期で写真を繰り返し表示する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const context = await browser.newContext({ reducedMotion: "reduce" });
	try {
		const pairing = harness.admin.page.getByRole("form", { name: "写真用のコード発行" });
		await pairing.getByRole("button", { name: "コードを発行" }).click();
		const code = await pairing.getByTestId("pairing-code").innerText();
		await expect(pairing.locator(".pairing-result")).toHaveText(code);
		const page = await context.newPage();
		await page.clock.install();
		await page.goto("/");
		await page.getByLabel("ペアリングコード").fill(code);
		await page.getByRole("button", { name: "登録する" }).click();
		await expect(page).toHaveURL(/\/photo\/photo-1$/);
		await expect(page).toHaveTitle("写真用 1 | あなた色写真展");
		const main = page.locator("main.photo-display");
		const shown = page.locator(".photo.visible img");
		await expect(main).toHaveAttribute("data-photo-id", playlist[0].id);
		await expect(shown).toHaveAttribute("data-photo-id", playlist[0].id);
		await expect(harness.admin.page.getByTestId("device-photo-1")).toContainText("接続中");
		await expect(harness.admin.page.getByTestId("display-count")).toContainText("0 台");
		await page.clock.pauseAt(new Date());

		const preview = harness.admin.page.getByRole("button", { name: RESULT_COLORS[0].name, exact: true });
		await preview.click({ timeout: 10_000 });
		await expect(preview).toHaveAttribute("aria-pressed", "true");
		await expect(main).toHaveAttribute("data-photo-id", playlist[0].id);
		const controller = await harness.pair("controller");
		try {
			await controller.page.getByRole("button", { name: "はじめる" }).click();
			await controller.page.getByRole("button", { name: "進む" }).click();
			for (const [index, question] of QUESTIONS.entries()) {
				await expect(controller.page.getByRole("heading", { name: question.prompt })).toBeVisible();
				await tapStop(controller.page, index % 5);
				await controller.page.getByRole("button", { name: "次へ" }).click();
			}
			await expect(harness.admin.page.getByTestId("phase")).toContainText("result");
			await expect(main).toHaveAttribute("data-photo-id", playlist[0].id);
			await page.clock.fastForward(IDLE_FRAME_MS);
			await expect(shown).toHaveAttribute("data-photo-id", playlist[1].id);
			await harness.admin.page.getByRole("button", { name: "強制リセット" }).click();
			await expect(harness.admin.page.getByTestId("phase")).toContainText("idle");
			await expect(main).toHaveAttribute("data-photo-id", playlist[1].id);
			for (let index = 2; index <= playlist.length; index += 1) {
				await page.clock.fastForward(IDLE_FRAME_MS);
				await expect(shown).toHaveAttribute("data-photo-id", playlist[index % playlist.length].id);
			}
			await expect(page.locator(".photo")).toHaveCount(Math.min(3, playlist.length));
		} finally {
			await controller.context.close();
		}
	} finally {
		await context.close();
		await harness.close();
	}
});

test("写真用は個別の画面IDを持ち、トップから戻れ、失効すると登録画面に戻る", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const first = await harness.pair("photo");
	const second = await harness.pair("photo");
	try {
		await expect(first.page).toHaveURL(/\/photo\/photo-1$/);
		await expect(second.page).toHaveURL(/\/photo\/photo-2$/);
		await expect(second.page.locator("main.photo-display")).toHaveAttribute("data-photo-id", playlist[1].id);
		await first.page.goto("/");
		await expect(first.page).toHaveURL(/\/photo\/photo-1$/);
		await expect(first.page.locator(".photo.visible img")).toBeVisible();
		await expect(harness.admin.page.getByTestId("device-photo-1")).toContainText("接続中");
		const response = await harness.admin.context.request.get("/api/admin/sessions");
		const { sessions } = (await response.json()) as { sessions: { id: string; screenId: string }[] };
		const session = sessions.find((entry) => entry.screenId === "photo-1")!;
		const row = harness.admin.page.getByTestId(`session-${session.id}`);
		await expect(row).toBeVisible();
		await row.getByRole("button", { name: "失効" }).click();
		await expect(first.page.getByRole("heading", { name: "端末の登録" })).toBeVisible();
		await expect(first.page.locator("main.photo-display")).toHaveCount(0);
		await expect(second.page.locator("main.photo-display")).toBeVisible();
		expect((await harness.admin.context.request.delete(`/api/admin/sessions/${session.id}`)).status()).toBe(404);
	} finally {
		await first.context.close();
		await second.context.close();
		await harness.close();
	}
});

test("写真用の画面ID・役割が一致しない場合は再登録を求める", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const photo = await harness.pair("photo");
	try {
		await photo.page.goto("/photo/photo-2");
		await expect(photo.page.getByText("この画面は再登録が必要です。")).toBeVisible();
		await expect(photo.page.locator("main.photo-display")).toHaveCount(0);
		await photo.page.goto("/display/display-1");
		await expect(photo.page.getByText("この画面は再登録が必要です。")).toBeVisible();
		await photo.page.goto("/photo/photo-0");
		await expect(photo.page.getByText("この画面は再登録が必要です。")).toBeVisible();
	} finally {
		await photo.context.close();
		await harness.close();
	}
});

test("写真用でもAVIFの失敗時はJPEGを表示し、画像取得に失敗しても表示を継続する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const photo = await harness.pair("photo", {}, async (context) => {
		await context.route("**/photos/*.avif", (route) => route.abort());
		await context.route(`**/photos/${playlist[0].id}.jpg`, (route) => route.abort());
	});
	try {
		await expect(photo.page.locator("main.photo-display > p")).toHaveCSS("opacity", "1");
		await photo.page.clock.install();
		await photo.page.clock.fastForward(IDLE_FRAME_MS);
		await expect(photo.page.locator(".photo.visible img")).toHaveAttribute("data-photo-id", playlist[1].id);
		await expect
			.poll(() =>
				photo.page.locator(".photo.visible img").evaluate((img) => (img as HTMLImageElement).currentSrc),
			)
			.toMatch(/\.jpg$/);
	} finally {
		await photo.context.close();
		await harness.close();
	}
});
