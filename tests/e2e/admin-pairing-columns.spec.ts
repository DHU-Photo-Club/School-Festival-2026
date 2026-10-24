import { expect, test } from '@playwright/test';
import { ExhibitHarness } from './fixtures.ts';

const devices = [
  { role: 'controller', label: '診断用iPad' },
  { role: 'display', label: '展示ディスプレイ' },
  { role: 'photo', label: '写真用' },
] as const;

test('コード発行は種別ごとの3列で表示し、各種別のコードを個別に保持して登録できる', async ({ browser }) => {
  const harness = await ExhibitHarness.open(browser);
  const { page } = harness.admin;
  const context = await browser.newContext();
  try {
    const codes = new Map<string, string>();
    for (const { role, label } of devices) {
      const form = page.getByRole('form', { name: `${label}のコード発行` });
      await expect(form.locator('.pairing-result')).toBeEmpty();
      const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/admin/pairing-codes'));
      await form.getByRole('button', { name: 'コードを発行', exact: true }).click();
      const response = await responsePromise;
      expect(response.request().postDataJSON()).toEqual({ role });
      expect(response.status()).toBe(200);
      const { code } = await response.json() as { code: string };
      await expect(form.getByTestId('pairing-code')).toHaveText(code);
      await expect(form.locator('.pairing-result')).toHaveText(code);
      codes.set(role, code);
    }
    for (const { role, label } of devices) {
      await expect(page.getByRole('form', { name: `${label}のコード発行` }).getByTestId('pairing-code')).toHaveText(codes.get(role)!);
    }

    for (const width of [1920, 1280]) {
      await page.setViewportSize({ width, height: 1080 });
      const boxes = await Promise.all(devices.map(({ label }) => page.getByRole('form', { name: `${label}のコード発行` }).boundingBox()));
      expect(boxes.every((box) => box !== null)).toBe(true);
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
      expect(Math.abs(boxes[1]!.y - boxes[2]!.y)).toBeLessThan(1);
      expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x);
      expect(boxes[1]!.x + boxes[1]!.width).toBeLessThan(boxes[2]!.x);
      expect(await page.locator('.registration-panel').evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    const displayForm = page.getByRole('form', { name: '展示ディスプレイのコード発行' });
    const reissuePromise = page.waitForResponse((response) => response.url().endsWith('/api/admin/pairing-codes'));
    await displayForm.getByRole('button', { name: 'コードを発行', exact: true }).click();
    const { code } = await (await reissuePromise).json() as { code: string };
    codes.set('display', code);
    for (const { role, label } of devices) {
      await expect(page.getByRole('form', { name: `${label}のコード発行` }).getByTestId('pairing-code')).toHaveText(codes.get(role)!);
      const response = await context.request.post('/api/pair', { data: { code: codes.get(role) } });
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ role });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const boxes = await Promise.all(devices.map(({ label }) => page.getByRole('form', { name: `${label}のコード発行` }).boundingBox()));
    expect(boxes[0]!.y + boxes[0]!.height).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y + boxes[1]!.height).toBeLessThan(boxes[2]!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await context.close();
    await harness.close();
  }
});

for (const width of [1920, 1280]) {
  test(`幅${width}pxで一部の列にコードを表示しても各列の発行ボタンは移動しない`, async ({ browser }) => {
    const harness = await ExhibitHarness.open(browser);
    const { page } = harness.admin;
    try {
      await page.setViewportSize({ width, height: 1080 });
      const forms = devices.map(({ label }) => page.getByRole('form', { name: `${label}のコード発行` }));
      const buttons = forms.map((form) => form.getByRole('button'));
      const buttonPositions = () => Promise.all(buttons.map((button) => button.evaluate((element) =>
        element.getBoundingClientRect().top,
      )));
      const before = await buttonPositions();
      for (const form of forms) {
        await form.getByRole('button', { name: 'コードを発行', exact: true }).click();
        await expect(form.getByTestId('pairing-code')).toHaveText(/^[0-9]{6}$/);
        await expect.poll(async () => {
          const after = await buttonPositions();
          return after.map((position, index) => Math.round(position - before[index]));
        }).toEqual([0, 0, 0]);
      }
    } finally {
      await harness.close();
    }
  });
}

test('コード発行中の重複送信を防ぎ、通信失敗後も再発行できる', async ({ browser }) => {
  const harness = await ExhibitHarness.open(browser);
  const { page } = harness.admin;
  try {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    let requests = 0;
    await page.route('**/api/admin/pairing-codes', async (route) => {
      requests += 1;
      await pending;
      await route.abort();
    });
    const form = page.getByRole('form', { name: '診断用iPadのコード発行' });
    await form.getByRole('button', { name: 'コードを発行', exact: true }).click();
    await expect(form.getByRole('button', { name: '発行中…' })).toBeDisabled();
    expect(requests).toBe(1);
    await expect(page.getByRole('form', { name: '写真用のコード発行' }).getByRole('button')).toBeEnabled();
    release();
    await expect(page.getByRole('alert')).toHaveText('コードを発行できませんでした。');
    await expect(form.getByRole('button', { name: 'コードを発行', exact: true })).toBeEnabled();
    await page.unroute('**/api/admin/pairing-codes');
    await form.getByRole('button', { name: 'コードを発行', exact: true }).click();
    await expect(form.getByTestId('pairing-code')).toHaveText(/^[0-9]{6}$/);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await harness.close();
  }
});
