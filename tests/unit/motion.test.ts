import { describe, expect, it } from "vitest";
import { PALETTE } from "../../src/data/palette.ts";
import { INACTIVITY_MS, JUDGING_MS } from "../../src/shared/machine.ts";
import type { Primitive, Scene, SceneInput } from "../../src/shared/motion.ts";
import {
	BLOOM_WARP,
	COLORS,
	computeScene,
	idleCrossfade,
	idleCycleIndex,
	JUDGING_SHARD_DIM,
	RESULT_FORMS,
	RESULT_SHARD_FADE_MS,
	resultFormPrimitives,
	SHARD_TINT_MS,
	screenColorId,
} from "../../src/shared/motion.ts";
import { backgroundColor, baseColor, paletteColor } from "../../src/shared/palette.ts";
import type { DisplayState, PaletteId } from "../../src/shared/types.ts";
import { PALETTE_IDS } from "../../src/shared/types.ts";

const colorOf = (id: PaletteId) => {
	const color = paletteColor(PALETTE.colors, id);
	if (!color) throw new Error(`パレットに ${id} がない`);
	return color;
};

/** 画面0が `first`、画面1が `second` を見せる結果。 */
const resultOf = (first: PaletteId, second: PaletteId = first === "sky" ? "amber" : "sky") => ({
	name: "テスト",
	colors: [first, second] as const,
	photoIds: [],
});

const T0 = 1_800_000_000_000;
const base = (state: Partial<DisplayState>, patch: Partial<SceneInput> = {}): SceneInput => ({
	state: {
		sessionId: "session-a",
		phase: "idle",
		sequenceId: null,
		result: null,
		previewColorId: null,
		phaseStartedAt: T0,
		phaseEndsAt: null,
		revision: 10,
		...state,
	},
	now: T0,
	displayOrder: 0,
	width: 1920,
	height: 1080,
	reducedMotion: false,
	colors: PALETTE.colors,
	resultMode: "animate",
	previousBackground: null,
	...patch,
});

const questionState = (lastOperationAt: number, revision = 12): Partial<DisplayState> => ({
	phase: "question",
	phaseStartedAt: T0,
	phaseEndsAt: lastOperationAt + INACTIVITY_MS,
	revision,
});

const shardsOf = (scene: Scene) => scene.shards;

describe("決定性", () => {
	it("同じ入力からは同じ描画内容を返す", () => {
		const input = base(questionState(T0 + 10_000), { now: T0 + 12_345 });
		expect(computeScene(input)).toEqual(computeScene(structuredClone(input)));
	});
});

describe("質問中の破片", () => {
	it("再接続した画面もほかの画面と同じ角度から再開する（描画は時刻と状態だけで決まる）", () => {
		const at = T0 + 23_456;
		const first = computeScene(base(questionState(T0 + 20_000), { now: at }));
		const reconnected = computeScene(base(questionState(T0 + 20_000), { now: at }));
		expect(shardsOf(reconnected)).toEqual(shardsOf(first));
	});

	it("破片は灰色で描き、色を付けない", () => {
		const shards = shardsOf(computeScene(base(questionState(T0 + 1_000), { now: T0 + 30_000 })));
		expect(shards).toMatchObject({ colors: null, tint: 0, intensity: 1, swell: 1 });
	});

	it("全画面が同じ破片を描く", () => {
		const at = (displayOrder: number) =>
			shardsOf(computeScene(base(questionState(T0 + 1_000), { now: T0 + 30_000, displayOrder })));
		expect(at(1)).toEqual(at(0));
	});

	it("破片は補正済みサーバー時刻で動き、reduced-motion では止まる", () => {
		const at = (reducedMotion: boolean) =>
			shardsOf(computeScene(base(questionState(T0 + 1_000), { now: T0 + 12_500, reducedMotion })));
		expect(at(false)).toMatchObject({ time: T0 + 12_500 });
		expect(at(true)).toMatchObject({ time: 0 });
	});

	it("一問確定すると輪がふくらんで元へ戻る", () => {
		const changedAt = T0 + 20_000;
		const swell = (now: number) => shardsOf(computeScene(base(questionState(changedAt), { now })))?.swell;
		expect(swell(changedAt + 3_000)).toBeCloseTo(1.08);
		expect(swell(changedAt + 6_000)).toBe(1);
	});

	it("reduced-motion では時刻が進んでも同じ構図のまま", () => {
		const at = (now: number) => computeScene(base(questionState(T0 + 1_000), { now, reducedMotion: true }));
		expect(at(T0 + 2_000).primitives).toEqual(at(T0 + 9_000).primitives);
		expect(at(T0 + 2_000).shards).toEqual(at(T0 + 9_000).shards);
		expect(at(T0 + 2_000).animating).toBe(false);
	});
});

