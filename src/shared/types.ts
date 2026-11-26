/**
 * 風景色パレット `scenery-v2` の13色のID（refs/handoff 実装仕様書4章）。AIはここから異なる二色を選ぶ。
 * 色名と色値は `src/data/palette.ts` で管理する。
 */
export const PALETTE_IDS = [
	"vermilion",
	"orange",
	"amber",
	"gold",
	"leaf",
	"forest",
	"emerald",
	"jade",
	"sky",
	"blue",
	"indigo",
	"wisteria",
	"rose",
] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/** パレットの一色。H は度、S と L は%（HSL）。 */
export interface PaletteColor {
	id: PaletteId;
	name: string;
	h: number;
	s: number;
	l: number;
	/** 色から連想する風景。AIへ渡す。 */
	scene: string;
}

export interface Palette {
	colors: readonly Color[];
}

/**
 * 質問の入力方式。単選択、複数選択（順不同）、順位つき選択（選んだ順が順位）、スライダー、2Dマップ。
 */
export const QUESTION_KINDS = ["single", "multiple", "ranked", "slider", "map"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const SLIDER_STOP_IDS = ["far-left", "left", "center", "right", "far-right"] as const;
export type SliderStopId = (typeof SLIDER_STOP_IDS)[number];

/** 2Dマップの3×3の区画。上の行から順に、各行は左から並べる。区画は補助文に使う。 */
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

/** 端末の役割。診断用iPadは `controller`、スマート電球の中継スクリプト（`scripts/light-bridge.ts`）は `light`。 */
export type ScreenRole = "display" | "photo";
export type DeviceRole = "controller" | ScreenRole | "light";
export type Role = DeviceRole | "admin";

/**
 * 一回の体験の結果のうち、各画面へ配信する部分。AIが選んだ二色と色名、選んだ写真。
 * 全文（読み取り、各色の理由、写真の根拠）は `ResultRecord` として会場サーバーに保存する。
 */
export interface SessionResult {
	/** 結果ページのID（`/result/{id}`）。 */
	id: string;
	name: string;
	/** 回答全体の読み取り。iPadの結果画面に表示する。 */
	reading: string;
	/** AIが選んだ異なる二色。順序はAIの出力順。 */
	colors: readonly [PaletteId, PaletteId];
	/** 段階1→2→3の順に選んだ写真ID。 */
	photoIds: readonly string[];
}

/** 仕様書8章の展示状態。 */
export interface ExhibitState {
	sessionId: string | null;
	phase: Phase;
	/** `intro` で入力したニックネーム。`idle` へ戻ると `null`。展示ディスプレイと写真用、管理画面には配信しない。 */
	nickname: string | null;
	/** `sequence` で再生中のシーケンスID。それ以外の段階では `null`。 */
	sequenceId: string | null;
	questionIndex: number | null;
	/** 回答。`intro` から `judging` まで保持し、結果が決まると消す。 */
	answers: Record<QuestionId, Answer>;
	/** 結果。`judging` で AI の選定が終わると設定し、`idle` へ戻ると `null`。 */
	result: SessionResult | null;
	/**
	 * 直前の AI の選定に失敗して最終問へ戻ったか。iPadは「もう一度」を案内する。
	 * 次の回答、戻る、`idle` への遷移で `false` にする。
	 */
	judgeFailed: boolean;
	previewColorId: PaletteId | null;
	phaseStartedAt: number;
	phaseEndsAt: number | null;
	/** 直前に質問の回答を受け付けた時刻。展示ディスプレイは、この時刻から中心の波紋を広げる。`idle` へ戻ると `null`。 */
	answeredAt: number | null;
	revision: number;
	accepting: boolean;
}

/** 展示ディスプレイと写真用へ配信する結果。結果ページのIDは含めない。 */
export type DisplayResult = Pick<SessionResult, "name" | "colors" | "photoIds">;

/** 展示ディスプレイと写真用へ配信する状態（仕様書8.3節）。 */
export type DisplayState = Pick<
	ExhibitState,
	| "sessionId"
	| "phase"
	| "sequenceId"
	| "previewColorId"
	| "phaseStartedAt"
	| "phaseEndsAt"
	| "answeredAt"
	| "revision"
> & { result: DisplayResult | null };

/** 2Dマップ上の位置。`x` は左端0から右端1、`y` は上端0から下端1。 */
export interface MapPoint {
	x: number;
	y: number;
}

/**
 * 一問の回答。単選択は選択肢ID、複数選択は選択肢IDの配列（選択肢の定義順）、
 * 順位つき選択は選択肢IDの配列（1位から順）、スライダーは左端0から右端1までの位置、2Dマップは平面上の位置。
 */
export type Answer = string | readonly string[] | number | MapPoint;

export interface SliderStop {
	id: SliderStopId;
	/** 回答位置の近くを選んでいるときの補助文。 */
	caption: string;
}

export interface ChoiceOption {
	/** 質問内で一意のID。英数字、ハイフン、アンダースコア。 */
	id: string;
	label: string;
	/** `true` なら単独でしか選べない（例: 「今は、どれとも決められない」）。複数選択だけで使う。 */
	exclusive?: boolean;
}

export interface MapCell {
	id: MapCellId;
	caption: string;
}

interface QuestionBase {
	id: QuestionId;
	prompt: string;
	/** 質問文の下に出す案内。 */
	guide: string;
}

/** 選択肢から一つを選ぶ。 */
export interface SingleChoiceQuestion extends QuestionBase {
	kind: "single";
	options: readonly ChoiceOption[];
}

/** 選択肢から `minSelections` 個以上 `maxSelections` 個以下を選ぶ。順序に意味はない。 */
export interface MultipleChoiceQuestion extends QuestionBase {
	kind: "multiple";
	options: readonly ChoiceOption[];
	minSelections: number;
	maxSelections: number;
}

/** 選択肢から `minSelections` 個以上 `maxSelections` 個以下を、優先度の高い順に選ぶ。 */
export interface RankedChoiceQuestion extends QuestionBase {
	kind: "ranked";
	options: readonly ChoiceOption[];
	minSelections: number;
	maxSelections: number;
}

/**
 * 左右端の語の間の位置を選ぶ。5つの回答位置は補助文に使う。
 * AIへは0〜100の整数（`Math.round(位置 × 100)`）と `interpretation` の補助ラベルで渡す。
 */
export interface SliderQuestion extends QuestionBase {
	kind: "slider";
	leftLabel: string;
	rightLabel: string;
	stops: readonly [SliderStop, SliderStop, SliderStop, SliderStop, SliderStop];
	/** 0〜100の値の補助ラベル（refs/handoff 実装仕様書3章 Q3）。心理学的な区分ではない。 */
	interpretation: readonly { upTo: number; label: string }[];
}

/**
 * 横軸と縦軸の2軸で位置を選ぶ。区画は補助文に使う。AIへは各軸0〜100の整数で渡す。
 * 縦軸は上端が `topLabel`（0〜100の100側）になる。
 */
export interface MapQuestion extends QuestionBase {
	kind: "map";
	leftLabel: string;
	rightLabel: string;
	topLabel: string;
	bottomLabel: string;
	/** AIへ渡す軸の名前。 */
	axisIds: { horizontal: string; vertical: string };
	/** `MAP_CELL_IDS` の順に9区画。 */
	cells: readonly [MapCell, MapCell, MapCell, MapCell, MapCell, MapCell, MapCell, MapCell, MapCell];
}

export type ChoiceQuestion = SingleChoiceQuestion | MultipleChoiceQuestion | RankedChoiceQuestion;
export type Question = ChoiceQuestion | SliderQuestion | MapQuestion;

/** 写真の色タグ。パレットのIDで、全体の印象に近い色と、視認できる一部分に近い色を分ける。 */
export interface PhotoColorTags {
	overall: readonly PaletteId[];
	partial: readonly PaletteId[];
}

export interface Photo {
	id: string;
	width: number;
	height: number;
	idleEnabled: boolean;
	idleOrder: number;
	shareAllowed: boolean;
	creditName: string | null;
	creditUrl?: string;
	colorTags: PhotoColorTags;
	/** 写っている物や場面。 */
	contentTags: readonly string[];
	/** 雰囲気。 */
	moodTags: readonly string[];
	description: string;
	/** タグの状態。`provisional` は写真担当の確認前の仮の値。 */
	tagStatus: "provisional" | "confirmed";
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
