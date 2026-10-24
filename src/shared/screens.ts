import type { ScreenRole } from './types.ts';

/** 画面IDの番号は役割ごとに割り当て、並び順は0から数える。 */
const SCREEN_ID = /^(display|photo)-([1-9][0-9]*)$/;

export function screenIdFor(displayOrder: number, role: ScreenRole = 'display'): string {
  return `${role}-${displayOrder + 1}`;
}

/** 画面IDから並び順を求める。形式が違えば `null`。 */
export function displayOrderOf(screenId: string, role: ScreenRole = 'display'): number | null {
  const match = screenId.match(SCREEN_ID);
  return match && match[1] === role ? Number(match[2]) - 1 : null;
}

/** 使用中の画面IDを除いた、最も小さい番号の画面ID。 */
export function nextFreeScreenId(used: Iterable<string>, role: ScreenRole = 'display'): string {
  const taken = new Set(used);
  let order = 0;
  while (taken.has(screenIdFor(order, role))) order += 1;
  return screenIdFor(order, role);
}