describe("判定と結果", () => {
	const judging = (colorId: PaletteId): Partial<DisplayState> => ({
		phase: "judging",
		result: resultOf(colorId),
		phaseStartedAt: T0,
		phaseEndsAt: T0 + JUDGING_MS,
	});

	it("二色は画面の順に交互に割り当てる", () => {
		const result = resultOf("jade", "rose");
		expect([0, 1, 2, 3].map((order) => screenColorId(result, order))).toEqual(["jade", "rose", "jade", "rose"]);
		expect(screenColorId(null, 0)).toBeNull();
	});

	it("結果開始時刻より前の判定画面の背景は、結果色によって変わらない", () => {
		for (const now of [T0, T0 + 600, T0 + 1_999]) {
			const scenes = PALETTE_IDS.map((colorId) =>
				JSON.stringify(computeScene(base(judging(colorId), { now })).primitives),
			);
			expect(new Set(scenes).size).toBe(1);
		}
	});

	it("色づき始めるまでの破片は、結果色によって変わらない", () => {
		const tintAt = T0 + JUDGING_MS - SHARD_TINT_MS;
		for (const now of [T0, T0 + 600, tintAt]) {
			for (const colorId of PALETTE_IDS) {
				expect(shardsOf(computeScene(base(judging(colorId), { now })))).toMatchObject({ tint: 0 });
			}
		}
	});

	it("判定の期限が短い設定でも、暗転を終えてから色づく", () => {
		const state: Partial<DisplayState> = { ...judging("jade"), phaseEndsAt: T0 + 1_000 };
		expect(shardsOf(computeScene(base(state, { now: T0 + 999 })))?.tint).toBe(0);
	});

	/** AIの選定を待っている判定。 */
	const waiting: Partial<DisplayState> = { phase: "judging", phaseStartedAt: T0, phaseEndsAt: T0 + 30_000 };

	it("判定は1.2秒で黒へ沈み、灰色の破片は薄くなって残る", () => {
		const scene = computeScene(base(waiting, { now: T0 + 1_500 }));
		expect(scene.primitives).toContainEqual({ type: "fill", color: COLORS.dark, alpha: 1 });
		expect(shardsOf(scene)).toMatchObject({ colors: null, tint: 0 });
		expect(shardsOf(scene)?.intensity).toBeCloseTo(JUDGING_SHARD_DIM);
		expect(shardsOf(computeScene(base(waiting, { now: T0 + 20_000 })))).toMatchObject({ colors: null });
	});

	it("結果の二色が決まると、結果開始までに破片を二色へ色づける", () => {
		const state: Partial<DisplayState> = { ...judging("jade"), result: resultOf("jade", "rose") };
		const two = [baseColor(colorOf("jade")), baseColor(colorOf("rose"))];
		const tintAt = T0 + JUDGING_MS - SHARD_TINT_MS;
		const at = (now: number) => shardsOf(computeScene(base(state, { now })));
		expect(at(tintAt - 1)).toMatchObject({ colors: two, tint: 0 });
		expect(at(tintAt - 1)?.intensity).toBeCloseTo(JUDGING_SHARD_DIM);
		const half = at(tintAt + SHARD_TINT_MS / 2);
		expect(half?.tint).toBeCloseTo(0.5);
		expect(half?.intensity).toBeGreaterThan(JUDGING_SHARD_DIM);
		expect(half?.intensity).toBeLessThan(1);
		// 結果開始の最初のフレームで色づき終えている。画面ごとの色に関わらず、全画面が同じ二色で描く。
		for (const displayOrder of [0, 1]) {
			const start = shardsOf(computeScene(base(state, { now: T0 + JUDGING_MS, displayOrder })));
			expect(start).toMatchObject({ colors: two, tint: 1, intensity: 1 });
		}
	});

	it("色づいた破片は、結果色が広がる間に消える", () => {
		const start = T0 + JUDGING_MS;
		const state: Partial<DisplayState> = {
			phase: "result",
			result: resultOf("jade", "rose"),
			phaseStartedAt: start,
			phaseEndsAt: start + 60_000,
		};
		const at = (offset: number) => shardsOf(computeScene(base(state, { now: start + offset })));
		const mid = at(RESULT_SHARD_FADE_MS / 2);
		expect(mid?.tint).toBe(1);
		expect(mid?.intensity).toBeGreaterThan(0);
		expect(mid?.intensity).toBeLessThan(1);
		expect(at(RESULT_SHARD_FADE_MS)).toBeNull();
		expect(shardsOf(computeScene(base(state, { now: start + 100, resultMode: "complete" })))).toBeNull();
	});

	it("reduced-motion の判定は、灰色の破片から二色の破片へ一回だけ切り替わる", () => {
		const state: Partial<DisplayState> = { ...judging("jade"), result: resultOf("jade", "rose") };
		const tintAt = T0 + JUDGING_MS - SHARD_TINT_MS;
		const at = (now: number) => computeScene(base(state, { now, reducedMotion: true }));
		expect(at(T0).primitives).toEqual([{ type: "fill", color: COLORS.dark }]);
		expect(shardsOf(at(T0))).toEqual(shardsOf(at(tintAt - 1)));
		expect(shardsOf(at(tintAt - 1))).toMatchObject({ colors: null, time: 0 });
		expect(shardsOf(at(tintAt))).toMatchObject({ tint: 1, intensity: 1, time: 0 });
		expect(shardsOf(at(T0 + JUDGING_MS))).toBeNull();
	});

	it.each(PALETTE_IDS)("%s: 結果開始の最初のフレームで結果色の形が見えている", (colorId) => {
		const scene = computeScene(base(judging(colorId), { now: T0 + JUDGING_MS }));
		const shape = scene.primitives[1];
		expect(shape).toBeDefined();
		expect(JSON.stringify(shape)).toContain(baseColor(colorOf(colorId)));
		expect(scene.resultLayer).toBe(0);
	});

	it("隣の画面はもう一方の色で広がる", () => {
		const state: Partial<DisplayState> = { ...judging("jade"), result: resultOf("jade", "rose") };
		const second = computeScene(base(state, { now: T0 + JUDGING_MS, displayOrder: 1 }));
		expect(JSON.stringify(second.primitives[1])).toContain(baseColor(colorOf("rose")));
	});

	it.each(PALETTE_IDS)("%s: 広がり、沈み、写真が現れて完了状態になる", (colorId) => {
		const color = colorOf(colorId);
		const start = T0 + JUDGING_MS;
		const result: Partial<DisplayState> = {
			phase: "result",
			result: resultOf(colorId),
			phaseStartedAt: start,
			phaseEndsAt: start + 60_000,
		};
		const { durationMs } = RESULT_FORMS[colorId];
		expect(durationMs).toBeGreaterThanOrEqual(1_400);
		const settled = computeScene(base(result, { now: start + 10_000 }));
		expect(settled).toEqual({
			primitives: [{ type: "fill", color: backgroundColor(color) }],
			shards: null,
			idleLayer: 0,
			resultLayer: 1,
			veil: null,
			animating: false,
		});
		const mid = computeScene(base(result, { now: start + durationMs / 2 }));
		expect(mid.animating).toBe(true);
		expect(mid.resultLayer).toBe(0);
	});

	it("結果開始後に接続した画面は演出を再生せず完了状態を表示する", () => {
		const start = T0 + JUDGING_MS;
		const scene = computeScene(
			base(
				{ phase: "result", result: resultOf("blue"), phaseStartedAt: start, phaseEndsAt: start + 60_000 },
				{ now: start + 100, resultMode: "complete" },
			),
		);
		expect(scene.primitives).toEqual([{ type: "fill", color: backgroundColor(colorOf("blue")) }]);
		expect(scene.resultLayer).toBe(1);
	});

	it("reduced-motion の結果は基準色の全面から完了状態へ一回だけ切り替わる", () => {
		const start = T0 + JUDGING_MS;
		const at = (offset: number) =>
			computeScene(
				base(
					{
						phase: "result",
						result: resultOf("emerald"),
						phaseStartedAt: start,
						phaseEndsAt: start + 60_000,
					},
					{ now: start + offset, reducedMotion: true },
				),
			);
		const emerald = colorOf("emerald");
		expect(at(0).primitives).toEqual([{ type: "fill", color: baseColor(emerald) }]);
		expect(at(1_500).primitives).toEqual([{ type: "fill", color: baseColor(emerald) }]);
		expect(at(1_600).primitives).toEqual([{ type: "fill", color: backgroundColor(emerald) }]);
		expect(at(30_000).primitives).toEqual([{ type: "fill", color: backgroundColor(emerald) }]);
	});

	it("掃く広がり方は偶数の画面で左から、奇数の画面で右から掃く", () => {
		expect(RESULT_FORMS.emerald.form).toBe("sweepingTide");
		expect(RESULT_FORMS.rose.form).toBe("sweepingTide");
		const start = T0 + JUDGING_MS;
		const state: Partial<DisplayState> = {
			phase: "result",
			result: resultOf("emerald", "rose"),
			phaseStartedAt: start,
			phaseEndsAt: start + 60_000,
		};
		const even = computeScene(base(state, { now: start + 200, displayOrder: 0 })).primitives[1];
		const odd = computeScene(base(state, { now: start + 200, displayOrder: 1 })).primitives[1];
		expect(even).toMatchObject({ type: "bloom", shape: "line", x: 0, dx: 1 });
		expect(odd).toMatchObject({ type: "bloom", shape: "line", x: 1920, dx: -1 });
	});

	/** 描画側と同じ式で、点 `(px, py)` の起点からの距離を求める。 */
	const distance = (
		bloom: Extract<Primitive, { type: "bloom" }>,
		px: number,
		py: number,
		width: number,
		height: number,
	) => {
		const along = (px - bloom.x) * bloom.dx + (py - bloom.y) * bloom.dy;
		if (bloom.shape === "line") return along;
		if (bloom.shape === "band") return Math.abs(along);
		return Math.min(px, width - px, py, height - py);
	};

	it.each(PALETTE_IDS)("%s: 広がり始めは画面の一部だけに色があり、円の形を使わない", (colorId) => {
		const blooms = resultFormPrimitives(colorId, "#FFFFFF", 0, 1920, 1080, 0, 0) as Extract<
			Primitive,
			{ type: "bloom" }
		>[];
		for (const bloom of blooms) {
			expect(["line", "band", "frame"]).toContain(bloom.shape);
			if (bloom.shape !== "frame") expect(Math.hypot(bloom.dx, bloom.dy)).toBeCloseTo(1);
		}
		const covered = (px: number, py: number) =>
			blooms.some(
				(bloom) => distance(bloom, px, py, 1920, 1080) < bloom.reach + bloom.feather * (1 + BLOOM_WARP),
			);
		expect(covered(960, 540) && covered(0, 0) && covered(1920, 1080) && covered(0, 1080) && covered(1920, 0)).toBe(
			false,
		);
	});

	it.each(PALETTE_IDS)("%s: 広がりの終わりでは、縁がノイズで揺れても画面全体を塗りつぶす", (colorId) => {
		for (const [width, height] of [
			[1920, 1080],
			[1080, 1920],
		]) {
			const blooms = resultFormPrimitives(colorId, "#FFFFFF", 1, width, height, 0, 0) as Extract<
				Primitive,
				{ type: "bloom" }
			>[];
			for (let gx = 0; gx <= 8; gx += 1) {
				for (let gy = 0; gy <= 8; gy += 1) {
					const [px, py] = [(width * gx) / 8, (height * gy) / 8];
					const covered = blooms.some(
						(bloom) =>
							distance(bloom, px, py, width, height) + bloom.feather * BLOOM_WARP <=
							bloom.reach - bloom.feather,
					);
					expect(covered, `${width}x${height} (${px}, ${py})`).toBe(true);
				}
			}
		}
	});
});

