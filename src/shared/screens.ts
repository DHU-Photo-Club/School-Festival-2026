/**
 * 展示ディスプレイの画面IDと並び順。画面IDは登録時にサーバーが空いている最小の番号から振り、
 * `display-1` の並び順（`displayOrder`）を0とする。
 */
const SCREEN_ID = /^display-([1-9][0-9]*)$/;

export function screenIdFor(displayOrder: number): string {
  return `display-${displayOrder + 1}`;
}

/** 画面IDから並び順を求める。形式が違えば `null`。 */
export function displayOrderOf(screenId: string): number | null {
  const match = screenId.match(SCREEN_ID);
  return match ? Number(match[1]) - 1 : null;
}

/** 使用中の画面IDを除いた、最も小さい番号の画面ID。 */
export function nextFreeScreenId(used: Iterable<string>): string {
  const taken = new Set(used);
  let order = 0;
  while (taken.has(screenIdFor(order))) order += 1;
  return screenIdFor(order);
}
