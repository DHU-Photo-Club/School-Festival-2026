import { expect, test } from '@playwright/test';

for (const [path, label] of [
  ['/', '診断用iPad'],
  ['/display/display-1', '展示ディスプレイ 1'],
  ['/display/display-2', '展示ディスプレイ 2'],
  ['/admin', '運営管理'],
]) {
  test(`${path} のタイトルに端末・画面の識別を表示する`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveTitle(`${label} | あなた色写真展`);
  });
}
