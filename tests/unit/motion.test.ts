import { describe, expect, it } from "vitest";
import { PALETTE } from "../../src/data/palette.ts";
import { INACTIVITY_MS, JUDGING_MS } from "../../src/shared/machine.ts";
import type { Primitive, Scene, SceneInput } from "../../src/shared/motion.ts";
import {
	ANSWER_PULSE_DEPTH,
	ANSWER_PULSE_IN_MS,
	ANSWER_PULSE_OUT_MS,
	BLOOM_WARP,
	COLORS,
	computeScene,
	INTRO_DESCRIPTION_AT_MS,
	INTRO_DESCRIPTION_FADE_MS,
	introDescriptionOpacity,
	introDescriptionRemainingMs,
	JUDGING_SHARD_DIM,
	RESULT_FORMS,
	resultFormPrimitives,
	SHARD_IDLE_DENSITY,
	SHARD_IDLE_SCALE,
	SHARD_OPENING_SIZE,
	SHARD_OPENING_SPREAD,
	SHARD_SCALE_MS,
	SHARD_TINT_MS,
	screenColorId,
	WELCOME_FADE_MS,
	WELCOME_FADE_OUT_MS,
	WELCOME_LEAVE_AT_MS,
	welcomeOpacity,
} from "../../src/shared/motion.ts";
import { backgroundColor, baseColor, paletteColor } from "../../src/shared/palette.ts";
import { RIPPLE_MS } from "../../src/shared/ripple.ts";
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
		answeredAt: null,
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

const questionState = (lastAcceptedAt: number, revision = 12): Partial<DisplayState> => ({
	phase: "question",
	phaseStartedAt: T0,
	phaseEndsAt: lastAcceptedAt + INACTIVITY_MS,
	revision,
});

const shardsOf = (scene: Scene) => scene.shards;

