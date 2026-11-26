// 質問の回答を受け付けた瞬間に、画面の中心から広がる波紋（docs/visual-language.md 3.2節）。
// 位置と不透明度を経過時間だけから求めるので、補正済みサーバー時刻を使う全画面で同じになる。

/** 一つの輪が中心から画面の外まで広がる時間（ミリ秒）。 */
const RING_MS = 4_800;
/** 輪を出す間隔（ミリ秒）。後の輪ほど遅れて出る。 */
const RING_INTERVAL_MS = 300;
/** 各輪の最も濃いときの不透明度。外側へ広がる前の、回答の直後が最も濃い。輪の本数は2本で、後の輪ほど薄い。 */
const RING_PEAKS = [0.34, 0.22] as const;
/** 波紋が広がり始めてから消えるまでの時間（ミリ秒）。最後の輪が消え終えるまで。 */
export const RIPPLE_MS = RING_MS + RING_INTERVAL_MS * (RING_PEAKS.length - 1);
/** 輪の太さ（CSS画素）。広がるにつれて細くなる。 */
export const RIPPLE_WIDTH_START = 2;
export const RIPPLE_WIDTH_END = 0.75;

/** 波紋の一つの輪。座標系は画面の中心が原点、単位はCSS画素。 */
export interface RippleRing {
	radius: number;
	/** 不透明度（0〜1）。 */
	alpha: number;
	/** 線の太さ（CSS画素）。 */
	width: number;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * 経過時間 `elapsed`（ミリ秒）での波紋の輪。輪は回答の瞬間に中心へ現れ、画面の隅の外まで広がりながら
 * 細く薄くなって消える。まだ出ていない輪と、消えた輪は含めない。
 */
export function rippleRings(elapsed: number, width: number, height: number): RippleRing[] {
	// 画面の隅の少し外まで広げて、輪が端で途切れず消えるようにする。
	const reach = Math.hypot(width, height) / 2 + 24;
	return RING_PEAKS.flatMap((peak, index) => {
		const t = (elapsed - index * RING_INTERVAL_MS) / RING_MS;
		if (t < 0 || t >= 1) return [];
		return [
			{
				radius: reach * easeOutCubic(t),
				// 外へ広がるほど薄くなる。出た瞬間は最も濃い。
				alpha: peak * (1 - t) ** 1.6,
				width: RIPPLE_WIDTH_START + (RIPPLE_WIDTH_END - RIPPLE_WIDTH_START) * t,
			},
		];
	});
}
