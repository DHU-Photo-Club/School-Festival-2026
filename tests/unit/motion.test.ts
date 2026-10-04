import { describe, expect, it } from 'vitest';
import { RESULT_COLORS } from '../../src/data/colors.ts';
import { INACTIVITY_MS, JUDGING_MS } from '../../src/shared/machine.ts';
import {
  BLOOM_WARP,
  COLORS,
  computeScene,
  idleCrossfade,
  idleCycleIndex,
  NEUTRAL_ORDER,
  RESULT_FORMS,
  resultFormPrimitives,
  ringAngle,
  ringOrder,
  ringSteps,
  spectrumOffset,
} from '../../src/shared/motion.ts';
import type { Primitive, Scene, SceneInput } from '../../src/shared/motion.ts';
import { COLOR_IDS } from '../../src/shared/types.ts';
import type { ColorId, DisplayState } from '../../src/shared/types.ts';

const T0 = 1_800_000_000_000;
const base = (state: Partial<DisplayState>, patch: Partial<SceneInput> = {}): SceneInput => ({
  state: {
    sessionId: 'session-a',
    phase: 'idle',
    resultColorId: null,
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
  colors: RESULT_COLORS,
  resultMode: 'animate',
  previousBackground: null,
  ...patch,
});

const questionState = (lastOperationAt: number, revision = 12): Partial<DisplayState> => ({
  phase: 'question',
  phaseStartedAt: T0,
  phaseEndsAt: lastOperationAt + INACTIVITY_MS,
  revision,
});

const spectrumOf = (scene: Scene) => scene.primitives.find((primitive) => primitive.type === 'spectrum');

describe('決定性', () => {
  it('同じ入力からは同じ描画内容を返す', () => {
    const input = base(questionState(T0 + 10_000), { now: T0 + 12_345 });
    expect(computeScene(input)).toEqual(computeScene(structuredClone(input)));
  });

  it('輪の並び順はセッションの間は同じで、8色を一度ずつ含む', () => {
    expect(ringOrder('session-a')).toEqual(ringOrder('session-a'));
    expect([...ringOrder('session-a')].sort()).toEqual([...COLOR_IDS].sort());
    expect(ringOrder(null)).toEqual(NEUTRAL_ORDER);
  });

  it('画面が右へ一つ進むごとに一区画戻し、一問確定すると隣の画面の構図へ移る', () => {
    expect(ringAngle('s', 5, 1)).toBeCloseTo(ringAngle('s', 4, 0));
    expect(ringAngle('s', 6, 2)).toBeCloseTo(ringAngle('s', 5, 1));
  });

  it('色のにじみは右隣の画面へ一区画ずつ続き、一問確定すると右へ一区画ずれる', () => {
    // 区画の位置 = x / 幅 × span - offset。右隣の画面は一区画先から始まる。
    expect(spectrumOffset('s', 5, 1)).toBeCloseTo(spectrumOffset('s', 5, 0) - 1);
    // 一問確定すると、右隣の画面が直前の自画面と同じ構図になる。
    expect(spectrumOffset('s', 6, 1)).toBeCloseTo(spectrumOffset('s', 5, 0));
  });
});

describe('質問中の色のにじみ', () => {
  it('revision が増えた時刻から6秒かけて一区画回る', () => {
    const changedAt = T0 + 20_000;
    const state = { ...base(questionState(changedAt)).state };
    expect(ringSteps(state, changedAt, 6_000, false)).toBeCloseTo(11);
    expect(ringSteps(state, changedAt + 3_000, 6_000, false)).toBeCloseTo(11.5);
    expect(ringSteps(state, changedAt + 6_000, 6_000, false)).toBe(12);
    expect(ringSteps(state, changedAt + 1_000, 6_000, true)).toBe(12);
  });

  it('再接続した画面もほかの画面と同じ角度から再開する（描画は時刻と状態だけで決まる）', () => {
    const at = T0 + 23_456;
    const first = computeScene(base(questionState(T0 + 20_000), { now: at }));
    const reconnected = computeScene(base(questionState(T0 + 20_000), { now: at }));
    expect(spectrumOf(reconnected)).toEqual(spectrumOf(first));
  });

  it('8色を同じ面積で並べ、どの色も強調しない', () => {
    const spectrum = spectrumOf(computeScene(base(questionState(T0 + 1_000), { now: T0 + 30_000 })));
    expect(spectrum?.type).toBe('spectrum');
    if (spectrum?.type !== 'spectrum') return;
    expect(spectrum.colors).toHaveLength(8);
    expect(new Set(spectrum.colors).size).toBe(8);
    expect(spectrum.intensity).toBe(1);
  });

  it('ノイズは質問の開始からの経過秒で流れ、reduced-motion では流れない', () => {
    const at = (reducedMotion: boolean) => spectrumOf(computeScene(base(questionState(T0 + 1_000), { now: T0 + 12_500, reducedMotion })));
    expect(at(false)).toMatchObject({ drift: 12.5 });
    expect(at(true)).toMatchObject({ drift: 0 });
  });

  it('reduced-motion では呼吸せず、時刻が進んでも同じ構図のまま', () => {
    const at = (now: number) => computeScene(base(questionState(T0 + 1_000), { now, reducedMotion: true }));
    expect(at(T0 + 2_000).primitives).toEqual(at(T0 + 9_000).primitives);
    expect(at(T0 + 2_000).animating).toBe(false);
  });

  it('reduced-motion でも一問確定で構図が切り替わる', () => {
    const before = computeScene(base(questionState(T0 + 1_000, 12), { now: T0 + 5_000, reducedMotion: true }));
    const after = computeScene(base(questionState(T0 + 5_000, 13), { now: T0 + 5_001, reducedMotion: true }));
    expect(spectrumOf(after)).not.toEqual(spectrumOf(before));
  });
});

describe('判定と結果', () => {
  const judging = (resultColorId: ColorId): Partial<DisplayState> => ({
    phase: 'judging',
    resultColorId,
    phaseStartedAt: T0,
    phaseEndsAt: T0 + JUDGING_MS,
  });

  it('結果開始時刻より前の判定画面は、結果色によって変わらない', () => {
    for (const now of [T0, T0 + 600, T0 + 1_999]) {
      const scenes = COLOR_IDS.map((colorId) => JSON.stringify(computeScene(base(judging(colorId), { now })).primitives));
      expect(new Set(scenes).size).toBe(1);
    }
  });

  it('判定は1.2秒で黒へ沈む', () => {
    const scene = computeScene(base(judging('red'), { now: T0 + 1_500 }));
    expect(scene.primitives).toContainEqual({ type: 'fill', color: COLORS.dark, alpha: 1 });
    expect(spectrumOf(scene)).toBeUndefined();
  });

  it.each(COLOR_IDS)('%s: 結果開始の最初のフレームで結果色の形が見えている', (colorId) => {
    const color = RESULT_COLORS.find((entry) => entry.id === colorId);
    const scene = computeScene(base(judging(colorId), { now: T0 + JUDGING_MS }));
    const shape = scene.primitives[1];
    expect(shape).toBeDefined();
    expect(JSON.stringify(shape)).toContain(color?.baseColor);
    expect(scene.resultLayer).toBe(0);
  });

  it.each(COLOR_IDS)('%s: 広がり、沈み、写真が現れて完了状態になる', (colorId) => {
    const color = RESULT_COLORS.find((entry) => entry.id === colorId);
    const start = T0 + JUDGING_MS;
    const result: Partial<DisplayState> = { phase: 'result', resultColorId: colorId, phaseStartedAt: start, phaseEndsAt: start + 60_000 };
    const { durationMs } = RESULT_FORMS[colorId];
    expect(durationMs).toBeGreaterThanOrEqual(1_400);
    const settled = computeScene(base(result, { now: start + 10_000 }));
    expect(settled).toEqual({
      primitives: [{ type: 'fill', color: color?.backgroundColor }],
      idleLayer: 0,
      resultLayer: 1,
      veil: null,
      animating: false,
    });
    const mid = computeScene(base(result, { now: start + durationMs / 2 }));
    expect(mid.animating).toBe(true);
    expect(mid.resultLayer).toBe(0);
  });

  it('結果開始後に接続した画面は演出を再生せず完了状態を表示する', () => {
    const start = T0 + JUDGING_MS;
    const scene = computeScene(
      base({ phase: 'result', resultColorId: 'blue', phaseStartedAt: start, phaseEndsAt: start + 60_000 }, { now: start + 100, resultMode: 'complete' }),
    );
    expect(scene.primitives).toEqual([{ type: 'fill', color: '#122247' }]);
    expect(scene.resultLayer).toBe(1);
  });

  it('reduced-motion の結果は基準色の全面から完了状態へ一回だけ切り替わる', () => {
    const start = T0 + JUDGING_MS;
    const at = (offset: number) =>
      computeScene(base({ phase: 'result', resultColorId: 'green', phaseStartedAt: start, phaseEndsAt: start + 60_000 }, { now: start + offset, reducedMotion: true }));
    expect(at(0).primitives).toEqual([{ type: 'fill', color: '#2F9B78' }]);
    expect(at(1_500).primitives).toEqual([{ type: 'fill', color: '#2F9B78' }]);
    expect(at(1_600).primitives).toEqual([{ type: 'fill', color: '#10392C' }]);
    expect(at(30_000).primitives).toEqual([{ type: 'fill', color: '#10392C' }]);
  });

  it('cyan は偶数の画面で左から、奇数の画面で右から掃く', () => {
    const start = T0 + JUDGING_MS;
    const state: Partial<DisplayState> = { phase: 'result', resultColorId: 'cyan', phaseStartedAt: start, phaseEndsAt: start + 60_000 };
    const even = computeScene(base(state, { now: start + 200, displayOrder: 0 })).primitives[1];
    const odd = computeScene(base(state, { now: start + 200, displayOrder: 1 })).primitives[1];
    expect(even).toMatchObject({ type: 'bloom', shape: 'line', x: 0, dx: 1 });
    expect(odd).toMatchObject({ type: 'bloom', shape: 'line', x: 1920, dx: -1 });
  });

  /** 描画側と同じ式で、点 `(px, py)` の起点からの距離を求める。 */
  const distance = (bloom: Extract<Primitive, { type: 'bloom' }>, px: number, py: number, width: number, height: number) => {
    const along = (px - bloom.x) * bloom.dx + (py - bloom.y) * bloom.dy;
    if (bloom.shape === 'line') return along;
    if (bloom.shape === 'band') return Math.abs(along);
    return Math.min(px, width - px, py, height - py);
  };

  it.each(COLOR_IDS)('%s: 広がり始めは画面の一部だけに色があり、円の形を使わない', (colorId) => {
    const blooms = resultFormPrimitives(colorId, '#FFFFFF', 0, 1920, 1080, 0, 0) as Extract<Primitive, { type: 'bloom' }>[];
    for (const bloom of blooms) {
      expect(['line', 'band', 'frame']).toContain(bloom.shape);
      if (bloom.shape !== 'frame') expect(Math.hypot(bloom.dx, bloom.dy)).toBeCloseTo(1);
    }
    const covered = (px: number, py: number) => blooms.some((bloom) => distance(bloom, px, py, 1920, 1080) < bloom.reach + bloom.feather * (1 + BLOOM_WARP));
    expect(covered(960, 540) && covered(0, 0) && covered(1920, 1080) && covered(0, 1080) && covered(1920, 0)).toBe(false);
  });

  it.each(COLOR_IDS)('%s: 広がりの終わりでは、縁がノイズで揺れても画面全体を塗りつぶす', (colorId) => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
    ]) {
      const blooms = resultFormPrimitives(colorId, '#FFFFFF', 1, width, height, 0, 0) as Extract<Primitive, { type: 'bloom' }>[];
      for (let gx = 0; gx <= 8; gx += 1) {
        for (let gy = 0; gy <= 8; gy += 1) {
          const [px, py] = [(width * gx) / 8, (height * gy) / 8];
          const covered = blooms.some((bloom) => distance(bloom, px, py, width, height) + bloom.feather * BLOOM_WARP <= bloom.reach - bloom.feather);
          expect(covered, `${width}x${height} (${px}, ${py})`).toBe(true);
        }
      }
    }
  });
});

