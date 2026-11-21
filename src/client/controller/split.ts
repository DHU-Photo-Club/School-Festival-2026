/**
 * スライダーの仕切り線の位置（画面幅に対する割合）。端まで寄せても狭い側の語が読めるよう、両端を空ける。
 */
export const SPLIT_MIN = 0.15;
export const SPLIT_MAX = 0.85;

/**
 * 回答の位置（左端0から右端1）を仕切り線の位置にする。広い側の語を選んでいるとみなすため、
 * 左の語に近いほど左の領域が広がり、仕切り線は右へ寄る。
 */
export const splitAt = (value: number) => SPLIT_MAX - (SPLIT_MAX - SPLIT_MIN) * Math.min(1, Math.max(0, value));

/** 仕切り線の位置を回答の位置（左端0から右端1）にする。0未満や1超もそのまま返す（呼び出し側で0〜1に収める）。 */
export const valueAt = (split: number) => (SPLIT_MAX - split) / (SPLIT_MAX - SPLIT_MIN);
