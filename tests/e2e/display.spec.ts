import { expect, test } from '@playwright/test';
import { RESULT_COLORS } from '../../src/data/colors.ts';
import { QUESTIONS } from '../../src/data/questions.ts';
import { canvasDigest, canvasHasGraphics, canvasPixel, ExhibitHarness, expectedResultView, tapStop } from './fixtures.ts';
import type { Device } from './fixtures.ts';

/** 現在枠の待機写真のIDと不透明度。 */
async function currentIdle(device: Device) {
  return device.page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>('[data-slot="current"]');
    return {
      id: slot?.querySelector('img')?.dataset.photoId ?? null,
      opacity: Number(slot?.style.opacity ?? 'NaN'),
    };
  });
}

/** 待機枠の先頭からの経過時間（ms）。展示画面の補正済み時刻ではなく、管理画面と同じサーバー時刻の近似。 */
async function waitForFramePosition(device: Device, from: number, to: number) {
  await expect
    .poll(
      async () => {
        const { opacity } = await currentIdle(device);
        return opacity > from && opacity < to;
      },
      { timeout: 12_000, intervals: [20] },
    )
    .toBe(true);
}

test('待機写真は8秒ごとに進み、先頭1秒だけクロスフェードし、同じ写真を複数画面へ表示しない', async ({ browser }) => {
  test.setTimeout(90_000);
  const harness = await ExhibitHarness.open(browser);
  const displays = await harness.pairDisplays(3);
  await expect.poll(async () => (await currentIdle(displays[0])).opacity).toBe(1);

  const ids = await Promise.all(displays.map(async (display) => (await currentIdle(display)).id));
  expect(new Set(ids).size).toBe(3);

  // クロスフェード中（不透明度が0と1の間）を観測し、その後は1で止まる。
  await waitForFramePosition(displays[0], 0.05, 0.95);
  const fadingId = (await currentIdle(displays[0])).id;
  expect(fadingId).not.toBe(ids[0]);
  await expect.poll(async () => (await currentIdle(displays[0])).opacity, { timeout: 2_000 }).toBe(1);
  // 次の切り替えまで同じ写真のまま（8秒枠）。
  await displays[0].page.waitForTimeout(5_000);
  expect((await currentIdle(displays[0])).id).toBe(fadingId);

  const later = await Promise.all(displays.map(async (display) => (await currentIdle(display)).id));
  expect(new Set(later).size).toBe(3);
  // 画面ごとにプレイリストを1つずつずらして表示する。
  expect(later[1]).toBe(ids[2]);

  for (const display of displays) await display.context.close();
  await harness.close();
});

test('reduced-motion の待機表示はクロスフェードせず即時に切り替える', async ({ browser }) => {
  test.setTimeout(60_000);
  const harness = await ExhibitHarness.open(browser);
  const [display] = await harness.pairDisplays(1, { reducedMotion: 'reduce' });
  const first = (await currentIdle(display)).id;
  await expect
    .poll(async () => (await currentIdle(display)).id, { timeout: 12_000, intervals: [20] })
    .not.toBe(first);
  for (let i = 0; i < 10; i += 1) {
    expect((await currentIdle(display)).opacity).toBe(1);
    await display.page.waitForTimeout(50);
  }
  await display.context.close();
  await harness.close();
});

test('管理画面の表示確認で全画面が結果色の完了状態を表示し、終了で待機へ戻る', async ({ browser }) => {
  const harness = await ExhibitHarness.open(browser);
  const displays = await harness.pairDisplays(3);
  for (const display of ['display-1', 'display-2', 'display-3']) {
    await expect(harness.admin.page.getByTestId(`device-${display}`)).toContainText('準備完了', { timeout: 15_000 });
  }
  const violet = RESULT_COLORS.find((color) => color.id === 'violet');
  await harness.admin.page.getByRole('button', { name: violet?.name }).click();
  for (const [displayOrder, display] of displays.entries()) {
    await expect(display.page.locator('main.display')).toHaveAttribute('data-result-color', 'violet');
    await expect.poll(() => canvasPixel(display.page, 0.5, 0.01)).toBe(violet?.backgroundColor);
    await expect(display.page.locator('main.display')).toHaveAttribute('data-result-view', expectedResultView('violet', displayOrder));
  }
  await harness.admin.page.getByRole('button', { name: '表示確認を終了' }).click();
  for (const display of displays) {
    await expect.poll(() => canvasPixel(display.page, 0.5, 0.01)).toBe('#0B0B0B');
  }
  for (const display of displays) await display.context.close();
  await harness.close();
});

