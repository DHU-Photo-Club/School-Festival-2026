// 三角形の破片の輪と床の配置と動き（docs/visual-language.md 3.2節、4.4節）。
// iPadの待機画面と展示ディスプレイの質問中で同じ配置を使う。配置は固定の種から作り、位置は経過時間だけから決まる。

/** 輪の半径（画面短辺に対する比）。 */
export const SHARD_RING_RADIUS = 0.38;
/** 輪の半径方向の散らばり（輪の半径に対する比、片側）。 */
const RING_SPREAD = 0.2;
const RING_COUNT = 130;
const FLOOR_COUNT = 110;
/** 輪の一周の周期（ミリ秒）。 */
const ORBIT_MS = 150_000;
/** 床の破片が画面幅を一度流れる周期（ミリ秒）。 */
const FLOOR_DRIFT_MS = 210_000;
/** 床の上端（画面の高さに対する比）。 */
const FLOOR_TOP = 0.78;
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
	/** 自転の初期角（ラジアン）と角速度（ラジアン/ミリ秒）。 */
	spin: number;
	spinSpeed: number;
	/** 揺れの位相（ラジアン）と角速度（ラジアン/ミリ秒）。 */
	sway: number;
	swaySpeed: number;
	/** 輪: 初期角（ラジアン）、半径の比。床: 横位置の比、高さの比。 */
	a: number;
	b: number;
	/** 公転または流れる速度の倍率。 */
	speed: number;
}

/** 一枚の破片の描く位置。座標は画面の画素単位。 */
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
const FLOOR: readonly Shard[] = Array.from({ length: FLOOR_COUNT }, () => {
	const x = next();
	// 下端ほど密にする。
	const y = FLOOR_TOP + (1.04 - FLOOR_TOP) * Math.sqrt(next());
	return shard(next, x, y, 0.07 + 0.11 * next());
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

/**
 * 経過時間 `elapsed`（ミリ秒）での全破片の位置。輪は画面中央を中心に時計回りに公転し、破片は輪の接線方向を
 * 向いたまま自転する。床は輪の下端と同じ向き（左）へ流れ、画面の端で反対側へ回り込む。
 * `swell` は輪の半径の倍率。
 */
export function shardPoses(width: number, height: number, elapsed: number, swell = 1): ShardPose[] {
	const unit = Math.min(width, height);
	const radius = unit * SHARD_RING_RADIUS;
	const cx = width / 2;
	const cy = height / 2;
	const poses: ShardPose[] = [];

	for (const item of RING) {
		const theta = item.a + (((elapsed * item.speed) % ORBIT_MS) / ORBIT_MS) * Math.PI * 2;
		const r = radius * swell * (item.b + 0.04 * Math.sin(item.sway + ((elapsed * item.swaySpeed) % (Math.PI * 2))));
		const rotation = theta + Math.PI / 2 + item.spin + ((elapsed * item.spinSpeed * 0.3) % (Math.PI * 2));
		poses.push(pose(item, cx + Math.cos(theta) * r, cy + Math.sin(theta) * r, rotation, radius));
	}

	const margin = unit * 0.2;
	const span = width + margin * 2;
	for (const item of FLOOR) {
		const travel = (((elapsed * item.speed) % FLOOR_DRIFT_MS) / FLOOR_DRIFT_MS) * span;
		const x = ((((item.a * span - travel) % span) + span) % span) - margin;
		const y = height * item.b + unit * 0.012 * Math.sin(item.sway + ((elapsed * item.swaySpeed) % (Math.PI * 2)));
		const rotation =
			item.spin * 0.35 + 0.25 * Math.sin(item.sway * 0.5 + ((elapsed * item.spinSpeed) % (Math.PI * 2)));
		poses.push(pose(item, x, y, rotation, unit));
	}
	return poses;
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
};

/**
 * 8色の並びの区画番号 `position` での色。`colors[i]` は番号 `i` から `i + 1` を占め（8区画で一巡する）、
 * 隣の区画の中央へ向けて `blend` の幅で溶け合う（docs/visual-language.md 3.2節）。
 */
export function spectrumColor(
	position: number,
	colors: readonly (readonly [number, number, number])[],
	blend: number,
): [number, number, number] {
	const s = position - 0.5;
	const i0 = Math.floor(s);
	const w = smoothstep(0.5 - blend / 2, 0.5 + blend / 2, s - i0);
	const n = colors.length;
	const a = colors[((i0 % n) + n) % n];
	const b = colors[(((i0 + 1) % n) + n) % n];
	return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}
