import type { Photo } from '../shared/types.ts';

/**
 * 写真定義。ファイルは `public/photos/{id}.avif` と `public/photos/{id}.jpg`。
 *
 * 仮データ: 仕様書16章「写真点数、縦横比、配布許可」と「8色の代表画像と作者クレジット」の
 * 決定前の値。写真IDの接頭辞 `kari-` と作者名「仮の撮影者」は仮の値であることを示す。
 * ファイルは `scripts/generate-placeholder-photos.ts` で生成した仮画像である。
 */
export const PHOTOS: readonly Photo[] = [
  { id: 'kari-red-01', resultColorId: 'red', resultOrder: 0, idleEnabled: true, idleOrder: 0, shareAllowed: true, creditName: '仮の撮影者B' },
  { id: 'kari-red-02', resultColorId: 'red', resultOrder: 1, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者C' },
  { id: 'kari-red-03', resultColorId: 'red', resultOrder: 2, idleEnabled: true, idleOrder: 8, shareAllowed: false, creditName: '仮の撮影者D' },
  { id: 'kari-red-04', resultColorId: 'red', resultOrder: 3, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者A' },
  { id: 'kari-red-05', resultColorId: 'red', resultOrder: 4, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者B' },
  { id: 'kari-orange-01', resultColorId: 'orange', resultOrder: 0, idleEnabled: true, idleOrder: 1, shareAllowed: true, creditName: '仮の撮影者C' },
  { id: 'kari-orange-02', resultColorId: 'orange', resultOrder: 1, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者D' },
  { id: 'kari-orange-03', resultColorId: 'orange', resultOrder: 2, idleEnabled: true, idleOrder: 9, shareAllowed: false, creditName: '仮の撮影者A' },
  { id: 'kari-orange-04', resultColorId: 'orange', resultOrder: 3, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者B' },
  { id: 'kari-orange-05', resultColorId: 'orange', resultOrder: 4, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者C' },
  { id: 'kari-yellow-01', resultColorId: 'yellow', resultOrder: 0, idleEnabled: true, idleOrder: 2, shareAllowed: true, creditName: '仮の撮影者D' },
  { id: 'kari-yellow-02', resultColorId: 'yellow', resultOrder: 1, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者A' },
  { id: 'kari-yellow-03', resultColorId: 'yellow', resultOrder: 2, idleEnabled: true, idleOrder: 10, shareAllowed: false, creditName: '仮の撮影者B' },
  { id: 'kari-yellow-04', resultColorId: 'yellow', resultOrder: 3, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者C' },
  { id: 'kari-yellow-05', resultColorId: 'yellow', resultOrder: 4, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者D' },
  { id: 'kari-green-01', resultColorId: 'green', resultOrder: 0, idleEnabled: true, idleOrder: 3, shareAllowed: true, creditName: '仮の撮影者A' },
  { id: 'kari-green-02', resultColorId: 'green', resultOrder: 1, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者B' },
  { id: 'kari-green-03', resultColorId: 'green', resultOrder: 2, idleEnabled: true, idleOrder: 11, shareAllowed: false, creditName: '仮の撮影者C' },
  { id: 'kari-green-04', resultColorId: 'green', resultOrder: 3, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者D' },
  { id: 'kari-green-05', resultColorId: 'green', resultOrder: 4, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者A' },
  { id: 'kari-cyan-01', resultColorId: 'cyan', resultOrder: 0, idleEnabled: true, idleOrder: 4, shareAllowed: true, creditName: '仮の撮影者B' },
  { id: 'kari-cyan-02', resultColorId: 'cyan', resultOrder: 1, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者C' },
  { id: 'kari-cyan-03', resultColorId: 'cyan', resultOrder: 2, idleEnabled: true, idleOrder: 12, shareAllowed: false, creditName: '仮の撮影者D' },
  { id: 'kari-cyan-04', resultColorId: 'cyan', resultOrder: 3, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者A' },
  { id: 'kari-cyan-05', resultColorId: 'cyan', resultOrder: 4, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者B' },
  { id: 'kari-blue-01', resultColorId: 'blue', resultOrder: 0, idleEnabled: true, idleOrder: 5, shareAllowed: true, creditName: '仮の撮影者C' },
  { id: 'kari-blue-02', resultColorId: 'blue', resultOrder: 1, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者D' },
  { id: 'kari-blue-03', resultColorId: 'blue', resultOrder: 2, idleEnabled: true, idleOrder: 13, shareAllowed: false, creditName: '仮の撮影者A' },
  { id: 'kari-blue-04', resultColorId: 'blue', resultOrder: 3, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者B' },
  { id: 'kari-blue-05', resultColorId: 'blue', resultOrder: 4, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者C' },
  { id: 'kari-violet-01', resultColorId: 'violet', resultOrder: 0, idleEnabled: true, idleOrder: 6, shareAllowed: true, creditName: '仮の撮影者D' },
  { id: 'kari-violet-02', resultColorId: 'violet', resultOrder: 1, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者A' },
  { id: 'kari-violet-03', resultColorId: 'violet', resultOrder: 2, idleEnabled: true, idleOrder: 14, shareAllowed: false, creditName: '仮の撮影者B' },
  { id: 'kari-violet-04', resultColorId: 'violet', resultOrder: 3, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者C' },
  { id: 'kari-violet-05', resultColorId: 'violet', resultOrder: 4, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者D' },
  { id: 'kari-magenta-01', resultColorId: 'magenta', resultOrder: 0, idleEnabled: true, idleOrder: 7, shareAllowed: true, creditName: '仮の撮影者A' },
  { id: 'kari-magenta-02', resultColorId: 'magenta', resultOrder: 1, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者B' },
  { id: 'kari-magenta-03', resultColorId: 'magenta', resultOrder: 2, idleEnabled: true, idleOrder: 15, shareAllowed: false, creditName: '仮の撮影者C' },
  { id: 'kari-magenta-04', resultColorId: 'magenta', resultOrder: 3, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者D' },
  { id: 'kari-magenta-05', resultColorId: 'magenta', resultOrder: 4, idleEnabled: false, idleOrder: 0, shareAllowed: false, creditName: '仮の撮影者A' },
];
