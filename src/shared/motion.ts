// 展示ディスプレイとiPadの演出を、補正済みサーバー時刻と受信状態だけから決める（docs/visual-language.md）。
import { INACTIVITY_MS } from './machine.ts';
import type { ColorId, DisplayState, ResultColor } from './types.ts';

// ---- 時間（docs/visual-language.md 3章） ----

export const IDLE_FRAME_MS = 8_000;
export const IDLE_CROSSFADE_MS = 1_000;
export const QUESTION_PHOTO_FADE_MS = 1_500;
export const RING_APPEAR_DELAY_MS = 600;
export const RING_APPEAR_MS = 3_000;
export const RING_TURN_MS = 6_000;
export const RING_PULSE = 0.08;
export const RING_BREATH_MS = 12_000;
export const RING_BREATH = 0.015;
export const JUDGING_FADE_MS = 1_200;
export const RESULT_SETTLE_MS = 1_000;
export const RESULT_PHOTO_DELAY_MS = 400;
export const RESULT_PHOTO_FADE_MS = 1_200;
export const RESULT_REDUCED_HOLD_MS = 1_600;
export const IDLE_RETURN_MS = 1_000;
const SECTOR_DEGREES = 45;

export const COLORS = {
  idle: '#0B0B0B',
  dark: '#000000',
  text: '#E8E6E3',
  muted: '#8A8784',
  line: '#3A3836',
} as const;

/** 結果色ごとの広がり方と所要時間（docs/visual-language.md 3.4節）。 */
export const RESULT_FORMS: Readonly<Record<ColorId, { form: ResultForm; durationMs: number }>> = {
  red: { form: 'centerCircle', durationMs: 1_600 },
  orange: { form: 'risingHalfCircle', durationMs: 1_800 },
  yellow: { form: 'fallingHalfCircle', durationMs: 1_600 },
  green: { form: 'risingBand', durationMs: 2_200 },
  cyan: { form: 'sweepingBand', durationMs: 1_600 },
  blue: { form: 'closingRing', durationMs: 2_000 },
  violet: { form: 'turningFan', durationMs: 2_600 },
  magenta: { form: 'meetingCircles', durationMs: 1_400 },
};

export type ResultForm =
  | 'centerCircle'
  | 'risingHalfCircle'
  | 'fallingHalfCircle'
  | 'risingBand'
  | 'sweepingBand'
  | 'closingRing'
  | 'turningFan'
  | 'meetingCircles';

/** 色相が隣り合わない固定順（docs/visual-language.md 2.2節）。 */
export const NEUTRAL_ORDER: readonly ColorId[] = ['red', 'cyan', 'yellow', 'violet', 'green', 'magenta', 'blue', 'orange'];

