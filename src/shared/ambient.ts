import type { DustPose } from "./dust.ts";
import type { Scene } from "./motion.ts";
import type { DisplayState } from "./types.ts";
import { random } from "./shards.ts";
import { rippleRings } from "./ripple.ts";
const rng = random(0xa6b1e);
const particles = Array.from({ length: 180 }, () => Array.from({ length: 6 }, () => rng()));
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => (1 - Math.cos(Math.PI * clamp(t))) / 2;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** 下部の控えめな光粒。既存の描画状態だけを参照し、回答・進行・音声は変更しない。 */
export function ambientPoses(width: number, height: number, now: number, state: DisplayState, scene: Scene, speech: number, reduced: boolean): DustPose[] {
	const short = Math.min(width, height), layer = scene.shards;
	const gathering = state.phase === "judging" && !layer.burst;
	const age = now - state.phaseStartedAt;
	const merge = gathering && !reduced ? smooth(age / 2400) : 0;
	if (merge >= 1) return [];
	const time = reduced ? 0 : (gathering ? state.phaseStartedAt : now) / 1000;
	const resultReturn = !reduced && layer.burst ? smooth((layer.burst.elapsed - 1800) / 2200) : 1;
	const waves = !reduced && scene.ripple ? rippleRings(scene.ripple.elapsed, width, height) : [];
	return particles.map((seed, i) => {
		let x = width * (.025 + seed[0] * .95 + Math.sin(time * .055 + seed[1] * 6.28) * .035);
		let y = height * (.83 + seed[2] * .15 + Math.sin(time * .16 + seed[3] * 6.28) * .009);
		if (!reduced) {
			const wave = Math.sin(x / width * Math.PI * 8 - now / 320) * .65 + Math.sin(x / width * Math.PI * 17 + now / 210) * .35;
			y = mix(y, height * .9 + wave * short * .025, speech * .65);
			const dx = x - width / 2, dy = y - height / 2, radius = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
			let push = waves.reduce((sum, wave) => sum + Math.exp(-(((radius - wave.radius) / (short * .13)) ** 2)) * wave.alpha * short * .08, 0);
			// 拡大したリングに押されて退場し、縮小時には同じ経路から戻る。
			const ring = short * .38 * layer.scale * (1 + 1.6 * layer.spread);
			if (!layer.burst && !gathering) push += Math.max(0, ring + short * .08 - radius);
			x += Math.cos(angle) * push; y += Math.sin(angle) * push;
			if (gathering) {
				const targetAngle = angle + merge * .45;
				x = mix(x, width / 2 + Math.cos(targetAngle) * short * .114, merge);
				y = mix(y, height / 2 + Math.sin(targetAngle) * short * .114, merge);
			}
			y += (1 - resultReturn) * height * .25;
		}
		const color = layer.colors?.[i % layer.colors.length] ?? "#ffffff";
		const tint = layer.colors ? layer.tint : 0;
		const channels = [1, 3, 5].map(c => Math.round(mix(255, parseInt(color.slice(c, c + 2), 16), tint)).toString(16).padStart(2, "0"));
		return { x, y, size: 1 + seed[4] * 1.8, alpha: (.09 + seed[5] * .13) * (1 - smooth((merge - .55) / .45)) * resultReturn, color: `#${channels.join("")}` };
	});
}
