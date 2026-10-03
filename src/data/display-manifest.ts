import type { DisplayManifestEntry } from '../shared/types.ts';

/**
 * 展示ディスプレイの登録（仕様書7.2.1節）。来場者から見た順に並べる。
 *
 * 仮データ: 仕様書16章「設置するディスプレイの台数、解像度、向き」の決定前の値。
 * 台数3は仕様書9.5節の三画面構成に合わせた仮の値である。
 */
export const DISPLAY_MANIFEST: readonly DisplayManifestEntry[] = [
  { screenId: 'display-1', displayOrder: 0, orientation: 'landscape', width: 1920, height: 1080 },
  { screenId: 'display-2', displayOrder: 1, orientation: 'landscape', width: 1920, height: 1080 },
  { screenId: 'display-3', displayOrder: 2, orientation: 'landscape', width: 1920, height: 1080 },
];
