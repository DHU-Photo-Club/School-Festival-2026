/**
 * AIによる色と写真の選定の設定（refs/handoff 実装仕様書4章、7章、8章）。
 *
 * 仮の値: handoff で未決定（11章）の項目に、実装上の暫定値を置いている。採用値を決めたらここを更新する。
 * - 再試行の回数、一回の呼び出しの時間切れ、`judging` の最長の長さ（11章 6）
 * - 一回の体験で選ぶ写真の枚数（11章 4。handoff の最低目標10枚を暫定値にした）
 */
export const AI_SETTINGS = {
	/** 一回の呼び出しに失敗したとき、同じ呼び出しをやり直す回数。 */
	retries: 1,
	/** 一回の呼び出しの時間切れ（ミリ秒）。 */
	callTimeoutMs: 9_000,
	/**
	 * `judging` の最長の長さ（ミリ秒）。色の選定と写真の選定を順に行い、それぞれ再試行を含む。
	 * これを過ぎても色が決まらなければ選定失敗として最終問へ戻す。
	 */
	judgingMaxMs: 30_000,
} as const;

/** AIの色の出力の文字数の上限（実装仕様書5章、8章）。 */
export const COLOR_OUTPUT_LIMITS = {
	name: 24,
	nameReason: 100,
	reading: 150,
	reason: 100,
	relationship: 150,
} as const;

/** 写真選定の方針。診断結果の二色との一致を必須とする。 */
export const PHOTO_POLICY = {
	version: "photo-policy-v2-color",
	/** 一回の体験で選ぶ写真の枚数（暫定値）。色が合う写真が足りなければ不足数を記録する。 */
	sessionPhotoCount: 10,
	/** 色が合わず内容だけ合う写真は選ばない。 */
	tier3Quota: 0,
} as const;
