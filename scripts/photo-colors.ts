// 写真の画素から色タグ（`overall`、`partial`）を決める。外部へは送らず、同じ写真なら毎回同じ結果になる。
// 縮小した画素を OKLab へ変換し、彩度の低い画素（白、黒、灰色）を除いて、色相と明るさが最も近いパレットの色に数える。
// パレットは鮮やかな色なので、彩度の差は比べない（くすんだ緑も「翡翠色」に数える）。
// 明るさが離れた画素（暗い茶色など）は、どの色にも数えない。
// しきい値は、前からある12枚の手書きの色タグと見比べて決めた（2026-11-28）。
import sharp from "sharp";
import { PALETTE } from "../src/data/palette.ts";
import type { PaletteId, PhotoColorTags } from "../src/shared/types.ts";

/** 判定に使う縮小後の長辺。 */
const SAMPLE_SIDE = 128;
/** これより彩度（OKLab の chroma）が低い画素は無彩色として数えない。 */
const CHROMA_MIN = 0.03;
/** これ以上の彩度の画素を「鮮やか」とする。小さくても目に付く色を `partial` に拾うために使う。 */
const VIVID_CHROMA_MIN = 0.12;
/** 色相の差（ラジアン）と明るさの差を合わせた距離がこれより遠い画素は、どの色にも数えない。 */
const DISTANCE_MAX = 0.35;
/** 画素全体に占める割合がこれ以上の色を、写真全体の印象（`overall`）にする。最大2色。 */
const OVERALL_MIN = 0.2;
/** 画素全体に占める割合がこれ以上の色を、一部分の色（`partial`）にする。 */
const PARTIAL_MIN = 0.02;
/** 鮮やかな画素の割合がこれ以上の色も、一部分の色にする（赤い札、値札など）。 */
const VIVID_PARTIAL_MIN = 0.004;
/** `partial` の最大の色数。 */
const PARTIAL_MAX = 3;

type Lab = readonly [number, number, number];

const linear = (channel: number) => {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** sRGB（0〜255）を OKLab へ変換する。https://bottosson.github.io/posts/oklab/ */
function oklab(r: number, g: number, b: number): Lab {
	const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const sat = s / 100;
	const light = l / 100;
	const k = (n: number) => (n + h / 30) % 12;
	const a = sat * Math.min(light, 1 - light);
	const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
	return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const PALETTE_LAB = PALETTE.colors.map((color) => {
	const [lightness, a, b] = oklab(...hslToRgb(color.h, color.s, color.l));
	return { id: color.id, lightness, hue: Math.atan2(b, a) };
});

/** 色相の差（ラジアン、0〜π）。 */
function hueDifference(a: number, b: number): number {
	const difference = Math.abs(a - b);
	return difference > Math.PI ? 2 * Math.PI - difference : difference;
}

/** 各色が画素全体に占める割合（`all`）と、鮮やかな画素だけの割合（`vivid`）。 */
export async function paletteShares(
	file: string,
): Promise<{ all: Map<PaletteId, number>; vivid: Map<PaletteId, number> }> {
	const { data, info } = await sharp(file)
		.resize({ width: SAMPLE_SIDE, height: SAMPLE_SIDE, fit: "inside" })
		.removeAlpha()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });
	const all = new Map<PaletteId, number>();
	const vivid = new Map<PaletteId, number>();
	const total = info.width * info.height;
	for (let index = 0; index < data.length; index += info.channels) {
		const [lightness, a, b] = oklab(data[index], data[index + 1], data[index + 2]);
		const chroma = Math.hypot(a, b);
		if (chroma < CHROMA_MIN) continue;
		const hue = Math.atan2(b, a);
		let best: PaletteId | null = null;
		let bestDistance = DISTANCE_MAX;
		for (const color of PALETTE_LAB) {
			const distance = Math.hypot(hueDifference(hue, color.hue), lightness - color.lightness);
			if (distance < bestDistance) {
				best = color.id;
				bestDistance = distance;
			}
		}
		if (!best) continue;
		all.set(best, (all.get(best) ?? 0) + 1 / total);
		if (chroma >= VIVID_CHROMA_MIN) vivid.set(best, (vivid.get(best) ?? 0) + 1 / total);
	}
	return { all, vivid };
}

/** 写真の画素から色タグを決める。割合の大きい色から順に並べる。 */
export async function colorTagsFromPixels(file: string): Promise<PhotoColorTags> {
	const { all, vivid } = await paletteShares(file);
	const ranked = [...all].sort((a, b) => b[1] - a[1]).map(([id]) => id);
	const overall = ranked.filter((id) => (all.get(id) ?? 0) >= OVERALL_MIN).slice(0, 2);
	const partial = ranked
		.filter(
			(id) =>
				!overall.includes(id) && ((all.get(id) ?? 0) >= PARTIAL_MIN || (vivid.get(id) ?? 0) >= VIVID_PARTIAL_MIN),
		)
		.slice(0, PARTIAL_MAX);
	return { overall, partial };
}
