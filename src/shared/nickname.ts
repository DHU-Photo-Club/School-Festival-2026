/** ニックネームの最大文字数（コードポイント数）。 */
export const NICKNAME_MAX_LENGTH = 12;

/** 制御文字と書式文字（ゼロ幅文字や双方向制御文字など）。 */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/**
 * 入力されたニックネームを正規化する。NFC正規化、制御文字と書式文字の除去、連続する空白の圧縮、
 * 前後の空白の除去を行う。空、または `NICKNAME_MAX_LENGTH` 文字を超える場合は `null`。
 */
export function normalizeNickname(value: string): string | null {
	const nickname = value.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/gu, " ").trim();
	const length = Array.from(nickname).length;
	return length > 0 && length <= NICKNAME_MAX_LENGTH ? nickname : null;
}
