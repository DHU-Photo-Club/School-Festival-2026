import type { Rgb, ShardPose } from "../../shared/shards.ts";
import { shardColor, shardOutlineColor } from "../../shared/shards.ts";

/**
 * 光の筋の幅の向きの明るさの分布。線形グラデーションの位置と、中心線の不透明度に対する比。両端は透明で、
 * グラデーションの外も透明のまま塗る。
 */
export const SHARD_STREAK_PROFILE = [
	[0, 0],
	[0.3, 0.2],
	[0.5, 1],
	[0.7, 0.2],
	[1, 0],
] as const;

/** 破片のアウトラインの太さ（CSS画素）。線は輪郭を中心にして引き、内側の半分は塗りの下になる。 */
export const SHARD_OUTLINE_WIDTH = 1;

/** 破片の色づけ。偶数番目の破片を `colors[0]`、奇数番目を `colors[1]` へ、灰色から `amount`（0〜1）だけ寄せる。 */
export interface ShardTint {
	colors: readonly [Rgb, Rgb];
	amount: number;
}

/**
 * 破片をcanvas 2Dへ描く。座標はCSS画素単位で、`ratio` はcanvasの画素数とCSS画素の比。
 * 破片は明るさに応じた灰色で描き、`tint` を渡すとその色へ寄せる（`shardColor`）。`opacity` は全体の不透明度。
 * `detail` が真なら、アウトラインと光の筋も描く。輪郭には塗りの色を白へ寄せた細いアウトラインを塗りと同じ
 * 不透明度で描き（`shardOutlineColor`）、その上に塗りを重ねて線の内側の半分を塗りの下にする。塗りの上には、
 * 光源を映した細い光の筋（`ShardPose.streak`）を、中央が最も明るい白の線形グラデーションで重ねる。筋の中心線の
 * 不透明度は、筋の明るさに破片ごとの不透明度と `opacity` を掛けたもの。
 */
export function drawShards(
	context: CanvasRenderingContext2D,
	poses: readonly ShardPose[],
	ratio: number,
	opacity: number,
	tint?: ShardTint,
	detail = true,
): void {
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	if (opacity <= 0) return;
	context.save();
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.lineWidth = SHARD_OUTLINE_WIDTH;
	// 細い三角形の鋭い角でアウトラインが頂点の先へ伸びないよう、角を丸める。
	context.lineJoin = "round";
	const rgba = ([r, g, b]: readonly number[], alpha: string) =>
		`rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
	const white = (alpha: number) => rgba([255, 255, 255], alpha.toFixed(3));
	poses.forEach((item, index) => {
		const fill = shardColor(item.shade, index, tint);
		const alpha = (item.alpha * opacity).toFixed(3);
		context.beginPath();
		item.vertices.forEach(([x, y], vertex) => {
			if (vertex === 0) context.moveTo(x, y);
			else context.lineTo(x, y);
		});
		context.closePath();
		if (detail) {
			context.strokeStyle = rgba(shardOutlineColor(fill), alpha);
			context.stroke();
		}
		context.fillStyle = rgba(fill, alpha);
		context.fill();
		if (detail && item.streak) {
			const { from, to, strength } = item.streak;
			const peak = strength * item.alpha * opacity;
			const gradient = context.createLinearGradient(from[0], from[1], to[0], to[1]);
			for (const [offset, share] of SHARD_STREAK_PROFILE) gradient.addColorStop(offset, white(peak * share));
			context.fillStyle = gradient;
			context.fill();
		}
	});
	context.restore();
}

/** `#RRGGBB` を0〜255の三成分へ変換する。 */
export function hexToRgb(color: string): Rgb {
	const value = Number.parseInt(color.slice(1, 7), 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * ブルームを描くcanvasの解像度（CSS画素に対する比）。ぼかしてから引き伸ばすので、低い解像度で足りる。
 * ブルームは破片の光のにじみ（docs/visual-language.md 4.4節）で、結果色の広がりの `bloom` プリミティブ（3.4節）とは別。
 */
export const SHARD_BLOOM_SCALE = 1 / 8;
/** ブルームの二段のぼかし幅（画面短辺に対する比、ガウスぼかしの標準偏差）と重み。広い段を主にする。 */
const SHARD_BLOOM_PASSES = [
	{ spread: 0.012, weight: 0.35 },
	{ spread: 0.045, weight: 0.65 },
] as const;

/** ブルームの下描きに使うcanvas。ブルームのcanvasと同じ大きさにして使い回す。 */
let scratch: HTMLCanvasElement | null = null;

/**
 * 破片をブルームのcanvasの解像度で描き直し、ぼかしてブルームのcanvasへ描く（docs/visual-language.md 4.4節）。
 * 破片の大きなcanvasを縮小しないので、負荷は画面の解像度にほとんど依存しない。`ratio` はブルームのcanvasの
 * 画素数とCSS画素の比、`unit` は画面短辺のCSS画素数。`poses` が空ならブルームを消す。
 * ぼかしはcanvas 2Dの `filter` で行い、使えない環境ではブルームを描かない。
 */
export function drawShardBloom(
	context: CanvasRenderingContext2D,
	poses: readonly ShardPose[],
	ratio: number,
	unit: number,
	opacity: number,
	tint?: ShardTint,
): void {
	const { width, height } = context.canvas;
	context.globalCompositeOperation = "source-over";
	context.globalAlpha = 1;
	context.filter = "none";
	context.clearRect(0, 0, width, height);
	if (poses.length === 0 || opacity <= 0 || typeof context.filter !== "string") return;
	scratch ??= document.createElement("canvas");
	if (scratch.width !== width || scratch.height !== height) {
		scratch.width = width;
		scratch.height = height;
	}
	const draft = scratch.getContext("2d");
	if (!draft) return;
	// アウトラインと光の筋はこの解像度では1画素に満たず、ぼかすと見えないので描かない。
	drawShards(draft, poses, ratio, opacity, tint, false);
	context.globalCompositeOperation = "lighter";
	for (const { spread, weight } of SHARD_BLOOM_PASSES) {
		context.filter = `blur(${(unit * spread * ratio).toFixed(2)}px)`;
		context.globalAlpha = weight;
		context.drawImage(scratch, 0, 0);
	}
	context.filter = "none";
	context.globalAlpha = 1;
	context.globalCompositeOperation = "source-over";
}
