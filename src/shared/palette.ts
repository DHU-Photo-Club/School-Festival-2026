import type { PaletteColor, PaletteId } from "./types.ts";

export type Rgb = readonly [number, number, number];

/** HSL を8bitの sRGB にする（refs/handoff reference-simulator/palette.mjs の `rgbFor` と同じ式）。 */
export function hslToRgb(h: number, s: number, l: number): Rgb {
	const hue = (((h % 360) + 360) % 360) / 60;
	const sat = s / 100;
	const light = l / 100;
	const chroma = (1 - Math.abs(2 * light - 1)) * sat;
	const x = chroma * (1 - Math.abs((hue % 2) - 1));
	const m = light - chroma / 2;
	const [r, g, b] =
		hue < 1
			? [chroma, x, 0]
			: hue < 2
				? [x, chroma, 0]
				: hue < 3
					? [0, chroma, x]
					: hue < 4
						? [0, x, chroma]
						: hue < 5
							? [x, 0, chroma]
							: [chroma, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export const rgbToHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** パレットの色そのもの（基準色）。 */
export const baseColor = (color: PaletteColor) => rgbToHex(hslToRgb(color.h, color.s, color.l));

/**
 * 結果表示の背景に使う深い色。色相を保ったまま暗くし、写真より明るくならないようにする
 * （docs/visual-language.md 5章）。
 */
export const backgroundColor = (color: PaletteColor) => rgbToHex(hslToRgb(color.h, Math.min(color.s, 60), 14));

/** 深い背景の上に置く文字の色。 */
export const foregroundColor = (color: PaletteColor) => rgbToHex(hslToRgb(color.h, 40, 92));

function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2のコントラスト比。 */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * 展示ディスプレイの結果で、色名のグラデーションの端点が黒の背景（`#000000`）に対して持つコントラスト比の下限。
 * 基準の4.5:1より余裕を取り、ぼけた破片が後ろに来ても読めるようにする。
 */
export const NAME_MIN_CONTRAST = 6;

/**
 * 展示ディスプレイの結果で、色名のグラデーションの端点に使う色。パレットの色（基準色）をそのまま使い、
 * 黒に対するコントラスト比が `NAME_MIN_CONTRAST` に届かない色だけ、色相と彩度を保ったまま届くまで明度を上げる。
 */
export function nameColor(color: PaletteColor): PaletteColor {
	let l = color.l;
	while (l < 100 && contrastRatio(rgbToHex(hslToRgb(color.h, color.s, l)), "#000000") < NAME_MIN_CONTRAST) l += 1;
	return { ...color, l };
}

/** 混色プレビューの色止めの数（refs/handoff 実装仕様書6章）。 */
export const GRADIENT_STOPS = 13;

/**
 * 二色の混色プレビューの色止め（refs/handoff 実装仕様書6章）。8bit sRGB の各成分を直線補間する。
 * 色相環を巡る補間はしない。両端は元の二色と一致する。
 */
export function gradientStops(a: PaletteColor, b: PaletteColor, count = GRADIENT_STOPS): Rgb[] {
	const from = hslToRgb(a.h, a.s, a.l);
	const to = hslToRgb(b.h, b.s, b.l);
	return Array.from({ length: count }, (_, i) => {
		const t = i / (count - 1);
		return [0, 1, 2].map((k) => Math.round(from[k] * (1 - t) + to[k] * t)) as unknown as Rgb;
	});
}

/** 色止めを等間隔に並べた線形グラデーションのCSS。 */
function stopsCss(stops: readonly Rgb[], angle: number): string {
	const parts = stops.map((rgb, i) => `rgb(${rgb.join(" ")}) ${((i / (stops.length - 1)) * 100).toFixed(2)}%`);
	return `linear-gradient(${angle}deg, ${parts.join(", ")})`;
}

/** 二色の混色プレビューのCSS。 */
export function gradientCss(a: PaletteColor, b: PaletteColor, angle = 125): string {
	return stopsCss(gradientStops(a, b), angle);
}

// ---- OKLCH ----

/** OKLCH の色（明度 L、彩度 C、色相 h はラジアン）。 */
type Oklch = readonly [number, number, number];

const toLinear = (value: number) => {
	const c = value / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (value: number) => {
	const c = Math.min(1, Math.max(0, value));
	return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

function rgbToOklch(rgb: Rgb): Oklch {
	const [r, g, b] = rgb.map(toLinear);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** OKLCH を線形 sRGB にする。色域外では0〜1を外れた値を返す。 */
function oklchToLinear([L, C, h]: Oklch): [number, number, number] {
	const [A, B] = [C * Math.cos(h), C * Math.sin(h)];
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

/** OKLCH を8bitの sRGB にする。sRGB の色域を外れる色は、明度と色相を保ったまま彩度だけを下げて収める。 */
function oklchToRgb([L, C, h]: Oklch): Rgb {
	const inGamut = (c: number) => oklchToLinear([L, c, h]).every((v) => v >= -1e-6 && v <= 1 + 1e-6);
	let chroma = C;
	if (!inGamut(chroma)) {
		let [lo, hi] = [0, C];
		for (let i = 0; i < 24; i++) {
			const mid = (lo + hi) / 2;
			if (inGamut(mid)) lo = mid;
			else hi = mid;
		}
		chroma = lo;
	}
	const [r, g, b] = oklchToLinear([L, chroma, h]).map(fromLinear);
	return [r, g, b];
}

/**
 * 展示ディスプレイの結果の色名のグラデーションの色止め。sRGB の各成分を直線補間すると、補色に近い二色の中間が
 * 灰色に濁るため、OKLCH で明度と彩度を直線補間し、色相は色相環の近い側を回って補間する。色止めの数と両端は
 * `gradientStops` と同じ。
 */
export function nameGradientStops(a: PaletteColor, b: PaletteColor, count = GRADIENT_STOPS): Rgb[] {
	const [fromRgb, toRgb] = [hslToRgb(a.h, a.s, a.l), hslToRgb(b.h, b.s, b.l)];
	const [from, to] = [rgbToOklch(fromRgb), rgbToOklch(toRgb)];
	const turn = Math.atan2(Math.sin(to[2] - from[2]), Math.cos(to[2] - from[2]));
	return Array.from({ length: count }, (_, i) => {
		if (i === 0) return fromRgb;
		if (i === count - 1) return toRgb;
		const t = i / (count - 1);
		return oklchToRgb([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + turn * t]);
	});
}

/** 展示ディスプレイの結果の色名のグラデーションのCSS。端点は `nameColor`、色止めは `nameGradientStops`。 */
export function nameGradientCss(a: PaletteColor, b: PaletteColor, angle = 90): string {
	return stopsCss(nameGradientStops(nameColor(a), nameColor(b)), angle);
}

/** IDからパレットの色を引く。 */
export function paletteColor(colors: readonly PaletteColor[], id: PaletteId | string | null): PaletteColor | null {
	return colors.find((color) => color.id === id) ?? null;
}
