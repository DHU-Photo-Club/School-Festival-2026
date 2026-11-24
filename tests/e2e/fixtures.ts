import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { splitAt } from "../../src/client/controller/split.ts";
import { PHOTO_POLICY } from "../../src/data/ai.ts";
import { PALETTE } from "../../src/data/palette.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { resultPhotoFor } from "../../src/shared/assignment.ts";
import { backgroundColor, foregroundColor, paletteColor } from "../../src/shared/palette.ts";
import { selectPhotos } from "../../src/shared/photo-selection.ts";
import type { PaletteColor, PaletteId, Question, ScreenRole } from "../../src/shared/types.ts";
import { MAP_SIZE } from "../../src/shared/types.ts";
import { STUB_COLORS, STUB_NAME } from "../../src/worker/ai/judge.ts";

/**
 * E2Eテストの開発サーバーは `AI_STUB=1` で動く（vite.config.ts）。AIへ接続せず、決まった色名と二色、
 * 色の適合だけで選んだ写真を返す（src/worker/ai/judge.ts の `createStubJudge`）。
 */
export const STUB_RESULT = {
	name: STUB_NAME,
	colors: STUB_COLORS,
	photoIds: selectPhotos({
		photos: PHOTOS,
		colors: STUB_COLORS,
		contentMatches: null,
		count: PHOTO_POLICY.sessionPhotoCount,
		policyVersion: PHOTO_POLICY.version,
	}).selected.map((pick) => pick.photoId),
};

/** パレットの色。 */
export function palette(id: PaletteId): PaletteColor {
	const color = paletteColor(PALETTE.colors, id);
	if (!color) throw new Error(`パレットに ${id} がありません`);
	return color;
}

/** 画面 `displayOrder` が仮の結果で見せる色（二色を画面の順に交互に割り当てる）。 */
export const stubScreenColor = (displayOrder: number) => palette(STUB_COLORS[displayOrder % 2]);

/** canvasの画素と比べられる形（大文字の `#RRGGBB`）の背景色。 */
export const backgroundHex = (color: PaletteColor) => backgroundColor(color).toUpperCase();