describe("待機写真の巡回", () => {
	it("cycleIndex は8秒ごとに進む", () => {
		expect(idleCycleIndex(T0 + 7_999, T0)).toBe(0);
		expect(idleCycleIndex(T0 + 8_000, T0)).toBe(1);
		expect(idleCycleIndex(T0 + 80_000, T0)).toBe(10);
	});

	it("先頭1秒だけクロスフェードし、reduced-motion では即時に切り替える", () => {
		expect(idleCrossfade(T0 + 8_000, T0, false)).toBe(0);
		expect(idleCrossfade(T0 + 8_500, T0, false)).toBeCloseTo(0.5);
		expect(idleCrossfade(T0 + 9_000, T0, false)).toBe(1);
		expect(idleCrossfade(T0 + 15_000, T0, false)).toBe(1);
		expect(idleCrossfade(T0 + 8_000, T0, true)).toBe(1);
	});

	it("結果から待機へ戻るときは1秒で前の結果色を消す", () => {
		const idle = { phase: "idle" as const, sessionId: null, phaseStartedAt: T0 };
		expect(computeScene(base(idle, { now: T0, previousBackground: "#4A1420" })).veil).toEqual({
			color: "#4A1420",
			opacity: 1,
		});
		expect(computeScene(base(idle, { now: T0 + 1_000, previousBackground: "#4A1420" })).veil).toBeNull();
		expect(
			computeScene(base(idle, { now: T0, previousBackground: "#4A1420", reducedMotion: true })).veil,
		).toBeNull();
	});
});

describe("シーケンス", () => {
	it("待機写真の巡回を続け、演出はシーケンスのコンポーネントに任せる", () => {
		const scene = computeScene(base({ phase: "sequence", sequenceId: "opening" }, { now: T0 + 500 }));
		expect(scene).toMatchObject({
			primitives: [{ type: "fill", color: COLORS.idle }],
			shards: null,
			idleLayer: 1,
			resultLayer: 0,
		});
	});
});
