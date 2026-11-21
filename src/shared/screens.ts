/**
 * URLの画面番号（`/display/2` の `2`）を読む。1以上の整数でなければ `null`。
 * 展示ディスプレイの並び順（`displayOrder`）は画面番号 - 1。
 */
export function parseScreenNumber(value: string | null): number | null {
	if (value === null || !/^[1-9][0-9]{0,2}$/.test(value)) return null;
	return Number(value);
}
