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
/** 破片の面の曲がりの偏りと揺れを決める擬似乱数の種。配置の乱数列と分け、光の筋を加えても配置が変わらないようにする。 */
const CURVE_SEED = 0x7117ab1e;

/**
 * 光の筋を作る点光源の位置。`x` は画面幅に対する比、`y` は画面の高さに対する比、`z`（画面から手前への距離）は
 * 画面短辺に対する比。視点は画面の正面の無限遠に置く。
 */
const SHARD_LIGHT = { x: 0.2, y: 0.15, z: 0.5 } as const;
/**
 * 破片の面の曲がり（ラジアン）。破片を長い向きを軸にわずかに曲げた鏡と見なし、幅の中央から端までで面の法線が
 * この角度だけ幅の向きへ倒れる。
 */
const CURVE = 0.6;
/** 破片の揺れの振れ幅（ラジアン）。揺れると面の法線が幅の向きへ傾き、光の筋が面の上を横切るように走る。 */
const ROCK = 0.6;
/** 破片の長い向きが光源の向きとそろうにつれて光の筋が暗くなる度合い（Blinn-Phongの指数）。直交するとき最も明るい。 */
const STREAK_SHARPNESS = 120;
/** 光の筋を描く明るさの下限。 */
const STREAK_MIN = 0.05;
/** 光の筋の半分の幅（CSS画素）。筋はこの二倍の幅の線形グラデーションで描き、中央を最も明るくする。 */
export const SHARD_STREAK_HALF_WIDTH = 3;

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
	/** 面の上の光の筋。描かないときは `null`。 */
	streak: ShardStreak | null;
}

/**
 * 破片の面の上の光の筋。破片の長い向きに沿う細い帯で、幅の向きに置いた `from` から `to` への線形グラデーションの
 * 中点を中心線が通る。`strength` は中心線の明るさ（0〜1）。
 */
