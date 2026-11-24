// 三角形の破片の輪の配置と動き（docs/visual-language.md 3.2〜3.4節、4.4節）。
// 展示ディスプレイで、質問中から結果色が広がり始めるまで描く。配置は固定の種から作り、位置は経過時間だけから決まる。

/** 輪の半径（画面短辺に対する比）。 */
export const SHARD_RING_RADIUS = 0.38;
/** 輪の半径方向の散らばり（輪の半径に対する比、片側）。 */
const RING_SPREAD = 0.2;
const RING_COUNT = 130;
/** 輪の一周の周期（ミリ秒）。 */
const ORBIT_MS = 150_000;
const SEED = 0x5eedc0de;

type Point = readonly [number, number];

interface Shard {
	/** 重心からの頂点座標。長さは基準長に対する比。 */
	points: readonly Point[];
	/** 基準長に対する破片の大きさ。 */
	size: number;
	/** 明るさ（0〜1）。 */
	shade: number;
	alpha: number;
	/** 自転の初期角（ラジアン）と角速度の基準値（ラジアン/ミリ秒）。輪では0.3倍して使う。 */
	spin: number;
	spinSpeed: number;
	/** 揺れの位相（ラジアン）と角速度（ラジアン/ミリ秒）。 */
	sway: number;
	swaySpeed: number;
	/** 初期角（ラジアン）と、輪の半径に対する比。 */
	a: number;
	b: number;
	/** 公転の速度の倍率。 */
	speed: number;
}

/** 一枚の破片を描く位置。座標はCSS画素単位。 */
export interface ShardPose {
	/** 重心。 */
	x: number;
	y: number;
	vertices: Point[];
	shade: number;
	alpha: number;
}

/** 32ビットの種から [0, 1) の擬似乱数列を作る（mulberry32）。 */
function random(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 細長い不規則な三角形の頂点を作る。x軸方向に長く、重心を原点に置く。 */
function triangle(next: () => number): Point[] {
	const squash = 0.25 + 0.4 * next();
	const start = next() * Math.PI * 2;
	const raw = [0, 1, 2].map((index): Point => {
		const angle = start + index * ((Math.PI * 2) / 3) + (next() - 0.5) * 1.2;
		const length = 0.45 + 0.55 * next();
		return [Math.cos(angle) * length, Math.sin(angle) * length * squash];
	});
	const cx = (raw[0][0] + raw[1][0] + raw[2][0]) / 3;
	const cy = (raw[0][1] + raw[1][1] + raw[2][1]) / 3;
	return raw.map(([x, y]): Point => [x - cx, y - cy]);
}

function shard(next: () => number, a: number, b: number, size: number): Shard {
	return {
		points: triangle(next),
		size,
		shade: (150 + 105 * next()) / 255,
		alpha: 0.3 + 0.45 * next(),
		spin: next() * Math.PI * 2,
		spinSpeed: ((next() < 0.5 ? -1 : 1) * Math.PI * 2) / (40_000 + 60_000 * next()),
		sway: next() * Math.PI * 2,
		swaySpeed: (Math.PI * 2) / (14_000 + 18_000 * next()),
		a,
		b,
		speed: 0.8 + 0.4 * next(),
	};
}

const next = random(SEED);
const RING: readonly Shard[] = Array.from({ length: RING_COUNT }, () => {
	const angle = next() * Math.PI * 2;
	// 三角分布で輪の中心線付近を密にする。
	const offset = (next() + next() - 1) * RING_SPREAD;
	return shard(next, angle, 1 + offset, 0.14 + 0.2 * next());
});

function pose(item: Shard, x: number, y: number, rotation: number, unit: number): ShardPose {
	const length = item.size * unit;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return {
		x,
		y,
		vertices: item.points.map(
			([px, py]): Point => [x + (px * cos - py * sin) * length, y + (px * sin + py * cos) * length],
		),
		shade: item.shade,
		alpha: item.alpha,
	};
}

/** 輪の破片の位置。画面中央を中心に時計回りに公転し、輪の接線方向を向いたまま自転する。`swell` は輪の半径の倍率。 */
function ringPoses(width: number, height: number, elapsed: number, swell: number): ShardPose[] {
	const radius = Math.min(width, height) * SHARD_RING_RADIUS;
	const cx = width / 2;
	const cy = height / 2;
	return RING.map((item) => {
		const theta = item.a + (((elapsed * item.speed) % ORBIT_MS) / ORBIT_MS) * Math.PI * 2;
		const r = radius * swell * (item.b + 0.04 * Math.sin(item.sway + ((elapsed * item.swaySpeed) % (Math.PI * 2))));
		const rotation = theta + Math.PI / 2 + item.spin + ((elapsed * item.spinSpeed * 0.3) % (Math.PI * 2));
		return pose(item, cx + Math.cos(theta) * r, cy + Math.sin(theta) * r, rotation, radius);
	});
}

/** 経過時間 `elapsed`（ミリ秒）での輪の全破片の位置。`swell` は輪の半径の倍率。 */
export function shardPoses(width: number, height: number, elapsed: number, swell = 1): ShardPose[] {
	return ringPoses(width, height, elapsed, swell);
}

/** 0〜255の三成分の色。 */
export type Rgb = readonly [number, number, number];

/** 色づけた破片を白へ寄せる最大の割合。明るい破片ほど白へ寄せる。 */
const TINT_LIGHTEN = 0.35;
/**
 * アウトライン用に破片の塗りの色を白へ寄せる割合。ハードライト合成は暗い背景の上で明るさの差を広げるので、
 * 小さく取る（docs/visual-language.md 4.4節）。
 */
const OUTLINE_LIGHTEN = 0.12;
/** 破片の明るさ `shade` の最小値。 */
const SHADE_MIN = 150 / 255;

/**
 * `index` 番目の破片の色（0〜255の三成分）。`tint` がなければ明るさ `shade` の灰色にする。`tint` があれば
 * 偶数番目を `colors[0]`、奇数番目を `colors[1]` へ振り分け、灰色からその色へ `amount`（0〜1）だけ寄せる。
 */
export function shardColor(
	shade: number,
	index: number,
	tint?: { colors: readonly [Rgb, Rgb]; amount: number },
): [number, number, number] {
	const gray = shade * 255;
	if (!tint || tint.amount <= 0) return [gray, gray, gray];
	const base = tint.colors[index % 2];
	const lighten = ((shade - SHADE_MIN) / (1 - SHADE_MIN)) * TINT_LIGHTEN;
	const mix = (value: number) => gray + (value + (255 - value) * lighten - gray) * tint.amount;
	return [mix(base[0]), mix(base[1]), mix(base[2])];
}

/** 破片のアウトラインの色（0〜255の三成分）。塗りの色 `fill`（各成分0〜255）を白へ `OUTLINE_LIGHTEN` だけ寄せる。 */
export function shardOutlineColor(fill: Rgb): [number, number, number] {
	const lift = (value: number) => value + (255 - value) * OUTLINE_LIGHTEN;
	return [lift(fill[0]), lift(fill[1]), lift(fill[2])];
}