/** CSSの計算値と比べられる形（`rgb(r, g, b)`）の文字色。 */
export function foregroundRgb(color: PaletteColor): string {
	const n = Number.parseInt(foregroundColor(color).slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

export interface Device {
	context: BrowserContext;
	page: Page;
}

export const DISPLAY_VIEWPORT = { width: 1920, height: 1080 };
export const IPAD_VIEWPORT = { width: 820, height: 1180 };

/** 管理画面を開き、展示を初期状態へ戻してから端末の画面を開く。 */
export class ExhibitHarness {
	/** 次に開く展示ディスプレイと写真用の画面番号。 */
	private readonly nextScreen = { display: 1, photo: 1 };

	private constructor(
		readonly browser: Browser,
		readonly admin: Device,
	) {}

	static async open(browser: Browser): Promise<ExhibitHarness> {
		const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
		const page = await context.newPage();
		await page.goto("/admin");
		await expect(page.getByText("サーバー接続中")).toBeVisible();
		const harness = new ExhibitHarness(browser, { context, page });
		await harness.reset();
		return harness;
	}

	/** 受付を再開し、強制リセットする。 */
	async reset(): Promise<void> {
		const { page } = this.admin;
		await page.getByRole("button", { name: "強制リセット" }).click();
		await expect(page.getByTestId("phase")).toContainText("idle");
		const resume = page.getByRole("button", { name: "受付を再開" });
		if (await resume.isVisible()) await resume.click();
		await expect(page.getByRole("button", { name: "受付を停止" })).toBeVisible();
	}

	/**
	 * 新しいブラウザコンテキストで端末の画面を開く。展示ディスプレイと写真用には、開いた順に
	 * 1、2…の画面番号を使う。`beforeOpen` はページを開く前にコンテキストを設定するときに使う。
	 */
	async openDevice(
		role: "controller" | ScreenRole,
		options: BrowserContextOptions = {},
		beforeOpen?: (context: BrowserContext) => Promise<unknown>,
	): Promise<Device> {
		const context = await this.browser.newContext({
			viewport: role === "controller" ? IPAD_VIEWPORT : DISPLAY_VIEWPORT,
			...options,
		});
		await beforeOpen?.(context);
		const page = await context.newPage();
		if (role === "controller") {
			await page.goto("/");
		} else {
			await page.goto(`/${role}/${this.nextScreen[role]}`);
			this.nextScreen[role] += 1;
		}
		return { context, page };
	}

	async openDisplays(count: number, options: BrowserContextOptions = {}): Promise<Device[]> {
		const displays: Device[] = [];
		for (let index = 0; index < count; index += 1) {
			const display = await this.openDevice("display", options);
			await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");
			displays.push(display);
		}
		return displays;
	}

	async close(): Promise<void> {
		await this.admin.context.close();
	}
}

/**
 * 展示ディスプレイのcanvasを読む。展示ディスプレイはWebGLで描き、描画結果を保持する設定にしているため、
 * 2Dのcanvasへ写せば描画フレームの外からでも画素を読める。破片のcanvasは重ねて写す。`stride` 画素ごとに一つ読む。
 */
async function readCanvas(page: Page, x: number, y: number, w: number, h: number, stride: number): Promise<number[]> {
	return page.evaluate(
		([px, py, pw, ph, step]) => {
			const [source, ...overlays] = document.querySelectorAll<HTMLCanvasElement>("main.display canvas");
			const copy = document.createElement("canvas");
			copy.width = source.width;
			copy.height = source.height;
			const context = copy.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
			context.drawImage(source, 0, 0);
			for (const overlay of overlays) context.drawImage(overlay, 0, 0, copy.width, copy.height);
			const left = Math.min(copy.width - 1, Math.floor(copy.width * px));
			const top = Math.min(copy.height - 1, Math.floor(copy.height * py));
			const { data } = context.getImageData(
				left,
				top,
				Math.max(1, Math.floor(copy.width * pw)),
				Math.max(1, Math.floor(copy.height * ph)),
			);
			const samples: number[] = [];
			for (let i = 0; i < data.length; i += step * 4) samples.push(data[i], data[i + 1], data[i + 2]);
			return samples;
		},
		[x, y, w, h, stride] as const,
	);
}

/** 展示ディスプレイのcanvasの画素を読む。座標は0〜1の比率。 */
export async function canvasPixel(page: Page, x: number, y: number): Promise<string> {
	const [r, g, b] = await readCanvas(page, x, y, 0, 0, 1);
	return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** canvasに背景 `#0B0B0B` 以外の色が描かれているか。 */
export async function canvasHasGraphics(page: Page): Promise<boolean> {
	const samples = await readCanvas(page, 0, 0, 1, 1, 257);
	for (let i = 0; i < samples.length; i += 3) {
		if (samples[i] !== 0x0b || samples[i + 1] !== 0x0b || samples[i + 2] !== 0x0b) return true;
	}
	return false;
}

/** canvas全体の画素の要約（変化の検出に使う）。 */
export async function canvasDigest(page: Page): Promise<string> {
	const samples = await readCanvas(page, 0, 0, 1, 1, 1023);
	let hash = 0;
	for (const value of samples) hash = (hash * 31 + value) | 0;
	return String(hash);
}

/** 「はじめる」から全問に答え、結果が表示されるまで待つ。 */
export async function answerAllQuestions(page: Page): Promise<void> {
	await page.getByRole("button", { name: "はじめる" }).click();
	await enterNickname(page);
	for (const [index, question] of QUESTIONS.entries()) {
		await expectQuestion(page, index);
		await answerQuestion(page, question, index * 3);
		await page.getByRole("button", { name: "次へ" }).click();
	}
	await expect(page.getByText("あなたの色は")).toBeVisible({ timeout: 6_000 });
}

/** `intro` でニックネームを入力して質問へ進む。 */
export async function enterNickname(page: Page, nickname = "テスト"): Promise<void> {
	await page.getByRole("textbox", { name: "ニックネームを入力して下さい" }).fill(nickname);
	await page.getByRole("button", { name: "進む" }).click();
}

/** 質問 `index`（0始まり）を表示していることを、進捗バーで確かめる。 */
export async function expectQuestion(page: Page, index: number): Promise<void> {
	await expect(page.getByRole("progressbar")).toHaveAttribute(
		"aria-valuetext",
		`質問 ${index + 1} / ${QUESTIONS.length}`,
	);
}

/** iPadの質問画面で、スライダーの位置（0〜4）をタップする。 */
export async function tapStop(page: Page, index: number): Promise<void> {
	await tapSliderAt(page, index / 4);
}

/** iPadの質問画面で、スライダーの回答の位置 `ratio`（左端0から右端1）に当たる仕切り線の位置をタップする。 */
export async function tapSliderAt(page: Page, ratio: number): Promise<void> {
	const box = await page.locator(".slider .area").boundingBox();
	if (!box) throw new Error("slider not found");
	await page.mouse.click(box.x + box.width * splitAt(ratio), box.y + box.height / 2);
}

/** スライダーで選んでいる位置（0〜1）。未回答は `null`。 */
export async function sliderValue(page: Page): Promise<number | null> {
	const value = await page.locator(".slider .area").getAttribute("data-value");
	return value ? Number(value) : null;
}

/**
 * スライダーの回答の位置 `from` に当たる仕切り線の位置で押し、`to` に当たる位置まで動かす（左端0から右端1）。
 * 指を離す前に `whileDragging` を呼ぶ。
 */
export async function dragSlider(
	page: Page,
	from: number,
	to: number,
	whileDragging: () => Promise<void>,
): Promise<void> {
	const box = await page.locator(".slider .area").boundingBox();
	if (!box) throw new Error("slider not found");
	const at = (ratio: number) => box.x + box.width * splitAt(ratio);
	const y = box.y + box.height / 2;
	await page.mouse.move(at(from), y);
	await page.mouse.down();
	try {
		await page.mouse.move(at(to), y, { steps: 8 });
		await whileDragging();
	} finally {
		// 確認に失敗しても指を離し、後続の操作がドラッグ中のまま止まらないようにする。
		await page.mouse.up();
	}
}

/** iPadの質問画面で、2Dマップの区画（0〜8、上の行から左→右の順）の中心をタップする。 */
export async function tapCell(page: Page, index: number): Promise<void> {
	const [x, y] = await cellCenter(page, index);
	await page.mouse.click(x, y);
}

/** iPadの質問画面で、2Dマップの平面上の位置（左上0、右下1）をタップする。 */
export async function tapMapAt(page: Page, x: number, y: number): Promise<void> {
	const box = await page.locator(".map .area").boundingBox();
	if (!box) throw new Error("map not found");
	await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

/** 2Dマップで選んでいる位置。未回答は `null`。 */
export async function mapValue(page: Page): Promise<{ x: number; y: number } | null> {
	const area = page.locator(".map .area");
	const [x, y] = await Promise.all([area.getAttribute("data-x"), area.getAttribute("data-y")]);
	return x && y ? { x: Number(x), y: Number(y) } : null;
}

/** 2Dマップの区画の中心のページ座標。 */
async function cellCenter(page: Page, index: number): Promise<[number, number]> {
	const box = await page.locator(".map .area").boundingBox();
	if (!box) throw new Error("map not found");
	const column = index % MAP_SIZE;
	const row = Math.floor(index / MAP_SIZE);
	return [box.x + (box.width * (column + 0.5)) / MAP_SIZE, box.y + (box.height * (row + 0.5)) / MAP_SIZE];
}

/**
 * 2Dマップの区画 `from` で押し、区画 `to` まで動かす。指を離す前に `whileDragging` を呼ぶ。
 * 押してから離すまでの間はピンを動かしている状態になる。
 */
export async function dragCell(
	page: Page,
	from: number,
	to: number,
	whileDragging: () => Promise<void>,
): Promise<void> {
	const [startX, startY] = await cellCenter(page, from);
	const [endX, endY] = await cellCenter(page, to);
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	try {
		await page.mouse.move(endX, endY, { steps: 8 });
		await whileDragging();
	} finally {
		// 確認に失敗しても指を離し、後続の操作がドラッグ中のまま止まらないようにする。
		await page.mouse.up();
	}
}

/** 入力方式によらない回答入力の要素。`data-mode` で未回答、操作中、確定済みなどを表す。 */
export function answerInput(page: Page) {
	return page.locator("[data-answer-input]");
}

/** 単選択、複数選択、順位つき選択の選択肢。 */
export function choiceOption(page: Page, question: Question, index: number) {
	if (question.kind !== "single" && question.kind !== "multiple" && question.kind !== "ranked")
		throw new Error(`${question.id} は選択式ではありません`);
	return page.getByRole(question.kind === "single" ? "radio" : "checkbox", {
		name: question.options[index].label,
		exact: true,
	});
}

/**
 * 表示中の質問へ、入力方式に合わせて `variant` 番目の回答を入力する（「次へ」は押さない）。
 * 複数選択と順位つき選択は `variant` 番目の選択肢から順に、下限の個数だけ選ぶ（単独選択の選択肢は除く）。
 * 選択式は未回答の状態から呼ぶ。
 */
export async function answerQuestion(page: Page, question: Question, variant = 0): Promise<void> {
	switch (question.kind) {
		case "slider":
			return tapStop(page, variant % question.stops.length);
		case "map":
			return tapCell(page, variant % question.cells.length);
		case "single":
			return choiceOption(page, question, variant % question.options.length).click();
		case "multiple":
		case "ranked": {
			const choices = question.options.flatMap((option, index) => (option.exclusive ? [] : [index]));
			for (let offset = 0; offset < question.minSelections; offset += 1)
				await choiceOption(page, question, choices[(variant + offset) % choices.length]).click();
		}
	}
}

/** 展示ディスプレイが先に読み込む結果写真がすべて読み込まれるまで待つ。 */
export async function waitForResultPhotos(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() =>
				[...document.querySelectorAll<HTMLImageElement>(".photo[data-result-photo] img")].every(
					(image) => image.complete && image.naturalWidth > 0,
				),
			),
		)
		.toBe(true);
}

/** 選定した写真から決まる結果表示の種類。写真が足りない画面はタイポグラフィ。 */
export function expectedResultView(photoIds: readonly string[], displayOrder: number): "photo" | "typography" {
	return resultPhotoFor(PHOTOS, photoIds, displayOrder) ? "photo" : "typography";
}

/**
 * 端末のWebSocketをテストから中継し、通信断を再現する。`context.setOffline` は開いているWebSocketを
 * 確実には止めないため、中継でメッセージを止めて、切断のないまま応答が途絶える状態を作る。
 * ページを開く前に呼ぶ。
 */
export async function controllableNetwork(context: BrowserContext) {
	let offline = false;
	const mocked: { close: () => Promise<void> }[] = [];
	await context.routeWebSocket(/\/api\/realtime/, (ws) => {
		if (offline) {
			// 通信断中の再接続は届かない。サーバーへつながず、復旧時に閉じて再接続させる。
			mocked.push({ close: () => ws.close({ code: 1001, reason: "network restored" }) });
			return;
		}
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			if (!offline) server.send(message);
		});
		server.onMessage((message) => {
			if (!offline) ws.send(message);
		});
		// 通信断中に閉じた接続は、相手側へ伝わらない。サーバーには古い接続が残り、受信が途絶えた状態になる。
		ws.onClose((code, reason) => {
			if (!offline) server.close({ code, reason });
		});
		server.onClose((code, reason) => {
			if (!offline) ws.close({ code, reason });
		});
	});
	return {
		async down() {
			offline = true;
		},
		async up() {
			offline = false;
			for (const socket of mocked.splice(0)) await socket.close();
		},
	};
}