test('reduced-motion でも全状態が色面の切り替えと静止した構図で成立する', async ({ browser }) => {
  test.setTimeout(120_000);
  const harness = await ExhibitHarness.open(browser);
  const displays = await harness.pairDisplays(3, { reducedMotion: 'reduce' });
  const ipad = await harness.pair('controller', { reducedMotion: 'reduce' });
  const { page } = ipad;
  await page.getByRole('button', { name: '診断をはじめる' }).click();
  await page.getByRole('button', { name: '進む' }).click();

  // 質問: 破片は静止して表示される。
  // 属性は状態の受信で、canvas は次の描画フレームで変わるため、描画を待ってから比べる。
  await expect(displays[0].page.locator('main.display')).toHaveAttribute('data-phase', 'question');
  await expect.poll(() => canvasHasGraphics(displays[0].page)).toBe(true);
  await expect.poll(() => canvasHasGraphics(displays[1].page)).toBe(true);
  const still = await canvasDigest(displays[0].page);
  await displays[0].page.waitForTimeout(1_000);
  expect(await canvasDigest(displays[0].page)).toBe(still);
  // 画面ごとに破片の色の区画がずれて見える。
  expect(await canvasDigest(displays[1].page)).not.toBe(still);

  for (let index = 0; index < QUESTIONS.length; index += 1) {
    await expect(page.getByText(`${index + 1} / ${QUESTIONS.length}`)).toBeVisible();
    await tapStop(page, 2);
    const before = await canvasDigest(displays[0].page);
    await page.getByRole('button', { name: '次へ' }).click();
    if (index < QUESTIONS.length - 1) {
      // 一問確定すると、破片の色を一区画回した構図へ即時に切り替わり、その後は静止する。
      await expect.poll(() => canvasDigest(displays[0].page), { timeout: 1_000 }).not.toBe(before);
      const after = await canvasDigest(displays[0].page);
      await displays[0].page.waitForTimeout(500);
      expect(await canvasDigest(displays[0].page)).toBe(after);
    }
  }

  // 判定: 即時に黒（判定は2秒なので、その間に黒になることを確かめる）。
  await expect.poll(() => canvasPixel(displays[0].page, 0.5, 0.5), { timeout: 1_800, intervals: [20] }).toBe('#000000');
  const name = await page.locator('.color-name').innerText({ timeout: 5_000 });
  const color = RESULT_COLORS.find((candidate) => candidate.name === name);

  // 結果: 基準色の全面から完了状態へ一回だけ切り替わる。
  for (const [displayOrder, display] of displays.entries()) {
    await expect.poll(() => canvasPixel(display.page, 0.5, 0.01), { timeout: 5_000 }).toBe(color?.backgroundColor);
    await expect(display.page.locator('main.display')).toHaveAttribute(
      'data-result-view',
      expectedResultView(color?.id ?? 'red', displayOrder),
    );
  }
  await page.getByRole('button', { name: '最初に戻る' }).click();
  for (const display of displays) await expect(display.page.locator('main.display')).toHaveAttribute('data-phase', 'idle');

  for (const device of [...displays, ipad]) await device.context.close();
  await harness.close();
});

test('「次へ」のタップから確定待ちの表示まで', async ({ browser }) => {
  const harness = await ExhibitHarness.open(browser);
  const ipad = await harness.pair('controller');
  const { page } = ipad;
  await page.getByRole('button', { name: '診断をはじめる' }).click();
  await page.getByRole('button', { name: '進む' }).click();
  const timings: number[] = [];
  let current = 0;
  for (let round = 0; round < 20; round += 1) {
    await expect(page.getByText(`${current + 1} / ${QUESTIONS.length}`)).toBeVisible();
    await tapStop(page, round % 5);
    const box = await page.getByRole('button', { name: '次へ' }).boundingBox();
    if (!box) throw new Error('button not found');
    // pointerup から確定待ちを描画した最初の requestAnimationFrame まで（仕様書13章）。
    await page.evaluate(() => {
      const target = window as unknown as { pendingTiming: Promise<number> };
      target.pendingTiming = new Promise<number>((resolve) => {
        addEventListener(
          'pointerup',
          () => {
            const start = performance.now();
            const observer = new MutationObserver(() => {
              if (!document.querySelector('.slider[data-mode="pending"]')) return;
              observer.disconnect();
              requestAnimationFrame(() => resolve(performance.now() - start));
            });
            observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-mode'] });
          },
          { once: true, capture: true },
        );
      });
    });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const measure = page.evaluate(() => (window as unknown as { pendingTiming: Promise<number> }).pendingTiming);
    timings.push(await measure);
    current += 1;
    await expect(page.getByText(`${current + 1} / ${QUESTIONS.length}`)).toBeVisible();
    if (current === QUESTIONS.length - 1) {
      // 最終問は送らず、最初の質問まで戻って同じセッションで測定を続ける。
      while (current > 0) {
        await page.getByRole('button', { name: '戻る' }).click();
        current -= 1;
        await expect(page.getByText(`${current + 1} / ${QUESTIONS.length}`)).toBeVisible();
      }
    }
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
  console.log(`pending表示まで: p95=${p95.toFixed(1)}ms max=${timings.at(-1)?.toFixed(1)}ms`);
  expect(p95).toBeLessThanOrEqual(100);
  expect(timings.at(-1)).toBeLessThanOrEqual(150);
  await ipad.context.close();
  await harness.close();
});

test('登録した台数の展示ディスプレイで動き、台数は登録しただけ増える', async ({ browser }) => {
  test.setTimeout(120_000);
  const harness = await ExhibitHarness.open(browser);
  await expect(harness.admin.page.getByTestId('display-count')).toContainText('0 台');
  const displays = await harness.pairDisplays(5, { viewport: { width: 960, height: 540 } });
  await expect(harness.admin.page.getByTestId('display-count')).toContainText('5 台');
  for (let index = 1; index <= 5; index += 1) {
    await expect(harness.admin.page.getByTestId(`device-display-${index}`)).toContainText('接続中');
  }
  // 5画面すべてが別々の待機写真を表示する。
  await expect.poll(async () => (await currentIdle(displays[4])).opacity).toBe(1);
  const ids = await Promise.all(displays.map(async (display) => (await currentIdle(display)).id));
  expect(new Set(ids).size).toBe(5);
  for (const display of displays) await display.context.close();
  await harness.close();
});
