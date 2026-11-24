import { describe, expect, it } from "vitest";
import { LIGHT_SETTINGS } from "../../src/data/lights.ts";
import { PALETTE } from "../../src/data/palette.ts";
import {
	lightColorIds,
	lightScene,
	lightTargets,
	paletteXy,
	sameTarget,
	srgbToXy,
	toMatterHueSaturation,
	toMatterLevel,
	toMatterXy,
	toTransitionTime,
} from "../../src/shared/lights.ts";
import { paletteColor } from "../../src/shared/palette.ts";
import type { DisplayState, PaletteColor } from "../../src/shared/types.ts";

const base: DisplayState = {
	sessionId: null,
	phase: "idle",
	sequenceId: null,
	result: null,
	previewColorId: null,
	phaseStartedAt: 0,
	phaseEndsAt: null,
	revision: 0,
};

const resultState: DisplayState = {
	...base,
	sessionId: "s1",
	phase: "result",
	result: { name: "テスト", colors: ["sky", "rose"], photoIds: [] },
};

const color = (id: string) => paletteColor(PALETTE.colors, id) as PaletteColor;
const kinds = (state: DisplayState | null, count: number) =>
	lightTargets(state, PALETTE.colors, count).map((target) => (target.kind === "white" ? "white" : target.colorId));

describe("電球の色の割り当て", () => {
	it("結果の表示中は、二色を電球の並び順に交互に割り当てる", () => {
		expect(kinds(resultState, 5)).toEqual(["sky", "rose", "sky", "rose", "sky"]);
		expect(kinds(resultState, 1)).toEqual(["sky"]);
		expect(kinds(resultState, 0)).toEqual([]);
	});

	it("結果の表示中以外は白色にする", () => {
		for (const phase of ["idle", "sequence", "intro", "question", "judging"] as const) {
			expect(kinds({ ...resultState, phase }, 3)).toEqual(["white", "white", "white"]);
		}
		expect(kinds(null, 2)).toEqual(["white", "white"]);
		expect(kinds({ ...base, phase: "result" }, 2)).toEqual(["white", "white"]);
	});

	it("待機中の表示確認では、全部の電球を確認中の色にする", () => {
		const preview = { ...base, previewColorId: "gold" } as const;
		expect(lightColorIds(preview)).toEqual(["gold", "gold"]);
		expect(kinds(preview, 3)).toEqual(["gold", "gold", "gold"]);
		// 待機以外では表示確認の色を使わない（展示ディスプレイと同じ）。
		expect(kinds({ ...preview, phase: "intro" }, 2)).toEqual(["white", "white"]);
	});

	it("パレットにない色は白色にする", () => {
		const unknown = { ...resultState, result: { name: "x", colors: ["sky", "nope"], photoIds: [] } };
		expect(kinds(unknown as unknown as DisplayState, 2)).toEqual(["sky", "white"]);
	});

	it("同じ色の目標を同じとみなす", () => {
		const [sky, rose] = lightTargets(resultState, PALETTE.colors, 2);
		const [white] = lightTargets(null, PALETTE.colors, 1);
		expect(sameTarget(sky, lightTargets(resultState, PALETTE.colors, 1)[0])).toBe(true);
		expect(sameTarget(sky, rose)).toBe(false);
		expect(sameTarget(white, { kind: "white" })).toBe(true);
		expect(sameTarget(white, sky)).toBe(false);
		expect(sameTarget(sky, white)).toBe(false);
	});
});

