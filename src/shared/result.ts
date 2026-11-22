import type { Answer, PaletteId, QuestionId } from "./types.ts";

/** AIが選んだ一色と、その理由。 */
export interface ColorChoice {
	id: PaletteId;
	reason: string;
	/** 根拠の質問ID。 */
	evidence: readonly QuestionId[];
}

/** AIの二色の出力（refs/handoff examples/color-ai-output.json）。検証済みのもの。 */
export interface ColorOutput {
	paletteVersion: string;
	name: string;
	nameReason: string;
	reading: string;
	colors: readonly [ColorChoice, ColorChoice];
	relationship: string;
}

/** 写真選定の段階（refs/handoff 実装仕様書7.2節）。1: 色と内容、2: 色だけ、3: 内容だけ。 */
export type PhotoTier = 1 | 2 | 3;

/** 選んだ写真一枚と、その根拠（refs/handoff examples/photo-selection.json）。 */
export interface PhotoPick {
	photoId: string;
	tier: PhotoTier;
	colorEvidence: { kind: "overall" | "partial"; matchedResultColorId: PaletteId } | null;
	contentEvidence: { questionIds: readonly QuestionId[]; matchedTags: readonly string[]; reason: string } | null;
}

export interface PhotoSelection {
	policyVersion: string;
	/** 選ぼうとした枚数。 */
	requested: number;
	selected: readonly PhotoPick[];
	/** `requested` に足りなかった枚数。 */
	shortage: number;
	/**
	 * 内容適合の判定の状態。`ai` はAIが判定した。`unavailable` はAIの写真選定に失敗し、
	 * 色の適合だけで選んだ（内容は根拠不足として段階2までを使う）。
	 */
	contentStatus: "ai" | "unavailable";
}

/**
 * 一回の体験の結果の記録（refs/handoff 実装仕様書8章、examples/resolved-colors.json）。
 * 回答、二色、色名、写真を、後から再生成せずに振り返れるよう保存する。
 */
export interface ResultRecord {
	schemaVersion: "color-result-v1";
	id: string;
	createdAt: number;
	questionVersion: string;
	paletteVersion: string;
	colorPromptVersion: string;
	photoPromptVersion: string;
	model: string;
	answers: Readonly<Record<QuestionId, Answer>>;
	color: ColorOutput;
	photos: PhotoSelection;
}

/** 結果ページ（`/result/{id}`）へ公開する部分。回答と写真の根拠は含めない。 */
export interface PublicResult {
	id: string;
	name: string;
	nameReason: string;
	reading: string;
	relationship: string;
	colors: readonly [{ id: PaletteId; reason: string }, { id: PaletteId; reason: string }];
	/** 選んだ写真のうち、配布を許可した写真のID。 */
	photoIds: readonly string[];
}

/** 結果IDの形式。推測されにくいよう、16桁の16進数にする。 */
export const RESULT_ID_PATTERN = /^[0-9a-f]{16}$/;