export interface ShardStreak {
	from: Point;
	to: Point;
	strength: number;
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

/**
 * 破片の面の曲がりの偏りと揺れ。偏り `bias` に、初期位相 `rock`（ラジアン）と角速度 `rockSpeed`（ラジアン/ミリ秒）
 * による揺れの角度を足して、面の法線を幅の向きへ倒す。
 */
const nextCurve = random(CURVE_SEED);
const CURVES = Array.from({ length: RING_COUNT }, () => ({
	bias: (nextCurve() - 0.5) * 0.2,
	rock: nextCurve() * Math.PI * 2,
	rockSpeed: (Math.PI * 2) / (14_000 + 10_000 * nextCurve()),
}));

/**
 * 重心 `(x, y)`、長い向き `axis`（ラジアン）の破片の面にできる光の筋。破片を長い向きを軸に曲げた鏡と見なすと、
 * 法線が光源の向きと視点の向きの中間の向きに最も近づく場所が、長い向きに沿う一本の線になる。破片の幅の両端を
 * -1〜1 とした座標でその線の位置を求め、実際の幅へ変換する。明るさはBlinn-Phongの式（指数 `STREAK_SHARPNESS`）で求める。
 * 光源は `light`（CSS画素、`z` 成分は画面から手前への距離）、視点は正面の無限遠に置く。光源からの距離による
 * 減衰は入れず、筋の幅は破片の幅によらず一定にする。
 */
function streakOf(
	vertices: readonly Point[],
	x: number,
	y: number,
	axis: number,
	curve: (typeof CURVES)[number],
	elapsed: number,
	light: readonly [number, number, number],
): ShardStreak | null {
	const [ux, uy] = [Math.cos(axis), Math.sin(axis)];
	const [wx, wy] = [-uy, ux];
	const [lx, ly, lz] = [light[0] - x, light[1] - y, light[2]];
	const distance = Math.hypot(lx, ly, lz);
	// 光源の向きと視点の向き (0, 0, 1) の中間の向き。
	const [hx, hy, hz] = [lx / distance, ly / distance, lz / distance + 1];
	const half = Math.hypot(hx, hy, hz);
	const along = (hx * ux + hy * uy) / half;
	const across = (hx * wx + hy * wy) / half;
	// 法線を幅の向きへ倒して中間の向きに最も近づけたときの反射の強さ。長い向きの成分 `along` だけは合わせられず、
	// 最も近づけたときの内積は √(1 − along²) になる。その `STREAK_SHARPNESS` 乗なので、指数を半分にして累乗する。
	const strength = Math.max(0, 1 - along * along) ** (STREAK_SHARPNESS / 2);
	if (strength < STREAK_MIN) return null;
	const tilt = curve.bias + ROCK * Math.sin(curve.rock + ((elapsed * curve.rockSpeed) % (Math.PI * 2)));
	const position = (Math.atan2(across, hz / half) - tilt) / CURVE;
	const spans = vertices.map(([px, py]) => (px - x) * wx + (py - y) * wy);
	const [low, high] = [Math.min(...spans), Math.max(...spans)];
	const offset = (low + high) / 2 + (position * (high - low)) / 2;
	if (offset < low - SHARD_STREAK_HALF_WIDTH || offset > high + SHARD_STREAK_HALF_WIDTH) return null;
	const [cx, cy] = [x + wx * offset, y + wy * offset];
	return {
		from: [cx - wx * SHARD_STREAK_HALF_WIDTH, cy - wy * SHARD_STREAK_HALF_WIDTH],
		to: [cx + wx * SHARD_STREAK_HALF_WIDTH, cy + wy * SHARD_STREAK_HALF_WIDTH],
		strength,
	};
}

const next = random(SEED);
const RING: readonly Shard[] = Array.from({ length: RING_COUNT }, () => {
	const angle = next() * Math.PI * 2;
	// 三角分布で輪の中心線付近を密にする。
	const offset = (next() + next() - 1) * RING_SPREAD;
	return shard(next, angle, 1 + offset, 0.14 + 0.2 * next());
});

/**
 * 破片の形の長い向き（破片の向きからの角度、ラジアン）。頂点の主成分の向きで、細長い破片ではほぼ0になる。
 * 正三角形に近い破片でも、光の筋が形の長い向きに沿うようにする。
 */
const AXES = RING.map(({ points }) => {
	const [xx, yy, xy] = points.reduce(([a, b, c], [px, py]) => [a + px * px, b + py * py, c + px * py], [0, 0, 0]);
	return Math.atan2(2 * xy, xx - yy) / 2;
});

function pose(item: Shard, x: number, y: number, rotation: number, unit: number): Omit<ShardPose, "streak"> {
	const length = item.size * unit;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const vertices = item.points.map(
		([px, py]): Point => [x + (px * cos - py * sin) * length, y + (px * sin + py * cos) * length],
	);
	return { x, y, vertices, shade: item.shade, alpha: item.alpha };
}

/** 輪の呼吸の振れ幅（輪の半径に対する比、片側）。 */
export const BREATH_DEPTH = 0.1;
/**
 * 輪の呼吸を作る三つの波の周期（ミリ秒）、重み、位相（ラジアン）。周期の比を互いに素な15:23:41にして
 * 重ね、呼吸の深さと間隔が不規則に見えるようにする。三つを重ねた呼吸は `BREATH_CYCLE` で同じ形へ戻る。
 * 重みの合計は1。
 */
const BREATH_WAVES = [
	{ period: 15_000, weight: 0.5, phase: 0.4 },
	{ period: 23_000, weight: 0.3, phase: 2.1 },
	{ period: 41_000, weight: 0.2, phase: 4.6 },
] as const;

/** 三つの波を重ねた呼吸の周期（ミリ秒）。15秒、23秒、41秒の最小公倍数の14,145秒（約3.9時間）。 */
export const BREATH_CYCLE = 14_145_000;

/**
 * 経過時間 `elapsed`（ミリ秒）での輪の半径の倍率（1 ± `BREATH_DEPTH`）。輪全体がゆっくり不規則に
 * ふくらんだり縮んだりする。補正済みサーバー時刻から求めるので、全画面で同じになる。
 */
export function ringBreath(elapsed: number): number {
	const wave = BREATH_WAVES.reduce(
		(sum, { period, weight, phase }) =>
			sum + weight * Math.sin(phase + ((elapsed % period) / period) * Math.PI * 2),
		0,
	);
	return 1 + BREATH_DEPTH * wave;
}

/** 輪の破片の位置。画面中央を中心に時計回りに公転し、輪の接線方向を向いたまま自転し、輪全体が呼吸する。 */
function ringPoses(width: number, height: number, elapsed: number): ShardPose[] {
	const radius = Math.min(width, height) * SHARD_RING_RADIUS;
	const breath = ringBreath(elapsed);
	const cx = width / 2;
	const cy = height / 2;
	const light = [width * SHARD_LIGHT.x, height * SHARD_LIGHT.y, Math.min(width, height) * SHARD_LIGHT.z] as const;
	return RING.map((item, index) => {
		const theta = item.a + (((elapsed * item.speed) % ORBIT_MS) / ORBIT_MS) * Math.PI * 2;
		const r =
			radius * breath * (item.b + 0.04 * Math.sin(item.sway + ((elapsed * item.swaySpeed) % (Math.PI * 2))));
		const rotation = theta + Math.PI / 2 + item.spin + ((elapsed * item.spinSpeed * 0.3) % (Math.PI * 2));
		const [x, y] = [cx + Math.cos(theta) * r, cy + Math.sin(theta) * r];
		const base = pose(item, x, y, rotation, radius);
		const streak = streakOf(base.vertices, x, y, rotation + AXES[index], CURVES[index], elapsed, light);
		return { ...base, streak };
	});
}

/** 経過時間 `elapsed`（ミリ秒）での輪の全破片の位置。 */
export function shardPoses(width: number, height: number, elapsed: number): ShardPose[] {
	return ringPoses(width, height, elapsed);
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
