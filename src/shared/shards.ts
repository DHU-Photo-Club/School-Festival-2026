// 三角形の破片の輪の配置と動き（docs/visual-language.md 3.2〜3.4節、4.4節）。
// 展示ディスプレイで、質問中から結果色が広がり始めるまで描く。配置は固定の種から作り、位置は経過時間だけから決まる。

/** 輪の半径（画面短辺に対する比）。 */
export const SHARD_RING_RADIUS = 0.38;
/** 輪の半径方向の散らばり（輪の半径に対する比、片側）。 */
const RING_SPREAD = 0.2;
/**
 * 散らばりを最大にしたとき、輪の外側へ広げる距離（輪の半径に対する比）。輪の内側の縁（`SHARD_RING_RADIUS`）は
 * 動かさず、各破片をその散らばりの順位に応じて外側へ押し出す。輪の半径の2.6倍は、16:9の画面の隅までの距離に近い。
 */
export const SHARD_SCATTER_DEPTH = 1.6;
const RING_COUNT = 130;
/** 破片が現れる／消えるときに、同時に不透明度が変わっていく枚数。小さいと一枚ずつ急に現れる。 */
const DENSITY_FADE_COUNT = 50;
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 32ビットの種から [0, 1) の擬似乱数列を作る（mulberry32）。 */
export function random(seed: number): () => number {
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
		alpha: 0.6 + 0.35 * next(),
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

/**
 * 輪の破片の位置。画面中央を中心に時計回りに公転し、輪の接線方向を向いたまま自転し、輪全体が呼吸する。
 * `scale` は輪の半径だけにかける倍率、`size` は破片の大きさにかける倍率。`spread` は輪の太さの広がりで、
 * 0なら輪、1なら輪の内側の縁を残したまま、画面いっぱいに散らばる（`SHARD_SCATTER_DEPTH`）。`density` は見せる破片の割合で、
 * 先頭から数えた枚数だけ見せ、境の `DENSITY_FADE_COUNT` 枚は不透明度を段階的に変えて、一枚ずつ急に現れないようにする。見せない破片も配列には残し、並び順を変えない
 * （色づけは並び順で二色へ振り分けるため）。
 */
function ringPoses(
	width: number,
	height: number,
	elapsed: number,
	scale: number,
	density: number,
	size: number,
	spread: number,
	idleFit: number,
	orbitAdvance: number,
): ShardPose[] {
	// 破片の大きさは通常の輪の半径で決め、`scale` で縮めるのは輪の半径だけにする。
	const unit = Math.min(width, height) * SHARD_RING_RADIUS;
	const radius = unit * scale;
	const shardUnit = unit * size;
	const breath = ringBreath(elapsed);
	const cx = width / 2;
	const cy = height / 2;
	return RING.map((item, index) => {
		const theta = item.a + ((((elapsed + orbitAdvance) * item.speed) % ORBIT_MS) / ORBIT_MS) * Math.PI * 2;
		// 輪の中の位置（内側の縁0〜外側の縁1）に応じて、散らばるときの距離を決める。
		const rank = (item.b - 1 + RING_SPREAD) / (2 * RING_SPREAD);
		const b = item.b + (1 + rank * SHARD_SCATTER_DEPTH - item.b) * spread;
		const r = radius * breath * (b + 0.04 * Math.sin(item.sway + ((elapsed * item.swaySpeed) % (Math.PI * 2))));
		const rotation = theta + Math.PI / 2 + item.spin + ((elapsed * item.spinSpeed * 0.3) % (Math.PI * 2));
		const [x, y] = [cx + Math.cos(theta) * r, cy + Math.sin(theta) * r];
		const base = pose(item, x, y, rotation, shardUnit);
		if (idleFit > 0) {
			// 位置・自転・呼吸の計算はそのまま。接線方向を残し、外へ突き出す幅だけ抑える。
			const fit = clamp01(idleFit);
			const radialScale = 1 - 0.3 * fit;
			const rx = Math.cos(theta);
			const ry = Math.sin(theta);
			base.vertices = base.vertices.map(([vx, vy]): Point => {
				const dx = vx - x;
				const dy = vy - y;
				const radial = (dx * rx + dy * ry) * radialScale;
				const tangent = -dx * ry + dy * rx;
				return [x + radial * rx - tangent * ry, y + radial * ry + tangent * rx];
			});
		}
		const visible = clamp01((density * (RING_COUNT + DENSITY_FADE_COUNT) - index) / DENSITY_FADE_COUNT);
		return { ...base, alpha: base.alpha * visible };
	});
}

/**
 * 経過時間 `elapsed`（ミリ秒）での輪の全破片の位置。`scale` は輪の半径の倍率（1が通常の大きさ）、`size` は
 * 破片の大きさの倍率（1が通常の大きさ）、`spread` は輪の太さの広がり（0が輪、1が画面いっぱいの散らばり）、
 * `density` は見せる破片の割合（1が全枚数）。見せない破片は不透明度0で返す。
 */
export function shardPoses(
	width: number,
	height: number,
	elapsed: number,
	{
		scale = 1,
		density = 1,
		size = 1,
		spread = 0,
		idleFit = 0,
		orbitAdvance = 0,
	}: { scale?: number; density?: number; size?: number; spread?: number; idleFit?: number; orbitAdvance?: number } = {},
): ShardPose[] {
	return ringPoses(width, height, elapsed, scale, density, size, spread, idleFit, orbitAdvance);
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
 * 破片を並び順で `colors` へ順に振り分け（二色なら偶数番目が一色目、奇数番目が二色目）、灰色からその色へ
 * `amount`（0〜1）だけ寄せる。
 */
export function shardColor(
	shade: number,
	index: number,
	tint?: { colors: readonly Rgb[]; amount: number },
): [number, number, number] {
	const gray = shade * 255;
	if (!tint || tint.amount <= 0) return [gray, gray, gray];
	const base = tint.colors[index % tint.colors.length];
	const lighten = ((shade - SHADE_MIN) / (1 - SHADE_MIN)) * TINT_LIGHTEN;
	const mix = (value: number) => gray + (value + (255 - value) * lighten - gray) * tint.amount;
	return [mix(base[0]), mix(base[1]), mix(base[2])];
}

/** 破片のアウトラインの色（0〜255の三成分）。塗りの色 `fill`（各成分0〜255）を白へ `OUTLINE_LIGHTEN` だけ寄せる。 */
export function shardOutlineColor(fill: Rgb): [number, number, number] {
	const lift = (value: number) => value + (255 - value) * OUTLINE_LIGHTEN;
	return [lift(fill[0]), lift(fill[1]), lift(fill[2])];
}

/** 回答後2.2秒だけ回転をふわっと加速する積分値。終了後も角度を保ち、逆戻りさせない。 */
export function answerOrbitAdvance(elapsed: number): number {
	const duration = 2200;
	const t = Math.max(0, Math.min(duration, elapsed));
	return 4 * (t / 2 - duration * Math.sin(2 * Math.PI * t / duration) / (4 * Math.PI));
}
