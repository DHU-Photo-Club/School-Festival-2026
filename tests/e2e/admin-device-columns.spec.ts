import { expect, test } from '@playwright/test';
import { ExhibitHarness } from './fixtures.ts';

const groups = [
  { role: 'controller', label: '診断用iPad' },
  { role: 'display', label: '展示ディスプレイ' },
  { role: 'photo', label: '写真用' },
] as const;

test('端末一覧は種別ごとの3列で表示し、列ごとにスクロールし、狭い画面では縦に並べる', async ({ browser }) => {
  const harness = await ExhibitHarness.open(browser);
  const { page } = harness.admin;
  const unconnected = await browser.newContext();
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const { role, label } of groups) {
      const group = page.getByRole('group', { name: label, exact: true });
      await expect(group.getByRole('heading', { name: label, level: 3 })).toBeVisible();
      if (role !== 'controller') await expect(group).toContainText('登録済みの端末はありません。');
    }

    for (const role of ['display', 'photo'] as const) {
      for (let index = 0; index < 12; index += 1) {
        const code = await harness.issueCode(role);
        expect((await unconnected.request.post('/api/pair', { data: { code } })).status()).toBe(200);
      }
    }

    const controller = page.getByRole('group', { name: '診断用iPad', exact: true });
    const displays = page.getByRole('group', { name: '展示ディスプレイ', exact: true });
    const photos = page.getByRole('group', { name: '写真用', exact: true });
    await expect(controller.locator('.device-card')).toHaveCount(1);
    await expect(displays.locator('.device-card')).toHaveCount(12);
    await expect(photos.locator('.device-card')).toHaveCount(12);
    await expect(displays.getByTestId('device-display-1')).toContainText('最終受信');
    await expect(displays.getByTestId('device-display-1').locator('dt')).toHaveText(['最終受信', '準備', '時刻同期']);
    await expect(photos.getByTestId('device-photo-1')).toContainText('時刻同期');
    await expect(photos.getByTestId('device-photo-1')).toContainText('切断');
    await expect(controller.getByTestId('device-controller').locator('dt')).toHaveText(['最終受信', '準備', '時刻同期']);
    await expect(page.getByTestId('display-count')).toContainText('12 台');

    for (const width of [1920, 1280]) {
      await page.setViewportSize({ width, height: 1080 });
      const boxes = await Promise.all(groups.map(({ label }) => page.getByRole('group', { name: label, exact: true }).boundingBox()));
      expect(boxes.every((box) => box !== null)).toBe(true);
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
      expect(Math.abs(boxes[1]!.y - boxes[2]!.y)).toBeLessThan(1);
      expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x);
      expect(boxes[1]!.x + boxes[1]!.width).toBeLessThan(boxes[2]!.x);
      for (const group of [displays, photos]) {
        expect(await group.locator('.device-list').evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true);
      }
      expect(await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > window.innerWidth,
        vertical: document.documentElement.scrollHeight > window.innerHeight,
      }))).toEqual({ horizontal: false, vertical: false });
    }

    await displays.locator('.device-list').evaluate((list) => (list.scrollTop = list.scrollHeight));
    await expect(displays.getByTestId('device-display-12')).toBeInViewport({ ratio: 0.99 });
    expect(await photos.locator('.device-list').evaluate((list) => list.scrollTop)).toBe(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileBoxes = await Promise.all(groups.map(({ label }) => page.getByRole('group', { name: label, exact: true }).boundingBox()));
    expect(mobileBoxes[0]!.y + mobileBoxes[0]!.height).toBeLessThan(mobileBoxes[1]!.y);
    expect(mobileBoxes[1]!.y + mobileBoxes[1]!.height).toBeLessThan(mobileBoxes[2]!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await photos.getByTestId('device-photo-12').scrollIntoViewIfNeeded();
    await expect(photos.getByTestId('device-photo-12')).toBeInViewport({ ratio: 0.99 });
  } finally {
    await unconnected.close();
    await harness.close();
  }
});
