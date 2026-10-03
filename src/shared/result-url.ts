import { COLOR_IDS } from './types.ts';
import type { ColorId } from './types.ts';

/**
 * QRコードへ格納する結果URL（仕様書10.3節）。`PUBLIC_ORIGIN` と `colorId` を検証してから組み立てる。
 * クエリ文字列、fragment、`sessionId`、回答内容を含めない。
 */
export function resultUrl(publicOrigin: string, colorId: string): string {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN が不正です');
  if (!COLOR_IDS.includes(colorId as ColorId)) throw new Error('colorId が不正です');
  return `${publicOrigin}/result/${encodeURIComponent(colorId)}`;
}
