import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

/** 開発サーバーと同じ規則で管理パスフレーズを読む（.dev.vars、なければ環境変数）。 */
export function adminPassphrase(): string {
  const file = join(import.meta.dirname, '..', '..', '.dev.vars');
  if (existsSync(file)) {
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.startsWith('ADMIN_PASSPHRASE='));
    const value = line?.slice('ADMIN_PASSPHRASE='.length).trim();
    if (value) return value;
  }
  if (process.env.ADMIN_PASSPHRASE) return process.env.ADMIN_PASSPHRASE;
  throw new Error('ADMIN_PASSPHRASE を .dev.vars または環境変数に設定してください（.dev.vars.example 参照）');
}

export interface Device {
  context: BrowserContext;
  page: Page;
}

export const DISPLAY_VIEWPORT = { width: 1920, height: 1080 };
export const IPAD_VIEWPORT = { width: 820, height: 1180 };

/** 管理画面を開き、展示を初期状態へ戻してから端末を登録する。 */
export class ExhibitHarness {
  private constructor(
    readonly browser: Browser,
    readonly admin: Device,
  ) {}

  static async open(browser: Browser): Promise<ExhibitHarness> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const login = await context.request.post('/api/admin/login', { data: { passphrase: adminPassphrase() } });
    expect(login.status()).toBe(200);
    const page = await context.newPage();
    await page.goto('/admin');
    await expect(page.getByText('サーバー接続中')).toBeVisible();
    const harness = new ExhibitHarness(browser, { context, page });
    await harness.reset();
    return harness;
  }

  /** 端末セッションを失効させ、受付を再開し、強制リセットする。 */
  async reset(): Promise<void> {
    const { page, context } = this.admin;
    const response = await context.request.get('/api/admin/sessions');
    const { sessions } = (await response.json()) as { sessions: { id: string }[] };
    for (const session of sessions) await context.request.delete(`/api/admin/sessions/${session.id}`);
    await page.getByRole('button', { name: '強制リセット' }).click();
    await expect(page.getByTestId('phase')).toContainText('idle');
    const resume = page.getByRole('button', { name: '受付を再開' });
    if (await resume.isVisible()) await resume.click();
    await expect(page.getByRole('button', { name: '受付を停止' })).toBeVisible();
    const release = page.getByRole('button', { name: '操作端末を解放' });
    if (await release.isEnabled()) await release.click();
  }

  async issueCode(role: 'controller' | 'display', screenId: string | null = null): Promise<string> {
    const response = await this.admin.context.request.post('/api/admin/pairing-codes', { data: { role, screenId } });
    expect(response.status()).toBe(200);
    return ((await response.json()) as { code: string }).code;
  }

  /** 新しいブラウザコンテキストを端末として登録し、登録後の画面を開く。 */
  async pair(
    role: 'controller' | 'display',
    screenId: string | null = null,
    options: BrowserContextOptions = {},
  ): Promise<Device> {
    const code = await this.issueCode(role, screenId);
    const context = await this.browser.newContext({
      viewport: role === 'display' ? DISPLAY_VIEWPORT : IPAD_VIEWPORT,
      ...options,
    });
    const response = await context.request.post('/api/pair', { data: { code } });
    expect(response.status()).toBe(200);
    const { location } = (await response.json()) as { location: string };
    const page = await context.newPage();
    await page.goto(location);
    return { context, page };
  }

  async pairDisplays(count: number, options: BrowserContextOptions = {}): Promise<Device[]> {
    const displays: Device[] = [];
    for (let index = 1; index <= count; index += 1) {
      const display = await this.pair('display', `display-${index}`, options);
      await expect(display.page.locator('main.display')).toHaveAttribute('data-phase', 'idle');
      displays.push(display);
    }
    return displays;
  }

  async close(): Promise<void> {
    await this.admin.context.close();
  }
}

/** 展示ディスプレイのcanvasの画素を読む。座標は0〜1の比率。 */
export async function canvasPixel(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ([px, py]) => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const context = canvas.getContext('2d') as CanvasRenderingContext2D;
      const [r, g, b] = context.getImageData(Math.floor(canvas.width * px), Math.floor(canvas.height * py), 1, 1).data;
      return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    },
    [x, y],
  );
}

/** canvas全体の画素の要約（変化の検出に使う）。 */
export async function canvasDigest(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 0;
    for (let i = 0; i < data.length; i += 4099) hash = (hash * 31 + data[i]) | 0;
    return String(hash);
  });
}

/** iPadの質問画面で、スライダーの位置（0〜4）をタップする。 */
export async function tapStop(page: Page, index: number): Promise<void> {
  const area = page.locator('.slider .area');
  const box = await area.boundingBox();
  if (!box) throw new Error('slider not found');
  const half = 22;
  const x = box.x + half + ((box.width - half * 2) * index) / 4;
  await page.mouse.click(x, box.y + box.height / 2);
}

export async function sliderValue(page: Page): Promise<string> {
  return page.locator('.slider input[type="range"]').inputValue();
}
