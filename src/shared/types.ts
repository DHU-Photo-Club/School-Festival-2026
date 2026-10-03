export const COLOR_IDS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta'] as const;
export type ColorId = (typeof COLOR_IDS)[number];

export const SLIDER_STOP_IDS = ['far-left', 'left', 'center', 'right', 'far-right'] as const;
export type SliderStopId = (typeof SLIDER_STOP_IDS)[number];

export const PHASES = ['idle', 'intro', 'question', 'judging', 'result'] as const;
export type Phase = (typeof PHASES)[number];

export type QuestionId = string;

/** 端末の役割。診断用iPadは `controller`。 */
export type Role = 'controller' | 'display' | 'admin';

/** 仕様書8章の展示状態。 */
export interface ExhibitState {
  sessionId: string | null;
  phase: Phase;
  questionIndex: number | null;
  answers: Record<QuestionId, SliderStopId>;
  resultColorId: ColorId | null;
  previewColorId: ColorId | null;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  revision: number;
  accepting: boolean;
}

/** 展示ディスプレイへ配信する状態（仕様書8.5節）。 */
export type DisplayState = Pick<
  ExhibitState,
  'sessionId' | 'phase' | 'resultColorId' | 'previewColorId' | 'phaseStartedAt' | 'phaseEndsAt' | 'revision'
>;

export interface ResultColor {
  id: ColorId;
  name: string;
  baseColor: string;
  backgroundColor: string;
  foregroundColor: string;
  message: string;
  /** 同点時の固定優先順位。小さいほど優先する。 */
  tieBreakPriority: number;
  representativePhotoId: string;
}

export interface SliderStop {
  id: SliderStopId;
  caption: string;
  /** 加点する色と点数。1〜2色。 */
  scores: Partial<Record<ColorId, number>>;
}

export interface Question {
  id: QuestionId;
  theme: string;
  prompt: string;
  leftLabel: string;
  rightLabel: string;
  stops: readonly [SliderStop, SliderStop, SliderStop, SliderStop, SliderStop];
}

export interface Photo {
  id: string;
  resultColorId: ColorId;
  resultOrder: number;
  idleEnabled: boolean;
  idleOrder: number;
  shareAllowed: boolean;
  creditName: string | null;
  creditUrl?: string;
}

export interface DisplayManifestEntry {
  screenId: string;
  displayOrder: number;
  orientation: 'landscape' | 'portrait';
  /** 物理解像度。写真の長辺の上限（仕様書12.1節）に使う。 */
  width: number;
  height: number;
}
