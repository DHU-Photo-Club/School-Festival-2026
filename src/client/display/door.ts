import type { RibbonPoint } from "../../shared/door.ts";
import type { Rgb } from "../../shared/palette.ts";

/**
 * 帯の重ね方。外側ほど太く薄くして、光のにじみを作る。`scale` は帯の幅に対する倍率。canvas要素のぼかし
 * （`DOOR_RIBBON_BLUR`）と合わせて、輪郭のない光に見せる。
 */
const LAYERS = [
	{ scale: 1.9, alpha: 0.28, add: false },
	{ scale: 1, alpha: 0.7, add: false },
	// 芯は加算で重ね、帯の中心を明るくする。
	{ scale: 0.35, alpha: 0.45, add: true },
] as const;

/** 扉の中の光をぼかす量。扉の幅に対する割合。 */
export const DOOR_RIBBON_BLUR = 0.06;

/**
 * 縦のグラデーションの色止め。上端と下端をこの画面の色、下寄りをもう一方の色にする。`stops` は一色目から
 * 二色目への色止めで、行きと帰りの両方に使う。
 */
function ribbonGradient(context: CanvasRenderingContext2D, height: number, stops: readonly Rgb[]): CanvasGradient {
	const gradient = context.createLinearGradient(0, 0, 0, height);
	const css = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;
	// 色止めが1件だけのときは、その色の単色にする。
	const last = Math.max(1, stops.length - 1);
	gradient.addColorStop(0, css(stops[0]));
	for (const [i, stop] of stops.entries()) {
		gradient.addColorStop(0.15 + (0.5 * i) / last, css(stop));
		gradient.addColorStop(1 - (0.35 * i) / last, css(stop));
	}
	return gradient;
}

/**
 * 扉の中の光の帯をcanvas 2Dへ描く。`points` は `ribbonPoints` の結果で、canvas全体を扉の内側とみなす。
 * `points` が空ならcanvasを消すだけにする。
 */
export function drawDoorRibbon(
	context: CanvasRenderingContext2D,
	points: readonly RibbonPoint[],
	stops: readonly Rgb[],
): void {
	const { width, height } = context.canvas;
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, width, height);
	if (points.length < 2 || stops.length === 0) return;
	context.fillStyle = ribbonGradient(context, height, stops);
	for (const layer of LAYERS) {
		context.globalAlpha = layer.alpha;
		context.globalCompositeOperation = layer.add ? "lighter" : "source-over";
		context.beginPath();
		points.forEach((point, i) => {
			const x = (point.x - point.half * layer.scale) * width;
			if (i === 0) context.moveTo(x, point.y * height);
			else context.lineTo(x, point.y * height);
		});
		for (let i = points.length - 1; i >= 0; i--) {
			const point = points[i];
			context.lineTo((point.x + point.half * layer.scale) * width, point.y * height);
		}
		context.closePath();
		context.fill();
	}
	context.globalAlpha = 1;
	context.globalCompositeOperation = "source-over";
}
