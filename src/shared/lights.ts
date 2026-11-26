import type { Rgb } from "./palette.ts";
import { hslToRgb, paletteColor } from "./palette.ts";
import type { DisplayState, PaletteColor, PaletteId } from "./types.ts";

/** CIE 1931 の色度座標。 */
export interface XyColor {
	x: number;
	y: number;
}

/**
 * 電球一つの目標。`white` は通常の白色、`color` はパレットの一色。
 * `colorId` は電球へ送る値ではなく、記録と比較に使う。
 */
export type LightTarget = { kind: "white" } | { kind: "color"; colorId: PaletteId; color: PaletteColor };

/**
 * 電球全体で見せる二色。結果の表示中はAIが選んだ二色、待機中の表示確認は確認中の一色を二つ並べる。
 * どちらでもなければ `null`（白色）。展示ディスプレイの見せ方（`src/client/display/Display.svelte`）に合わせる。
 */
export function lightColorIds(state: DisplayState): readonly [PaletteId, PaletteId] | null {
	if (state.phase === "result" && state.result) return state.result.colors;
	if (state.phase === "idle" && state.previewColorId) return [state.previewColorId, state.previewColorId];
	return null;
}

/**
 * 電球ごとの目標。電球の並び順（0始まり）で二色を交互に割り当てる（電球 k は `colors[k % 2]`）。
 * 展示ディスプレイの `screenColorId` と同じ割り当て。パレットにない色IDは白色にする。
 */
export function lightTargets(
	state: DisplayState | null,
	palette: readonly PaletteColor[],
	count: number,
): LightTarget[] {
	const ids = state ? lightColorIds(state) : null;
	return Array.from({ length: count }, (_, index): LightTarget => {
		const colorId = ids ? ids[index % 2] : null;
		const color = paletteColor(palette, colorId);
		return color && colorId ? { kind: "color", colorId, color } : { kind: "white" };
	});
}

/** 二つの目標が同じ色か。 */
export function sameTarget(a: LightTarget, b: LightTarget): boolean {
	return a.kind === "white" ? b.kind === "white" : b.kind === "color" && a.colorId === b.colorId;
}

const linearize = (value: number) => {
	const c = value / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** 8bit の sRGB を CIE 1931 の色度座標にする（IEC 61966-2-1、D65）。黒は D65 の白色点を返す。 */
export function srgbToXy([r, g, b]: Rgb): XyColor {
	const [lr, lg, lb] = [linearize(r), linearize(g), linearize(b)];
	const X = 0.4124 * lr + 0.3576 * lg + 0.1805 * lb;
	const Y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
	const Z = 0.0193 * lr + 0.1192 * lg + 0.9505 * lb;
	const sum = X + Y + Z;
	if (sum === 0) return { x: 0.3127, y: 0.329 };
	return { x: X / sum, y: Y / sum };
}

/** パレットの色の色度座標。 */
export const paletteXy = (color: PaletteColor): XyColor => srgbToXy(hslToRgb(color.h, color.s, color.l));

/** 電球一つに送る値。 */
export interface LightScene {
	xy: XyColor;
	/** 明るさ（Matter の LevelControl、1〜254）。 */
	level: number;
	/** 遷移の秒数。 */
	transitionSeconds: number;
}

/** 電球の設定（`src/data/lights.ts`）。 */
export interface LightSettings {
	whiteXy: XyColor;
	/** xy 色空間に対応しない電球の白色（色温度、ミレッド）。 */
	whiteMireds: number;
	level: number;
	toColorSeconds: number;
	toWhiteSeconds: number;
	/** 色ごとに会場で調整した照明シーン。書かない項目はパレットの色から計算した値と `level` を使う。 */
	colors: Partial<Record<PaletteId, { xy?: XyColor; level?: number }>>;
}

/** 目標に対応する照明シーン。色は会場で調整した値があればそれを使う（仕様書11章）。 */
export function lightScene(target: LightTarget, settings: LightSettings): LightScene {
	if (target.kind === "white") {
		return {
			xy: settings.whiteXy,
			level: toMatterLevel(settings.level),
			transitionSeconds: settings.toWhiteSeconds,
		};
	}
	const tuned = settings.colors[target.colorId];
	return {
		xy: tuned?.xy ?? paletteXy(target.color),
		level: toMatterLevel(tuned?.level ?? settings.level),
		transitionSeconds: settings.toColorSeconds,
	};
}

/** 明るさを Matter の LevelControl の範囲（1〜254）に収める。0 は消灯ではなく最も暗い明るさにする。 */
export const toMatterLevel = (level: number) => Math.min(254, Math.max(1, Math.round(level)));

/** Matter の ColorControl の `CurrentX` と `CurrentY` の上限（0xFEFF）。 */
const MATTER_XY_MAX = 0xfeff;

/** 色度座標を Matter の `MoveToColor` の `colorX` と `colorY`（座標 × 65536、0〜65279）にする。 */
export function toMatterXy({ x, y }: XyColor): { colorX: number; colorY: number } {
	const scale = (value: number) => Math.min(MATTER_XY_MAX, Math.max(0, Math.round(value * 65536)));
	return { colorX: scale(x), colorY: scale(y) };
}

/** Matter の `CurrentHue` と `CurrentSaturation` の上限。 */
const MATTER_HS_MAX = 254;

/**
 * パレットの色を Matter の `MoveToHueAndSaturation` の `hue` と `saturation`（各0〜254）にする。
 * 色相はパレットの H、彩度は HSL から HSV へ直した値。xy 色空間に対応しない電球に使う。
 */
export function toMatterHueSaturation(color: PaletteColor): { hue: number; saturation: number } {
	const s = color.s / 100;
	const l = color.l / 100;
	const value = l + s * Math.min(l, 1 - l);
	const saturation = value === 0 ? 0 : 2 * (1 - l / value);
	const hue = (((color.h % 360) + 360) % 360) / 360;
	return {
		hue: Math.min(MATTER_HS_MAX, Math.round(hue * MATTER_HS_MAX)),
		saturation: Math.min(MATTER_HS_MAX, Math.max(0, Math.round(saturation * MATTER_HS_MAX))),
	};
}

/** 秒を Matter の遷移時間（0.1秒単位、0〜65534）にする。 */
export const toTransitionTime = (seconds: number) => Math.min(65534, Math.max(0, Math.round(seconds * 10)));
