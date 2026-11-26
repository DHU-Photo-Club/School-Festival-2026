import { expect, test } from "@playwright/test";
import { PALETTE } from "../../src/data/palette.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { idlePlaylist } from "../../src/shared/assignment.ts";
import { IDLE_FRAME_MS } from "../../src/shared/motion.ts";
import { answerQuestion, ExhibitHarness, enterNickname, expectQuestion } from "./fixtures.ts";

const playlist = idlePlaylist(PHOTOS);

test("写真用は診断中も8秒周期で写真を繰り返し表示する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const { context, page } = await harness.openDevice("photo", { reducedMotion: "reduce" }, (context) =>
		context.clock.install(),
	);
	try {
		await expect(page).toHaveTitle("写真用 1 | あなた色写真展");
		const main = page.locator("main.photo-display");
		const shown = page.locator(".photo.visible img");
		await expect(main).toHaveAttribute("data-photo-id", playlist[0].id);
		await expect(shown).toHaveAttribute("data-photo-id", playlist[0].id);
		await expect(harness.admin.page.getByTestId("device-photo-1")).toContainText("接続中");
		await expect(harness.admin.page.locator('[data-testid^="device-display-"]')).toHaveCount(0);
		await page.clock.pauseAt(new Date());

		const preview = harness.admin.page.getByRole("button", { name: PALETTE.colors[0].name, exact: true });
		await preview.click({ timeout: 10_000 });
		await expect(preview).toHaveAttribute("aria-pressed", "true");
		await expect(main).toHaveAttribute("data-photo-id", playlist[0].id);
		const controller = await harness.openDevice("controller");
		try {
			await controller.page.getByRole("button", { name: "はじめる" }).click();
			await enterNickname(controller.page);
			for (const [index, question] of QUESTIONS.entries()) {
				// 質問の入れ替えの間は入力が操作を受け付けないため、入れ替えが終わるまで待つ。
				await expectQuestion(controller.page, index);
				await expect(controller.page.getByRole("heading", { name: question.prompt })).toBeVisible();
				await answerQuestion(controller.page, question, index);
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

test("写真用は画面番号ごとにずらした写真から始める", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const first = await harness.openDevice("photo");
	const second = await harness.openDevice("photo");
	try {
		await expect(first.page.locator("main.photo-display")).toHaveAttribute("data-photo-id", playlist[0].id);
		await expect(second.page.locator("main.photo-display")).toHaveAttribute("data-photo-id", playlist[1].id);
		await expect(harness.admin.page.getByTestId("device-photo-1")).toContainText("接続中");
		await expect(harness.admin.page.getByTestId("device-photo-2")).toContainText("接続中");
	} finally {
		await first.context.close();
		await second.context.close();
		await harness.close();
	}
});

test("写真用でもAVIFの失敗時はJPEGを表示し、画像取得に失敗しても表示を継続する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const photo = await harness.openDevice("photo", {}, async (context) => {
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
