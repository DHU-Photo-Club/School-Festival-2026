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

/** 二色の混色プレビューのCSS。 */
export function gradientCss(a: PaletteColor, b: PaletteColor, angle = 125): string {
	const stops = gradientStops(a, b);
	const parts = stops.map((rgb, i) => `rgb(${rgb.join(" ")}) ${((i / (stops.length - 1)) * 100).toFixed(2)}%`);
	return `linear-gradient(${angle}deg, ${parts.join(", ")})`;
}

/** IDからパレットの色を引く。 */
export function paletteColor(colors: readonly PaletteColor[], id: PaletteId | string | null): PaletteColor | null {
	return colors.find((color) => color.id === id) ?? null;
}
