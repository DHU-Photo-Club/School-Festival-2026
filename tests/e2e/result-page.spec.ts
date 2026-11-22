import type { Browser } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { PHOTOS } from "../../src/data/photos.ts";
import { answerAllQuestions, ExhibitHarness, STUB_RESULT, stubScreenColor } from "./fixtures.ts";

/** 体験を一回行い、iPadに表示された結果ページのパス（`/result/{id}`）を返す。 */
async function createResult(browser: Browser): Promise<string> {
	const harness = await ExhibitHarness.open(browser);
	const ipad = await harness.openDevice("controller");
	try {
		await answerAllQuestions(ipad.page);
		const url = (await ipad.page.locator(".url").textContent()) ?? "";
		await ipad.page.getByRole("button", { name: "最初に戻る" }).click();
		return new URL(url).pathname;
	} finally {
		await ipad.context.close();
		await harness.close();
	}
}

/** 結果に選ばれた写真のうち、配布を許可した写真。 */
const sharedPhotos = STUB_RESULT.photoIds
	.map((id) => PHOTOS.find((photo) => photo.id === id))
	.filter((photo) => photo?.shareAllowed);

let path = "";

test.beforeAll(async ({ browser }) => {
	test.setTimeout(120_000);
	path = await createResult(browser);
});

test("結果ページ: 保存した色名、二色、読み取り、配布を許可した写真とクレジットを表示する", async ({ page }) => {
	expect(path).toMatch(/^\/result\/[0-9a-f]{16}$/);
	const response = await page.goto(path);
	expect(response?.status()).toBe(200);
	expect(response?.headers()["cache-control"]).toBe("no-store");
	await expect(page.getByRole("heading", { name: STUB_RESULT.name })).toBeVisible();
	await expect(page.getByText(stubScreenColor(0).name, { exact: true })).toBeVisible();
	await expect(page.getByText(stubScreenColor(1).name, { exact: true })).toBeVisible();
	await expect(page.locator(".gradient")).toHaveCSS("background-image", /linear-gradient/);
	expect(sharedPhotos.length).toBeGreaterThan(0);
	await expect(page.locator("figure")).toHaveCount(sharedPhotos.length);
	for (const photo of sharedPhotos) await expect(page.locator(`img[data-photo-id="${photo?.id}"]`)).toBeVisible();
	// 配布を許可していない写真は、選ばれていても結果ページに出さない。
	for (const id of STUB_RESULT.photoIds.filter((id) => !sharedPhotos.some((photo) => photo?.id === id)))
		await expect(page.locator(`img[data-photo-id="${id}"]`)).toHaveCount(0);
	await expect(page.locator("figcaption").first()).toHaveText(`© ${sharedPhotos[0]?.creditName}`);
	await expect(page.getByText("あなた色写真展")).toBeVisible();
});

test("結果ページのデータには回答と写真の根拠を含めない", async ({ request }) => {
	const response = await request.get(`${path}/data`);
	expect(response.status()).toBe(200);
	const body = await response.json();
	expect(body).toMatchObject({ name: STUB_RESULT.name, colors: [{ id: "emerald" }, { id: "amber" }] });
	expect(body).not.toHaveProperty("answers");
	expect(JSON.stringify(body)).not.toContain("tier");
});

test("形式の合わないIDと、保存されていないIDは404", async ({ request }) => {
	for (const target of ["/result/red", "/result/", "/result/0123456789abcdef", `${path}/extra`]) {
		const response = await request.get(target);
		expect(response.status(), target).toBe(404);
	}
});

test(".avif の取得を失敗させると、写真要素の currentSrc が対応する .jpg になり同じ写真を表示する", async ({ page }) => {
	const id = sharedPhotos[0]?.id ?? "";
	await page.route("**/*.avif", (route) => route.abort());
	await page.goto(path);
	const image = page.locator(`img[data-photo-id="${id}"]`);
	await expect(image).toBeVisible();
	await expect
		.poll(() => image.evaluate((element: HTMLImageElement) => element.currentSrc))
		.toMatch(new RegExp(`/photos/${id}\\.jpg$`));
	expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
});

test("写真を読み込めない場合は色名と読み取りを表示し、その写真の枠とクレジットを隠す", async ({ page }) => {
	await page.route(/\/photos\/.+\.(avif|jpg)$/, (route) => route.abort());
	await page.goto(path);
	await expect(page.getByRole("heading", { name: STUB_RESULT.name })).toBeVisible();
	await expect(page.locator("figure")).toHaveCount(0);
	await expect(page.locator("figcaption")).toHaveCount(0);
});