describe("回答の瞬間の輪の収縮", () => {
	const at = (elapsed: number, patch: Partial<DisplayState> = {}, input: Partial<SceneInput> = {}) =>
		computeScene(
			base({ ...questionState(T0), answeredAt: T0 + 1_000, ...patch }, { now: T0 + 1_000 + elapsed, ...input }),
		).shards.scale;

	it("回答の瞬間から一瞬で縮み、勢いよく戻って、減速しながら元の大きさへ着く", () => {
		expect(at(0)).toBe(1);
		expect(at(ANSWER_PULSE_IN_MS)).toBeCloseTo(1 - ANSWER_PULSE_DEPTH);
		// 縮む側は `easeInOutSine` で、半分の時間で半分の量。
		expect(at(ANSWER_PULSE_IN_MS / 2)).toBeCloseTo(1 - ANSWER_PULSE_DEPTH / 2);
		const returning = Array.from({ length: ANSWER_PULSE_OUT_MS / 10 + 1 }, (_, i) =>
			at(ANSWER_PULSE_IN_MS + i * 10),
		);
		// 元の大きさを超えず、縮み切った点から元の大きさへ向けて一方向に戻る（弾性がない）。
		for (let index = 1; index < returning.length; index++) {
			expect(returning[index]).toBeGreaterThanOrEqual(returning[index - 1]);
			expect(returning[index]).toBeLessThanOrEqual(1);
		}
		// 戻る速さは、早め（戻る時間の3分の1まで）に最高速に達し、その後は減速し続ける。
		const speeds = returning.slice(1).map((scale, index) => scale - returning[index]);
		const fastest = speeds.indexOf(Math.max(...speeds));
		expect(fastest).toBeGreaterThan(2);
		expect(fastest).toBeLessThan(speeds.length / 3);
		for (let index = fastest + 1; index < speeds.length; index++) {
			expect(speeds[index]).toBeLessThanOrEqual(speeds[index - 1] + 1e-12);
		}
		// 戻る時間の4分の1で、縮めた量の半分以上が戻る。
		expect(at(ANSWER_PULSE_IN_MS + ANSWER_PULSE_OUT_MS / 4)).toBeGreaterThan(1 - ANSWER_PULSE_DEPTH / 2);
		// 元の大きさへ着いて止まる。
		expect(returning.at(-1)).toBe(1);
		expect(at(ANSWER_PULSE_IN_MS + ANSWER_PULSE_OUT_MS)).toBe(1);
		expect(ANSWER_PULSE_IN_MS + ANSWER_PULSE_OUT_MS).toBeGreaterThanOrEqual(1_400);
	});

	it("縮み切った下限で、速度が途切れずにつながる（ガクッとならない）", () => {
		const velocity = (from: number) => (at(from + 1) - at(from - 1)) / 2;
		const fastestShrink = Math.max(
			...Array.from({ length: ANSWER_PULSE_IN_MS }, (_, i) => Math.abs(velocity(i + 1))),
		);
		// 縮み切る時刻の前後で、速度が最高速の数%以内（0を通って符号が変わるだけ）。
		for (const offset of [-5, -1, 0, 1, 5]) {
			expect(Math.abs(velocity(ANSWER_PULSE_IN_MS + offset))).toBeLessThan(fastestShrink * 0.1);
		}
		expect(Math.abs(velocity(ANSWER_PULSE_IN_MS - 10))).toBeLessThan(fastestShrink * 0.25);
		expect(Math.abs(velocity(ANSWER_PULSE_IN_MS + 10))).toBeLessThan(fastestShrink * 0.25);
		// 速度は縮み切る時刻の前後で、急にではなく滑らかに変わる（10ミリ秒ごとの速度の変化が最高速の15%未満）。
		for (let time = ANSWER_PULSE_IN_MS - 50; time < ANSWER_PULSE_IN_MS + 50; time += 10) {
			expect(Math.abs(velocity(time + 10) - velocity(time))).toBeLessThan(fastestShrink * 0.15);
		}
	});

	it("縮む側は動き出しが急に変わらない", () => {
		const step = (from: number) => Math.abs(at(from + 10) - at(from));
		const peak = ANSWER_PULSE_DEPTH / ANSWER_PULSE_IN_MS;
		expect(step(0)).toBeLessThan(peak * 10 * 0.2);
		// 縮む側の途中が最も速い。
		expect(step(ANSWER_PULSE_IN_MS / 2 - 5)).toBeGreaterThan(step(0) * 3);
	});

	it("縮むのは輪の半径だけで、破片の大きさや枚数は変えない", () => {
		const shards = computeScene(
			base({ ...questionState(T0), answeredAt: T0 + 1_000 }, { now: T0 + 1_000 + ANSWER_PULSE_IN_MS }),
		).shards;
		expect(shards).toMatchObject({ size: 1, density: 1, spread: 0, intensity: 1 });
	});

	it("全画面で同じ倍率になり、最終問の回答で入った judging でも縮む", () => {
		expect(at(300, {}, { displayOrder: 1 })).toBe(at(300, {}, { displayOrder: 0 }));
		expect(at(ANSWER_PULSE_IN_MS, { phase: "judging" })).toBeCloseTo(1 - ANSWER_PULSE_DEPTH);
	});

	it("回答がなければ、reduced-motionなら、question と judging 以外なら縮めない", () => {
		expect(at(ANSWER_PULSE_IN_MS, { answeredAt: null })).toBe(1);
		expect(at(ANSWER_PULSE_IN_MS, {}, { reducedMotion: true })).toBe(1);
		for (const phase of ["idle", "intro", "sequence", "result"] as const) {
			expect(at(ANSWER_PULSE_IN_MS, { phase })).not.toBeCloseTo(1 - ANSWER_PULSE_DEPTH);
		}
	});
});

