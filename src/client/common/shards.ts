import type { ShardPose } from "../../shared/shards.ts";

type Rgb = readonly [number, number, number];

/** 破片の色の濃淡。明るい破片ほど白へ寄せる割合。 */
const TINT_LIGHTEN = 0.35;
const SHADE_MIN = 150 / 255;

/**
 * 破片をcanvas 2Dへ描く。座標はCSS画素単位で、`ratio` はcanvasの画素数とCSS画素の比。
 * `tint` を渡すと破片の重心の横位置から色を決め、渡さなければ灰色で描く。`opacity` は全体の不透明度。
 */
export function drawShards(
	context: CanvasRenderingContext2D,
	poses: readonly ShardPose[],
	ratio: number,
	opacity: number,
	tint?: (x: number) => Rgb,
): void {
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	if (opacity <= 0) return;
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	for (const item of poses) {
		let rgb: Rgb;
		if (tint) {
			const base = tint(item.x);
			const lighten = ((item.shade - SHADE_MIN) / (1 - SHADE_MIN)) * TINT_LIGHTEN;
			rgb = [
				base[0] + (255 - base[0]) * lighten,
				base[1] + (255 - base[1]) * lighten,
				base[2] + (255 - base[2]) * lighten,
			];
		} else {
			const gray = item.shade * 255;
			rgb = [gray, gray, gray];
		}
		context.beginPath();
		item.vertices.forEach(([x, y], index) => {
			if (index === 0) context.moveTo(x, y);
			else context.lineTo(x, y);
		});
		context.closePath();
		context.fillStyle = `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${(item.alpha * opacity).toFixed(3)})`;
		context.fill();
	}
}

/** `#RRGGBB` を0〜255の三成分へ変換する。 */
export function hexToRgb(color: string): Rgb {
	const value = Number.parseInt(color.slice(1, 7), 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
