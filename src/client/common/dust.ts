import { DUST_COLOR, type DustPose } from "../../shared/dust.ts";

/** 不透明度をまとめて描くための段数。粒ごとに塗りの色を変えると遅いため、段ごとに一つの経路で描く。 */
const ALPHA_STEPS = 16;

/**
 * 塵をcanvas 2Dへ描く。座標はCSS画素単位で、`ratio` はcanvasの画素数とCSS画素の比。塵は小さな円で、
 * 発光や影は付けない。`poses` が空ならcanvasを消す。
 */
export function drawDust(context: CanvasRenderingContext2D, poses: readonly DustPose[], ratio: number): void {
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	if (poses.length === 0) return;
	context.save();
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	const buckets: DustPose[][] = Array.from({ length: ALPHA_STEPS }, () => []);
	for (const pose of poses) {
		buckets[Math.min(ALPHA_STEPS - 1, Math.floor(pose.alpha * ALPHA_STEPS))].push(pose);
	}
	buckets.forEach((bucket, step) => {
		if (bucket.length === 0) return;
		context.beginPath();
		for (const { x, y, size } of bucket) {
			context.moveTo(x + size / 2, y);
			context.arc(x, y, size / 2, 0, Math.PI * 2);
		}
		context.fillStyle = `rgba(${DUST_COLOR}, ${((step + 0.5) / ALPHA_STEPS).toFixed(3)})`;
		context.fill();
	});
	context.restore();
}