describe("回答の波紋", () => {
	const answered = (answeredAt: number | null, patch: Partial<DisplayState> = {}) => ({
		...questionState(T0),
		answeredAt,
		...patch,
	});

	// 波紋は、輪が縮み切って戻り始める瞬間（回答から `ANSWER_PULSE_IN_MS` 後）に始まる。
	const start = T0 + 1_000 + ANSWER_PULSE_IN_MS;

	it("輪が戻り始める瞬間から経過時間を数え、全画面で同じ値にする", () => {
		const at = (displayOrder: number) =>
			computeScene(base(answered(T0 + 1_000), { now: start + 750, displayOrder })).ripple;
		expect(at(0)).toEqual({ elapsed: 750 });
		expect(at(1)).toEqual({ elapsed: 750 });
	});

	it("輪が戻り始めるまでは出さず、始まる瞬間に出て、波紋が消えるまで広げ続ける", () => {
		const ripple = (now: number) => computeScene(base(answered(T0 + 1_000), { now })).ripple;
		// 回答の瞬間と、輪が縮んでいる間は出ない。
		expect(ripple(T0 + 1_000)).toBeNull();
		expect(ripple(start - 1)).toBeNull();
		expect(ripple(start)).toEqual({ elapsed: 0 });
		expect(ripple(start + RIPPLE_MS - 1)).not.toBeNull();
		expect(ripple(start + RIPPLE_MS)).toBeNull();
	});

	it("波紋が始まる瞬間は、輪が縮み切って戻り始める瞬間と同じ", () => {
		const scale = (now: number) => computeScene(base(answered(T0 + 1_000), { now })).shards.scale;
		// 波紋が出る直前まで輪は縮み続け、波紋が出た後は戻り続ける。
		expect(scale(start - 20)).toBeGreaterThan(scale(start));
		expect(scale(start + 20)).toBeGreaterThan(scale(start));
		expect(scale(start)).toBeCloseTo(1 - ANSWER_PULSE_DEPTH);
	});

	it("回答がなければ、reduced-motionなら、question と judging 以外なら広げない", () => {
		const now = start + 500;
		expect(computeScene(base(answered(null), { now })).ripple).toBeNull();
		expect(computeScene(base(answered(T0 + 1_000), { now, reducedMotion: true })).ripple).toBeNull();
		for (const phase of ["idle", "intro", "sequence", "result"] as const) {
			expect(computeScene(base(answered(T0 + 1_000, { phase }), { now })).ripple).toBeNull();
		}
		// 最終問の回答（judging へ進む）は広げる。
		expect(computeScene(base(answered(T0 + 1_000, { phase: "judging" }), { now })).ripple).toEqual({
			elapsed: 500,
		});
	});

	it("answeredAt を持たない保存済みの状態でも広げず、落ちない", () => {
		const input = base(answered(null), { now: start + 500 });
		const legacy = { ...input, state: { ...input.state, answeredAt: undefined } } as unknown as SceneInput;
		expect(computeScene(legacy).ripple).toBeNull();
	});

	it("波紋の間は描き続ける", () => {
		expect(computeScene(base(answered(T0 + 1_000), { now: start + 500 })).animating).toBe(true);
	});
});

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
		expect(shards).toMatchObject({ colors: null, tint: 0, intensity: 1 });
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

	it("回答を確定しても描画内容は変わらない（時刻だけで動く）", () => {
		const now = T0 + 23_000;
		const before = computeScene(base(questionState(T0 + 1_000, 12), { now }));
		const after = computeScene(base(questionState(T0 + 20_000, 13), { now }));
		expect(after).toEqual(before);
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

	it("判定中は塵を出し、結果の色づきに合わせて消え、結果開始以降と判定以外、reduced-motionでは出さない", () => {
		expect(computeScene(base(waiting, { now: T0 })).dust).toBeNull();
		expect(computeScene(base(waiting, { now: T0 + 3_000 })).dust).toEqual({ elapsed: 3_000, fade: 1 });
		const settled: Partial<DisplayState> = { ...judging("jade"), result: resultOf("jade", "rose") };
		const tintAt = T0 + JUDGING_MS - SHARD_TINT_MS;
		expect(computeScene(base(settled, { now: tintAt })).dust?.fade).toBe(1);
		const middle = computeScene(base(settled, { now: tintAt + SHARD_TINT_MS / 2 })).dust?.fade;
		expect(middle).toBeGreaterThan(0);
		expect(middle).toBeLessThan(1);
		expect(computeScene(base(settled, { now: T0 + JUDGING_MS })).dust).toBeNull();
		expect(computeScene(base(waiting, { now: T0 + 3_000, reducedMotion: true })).dust).toBeNull();
		expect(computeScene(base(questionState(T0), { now: T0 + 3_000 })).dust).toBeNull();
		expect(computeScene(base({ phase: "idle" }, { now: T0 + 3_000 })).dust).toBeNull();
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

	it("色づいた破片は、結果色が広がった後も消えずに残る", () => {
		const start = T0 + JUDGING_MS;
		const state: Partial<DisplayState> = {
			phase: "result",
			result: resultOf("jade", "rose"),
			phaseStartedAt: start,
			phaseEndsAt: start + 60_000,
		};
		const at = (offset: number) => shardsOf(computeScene(base(state, { now: start + offset })));
		expect(at(600)).toMatchObject({ tint: 1, intensity: 1 });
		expect(at(10_000)).toMatchObject({ tint: 1, intensity: 1 });
		const complete = shardsOf(computeScene(base(state, { now: start + 100, resultMode: "complete" })));
		expect(complete).toMatchObject({ tint: 1, intensity: 1 });
		expect(complete.colors).not.toBeNull();
	});

	it("reduced-motion の判定は、灰色の破片から二色の破片へ一回だけ切り替わる", () => {
		const state: Partial<DisplayState> = { ...judging("jade"), result: resultOf("jade", "rose") };
		const tintAt = T0 + JUDGING_MS - SHARD_TINT_MS;
		const at = (now: number) => computeScene(base(state, { now, reducedMotion: true }));
		expect(at(T0).primitives).toEqual([{ type: "fill", color: COLORS.dark }]);
		expect(shardsOf(at(T0))).toEqual(shardsOf(at(tintAt - 1)));
		expect(shardsOf(at(tintAt - 1))).toMatchObject({ colors: null, time: 0 });
		expect(shardsOf(at(tintAt))).toMatchObject({ tint: 1, intensity: 1, time: 0 });
		expect(shardsOf(at(T0 + JUDGING_MS))).toMatchObject({ tint: 1, intensity: 1, time: 0 });
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

	it.each(PALETTE_IDS)("%s: 広がり、沈み、色名が現れて完了状態になる", (colorId) => {
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
		expect(settled).toMatchObject({
			primitives: [{ type: "fill", color: backgroundColor(color) }],
			resultLayer: 1,
			veil: null,
		});
		expect(settled.shards).toMatchObject({ tint: 1, intensity: 1 });
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

describe("歓迎の文字", () => {
	const intro = { phase: "intro" as const, sequenceId: null, phaseStartedAt: T0 };

	it("intro の間だけ、開始からゆっくり現れる", () => {
		expect(welcomeOpacity(intro, T0, false)).toBe(0);
		const mid = welcomeOpacity(intro, T0 + WELCOME_FADE_MS / 2, false);
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThan(1);
		expect(welcomeOpacity(intro, T0 + WELCOME_FADE_MS, false)).toBe(1);
		expect(welcomeOpacity(intro, T0 + WELCOME_LEAVE_AT_MS - 1, false)).toBeCloseTo(1, 3);
	});

	it("現れ終えてしばらく見せたあと、説明の文へ入れ替えるために消える", () => {
		const half = welcomeOpacity(intro, T0 + WELCOME_LEAVE_AT_MS + WELCOME_FADE_OUT_MS / 2, false);
		expect(half).toBeGreaterThan(0);
		expect(half).toBeLessThan(1);
		expect(welcomeOpacity(intro, T0 + INTRO_DESCRIPTION_AT_MS, false)).toBe(0);
		expect(welcomeOpacity(intro, T0 + 60_000, false)).toBe(0);
	});

	it("reduced-motion では即時に現れ、入れ替えの時刻に即時に消え、intro 以外では出さない", () => {
		expect(welcomeOpacity(intro, T0, true)).toBe(1);
		expect(welcomeOpacity(intro, T0 + WELCOME_LEAVE_AT_MS, true)).toBe(0);
		for (const phase of ["idle", "sequence", "question", "judging", "result"] as const)
			expect(welcomeOpacity({ phase, sequenceId: null, phaseStartedAt: T0 }, T0 + 60_000, false)).toBe(0);
	});

	it("intro の直前のシーケンスから現れ始め、intro に入っても途切れない", () => {
		const lead = { id: "opening", durationMs: 1_200 };
		const sequence = { phase: "sequence" as const, sequenceId: "opening", phaseStartedAt: T0 };
		const afterwards = { phase: "intro" as const, sequenceId: null, phaseStartedAt: T0 + lead.durationMs };
		expect(welcomeOpacity(sequence, T0, false, lead)).toBe(0);
		expect(welcomeOpacity(sequence, T0 + 1_000, false, lead)).toBeGreaterThan(0);
		// シーケンスの終わりの前後で連続する。
		expect(welcomeOpacity(afterwards, T0 + lead.durationMs, false, lead)).toBeCloseTo(
			welcomeOpacity(sequence, T0 + lead.durationMs, false, lead),
		);
		expect(welcomeOpacity(afterwards, T0 + WELCOME_FADE_MS, false, lead)).toBe(1);
		// 別のシーケンスや、定義にないシーケンスでは出さない。
		expect(welcomeOpacity({ ...sequence, sequenceId: "other" }, T0 + 1_000, false, lead)).toBe(0);
		expect(welcomeOpacity(sequence, T0 + 1_000, false, null)).toBe(0);
	});
});

describe("intro の説明の文", () => {
	const intro = { phase: "intro" as const, sequenceId: null, phaseStartedAt: T0 };

	it("歓迎の文字が消え終えてから、ゆっくり現れて見せ続ける", () => {
		expect(introDescriptionOpacity(intro, T0 + INTRO_DESCRIPTION_AT_MS - 1, false)).toBe(0);
		const mid = introDescriptionOpacity(intro, T0 + INTRO_DESCRIPTION_AT_MS + INTRO_DESCRIPTION_FADE_MS / 2, false);
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThan(1);
		expect(introDescriptionOpacity(intro, T0 + INTRO_DESCRIPTION_AT_MS + INTRO_DESCRIPTION_FADE_MS, false)).toBe(1);
		expect(introDescriptionOpacity(intro, T0 + 60_000, false)).toBe(1);
	});

	it("歓迎の文字と同時には見えない", () => {
		for (let t = 0; t <= INTRO_DESCRIPTION_AT_MS + INTRO_DESCRIPTION_FADE_MS; t += 100) {
			const welcome = welcomeOpacity(intro, T0 + t, false);
			const description = introDescriptionOpacity(intro, T0 + t, false);
			expect(Math.min(welcome, description)).toBe(0);
		}
	});

	it("reduced-motion では入れ替えの時刻に即時に現れ、intro 以外では出さない", () => {
		expect(introDescriptionOpacity(intro, T0 + WELCOME_LEAVE_AT_MS - 1, true)).toBe(0);
		expect(introDescriptionOpacity(intro, T0 + WELCOME_LEAVE_AT_MS, true)).toBe(1);
		for (const phase of ["idle", "sequence", "question", "judging", "result"] as const)
			expect(introDescriptionOpacity({ phase, sequenceId: null, phaseStartedAt: T0 }, T0 + 60_000, false)).toBe(
				0,
			);
	});

	it("intro の直前のシーケンスから数えて、intro の途中から接続しても同じ不透明度になる", () => {
		const lead = { id: "opening", durationMs: 3_600 };
		const afterwards = { phase: "intro" as const, sequenceId: null, phaseStartedAt: T0 + lead.durationMs };
		expect(introDescriptionOpacity(afterwards, T0 + INTRO_DESCRIPTION_AT_MS - 1, false, lead)).toBe(0);
		expect(
			introDescriptionOpacity(afterwards, T0 + INTRO_DESCRIPTION_AT_MS + INTRO_DESCRIPTION_FADE_MS, false, lead),
		).toBe(1);
	});
});

describe("ニックネームの入力欄を出す時刻", () => {
	const intro = { phaseStartedAt: T0 };
	const lead = { id: "opening", durationMs: 3_600 };

	it("説明の文が現れ終えるまでの残り時間を返し、現れ終えると0以下になる", () => {
		const doneAt = INTRO_DESCRIPTION_AT_MS + INTRO_DESCRIPTION_FADE_MS;
		expect(introDescriptionRemainingMs(intro, T0, false)).toBe(doneAt);
		expect(introDescriptionRemainingMs(intro, T0 + doneAt - 1, false)).toBe(1);
		expect(introDescriptionRemainingMs(intro, T0 + doneAt, false)).toBeLessThanOrEqual(0);
	});

	it("直前のシーケンスの長さを足して数える", () => {
		expect(introDescriptionRemainingMs(intro, T0, false, lead)).toBe(
			INTRO_DESCRIPTION_AT_MS + INTRO_DESCRIPTION_FADE_MS - lead.durationMs,
		);
	});

	it("reduced-motion では説明の文が即時に現れる時刻まで", () => {
		expect(introDescriptionRemainingMs(intro, T0, true)).toBe(WELCOME_LEAVE_AT_MS);
		expect(introDescriptionRemainingMs(intro, T0 + WELCOME_LEAVE_AT_MS, true)).toBeLessThanOrEqual(0);
	});
});

describe("opening と intro の破片", () => {
	const lead = { id: "opening", durationMs: 3_600 };
	const sequence = { phase: "sequence" as const, sequenceId: "opening", phaseStartedAt: T0 };
	const intro = { phase: "intro" as const, sequenceId: null, phaseStartedAt: T0 + lead.durationMs };
	const at = (state: Partial<DisplayState>, now: number, patch: Partial<SceneInput> = {}) =>
		computeScene(base(state, { now, lead, ...patch })).shards;
	const scattered = { tint: 1, scale: 1, density: 1, size: SHARD_OPENING_SIZE, spread: SHARD_OPENING_SPREAD };

	it("シーケンスの開始では待機の小さな灰色の輪で、パレットの全色へ色づきながら画面いっぱいに散らばる", () => {
		const start = at(sequence, T0);
		expect(start).toMatchObject({ tint: 0, density: SHARD_IDLE_DENSITY, size: 1, spread: 0 });
		expect(start.scale).toBeCloseTo(SHARD_IDLE_SCALE);
		const mid = at(sequence, T0 + SHARD_SCALE_MS / 2);
		expect(mid.tint).toBeGreaterThan(0);
		expect(mid.tint).toBeLessThan(1);
		expect(mid.spread).toBeGreaterThan(0);
		expect(mid.spread).toBeLessThan(SHARD_OPENING_SPREAD);
		const end = at(sequence, T0 + SHARD_SCALE_MS);
		expect(end).toMatchObject(scattered);
		expect(end.colors).toEqual(PALETTE.colors.map(baseColor));
	});

	it("intro に入っても散らばったまま続き、途中から接続した画面も同じになる", () => {
		expect(at(intro, intro.phaseStartedAt)).toMatchObject(scattered);
		expect(at(intro, intro.phaseStartedAt + 60_000)).toMatchObject(scattered);
		// シーケンスの終わりと intro の始まりで、破片は途切れない。
		expect(at(intro, T0 + lead.durationMs)).toEqual(at(sequence, T0 + lead.durationMs));
	});

	it("reduced-motion では最初から散らばった状態", () => {
		expect(at(sequence, T0, { reducedMotion: true })).toMatchObject(scattered);
	});

	it("intro から質問へ移ると、色づいて散らばった破片が灰色の質問中の輪へ戻る", () => {
		const question = questionState(T0 + 10_000);
		const from = (offset: number) =>
			computeScene(base(question, { now: T0 + offset, lead, questionFromIntro: true })).shards;
		expect(from(0)).toMatchObject({ tint: 1, spread: SHARD_OPENING_SPREAD, size: SHARD_OPENING_SIZE });
		const mid = from(SHARD_SCALE_MS / 2);
		expect(mid.tint).toBeGreaterThan(0);
		expect(mid.tint).toBeLessThan(1);
		expect(mid.spread).toBeGreaterThan(0);
		expect(mid.spread).toBeLessThan(SHARD_OPENING_SPREAD);
		expect(from(SHARD_SCALE_MS)).toMatchObject({ colors: null, tint: 0, scale: 1, size: 1, density: 1, spread: 0 });
	});
});

describe("待機", () => {
	it("写真を置かず、灰色の破片を常に描く", () => {
		const idle = { phase: "idle" as const, sessionId: null, phaseStartedAt: T0 };
		const scene = computeScene(base(idle, { now: T0 + 30_000 }));
		expect(scene.shards).toMatchObject({ colors: null, tint: 0, intensity: 1, time: T0 + 30_000 });
		expect(scene).not.toHaveProperty("idleLayer");
	});

	it("待機中と、intro 以外のシーケンスでは、輪は小さく枚数も少ない", () => {
		const idle = { phase: "idle" as const, sessionId: null, phaseStartedAt: T0 };
		const at = (state: Partial<DisplayState>, offset: number, reducedMotion = false) =>
			computeScene(base(state, { now: T0 + offset, reducedMotion })).shards;
		for (const state of [idle, { ...idle, phase: "sequence" as const, sequenceId: "other" }]) {
			expect(at(state, 60_000)).toMatchObject({ colors: null, size: 1 });
			expect(at(state, 60_000).scale).toBeCloseTo(SHARD_IDLE_SCALE);
			expect(at(state, 60_000).density).toBeCloseTo(SHARD_IDLE_DENSITY);
		}
		expect(at(idle, 0, true).scale).toBeCloseTo(SHARD_IDLE_SCALE);
	});

	it("質問へ intro 以外から入ったときは、輪は最初から質問中の大きさ", () => {
		const shards = computeScene(base(questionState(T0), { now: T0 })).shards;
		expect(shards).toMatchObject({ colors: null, scale: 1, density: 1, size: 1, tint: 0 });
	});

	it("結果から待機へ戻ると、質問中の大きさから待機の小さな輪へ縮む", () => {
		const idle = { phase: "idle" as const, sessionId: null, phaseStartedAt: T0 };
		const at = (offset: number) => computeScene(base(idle, { now: T0 + offset })).shards.scale;
		expect(at(0)).toBe(1);
		expect(at(SHARD_SCALE_MS / 2)).toBeLessThan(1);
		expect(at(SHARD_SCALE_MS)).toBeCloseTo(SHARD_IDLE_SCALE);
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
	it("破片を描き続け、演出はシーケンスのコンポーネントに任せる", () => {
		const scene = computeScene(base({ phase: "sequence", sequenceId: "opening" }, { now: T0 + 500 }));
		expect(scene).toMatchObject({
			primitives: [{ type: "fill", color: COLORS.idle }],
			shards: { colors: null, tint: 0, intensity: 1 },
			resultLayer: 0,
		});
	});
});
