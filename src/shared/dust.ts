// 判定中に、画面の外から中心へ集まっていく細かい塵（docs/visual-language.md 3.3節）。
// 配置は固定の種から作り、位置と不透明度は経過時間だけから求めるので、補正済みサーバー時刻を使う全画面で同じになる。
import { JUDGING_MS, SETTLE_MARGIN_MS } from "./machine.ts";
import { random } from "./shards.ts";

/** 塵の最大数。 */
export const DUST_COUNT = 1600;
/** 塵の数と濃さが最大になるまでの時間（`judging` の開始から）。結果が決まる最短の時刻の、色づきの直前に合わせる。 */
export const DUST_RAMP_MS = JUDGING_MS - SETTLE_MARGIN_MS;
/** 塵の色。 */
export const DUST_COLOR = "232, 230, 227";
const SEED = 0xd057;

interface Mote {
	/** 中心から見た向き（ラジアン）。 */
	angle: number;
	/** 外から中心へ進む間に、向きを回す量（ラジアン）。 */
	swirl: number;
	/** 画面の縁の外へ置く距離（画面短辺に対する比）。 */
	overshoot: number;
	/** 消える半径（画面短辺に対する比）。 */
	end: number;
	/** 外から消えるまでの一周の時間（ミリ秒）。 */
	period: number;
	/** 現れ始める時刻（`judging` の開始から、ミリ秒）。後ろの塵ほど遅い。 */
	enter: number;
	/** 大きさ（CSS画素）。 */
	size: number;
	/** 最も濃いときの不透明度。 */
	alpha: number;
	/** 横揺れの位相と振幅（画面短辺に対する比）。 */
	sway: number;
	swayAmount: number;
}

const MOTES: readonly Mote[] = (() => {
	const next = random(SEED);
	return Array.from({ length: DUST_COUNT }, (_, index): Mote => {
		const rank = index / DUST_COUNT;
		return {
			angle: next() * Math.PI * 2,
			swirl: (next() - 0.5) * 0.9,
			overshoot: 0.03 + next() * 0.1,
			end: 0.01 + next() * 0.06,
			period: 5_000 + next() * 3_500,
			// 数は時間とともに加速して増える。
			enter: DUST_RAMP_MS * rank ** 0.7,
			size: 2 + next() ** 2 * 3.5,
			alpha: 0.45 + next() * 0.5,
			sway: next() * Math.PI * 2,
			swayAmount: 0.004 + next() * 0.01,
		};
	});
})();

/** 一粒の塵を描く位置。座標はCSS画素単位で、画面の左上が原点。 */
export interface DustPose {
	x: number;
	y: number;
	/** 直径（CSS画素）。 */
	size: number;
	/** 不透明度（0〜1）。 */
	alpha: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * clamp01(t))) / 2;
const smooth = (t: number) => easeInOutSine(clamp01(t));

/**
 * 経過時間 `elapsed`（ミリ秒、`judging` の開始から）での塵。`fade` は全体の不透明度の倍率（0〜1）。
 * 塵は画面の縁の外に現れ、ゆるやかに向きを回しながら中心へ集まり、中心の近くで消える。消えるとまた外から現れる。
 * 現れ始める時刻を塵ごとにずらし、時間とともに数が増え、一粒ずつの濃さも増す。まだ現れていない塵は含めない。
 */
export function dustPoses(elapsed: number, width: number, height: number, fade = 1): DustPose[] {
	if (elapsed <= 0 || fade <= 0) return [];
	const short = Math.min(width, height);
	const ramp = smooth(elapsed / DUST_RAMP_MS);
	// 全体の濃さ。始めは薄く、少しずつ濃くなる。
	const density = (0.4 + 0.6 * ramp) * clamp01(fade);
	const poses: DustPose[] = [];
	for (const mote of MOTES) {
		const age = elapsed - mote.enter;
		if (age < 0) break;
		const progress = (age % mote.period) / mote.period;
		const p = easeInOutSine(progress);
		// 向きの先で画面の縁に当たるまでの距離。そこから少し外を出発点にする。
		const cos = Math.abs(Math.cos(mote.angle));
		const sin = Math.abs(Math.sin(mote.angle));
		const edge = Math.min(cos > 1e-6 ? width / 2 / cos : Infinity, sin > 1e-6 ? height / 2 / sin : Infinity);
		const start = edge + mote.overshoot * short;
		const radius = start + (mote.end * short - start) * p;
		const angle = mote.angle + mote.swirl * p;
		const sway = Math.sin(mote.sway + age / 2_300) * mote.swayAmount * short * Math.sin(Math.PI * progress);
		// 縁を越える頃までに現れ、中心の近くで消える。
		const visible = smooth(progress / 0.18) * (1 - smooth((progress - 0.78) / 0.22));
		const alpha = mote.alpha * density * visible;
		if (alpha < 0.004) continue;
		poses.push({
			x: width / 2 + Math.cos(angle) * radius - Math.sin(angle) * sway,
			y: height / 2 + Math.sin(angle) * radius + Math.cos(angle) * sway,
			size: mote.size * (1 - 0.3 * p),
			alpha,
		});
	}
	return poses;
}
