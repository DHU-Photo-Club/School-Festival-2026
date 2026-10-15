import { expect, test } from '@playwright/test';
import { RESULT_COLORS } from '../../src/data/colors.ts';
import { PHOTOS } from '../../src/data/photos.ts';
import { resultPhotoFor } from '../../src/shared/assignment.ts';
import { QUESTIONS } from '../../src/data/questions.ts';
import { canvasDigest, canvasPixel, ExhibitHarness, sliderValue, tapStop } from './fixtures.ts';
import type { Device } from './fixtures.ts';

const revisionOf = async (device: Device) => Number(await device.page.locator('main.display').getAttribute('data-revision'));

for (const displayCount of [1, 3]) {
  test(`展示${displayCount}画面: 開始から結果、最初に戻るまで`, async ({ browser }) => {
    test.setTimeout(240_000);
    const harness = await ExhibitHarness.open(browser);
    const displays = await harness.pairDisplays(displayCount);
    const ipad = await harness.pair('controller');
    const { page } = ipad;

    await page.getByRole('button', { name: '診断をはじめる' }).click();
    await page.getByRole('button', { name: '進む' }).click();
    await expect(page.getByText(`1 / ${QUESTIONS.length}`)).toBeVisible();
    for (const display of displays) await expect(display.page.locator('main.display')).toHaveAttribute('data-phase', 'question');

    for (const [index, question] of QUESTIONS.entries()) {
      await expect(page.getByText(`${index + 1} / ${QUESTIONS.length}`)).toBeVisible();
      await expect(page.getByRole('heading', { name: question.prompt })).toBeVisible();
      const next = page.getByRole('button', { name: '次へ' });
      // 初めて開いた質問では「次へ」が無効で、つまみは未回答の表示。
      await expect(next).toBeDisabled();
      await expect(page.locator('.slider')).toHaveAttribute('data-mode', 'unanswered');

      const before = await revisionOf(displays[0]);
      if (index === 0) {
        // トラックのタップで5位置すべてを選べ、スライダー操作だけでは revision が増えない。
        for (const stop of [0, 1, 2, 3, 4]) {
          await tapStop(page, stop);
          expect(await sliderValue(page)).toBe(String(stop));
          await expect(page.locator('.slider .caption')).toHaveText(question.stops[stop].caption);
        }
        await page.waitForTimeout(300);
        expect(await revisionOf(displays[0])).toBe(before);
      }
      await tapStop(page, index % 5);
      await expect(next).toBeEnabled();
      const digest = await canvasDigest(displays[0].page);
      await next.click();
      if (index < QUESTIONS.length - 1) {
        // 一問確定するたびに全画面の revision が増え、破片の色が回り始める。
        for (const display of displays) await expect.poll(() => revisionOf(display)).toBe(before + 1);
        await expect.poll(() => canvasDigest(displays[0].page), { timeout: 3_000 }).not.toBe(digest);
      }
      if (index === 1) {
        // 戻ると直前の位置が復元され、変更して再確定できる。
        await page.getByRole('button', { name: '戻る' }).click();
        await expect(page.getByText(`2 / ${QUESTIONS.length}`)).toBeVisible();
        expect(await sliderValue(page)).toBe('1');
        await expect(page.locator('.slider')).toHaveAttribute('data-mode', 'answered');
        await tapStop(page, 3);
        await page.getByRole('button', { name: '次へ' }).click();
        await expect(page.getByText(`3 / ${QUESTIONS.length}`)).toBeVisible();
      }
    }

    await expect(page.getByText('あなたの色を選んでいます')).toBeVisible();
    for (const display of displays) await expect(display.page.locator('main.display')).toHaveAttribute('data-phase', 'judging');

    // 全画面が同じ結果色へ切り替わる。
    await expect(page.getByText('あなたの色は')).toBeVisible({ timeout: 5_000 });
    const name = await page.locator('.color-name').innerText();
    const color = RESULT_COLORS.find((candidate) => candidate.name === name);
    expect(color).toBeDefined();
    for (const display of displays) {
      await expect(display.page.locator('main.display')).toHaveAttribute('data-result-color', color?.id ?? '');
    }
    await displays[0].page.waitForTimeout(4_500);
    const shown: string[] = [];
    for (const [displayOrder, display] of displays.entries()) {
      expect(await canvasPixel(display.page, 0.01, 0.01)).toBe(color?.backgroundColor);
      // 写真がある画面は写真、足りない画面は複製せずに色名のタイポグラフィ（仕様書7.2.4節）。
      const assigned = color ? resultPhotoFor(PHOTOS, color.id, displayOrder) : null;
      if (assigned) {
        await expect(display.page.locator('main.display')).toHaveAttribute('data-result-view', 'photo');
        const photo = display.page.locator(`.photo[data-result-color="${color?.id}"] img`);
        await expect(photo).toBeVisible();
        await expect(photo).toHaveAttribute('data-photo-id', assigned.id);
        shown.push(assigned.id);
      } else {
        await expect(display.page.locator('main.display')).toHaveAttribute('data-result-view', 'typography');
        await expect(display.page.locator('.color-name')).toHaveText(name);
      }
    }
    // 同じ写真を複数の画面へ割り当てない。
    expect(new Set(shown).size).toBe(shown.length);

    // 管理画面に同期差が表示される。
    await expect(harness.admin.page.getByTestId('sync-spread')).not.toHaveText('—');
    const spread = Number((await harness.admin.page.getByTestId('sync-spread').innerText()).replace('ms', ''));
    expect(spread).toBeLessThanOrEqual(200);

    // QRコードと結果URL。
    await expect(page.getByRole('img', { name: '結果ページのQRコード' })).toBeVisible();
    await expect(page.locator('.url')).toHaveText(new RegExp(`^https://.+/result/${color?.id}$`));

    // 結果表示中に再読み込みした画面は、演出を再生せず完了状態を表示する。
    await displays[0].page.reload();
    await expect(displays[0].page.locator('main.display')).toHaveAttribute('data-result-color', color?.id ?? '');
    expect(await canvasPixel(displays[0].page, 0.01, 0.01)).toBe(color?.backgroundColor);

    await page.getByRole('button', { name: '最初に戻る' }).click();
    await expect(page.getByRole('button', { name: '診断をはじめる' })).toBeVisible();
    for (const display of displays) await expect(display.page.locator('main.display')).toHaveAttribute('data-phase', 'idle');
    await expect(page.locator('.qr')).toHaveCount(0);

    for (const device of [...displays, ipad]) await device.context.close();
    await harness.close();
  });
}
