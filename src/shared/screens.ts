/**
 * URLの画面番号（`/display/2` の `2`）を読む。1以上の整数でなければ `null`。
 * 展示ディスプレイの並び順（`displayOrder`）は画面番号 - 1。
 */
export function parseScreenNumber(value: string | null): number | null {
	if (value === null || !/^[1-9][0-9]{0,2}$/.test(value)) return null;
	return Number(value);
}

/**
 * 画面分割（`/display/split/{番号}`）の画面番号。左から1、2。会場では二台のディスプレイを横に並べ、それぞれの
 * ディスプレイで一つずつタブ（ウィンドウ）を全画面で開く。二つのタブが、二台を合わせた一つの横長の画面の左半分と右半分を描く。
 */
export const SPLIT_SCREENS = [1, 2] as const;

/** 画面分割の全体の縦横比（横 / 縦）。二台を横に並べた36:9で、一台あたり18:9。 */
export const SPLIT_ASPECT = 36 / 9;

/** 画面分割の画面番号（`/display/split/2` の `2`）を読む。`SPLIT_SCREENS` になければ `null`。 */
export function parseSplitScreen(value: string | null): number | null {
	const screen = parseScreenNumber(value);
	return screen !== null && (SPLIT_SCREENS as readonly number[]).includes(screen) ? screen : null;
}
