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

test("待機画面の見出しと開始ボタンは、折り返しても押し分けられる間隔を空ける", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const controller = await harness.openDevice("controller");
	const { page } = controller;
	try {
		const heading = page.locator("main h1");
		const start = page.getByRole("button", { name: "はじめる" });
		for (const viewport of [
			{ width: 1180, height: 820 },
			{ width: 820, height: 1180 },
			{ width: 390, height: 844 },
		]) {
			await page.setViewportSize(viewport);
			const box = await heading.boundingBox();
			const button = await start.boundingBox();
			expect(box).not.toBeNull();
			expect(button).not.toBeNull();
			// 見出しは画面幅によって折り返し、高さが変わる。上下端の実測値から間隔の下限だけを検証する。
			// 閾値は .top.welcome の下限 40px そのものではなく、指定が失われた場合を検出できる 32px とする。40px ちょうどは配置の端数で落ちうる。
			expect((button?.y ?? 0) - ((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(32);
			// ラベルと矢印を横に並べても、.primary-button の最小寸法を保つ。
			expect(button?.height ?? 0).toBeGreaterThanOrEqual(56);
			expect(button?.width ?? 0).toBeGreaterThanOrEqual(200);
			// 送信中の「準備しています」へ切り替えても、ボタンの幅と矢印の位置は変わらない。
			// 読み上げ名が変わるため role と名前の指定では見つけられなくなるので、クラスで指してラベルの文字だけを差し替える。
			const buttonElement = page.locator(".welcome-start");
			const idleWidth = button?.width ?? 0;
			const pendingWidth = await buttonElement.evaluate((element) => {
				const label = element.querySelector(".welcome-label");
				const previous = label?.textContent ?? "";
				if (label) label.textContent = "準備しています";
				const width = element.getBoundingClientRect().width;
				if (label) label.textContent = previous;
				return width;
			});
			expect(pendingWidth).toBeCloseTo(idleWidth, 1);
		}
	} finally {
		await controller.context.close();
		await harness.close();
	}
});

test("待機画面の「はじめる」は、押している間だけ縮小と矢印の移動で応答する", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const controller = await harness.openDevice("controller");
	const { page } = controller;
	try {
		const start = page.getByRole("button", { name: "はじめる" });
		const arrow = start.locator(".welcome-arrow");
		const box = await start.boundingBox();
		expect(box).not.toBeNull();
		// 指で押している間の状態を、マウスの押下で再現する。
		await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
		await page.mouse.down();
		await expect(start).toHaveAttribute("data-pressed", "true");
		await expect(start).toHaveCSS("transform", "matrix(0.96, 0, 0, 0.96, 0, 0)");
		await expect(arrow).toHaveCSS("transform", "matrix(1, 0, 0, 1, 6, 0)");

		// マウスではボタンの外へずらすと、開始せずに押下の状態だけを解除する。
		await page.mouse.move(12, 12);
		await expect(start).toHaveAttribute("data-pressed", "false");
		await expect(start).toHaveCSS("transform", "none");
		await expect(arrow).toHaveCSS("transform", "none");

		await page.mouse.up();
		await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
		await expect(start).toBeVisible();
	} finally {
		await controller.context.close();
		await harness.close();
	}
});

test("待機画面から離れると「はじめる」の押下の表示は残らない", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const controller = await harness.openDevice("controller");
	const { page } = controller;
	const admin = harness.admin.page;
	try {
		const start = page.locator(".welcome-start");
		const box = await start.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move((box?.x ?? 0) + 50, (box?.y ?? 0) + 20);
		await page.mouse.down();
		await expect(start).toHaveAttribute("data-pressed", "true");

		// 押したまま受付を止めると、ボタンが消えて `pointerup` が届かない。
		await admin.getByRole("button", { name: "受付を停止" }).click();
		await expect(start).toHaveCount(0);
		await admin.getByRole("button", { name: "受付を再開" }).click();
		await expect(start).toHaveAttribute("data-pressed", "false");
		await expect(start).toHaveCSS("transform", "none");
	} finally {
		await controller.context.close();
		await harness.close();
	}
});

test("縮小の動きを減らす設定では、押下の状態を時間をかけずに切り替える", async ({ browser }) => {
	const harness = await ExhibitHarness.open(browser);
	const controller = await harness.openDevice("controller", { reducedMotion: "reduce" });
	const { page } = controller;
	try {
		const start = page.getByRole("button", { name: "はじめる" });
		await expect(start).toHaveCSS("transition-duration", "0s");
		const box = await start.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
		await page.mouse.down();
		await expect(start).toHaveCSS("transform", "matrix(0.96, 0, 0, 0.96, 0, 0)");
		await expect(start.locator(".welcome-arrow")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 6, 0)");
		await page.mouse.move(12, 12);
		await expect(start).toHaveCSS("transform", "none");
	} finally {
		await controller.context.close();
		await harness.close();
	}
});
