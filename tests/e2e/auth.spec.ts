import { request as httpRequest } from 'node:http';
import { expect, test } from '@playwright/test';
import { ExhibitHarness } from './fixtures.ts';

/** WebSocket Upgrade要求を送り、接続が成立したら101、HTTP応答ならそのステータス、切断なら0を返す。 */
function upgradeStatus(baseURL: string, path: string, cookie = ''): Promise<number> {
  const url = new URL(path, baseURL);
  return new Promise((resolve) => {
    const request = httpRequest({
      host: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    request.on('response', (response) => {
      resolve(response.statusCode ?? 0);
      response.resume();
    });
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    request.on('error', () => resolve(0));
    request.end();
  });
}

test('未認証のUpgradeは401、役割不一致は403で、接続が成立しない', async ({ browser, baseURL, playwright }) => {
  const harness = await ExhibitHarness.open(browser);
  const display = await harness.pair('display', 'display-1');
  const cookie = (await display.context.cookies())
    .filter((entry) => entry.name === 'dpc_device')
    .map((entry) => `${entry.name}=${entry.value}`)
    .join('; ');
  const base = baseURL ?? '';
  const cases = [
    { path: '/api/realtime?role=display&screenId=display-1', cookie: '', status: 401 },
    { path: '/api/realtime?role=controller', cookie, status: 403 },
    { path: '/api/realtime?role=admin', cookie, status: 401 },
    { path: '/api/realtime?role=display&screenId=display-2', cookie, status: 403 },
  ];
  // WorkerはUpgrade前にCookieを検証して401または403を返す。ローカル開発サーバー（Cloudflare Vite plugin）は
  // Upgrade要求への101以外の応答を中継せずソケットを閉じるため、ステータスはUpgradeなしの同じ要求で確かめる。
  const plain = await playwright.request.newContext({ baseURL: base });
  for (const entry of cases) {
    expect(await upgradeStatus(base, entry.path, entry.cookie)).not.toBe(101);
    const response = await plain.get(entry.path, { headers: entry.cookie ? { Cookie: entry.cookie } : {} });
    expect(response.status()).toBe(entry.status);
  }
  expect(await upgradeStatus(base, '/api/realtime?role=display&screenId=display-1', cookie)).toBe(101);
  await plain.dispose();
  await display.context.close();
  await harness.close();
});

test('使用済みのペアリングコードでは端末セッションを発行できない', async ({ browser, playwright, baseURL }) => {
  const harness = await ExhibitHarness.open(browser);
  const code = await harness.issueCode('controller');
  const first = await playwright.request.newContext({ baseURL });
  const second = await playwright.request.newContext({ baseURL });
  expect((await first.post('/api/pair', { data: { code } })).status()).toBe(200);
  expect((await second.post('/api/pair', { data: { code } })).status()).toBe(400);
  expect((await second.post('/api/pair', { data: { code: '000000' } })).status()).toBe(400);
  await first.dispose();
  await second.dispose();
  await harness.close();
});

test('管理APIはログインなしで401', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get('/api/admin/sessions')).status()).toBe(401);
  expect((await anonymous.post('/api/admin/pairing-codes', { data: { role: 'controller' } })).status()).toBe(401);
  expect((await anonymous.post('/api/admin/login', { data: { passphrase: 'wrong' } })).status()).toBe(401);
  await anonymous.dispose();
});

test('URLと端末セッションの画面IDが一致しない展示画面は表示を開始せず再登録を求める', async ({ browser }) => {
  const harness = await ExhibitHarness.open(browser);
  const display = await harness.pair('display', 'display-1');
  await display.page.goto('/display/display-2');
  await expect(display.page.getByText('この画面は再登録が必要です。')).toBeVisible();
  await expect(display.page.locator('canvas')).toHaveCount(0);
  await display.context.close();
  await harness.close();
});

test('未登録の端末は登録画面を表示する', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '端末の登録' })).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test('端末の初期画面で6桁のコードを入力して登録できる', async ({ browser }) => {
  const harness = await ExhibitHarness.open(browser);
  const code = await harness.issueCode('display', 'display-2');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  const input = page.getByLabel('ペアリングコード');
  await expect(input).toHaveAttribute('pattern', '[0-9]{6}');
  await input.fill(code);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/display\/display-2$/);
  await expect(page.locator('main.display')).toHaveAttribute('data-phase', /.+/);
  await context.close();
  await harness.close();
});