describe('待機写真の巡回', () => {
  it('cycleIndex は8秒ごとに進む', () => {
    expect(idleCycleIndex(T0 + 7_999, T0)).toBe(0);
    expect(idleCycleIndex(T0 + 8_000, T0)).toBe(1);
    expect(idleCycleIndex(T0 + 80_000, T0)).toBe(10);
  });

  it('先頭1秒だけクロスフェードし、reduced-motion では即時に切り替える', () => {
    expect(idleCrossfade(T0 + 8_000, T0, false)).toBe(0);
    expect(idleCrossfade(T0 + 8_500, T0, false)).toBeCloseTo(0.5);
    expect(idleCrossfade(T0 + 9_000, T0, false)).toBe(1);
    expect(idleCrossfade(T0 + 15_000, T0, false)).toBe(1);
    expect(idleCrossfade(T0 + 8_000, T0, true)).toBe(1);
  });

  it('結果から待機へ戻るときは1秒で前の結果色を消す', () => {
    const idle = { phase: 'idle' as const, sessionId: null, phaseStartedAt: T0 };
    expect(computeScene(base(idle, { now: T0, previousBackground: '#4A1420' })).veil).toEqual({ color: '#4A1420', opacity: 1 });
    expect(computeScene(base(idle, { now: T0 + 1_000, previousBackground: '#4A1420' })).veil).toBeNull();
    expect(computeScene(base(idle, { now: T0, previousBackground: '#4A1420', reducedMotion: true })).veil).toBeNull();
  });
});
