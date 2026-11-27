// 「扉を開く」の後に展示ディスプレイの中央に出す扉の、中の光の形（docs/visual-language.md 3.4.1節）。
// 描画（`src/client/display/door.ts`）から切り離し、時刻だけから決まる純関数にする。

/** 光の帯の一点。`x` は帯の中心、`half` は帯の幅の半分。どちらも扉の幅に対する割合。`y` は扉の高さに対する割合。 */
export interface RibbonPoint {
	y: number;
	x: number;
	half: number;
}

/** 帯を縦に区切る数。 */
export const RIBBON_SEGMENTS = 96;

/**
 * 帯の揺れ。周期の異なる正弦波を重ね、上下で揺れ方を変える。どの周期も12秒以上にする
 * （docs/visual-language.md 1章の「繰り返す動きの周期は12秒以上」という決まり）。
 */
const SWAY = [
	{ amplitude: 0.018, waves: 2.4, periodMs: 31_000, phase: 0 },
	{ amplitude: 0.008, waves: 4.1, periodMs: -47_000, phase: 1.3 },
] as const;
/** 帯の幅の変化。 */
const WIDTH = { base: 0.17, amplitude: 0.012, waves: 2.6, periodMs: 41_000, phase: 0.6 } as const;

/**
 * 時刻 `time`（ミリ秒）の帯の形。扉の上端の少し外から下端の少し外までを `RIBBON_SEGMENTS` 等分して返す。
 * 同じ時刻には同じ形を返すので、補正済みサーバー時刻を渡せば全画面で同じ形になる。
 */
export function ribbonPoints(time: number): RibbonPoint[] {
	const turn = Math.PI * 2;
	return Array.from({ length: RIBBON_SEGMENTS + 1 }, (_, i) => {
		const y = -0.05 + (1.1 * i) / RIBBON_SEGMENTS;
		let x = 0.5;
		for (const wave of SWAY)
			x += wave.amplitude * Math.sin(turn * (y * wave.waves + time / wave.periodMs) + wave.phase);
		const half =
			WIDTH.base + WIDTH.amplitude * Math.sin(turn * (y * WIDTH.waves + time / WIDTH.periodMs) + WIDTH.phase);
		return { y, x, half };
	});
}
