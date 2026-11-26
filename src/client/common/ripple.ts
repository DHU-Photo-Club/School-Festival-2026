import type { RippleRing } from "../../shared/ripple.ts";

/**
 * 波紋の輪をcanvas 2Dへ描く。座標はCSS画素単位で、`ratio` はcanvasの画素数とCSS画素の比。輪は画面の中心を
 * 中心とする細い白の円で、不透明度と太さは輪ごとの値に従う。`rings` が空ならcanvasを消す。
 */
export function drawRipple(context: CanvasRenderingContext2D, rings: readonly RippleRing[], ratio: number): void {
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	if (rings.length === 0) return;
	context.save();
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	const [cx, cy] = [context.canvas.width / ratio / 2, context.canvas.height / ratio / 2];
	for (const { radius, alpha, width } of rings) {
		if (alpha <= 0 || radius <= 0) continue;
		context.beginPath();
		context.arc(cx, cy, radius, 0, Math.PI * 2);
		context.lineWidth = width;
		context.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
		context.stroke();
	}
	context.restore();
}
