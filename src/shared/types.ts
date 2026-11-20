export const COLOR_IDS = ["red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta"] as const;
export type ColorId = (typeof COLOR_IDS)[number];

export const SLIDER_STOP_IDS = ["far-left", "left", "center", "right", "far-right"] as const;
export type SliderStopId = (typeof SLIDER_STOP_IDS)[number];

export const PHASES = ["idle", "sequence", "intro", "question", "judging", "result"] as const;
export type Phase = (typeof PHASES)[number];

export type QuestionId = string;

/** 端末の役割。診断用iPadは `controller`。 */
export type ScreenRole = "display" | "photo";
export type DeviceRole = "controller" | ScreenRole;
export type Role = DeviceRole | "admin";

/** 仕様書8章の展示状態。 */
export interface ExhibitState {
	sessionId: string | null;
	phase: Phase;
	/** `sequence` で再生中のシーケンスID。それ以外の段階では `null`。 */
	sequenceId: string | null;
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
	| "sessionId"
	| "phase"
	| "sequenceId"
	| "resultColorId"
	| "previewColorId"
	| "phaseStartedAt"
	| "phaseEndsAt"
	| "revision"
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

/** シーケンスを差し込める段階。その段階へ入る直前に再生する。 */
export const SEQUENCE_TARGETS = ["intro", "question"] as const;
export type SequenceTarget = (typeof SEQUENCE_TARGETS)[number];

/**
 * 時間経過で自動で進む、iPadと展示ディスプレイの連動演出。サーバーは再生時間だけを扱い、
 * 見た目は `src/client/sequences/<id>/` のコンポーネントが決める。
 */
export interface Sequence {
	id: string;
	/** 再生後に入る段階。 */
	before: SequenceTarget;
	durationMs: number;
}
