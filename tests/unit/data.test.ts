import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePhotoFiles } from '../../build/validate-assets.ts';
import { RESULT_COLORS } from '../../src/data/colors.ts';
import { DISPLAY_MANIFEST } from '../../src/data/display-manifest.ts';
import { PHOTOS } from '../../src/data/photos.ts';
import { QUESTIONS } from '../../src/data/questions.ts';
import { estimateClock } from '../../src/shared/clock.ts';
import {
  contrastRatio,
  validateExhibitData,
  validatePublicOrigin,
  validatePublishedUntil,
} from '../../src/shared/data-validation.ts';
import { resultUrl } from '../../src/shared/result-url.ts';
import { COLOR_IDS } from '../../src/shared/types.ts';
import { createQrModel, generateQrWithRetry, QR_RETRY_DELAY_MS } from '../../src/client/lib/qr.ts';
import { resultAvailability } from '../../src/worker/result-page.ts';

const data = { colors: RESULT_COLORS, questions: QUESTIONS, photos: PHOTOS, manifest: DISPLAY_MANIFEST };
const representative = (colorId: string) => RESULT_COLORS.find((color) => color.id === colorId)?.representativePhotoId;

describe('展示データ', () => {
  it('仮データは検証を通る', () => {
    expect(validateExhibitData(data)).toEqual([]);
  });

  it('全色の文字色と背景色のコントラスト比は4.5:1以上', () => {
    for (const color of RESULT_COLORS) expect(contrastRatio(color.foregroundColor, color.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });

  it('代表画像が同色でない、配布不可、クレジットなし、存在しない場合を検出する', () => {
    const photos = PHOTOS.map((photo) =>
      photo.id === representative('red') ? { ...photo, shareAllowed: false } : photo.id === representative('blue') ? { ...photo, creditName: null } : photo,
    );
    const colors = RESULT_COLORS.map((color) =>
      color.id === 'green' ? { ...color, representativePhotoId: representative('cyan') ?? '' } : color.id === 'violet' ? { ...color, representativePhotoId: 'none' } : color,
    );
    const errors = validateExhibitData({ ...data, photos, colors });
    expect(errors).toEqual(
      expect.arrayContaining([
        'red の代表画像は配布許可がありません',
        'blue の代表画像に creditName がありません',
        'green の代表画像が同じ結果色の写真ではありません',
        'violet の代表画像 none が存在しません',
      ]),
    );
  });

  it('写真IDの重複と形式違反、未定義の resultColorId を検出する', () => {
    const photos = [...PHOTOS, { ...PHOTOS[0] }, { ...PHOTOS[1], id: 'Bad_ID' }, { ...PHOTOS[2], id: 'photo-x', resultColorId: 'pink' as never }];
    const errors = validateExhibitData({ ...data, photos });
    expect(errors).toEqual(
      expect.arrayContaining([
        `写真ID ${PHOTOS[0].id} が重複しています`,
        '写真ID Bad_ID の形式が不正です',
        '写真 photo-x の resultColorId pink は未定義です',
      ]),
    );
  });

  it('コントラスト不足と50文字を超えるメッセージを検出する', () => {
    const colors = RESULT_COLORS.map((color) =>
      color.id === 'yellow' ? { ...color, foregroundColor: '#555555', message: 'あ'.repeat(51) } : color,
    );
    expect(validateExhibitData({ ...data, colors })).toEqual(
      expect.arrayContaining([
        'yellow の foregroundColor と backgroundColor のコントラスト比が4.5:1未満です',
        'yellow のメッセージが50文字を超えています',
      ]),
    );
  });

  it('displayManifest の screenId と displayOrder の重複を検出する', () => {
    const manifest = [...DISPLAY_MANIFEST, { ...DISPLAY_MANIFEST[0] }];
    expect(validateExhibitData({ ...data, manifest })).toEqual(
      expect.arrayContaining(['displayManifest の screenId が重複しています', 'displayManifest の displayOrder が重複しています']),
    );
  });

  it('全写真IDに同寸法のAVIFとJPEGがあり、容量上限と長辺の上限を満たす', async () => {
    expect(await validatePhotoFiles(PHOTOS, DISPLAY_MANIFEST, join(import.meta.dirname, '..', '..', 'public', 'photos'))).toEqual([]);
  }, 60_000);

  it('写真ファイルの欠落を検出する', async () => {
    const errors = await validatePhotoFiles([{ ...PHOTOS[0], id: 'missing-photo' }], DISPLAY_MANIFEST, join(import.meta.dirname, '..', '..', 'public', 'photos'));
    expect(errors).toEqual(['missing-photo.avif: ファイルがありません', 'missing-photo.jpg: ファイルがありません']);
  });
});

describe('公開URL', () => {
  it('PUBLIC_ORIGIN はHTTPSでデプロイ先の workers.dev と一致する必要がある', () => {
    expect(validatePublicOrigin('https://dpc-school-festival.tbd-subdomain.workers.dev', 'dpc-school-festival')).toEqual([]);
    expect(validatePublicOrigin('http://dpc-school-festival.a.workers.dev', 'dpc-school-festival')).toContain('PUBLIC_ORIGIN はHTTPSにします');
    expect(validatePublicOrigin('https://dpc-school-festival.a.workers.dev/', 'dpc-school-festival').length).toBeGreaterThan(0);
    expect(validatePublicOrigin('https://other.a.workers.dev', 'dpc-school-festival').length).toBeGreaterThan(0);
    expect(validatePublicOrigin('https://example.com', 'dpc-school-festival').length).toBeGreaterThan(0);
  });

  it('PUBLIC_ORIGIN から生成した8色の結果URLはすべてHTTPSで、クエリと fragment を含まない', () => {
    const origin = 'https://dpc-school-festival.tbd-subdomain.workers.dev';
    for (const colorId of COLOR_IDS) {
      const url = new URL(resultUrl(origin, colorId));
      expect(url.protocol).toBe('https:');
      expect(url.href).toBe(`${origin}/result/${colorId}`);
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
    }
    expect(() => resultUrl('http://example.com', 'red')).toThrow();
    expect(() => resultUrl(origin, 'pink')).toThrow();
  });

  it('RESULTS_PUBLISHED_UNTIL はISO 8601形式のUTC時刻', () => {
    expect(validatePublishedUntil('2026-12-31T15:00:00Z')).toEqual([]);
    expect(validatePublishedUntil('2026-12-31 15:00')).not.toEqual([]);
    expect(validatePublishedUntil('2026-12-31T15:00:00+09:00')).not.toEqual([]);
  });

  it('結果ページは公開期間内200、終了日時以降410、未定義の colorId は期間にかかわらず404', () => {
    const until = '2026-12-31T15:00:00Z';
    const end = Date.parse(until);
    expect(resultAvailability('/result/red', end - 1, until)).toEqual({ status: 200, colorId: 'red' });
    expect(resultAvailability('/result/red', end, until)).toEqual({ status: 410 });
    expect(resultAvailability('/result/pink', end - 1, until)).toEqual({ status: 404 });
    expect(resultAvailability('/result/pink', end + 1, until)).toEqual({ status: 404 });
    expect(resultAvailability('/result/red', 0, 'invalid')).toEqual({ status: 410 });
  });
});

describe('QRコード', () => {
  it('Quiet Zone 4モジュールを含む正方形のモデルを作る', () => {
    const model = createQrModel('https://dpc-school-festival.tbd-subdomain.workers.dev/result/magenta');
    expect((model.size - 8 - 17) % 4).toBe(0);
    expect(model.path).toMatch(/^M4 4h1v1h-1z/);
  });

  it('失敗したら500ms後に一度だけ再試行し、二回とも失敗したら失敗を返す', async () => {
    const waits: number[] = [];
    let calls = 0;
    const failing = () => {
      calls += 1;
      throw new Error('boom');
    };
    const outcome = await generateQrWithRetry('x', failing, async (ms) => void waits.push(ms));
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(2);
    expect(waits).toEqual([QR_RETRY_DELAY_MS]);

    let attempts = 0;
    const flaky = (text: string) => {
      attempts += 1;
      if (attempts === 1) throw new Error('once');
      return createQrModel(text);
    };
    expect((await generateQrWithRetry('https://example.com/result/red', flaky, async () => {})).ok).toBe(true);
  });
});

describe('時刻補正', () => {
  it('往復時間が長い2件を除き、残る3件の補正値の中央値を使う', () => {
    const sample = (sent: number, rtt: number, offset: number) => ({
      clientSentAt: sent,
      clientReceivedAt: sent + rtt,
      serverTime: sent + rtt / 2 + offset,
    });
    const estimate = estimateClock([sample(0, 10, 100), sample(200, 12, 104), sample(400, 500, 900), sample(600, 8, 98), sample(800, 300, -50)]);
    expect(estimate).toEqual({ offset: 100, minRoundTripTime: 8, offsetSpread: 6 });
  });
});
