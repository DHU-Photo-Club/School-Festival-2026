import { random, shardPoses, type ShardPose } from "./shards.ts";
import type { DustPose } from "./dust.ts";
export const FINALE_SHRINK_MS = 1200;
export const FINALE_BURST_MS = 800;
export const FINALE_SETTLE_MS = 1800;
const clamp = (t: number) => Math.max(0, Math.min(1, t));
const out = (t: number) => 1 - (1 - clamp(t)) ** 3;
const smooth = (t: number) => (1 - Math.cos(Math.PI * clamp(t))) / 2;
const rng = random(0xf1a1e);
const seeds = Array.from({ length: 1600 }, () => Array.from({ length: 8 }, () => rng()));
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
function hexMix(a: string, b: string, p: number): string {
	const channels = [1, 3, 5].map((i) => Math.round(mix(parseInt(a.slice(i, i + 2), 16), parseInt(b.slice(i, i + 2), 16), p)).toString(16).padStart(2, "0"));
	return `#${channels.join("")}`;
}
/** 同じ種と時刻から常に同じ配色。余分な抽選や一斉の点滅をしない。 */
export function finaleColor(index: number, elapsed: number, colors: readonly string[], cycling: boolean): string {
	const seed = seeds[index % seeds.length];
	const period = 4000 + seed[0] * 3000;
	const phase = Math.max(0, elapsed) + seed[1] * period;
	const n = Math.floor(phase / period);
	const pick = (step: number) => colors[Math.floor((seed[2] + step * 0.61803398875) % 1 * colors.length)] ?? "#ffffff";
	return cycling ? hexMix(pick(n), pick(n + 1), smooth((phase % period) / 1500)) : pick(0);
}
export const finaleColors = (elapsed: number, colors: readonly string[], cycling: boolean) => Array.from({ length: 130 }, (_, i) => finaleColor(i, elapsed, colors, cycling));
/** 通常の回答加速に、判定待ち中の約2倍回転を滑らかに足す。 */
export function gatheringOrbit(elapsed: number): number {
	const t = Math.max(0, elapsed - FINALE_SHRINK_MS);
	return t - 700 * (1 - Math.exp(-t / 700));
}
/** 小リングの同じ破片から始まり、画面全体へ飛び出してそのまま漂う。 */
export function burstShards(width: number, height: number, startAt: number, elapsed: number, orbitAdvance: number): ShardPose[] {
	const origins = shardPoses(width, height, startAt, { scale: 0.3, density: 0.42, idleFit: 1, orbitAdvance });
	const p = out(elapsed / FINALE_BURST_MS);
	const drift = Math.max(0, elapsed - FINALE_BURST_MS) / 1000;
	return origins.map((piece, i) => {
		const seed = seeds[i];
		const angle = Math.atan2(piece.y - height / 2, piece.x - width / 2) + (seed[3] - 0.5) * 0.35;
		const edge = Math.min(width / 2 / Math.max(1e-6, Math.abs(Math.cos(angle))), height / 2 / Math.max(1e-6, Math.abs(Math.sin(angle))));
		const distance = Math.max(Math.hypot(piece.x - width / 2, piece.y - height / 2) + Math.min(width, height) * 0.04, edge * (0.2 + 0.76 * Math.sqrt(seed[4])));
		const x = mix(piece.x, width / 2 + Math.cos(angle) * distance, p) + Math.sin(drift * 0.18 + seed[4] * 6.28) * Math.min(width, height) * 0.025 * (1 - Math.exp(-drift));
		const y = mix(piece.y, height / 2 + Math.sin(angle) * distance, p) + Math.sin(drift * 0.14 + seed[5] * 6.28) * Math.min(width, height) * 0.025 * (1 - Math.exp(-drift));
		const spin = elapsed / 1000 * (seed[6] - 0.5) * 0.18;
		const c = Math.cos(spin), s = Math.sin(spin);
		return { ...piece, x, y, alpha: mix(piece.alpha, 0.6 + seed[7] * 0.3, p), vertices: piece.vertices.map(([vx, vy]) => [x + (vx - piece.x) * c - (vy - piece.y) * s, y + (vx - piece.x) * s + (vy - piece.y) * c] as const) };
	});
}
/** 同じ粒子IDを集約から爆発へ引き継ぐ。中央で消さず、少し留まって次の流入へ循環する。 */
export function finaleDust(width: number, height: number, gatherElapsed: number, colors: readonly string[], burstElapsed: number | null = null): DustPose[] {
	const short = Math.min(width, height), diagonal = Math.hypot(width, height) / 2;
	const fade = burstElapsed === null ? 1 : 1 - smooth((burstElapsed - FINALE_BURST_MS) / 1000);
	if (gatherElapsed <= 0 || fade <= 0) return [];
	const gatheringColors = colors.map((_, i) => finaleColor(i, gatherElapsed, colors, true));
	return seeds.flatMap((seed, i): DustPose[] => {
		const age = gatherElapsed - i / seeds.length * 9200;
		if (age < 0) return [];
		const period = 5500 + seed[0] * 3000;
		const phase = (age % period) / period;
		const angle = seed[1] * Math.PI * 2 + seed[2] * smooth(phase / 0.75);
		const radius = mix(diagonal * 1.1, short * (0.015 + seed[3] * 0.035), smooth(phase / 0.75));
		const launch = burstElapsed === null ? 0 : diagonal * 2.2 * out(burstElapsed / 1200);
		const alpha = (0.4 + seed[4] * 0.55) * smooth(phase / 0.12) * (1 - smooth((phase - 0.94) / 0.06)) * fade;
		if (alpha < 0.004) return [];
		return [{ x: width / 2 + Math.cos(angle) * (radius + launch), y: height / 2 + Math.sin(angle) * (radius + launch), size: 1.5 + seed[5] * 3, alpha, color: burstElapsed === null ? gatheringColors[i % Math.max(1, colors.length)] : finaleColor(i, gatherElapsed, colors, false) }];
	});
}
