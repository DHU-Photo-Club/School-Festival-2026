import type { Photo } from '../shared/types.ts';

/**
 * 写真定義。ファイルは `public/photos/{id}.avif` と `public/photos/{id}.jpg`。
 * 原本は `photos/originals/` に置き、`pnpm export-photos` で表示用ファイルを書き出す。
 *
 * 仮データ: 次の項目は仕様書16章「写真点数、縦横比、配布許可」と「8色の代表画像と作者クレジット」の決定前の値。
 * - `resultColorId`: 写真の主題から仮に割り当てた。写真担当責任者が12.2節に従って決める。
 * - `shareAllowed`: 各色の代表画像だけを仮に `true` にした。
 * - `creditName`: 撮影者名が未確定のため仮の値。
 * - `idleOrder`: 色が続かないように仮に並べた。
 */
const CREDIT = '撮影者名（仮）';

export const PHOTOS: readonly Photo[] = [
  { id: 'sdi1218-3', resultColorId: 'red', resultOrder: 0, idleEnabled: true, idleOrder: 0, shareAllowed: true, creditName: CREDIT },
  { id: 'sdi0743', resultColorId: 'orange', resultOrder: 0, idleEnabled: true, idleOrder: 7, shareAllowed: true, creditName: CREDIT },
  { id: 'sdi1092-2', resultColorId: 'yellow', resultOrder: 0, idleEnabled: true, idleOrder: 2, shareAllowed: true, creditName: CREDIT },
  { id: 'sdi0225', resultColorId: 'green', resultOrder: 0, idleEnabled: true, idleOrder: 4, shareAllowed: true, creditName: CREDIT },
  { id: 'sdi0776', resultColorId: 'green', resultOrder: 1, idleEnabled: true, idleOrder: 10, shareAllowed: false, creditName: CREDIT },
  { id: 'sdi0565-2', resultColorId: 'cyan', resultOrder: 0, idleEnabled: true, idleOrder: 1, shareAllowed: true, creditName: CREDIT },
  { id: 'sdi1091', resultColorId: 'cyan', resultOrder: 1, idleEnabled: true, idleOrder: 8, shareAllowed: false, creditName: CREDIT },
  { id: 'sdi1195-3', resultColorId: 'blue', resultOrder: 0, idleEnabled: true, idleOrder: 6, shareAllowed: true, creditName: CREDIT },
  { id: 'sdi1134-2', resultColorId: 'blue', resultOrder: 1, idleEnabled: true, idleOrder: 11, shareAllowed: false, creditName: CREDIT },
  { id: 'sdi1031-2', resultColorId: 'violet', resultOrder: 0, idleEnabled: true, idleOrder: 3, shareAllowed: true, creditName: CREDIT },
  { id: 'sdi1163-3', resultColorId: 'violet', resultOrder: 1, idleEnabled: true, idleOrder: 9, shareAllowed: false, creditName: CREDIT },
  { id: 'sdi1070-2', resultColorId: 'magenta', resultOrder: 0, idleEnabled: true, idleOrder: 5, shareAllowed: true, creditName: CREDIT },
];
