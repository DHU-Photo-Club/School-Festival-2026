/**
 * 台形補正（四隅の位置合わせ）。プロジェクターを斜めから投影して台形にゆがんだ映像を、ページ側で逆にゆがめて
 * 長方形に戻す。画面の四隅をそれぞれ動かした先の四角形へ、画面全体を射影変換（ホモグラフィ）で写す。
 */

/** 一つの角のずれ。画面の幅と高さに対する割合で、右と下を正とする。 */
export type CornerOffset = readonly [x: number, y: number];

/** 四隅のずれ。左上、右上、右下、左下の順。 */
export type Keystone = readonly [CornerOffset, CornerOffset, CornerOffset, CornerOffset];

/** 角の名前。`Keystone` と同じ順。 */
export const CORNER_LABELS = ["左上", "右上", "右下", "左下"] as const;

/** 補正しない状態。 */
export const IDENTITY_KEYSTONE: Keystone = [
	[0, 0],
	[0, 0],
	[0, 0],
	[0, 0],
];

/** 一つの角を動かせる範囲（画面の幅と高さに対する割合）。 */
export const KEYSTONE_LIMIT = 0.5;

/** 角の元の位置（画面の幅と高さに対する割合）。 */
const BASE: readonly CornerOffset[] = [
	[0, 0],
	[1, 0],
	[1, 1],
	[0, 1],
];

export function isIdentityKeystone(keystone: Keystone): boolean {
	return keystone.every(([x, y]) => x === 0 && y === 0);
}

/** 補正後の四隅の位置（画素）。 */
export function keystoneCorners(keystone: Keystone, width: number, height: number): [number, number][] {
	return keystone.map(([x, y], index) => [(BASE[index][0] + x) * width, (BASE[index][1] + y) * height]);
}

/**
 * 四隅が凸な四角形を、元の画面と同じ向き（時計回り）に囲むか。凹んだりねじれたりした四角形へは射影変換で
 * 写せない（画面の一部が無限遠へ飛ぶ）ので、そうなる動かし方は受け付けない。
 */
export function isValidKeystone(keystone: Keystone): boolean {
	// 幅と高さを正の数で拡大しても凸かどうかと向きは変わらないので、割合のまま確かめる。
	const points = keystoneCorners(keystone, 1, 1);
	for (let index = 0; index < 4; index++) {
		const [ax, ay] = points[index];
		const [bx, by] = points[(index + 1) % 4];
		const [cx, cy] = points[(index + 2) % 4];
		// 画面座標（yが下向き）で時計回りなら、隣り合う辺の外積は正になる。
		if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0) return false;
	}
	return true;
}

/**
 * 画面（`width` × `height`、左上が原点）を補正後の四角形へ写す CSS の `matrix3d()`。`transform-origin` は `0 0` で使う。
 * 補正しない状態では `none`。
 */
export function keystoneTransform(keystone: Keystone, width: number, height: number): string {
	if (isIdentityKeystone(keystone) || width <= 0 || height <= 0) return "none";
	const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = keystoneCorners(keystone, width, height);
	// 単位正方形から四角形への射影変換（Heckbert, 1989）。
	const dx1 = x1 - x2;
	const dx2 = x3 - x2;
	const dx3 = x0 - x1 + x2 - x3;
	const dy1 = y1 - y2;
	const dy2 = y3 - y2;
	const dy3 = y0 - y1 + y2 - y3;
	const den = dx1 * dy2 - dx2 * dy1;
	const g = (dx3 * dy2 - dx2 * dy3) / den;
	const h = (dx1 * dy3 - dx3 * dy1) / den;
	const a = x1 - x0 + g * x1;
	const b = x3 - x0 + h * x3;
	const d = y1 - y0 + g * y1;
	const e = y3 - y0 + h * y3;
	// 画面の画素を単位正方形へ縮めてから写す。
	const m = [a / width, b / height, x0, d / width, e / height, y0, g / width, h / height];
	const [ma, mb, mc, md, me, mf, mg, mh] = m.map((value) => Number(value.toPrecision(10)));
	// 列優先の4×4。z は使わない。
	return `matrix3d(${ma}, ${md}, 0, ${mg}, ${mb}, ${me}, 0, ${mh}, 0, 0, 1, 0, ${mc}, ${mf}, 0, 1)`;
}

/** 画面上の点（画素）を射影変換で写した先。確かめるときに使う。 */
export function applyKeystone(
	keystone: Keystone,
	width: number,
	height: number,
	x: number,
	y: number,
): [number, number] {
	const transform = keystoneTransform(keystone, width, height);
	if (transform === "none") return [x, y];
	const values = transform.slice("matrix3d(".length, -1).split(",").map(Number);
	// 列優先の4×4のうち、x、y、w の行だけ使う。
	const px = values[0] * x + values[4] * y + values[12];
	const py = values[1] * x + values[5] * y + values[13];
	const pw = values[3] * x + values[7] * y + values[15];
	return [px / pw, py / pw];
}

/** 保存した値を読む。形が違う、範囲の外、または写せない四角形なら `null`。 */
export function parseKeystone(value: unknown): Keystone | null {
	if (!Array.isArray(value) || value.length !== 4) return null;
	for (const corner of value) {
		if (!Array.isArray(corner) || corner.length !== 2) return null;
		for (const component of corner) {
			if (typeof component !== "number" || !Number.isFinite(component) || Math.abs(component) > KEYSTONE_LIMIT) {
				return null;
			}
		}
	}
	const keystone = value as unknown as Keystone;
	return isValidKeystone(keystone) ? keystone : null;
}

/** 一つの角を動かした補正。範囲の外へは出さず、写せない四角形になるなら元のまま返す。 */
export function moveCorner(keystone: Keystone, index: number, offset: CornerOffset): Keystone {
	const clamp = (value: number) => Math.min(KEYSTONE_LIMIT, Math.max(-KEYSTONE_LIMIT, value));
	const next = keystone.map((corner, at) =>
		at === index ? ([clamp(offset[0]), clamp(offset[1])] as const) : corner,
	) as unknown as Keystone;
	return isValidKeystone(next) ? next : keystone;
}
