export const COLOR_IDS = ["red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta"] as const;
export type ColorId = (typeof COLOR_IDS)[number];

/** 質問の入力方式。単選択、複数選択、スライダー、2Dマップ。 */
export const QUESTION_KINDS = ["single", "multiple", "slider", "map"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const SLIDER_STOP_IDS = ["far-left", "left", "center", "right", "far-right"] as const;
export type SliderStopId = (typeof SLIDER_STOP_IDS)[number];

/** 2Dマップの3×3の区画。上の行から順に、各行は左から並べる。配点は各区画の中心に置く。 */
export const MAP_CELL_IDS = [
	"top-left",
	"top",
	"top-right",
	"left",
	"center",
	"right",
	"bottom-left",
	"bottom",
	"bottom-right",
] as const;
export type MapCellId = (typeof MAP_CELL_IDS)[number];
/** 2Dマップの一辺の区画数。 */
export const MAP_SIZE = 3;

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
	/** `intro` で入力したニックネーム。`idle` へ戻ると `null`。展示ディスプレイと写真用、管理画面には配信しない。 */
	nickname: string | null;
	/** `sequence` で再生中のシーケンスID。それ以外の段階では `null`。 */
	sequenceId: string | null;
	questionIndex: number | null;
	answers: Record<QuestionId, Answer>;
	resultColorId: ColorId | null;
	previewColorId: ColorId | null;
	phaseStartedAt: number;
	phaseEndsAt: number | null;
	revision: number;
	accepting: boolean;
}

/** 展示ディスプレイと写真用へ配信する状態（仕様書8.3節）。 */
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

/** 加点する色と点数。1〜2色。 */
export type Scores = Partial<Record<ColorId, number>>;

/** 2Dマップ上の位置。`x` は左端0から右端1、`y` は上端0から下端1。 */
export interface MapPoint {
	x: number;
	y: number;
}

/**
 * 一問の回答。単選択は選択肢ID、複数選択は選択肢IDの配列（選択肢の定義順）、
 * スライダーは左端0から右端1までの位置、2Dマップは平面上の位置。
 */
export type Answer = string | readonly string[] | number | MapPoint;

export interface SliderStop {
	id: SliderStopId;
	caption: string;
	scores: Scores;
}

export interface ChoiceOption {
	/** 質問内で一意のID。英小文字、数字、ハイフン。 */
	id: string;
	label: string;
	scores: Scores;
}

export interface MapCell {
	id: MapCellId;
	caption: string;
	scores: Scores;
}

interface QuestionBase {
	id: QuestionId;
	theme: string;
	prompt: string;
}

/** 選択肢から一つを選ぶ。 */
export interface SingleChoiceQuestion extends QuestionBase {
	kind: "single";
	options: readonly ChoiceOption[];
}

/** 選択肢から `minSelections` 個以上 `maxSelections` 個以下を選ぶ。選んだ選択肢の配点を合計する。 */
export interface MultipleChoiceQuestion extends QuestionBase {
	kind: "multiple";
	options: readonly ChoiceOption[];
	minSelections: number;
	maxSelections: number;
}

/** 左右端の語の間の位置を選ぶ。5段階の回答位置を等間隔に置き、その間は両隣の配点を距離で混ぜる。 */
export interface SliderQuestion extends QuestionBase {
	kind: "slider";
	leftLabel: string;
	rightLabel: string;
	stops: readonly [SliderStop, SliderStop, SliderStop, SliderStop, SliderStop];
}

/** 上下左右の4辺に語を置いた平面で位置を選ぶ。配点は3×3の区画の中心に置き、その間は近くの区画の配点を距離で混ぜる。 */
export interface MapQuestion extends QuestionBase {
	kind: "map";
	leftLabel: string;
	rightLabel: string;
	topLabel: string;
	bottomLabel: string;
	/** `MAP_CELL_IDS` の順に9区画。 */
	cells: readonly [MapCell, MapCell, MapCell, MapCell, MapCell, MapCell, MapCell, MapCell, MapCell];
}

export type Question = SingleChoiceQuestion | MultipleChoiceQuestion | SliderQuestion | MapQuestion;

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