// ---- 補助関数 ----

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInSine = (t: number) => 1 - Math.cos((clamp01(t) * Math.PI) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** FNV-1a 32bit。 */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seededRandom(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 輪の8区画の並び順。セッションの間は全画面で同じ（docs/visual-language.md 2.2節）。 */
export function ringOrder(sessionId: string | null): ColorId[] {
  if (!sessionId) return [...NEUTRAL_ORDER];
  const order = [...NEUTRAL_ORDER];
  const random = seededRandom(hash32(sessionId));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** 輪の基準角（度）。 */
export function ringBaseAngle(sessionId: string | null): number {
  return sessionId ? (hash32(`${sessionId}:angle`) % 4500) / 100 : 0;
}

/** サーバーが最後にiPad操作を受理した時刻（`question` の `phaseEndsAt` は最終操作から5分後）。 */
export function lastOperationAt(state: Pick<DisplayState, 'phase' | 'phaseStartedAt' | 'phaseEndsAt'>): number {
  if ((state.phase === 'question' || state.phase === 'intro') && state.phaseEndsAt !== null) {
    return state.phaseEndsAt - INACTIVITY_MS;
  }
  return state.phaseStartedAt;
}

/**
 * 輪の回転量（区画数）。`revision` が増えた時刻から `turnMs` かけて一区画回る。
 * `judging` では最終回答の確定として一区画回りながら消える。
 */
export function ringSteps(
  state: Pick<DisplayState, 'phase' | 'phaseStartedAt' | 'phaseEndsAt' | 'revision'>,
  now: number,
  turnMs: number,
  reducedMotion: boolean,
): number {
  const changedAt = lastOperationAt(state);
  const turning =
    (state.phase === 'judging' || (state.phase === 'question' && changedAt > state.phaseStartedAt)) &&
    now - changedAt < turnMs;
  if (!turning || reducedMotion) return state.revision;
  return state.revision - 1 + easeInOutSine((now - changedAt) / turnMs);
}

/** 輪の回転角（度、12時方向から時計回り）。画面が右へ一つ進むごとに一区画戻す。 */
export function ringAngle(sessionId: string | null, steps: number, displayOrder: number): number {
  return ringBaseAngle(sessionId) + (steps - displayOrder) * SECTOR_DEGREES;
}

// ---- 描画内容 ----

export type Primitive =
  | { type: 'fill'; color: string; alpha?: number }
  | { type: 'ring'; cx: number; cy: number; outer: number; inner: number; angle: number; colors: string[] }
  | { type: 'circle'; cx: number; cy: number; r: number; color: string }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { type: 'ellipseHole'; cx: number; cy: number; rx: number; ry: number; color: string; holeColor: string }
  | { type: 'fan'; cx: number; cy: number; r: number; start: number; sweep: number; color: string };

export interface Scene {
  primitives: Primitive[];
  /** 待機写真またはタイトルの層の不透明度。 */
  idleLayer: number;
  /** 結果写真またはタイポグラフィの層の不透明度。 */
  resultLayer: number;
  /** 前の結果色を1秒で消すための覆い。 */
  veil: { color: string; opacity: number } | null;
  /** 次のフレームで描画内容が変わりうるか。 */
  animating: boolean;
}

export interface SceneInput {
  state: DisplayState;
  now: number;
  displayOrder: number;
  width: number;
  height: number;
  reducedMotion: boolean;
  colors: readonly ResultColor[];
  /**
   * 結果の見せ方。`animate` は `judging` から接続していた画面、`complete` は結果開始後に接続した画面。
   */
  resultMode: 'animate' | 'complete';
  /** 直前に表示していた結果の背景色。`idle` へ戻るときの覆いに使う。 */
  previousBackground: string | null;
}

const colorOf = (colors: readonly ResultColor[], id: ColorId | null) => colors.find((color) => color.id === id) ?? null;

/** 質問中の輪の形（docs/visual-language.md 3.2節）。 */
export function ringGeometry(width: number, height: number) {
  const m = Math.min(width, height);
  const M = Math.max(width, height);
  return { cx: width / 2, cy: height + 0.56 * m, outer: 0.78 * M, thickness: 0.48 * m };
}

function questionRing(input: SceneInput, thicknessScale: number, steps: number): Primitive {
  const { state, now, width, height, reducedMotion, colors } = input;
  const geometry = ringGeometry(width, height);
  const breath = reducedMotion ? 0 : RING_BREATH * Math.sin((2 * Math.PI * (now - state.phaseStartedAt)) / RING_BREATH_MS);
  const outer = geometry.outer * (1 + breath);
  const thickness = geometry.thickness * thicknessScale;
  return {
    type: 'ring',
    cx: geometry.cx,
    cy: geometry.cy,
    outer,
    inner: Math.max(0, outer - thickness),
    angle: ringAngle(state.sessionId, steps, input.displayOrder),
    colors: ringOrder(state.sessionId).map((id) => colorOf(colors, id)?.baseColor ?? COLORS.line),
  };
}

/** 結果色の広がりの一フレーム（docs/visual-language.md 3.4節）。`progress` は0〜1。 */
export function resultFormPrimitive(
  colorId: ColorId,
  color: string,
  progress: number,
  width: number,
  height: number,
  displayOrder: number,
): Primitive {
  const m = Math.min(width, height);
  const seed = 0.08 * m;
  const p = easeOutCubic(progress);
  const halfDiagonal = Math.hypot(width / 2, height / 2);
  const toBottomCorner = Math.hypot(width / 2, height);
  switch (RESULT_FORMS[colorId].form) {
    case 'centerCircle':
      return { type: 'circle', cx: width / 2, cy: height / 2, r: lerp(seed, halfDiagonal, p), color };
    case 'risingHalfCircle':
      return { type: 'circle', cx: width / 2, cy: height, r: lerp(seed, toBottomCorner, p), color };
    case 'fallingHalfCircle':
      return { type: 'circle', cx: width / 2, cy: 0, r: lerp(seed, toBottomCorner, p), color };
    case 'risingBand': {
      const h = lerp(seed, height, p);
      return { type: 'rect', x: 0, y: height - h, w: width, h, color };
    }
    case 'sweepingBand': {
      const w = lerp(seed, width, p);
      return { type: 'rect', x: displayOrder % 2 === 0 ? 0 : width - w, y: 0, w, h: height, color };
    }
    case 'closingRing': {
      const k = 1 - p;
      return {
        type: 'ellipseHole',
        cx: width / 2,
        cy: height / 2,
        rx: Math.max(0, width / 2 - seed) * k,
        ry: Math.max(0, height / 2 - seed) * k,
        color,
        holeColor: COLORS.dark,
      };
    }
    case 'turningFan':
      return {
        type: 'fan',
        cx: width / 2,
        cy: height / 2,
        r: halfDiagonal * 1.01,
        start: -Math.PI / 2,
        sweep: lerp(Math.PI * 0.1, Math.PI * 2, p),
        color,
      };
    case 'meetingCircles':
      return { type: 'circle', cx: 0, cy: height / 2, r: lerp(seed, halfDiagonal * 1.02, p), color };
  }
}

function resultScene(input: SceneInput): Scene {
  const { state, now, colors, reducedMotion, width, height, displayOrder } = input;
  const color = colorOf(colors, state.resultColorId);
  if (!color || !state.resultColorId) {
    return { primitives: [{ type: 'fill', color: COLORS.dark }], idleLayer: 0, resultLayer: 0, veil: null, animating: false };
  }
  const complete: Scene = {
    primitives: [{ type: 'fill', color: color.backgroundColor }],
    idleLayer: 0,
    resultLayer: 1,
    veil: null,
    animating: false,
  };
  if (input.resultMode === 'complete') return complete;

  // `judging` の `phaseEndsAt` と `result` の `phaseStartedAt` は同じ時刻。
  const startAt = state.phase === 'judging' ? (state.phaseEndsAt ?? now) : state.phaseStartedAt;
  const elapsed = now - startAt;
  if (reducedMotion) {
    if (elapsed < RESULT_REDUCED_HOLD_MS) {
      return { primitives: [{ type: 'fill', color: color.baseColor }], idleLayer: 0, resultLayer: 0, veil: null, animating: true };
    }
    return complete;
  }

  const { durationMs } = RESULT_FORMS[state.resultColorId];
  const settleEnd = durationMs + RESULT_SETTLE_MS;
  const photoEnd = durationMs + RESULT_PHOTO_DELAY_MS + RESULT_PHOTO_FADE_MS;
  if (elapsed >= Math.max(settleEnd, photoEnd)) return complete;

  const primitives: Primitive[] = [{ type: 'fill', color: COLORS.dark }];
  if (elapsed < durationMs) {
    const progress = elapsed / durationMs;
    primitives.push(resultFormPrimitive(state.resultColorId, color.baseColor, progress, width, height, displayOrder));
    if (RESULT_FORMS[state.resultColorId].form === 'meetingCircles') {
      const left = primitives[1] as Extract<Primitive, { type: 'circle' }>;
      primitives.push({ ...left, cx: width });
    }
  } else {
    primitives.push({ type: 'fill', color: color.baseColor });
    primitives.push({ type: 'fill', color: color.backgroundColor, alpha: easeInOutSine((elapsed - durationMs) / RESULT_SETTLE_MS) });
  }
  return {
    primitives,
    idleLayer: 0,
    resultLayer: easeInOutSine((elapsed - durationMs - RESULT_PHOTO_DELAY_MS) / RESULT_PHOTO_FADE_MS),
    veil: null,
    animating: true,
  };
}

/** 一フレームの描画内容を求める。同じ入力には同じ結果を返す。 */
export function computeScene(input: SceneInput): Scene {
  const { state, now, reducedMotion, colors } = input;

  if (state.phase === 'idle' || state.phase === 'intro') {
    const preview = state.phase === 'idle' ? colorOf(colors, state.previewColorId) : null;
    if (preview) {
      return { primitives: [{ type: 'fill', color: preview.backgroundColor }], idleLayer: 0, resultLayer: 1, veil: null, animating: false };
    }
    const sinceIdle = now - state.phaseStartedAt;
    const veiled = state.phase === 'idle' && input.previousBackground !== null && !reducedMotion && sinceIdle < IDLE_RETURN_MS;
    return {
      primitives: [{ type: 'fill', color: COLORS.idle }],
      idleLayer: 1,
      resultLayer: 0,
      veil: veiled ? { color: input.previousBackground as string, opacity: 1 - easeInOutSine(sinceIdle / IDLE_RETURN_MS) } : null,
      animating: !reducedMotion,
    };
  }

  if (state.phase === 'question') {
    const sinceStart = now - state.phaseStartedAt;
    const appear = reducedMotion ? 1 : easeInOutSine((sinceStart - RING_APPEAR_DELAY_MS) / RING_APPEAR_MS);
    const changedAt = lastOperationAt(state);
    const turn = (now - changedAt) / RING_TURN_MS;
    const pulse = !reducedMotion && changedAt > state.phaseStartedAt && turn < 1 ? RING_PULSE * Math.sin(Math.PI * clamp01(turn)) : 0;
    const steps = ringSteps(state, now, RING_TURN_MS, reducedMotion);
    return {
      primitives: [{ type: 'fill', color: COLORS.idle }, questionRing(input, appear * (1 + pulse), steps)],
      idleLayer: reducedMotion ? 0 : 1 - easeInOutSine(sinceStart / QUESTION_PHOTO_FADE_MS),
      resultLayer: 0,
      veil: null,
      animating: !reducedMotion,
    };
  }

  // `judging`。結果開始時刻を過ぎたフレームからは結果を描く（仕様書8.7節）。
  if (state.phase === 'judging' && (state.phaseEndsAt === null || now < state.phaseEndsAt)) {
    if (reducedMotion) {
      return { primitives: [{ type: 'fill', color: COLORS.dark }], idleLayer: 0, resultLayer: 0, veil: null, animating: false };
    }
    const fade = easeInSine((now - state.phaseStartedAt) / JUDGING_FADE_MS);
    const primitives: Primitive[] = [{ type: 'fill', color: COLORS.idle }, { type: 'fill', color: COLORS.dark, alpha: fade }];
    if (fade < 1) {
      primitives.push(questionRing(input, 1 - fade, ringSteps(state, now, RING_TURN_MS, false)));
    }
    return { primitives, idleLayer: 0, resultLayer: 0, veil: null, animating: true };
  }

  return resultScene(input);
}

// ---- 待機写真の巡回（仕様書7.2.3節） ----

/** `floor((補正済みサーバー時刻 - idle.phaseStartedAt) / 8000)`。 */
export function idleCycleIndex(now: number, idleStartedAt: number): number {
  return Math.max(0, Math.floor((now - idleStartedAt) / IDLE_FRAME_MS));
}

/** 現在の枠のクロスフェード進み具合（0〜1）。reduced-motionでは常に1。 */
export function idleCrossfade(now: number, idleStartedAt: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const intoFrame = (now - idleStartedAt) % IDLE_FRAME_MS;
  return easeInOutSine(intoFrame / IDLE_CROSSFADE_MS);
}
