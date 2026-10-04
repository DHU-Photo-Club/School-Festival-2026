import { expect, test } from '@playwright/test';
import { RESULT_COLORS } from '../../src/data/colors.ts';
import { PHOTOS } from '../../src/data/photos.ts';

for (const color of RESULT_COLORS) {
  test(`結果ページ ${color.id}: 色名、色面、メッセージ、代表画像とクレジットを表示する`, async ({ page }) => {
    const response = await page.goto(`/result/${color.id}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toBe('no-store');
    await expect(page.getByRole('heading', { name: color.name })).toBeVisible();
    await expect(page.getByText(color.message)).toBeVisible();
    const photo = PHOTOS.find((candidate) => candidate.id === color.representativePhotoId);
    await expect(page.locator(`img[data-photo-id="${color.representativePhotoId}"]`)).toBeVisible();
    await expect(page.locator('figcaption')).toHaveText(`© ${photo?.creditName}`);
    await expect(page.getByText('あなた色写真展')).toBeVisible();
  });
}

test('未定義の colorId は404', async ({ request }) => {
  for (const path of ['/result/pink', '/result/', '/result/red/extra']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
});

test('.avif の取得を失敗させると、写真要素の currentSrc が対応する .jpg になり同じ写真を表示する', async ({ page }) => {
  await page.route('**/*.avif', (route) => route.abort());
  await page.goto('/result/green');
  const image = page.locator('img[data-photo-id="kari-green-01"]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.currentSrc)).toMatch(/\/photos\/kari-green-01\.jpg$/);
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
});

test('代表画像を読み込めない場合は色面とメッセージを表示し、画像枠とクレジットを隠す', async ({ page }) => {
  await page.route(/\/photos\/kari-blue-01\.(avif|jpg)$/, (route) => route.abort());
  await page.goto('/result/blue');
  await expect(page.getByRole('heading', { name: 'コバルトブルー' })).toBeVisible();
  await expect(page.locator('figure')).toHaveCount(0);
  await expect(page.locator('figcaption')).toHaveCount(0);
});