describe("照明シーン", () => {
	const [sky, rose] = lightTargets(resultState, PALETTE.colors, 2);

	it("白色は設定の白色点と明るさで、白色へ戻る秒数を使う", () => {
		expect(lightScene({ kind: "white" }, LIGHT_SETTINGS)).toEqual({
			xy: LIGHT_SETTINGS.whiteXy,
			level: LIGHT_SETTINGS.level,
			transitionSeconds: LIGHT_SETTINGS.toWhiteSeconds,
		});
	});

	it("会場で調整していない色は、パレットの色から計算した色度座標を使う", () => {
		expect(lightScene(sky, LIGHT_SETTINGS)).toEqual({
			xy: paletteXy(color("sky")),
			level: LIGHT_SETTINGS.level,
			transitionSeconds: LIGHT_SETTINGS.toColorSeconds,
		});
	});

	it("会場で調整した色は、書いた項目だけを上書きする", () => {
		const settings = {
			...LIGHT_SETTINGS,
			colors: { sky: { xy: { x: 0.2, y: 0.25 }, level: 120 }, rose: { level: 80 } },
		};
		expect(lightScene(sky, settings)).toMatchObject({ xy: { x: 0.2, y: 0.25 }, level: 120 });
		expect(lightScene(rose, settings)).toMatchObject({ xy: paletteXy(color("rose")), level: 80 });
	});

	it("明るさを 1〜254 に収める", () => {
		expect(toMatterLevel(0)).toBe(1);
		expect(toMatterLevel(300)).toBe(254);
		expect(toMatterLevel(99.6)).toBe(100);
		const settings = { ...LIGHT_SETTINGS, level: 999, colors: { sky: { level: 0 } } };
		expect(lightScene({ kind: "white" }, settings).level).toBe(254);
		expect(lightScene(sky, settings).level).toBe(1);
	});
});

describe("Matter の値への変換", () => {
	it("sRGB の白は D65 の白色点、原色は sRGB の原色の色度になる", () => {
		const white = srgbToXy([255, 255, 255]);
		expect(white.x).toBeCloseTo(0.3127, 3);
		expect(white.y).toBeCloseTo(0.329, 3);
		expect(srgbToXy([255, 0, 0]).x).toBeCloseTo(0.64, 2);
		expect(srgbToXy([255, 0, 0]).y).toBeCloseTo(0.33, 2);
		expect(srgbToXy([0, 255, 0]).y).toBeCloseTo(0.6, 2);
		expect(srgbToXy([0, 0, 255]).x).toBeCloseTo(0.15, 2);
		expect(srgbToXy([0, 0, 0])).toEqual({ x: 0.3127, y: 0.329 });
	});

	it("色度座標を 65536 倍し、0〜65279 に収める", () => {
		expect(toMatterXy({ x: 0.5, y: 0.25 })).toEqual({ colorX: 32768, colorY: 16384 });
		expect(toMatterXy({ x: 1, y: -0.1 })).toEqual({ colorX: 0xfeff, colorY: 0 });
		const { colorX, colorY } = toMatterXy(LIGHT_SETTINGS.whiteXy);
		expect(colorX).toBe(Math.round(0.3805 * 65536));
		expect(colorY).toBe(Math.round(0.3768 * 65536));
	});

	it("パレットの全色が Matter の範囲に収まる", () => {
		for (const entry of PALETTE.colors) {
			const { colorX, colorY } = toMatterXy(paletteXy(entry));
			expect(colorX).toBeGreaterThan(0);
			expect(colorX).toBeLessThanOrEqual(0xfeff);
			expect(colorY).toBeGreaterThan(0);
			expect(colorY).toBeLessThanOrEqual(0xfeff);
			const { hue, saturation } = toMatterHueSaturation(entry);
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThanOrEqual(254);
			expect(saturation).toBeGreaterThan(0);
			expect(saturation).toBeLessThanOrEqual(254);
		}
	});

	it("色相と彩度は HSL から HSV へ直して 0〜254 にする", () => {
		// 朱色 H12 S76 L53 → HSV の V = 0.53 + 0.76 × 0.47 = 0.8872、S = 2 × (1 − 0.53 / 0.8872) ≈ 0.805
		expect(toMatterHueSaturation(color("vermilion"))).toEqual({
			hue: Math.round((12 / 360) * 254),
			saturation: 205,
		});
		expect(toMatterHueSaturation({ ...color("sky"), s: 0 })).toMatchObject({ saturation: 0 });
	});

	it("秒を 0.1 秒単位の遷移時間にする", () => {
		expect(toTransitionTime(3)).toBe(30);
		expect(toTransitionTime(0.04)).toBe(0);
		expect(toTransitionTime(-1)).toBe(0);
		expect(toTransitionTime(10_000)).toBe(65534);
	});
});
