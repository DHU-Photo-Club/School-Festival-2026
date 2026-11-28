import type { PhotoPick, PhotoSelection } from "./result.ts";
import type { PaletteId, Photo, QuestionId } from "./types.ts";

/** AIが内容に合うと判定した写真一枚。並びはAIが合うと判断した順。 */
export interface ContentMatch {
	photoId: string;
	questionIds: readonly QuestionId[];
	matchedTags: readonly string[];
	reason: string;
}

/** 写真に内容の情報（内容タグ、雰囲気タグ、説明のどれか）があるか。ないものはAIの内容の判定に使わない。 */
export function hasContent(photo: Photo): boolean {
	return photo.contentTags.length > 0 || photo.moodTags.length > 0 || photo.description.trim().length > 0;
}

/**
 * 写真の色適合（refs/handoff 実装仕様書7.1節）。二色のどちらかが写真全体の印象（`overall`）か、
 * 視認できる一部分（`partial`）の色タグにあれば適合。全体を部分より、一色目を二色目より先に見る。
 */
export function colorMatch(photo: Photo, colors: readonly PaletteId[]): PhotoPick["colorEvidence"] {
	for (const kind of ["overall", "partial"] as const) {
		const matched = colors.find((color) => photo.colorTags[kind].includes(color));
		if (matched) return { kind, matchedResultColorId: matched };
	}
	return null;
}

/**
 * 診断結果の二色に合う写真だけを選ぶ。
 * - 全体の色（overall）が合う写真を、部分の色（partial）だけ合う写真より優先する。
 * - 色の一致度が同じ場合だけ、内容も合う写真を優先し、その中ではAIの判定順を使う。
 * - 内容だけ合う写真や、色タグがない写真では不足枚数を埋めない。
 * - `tier` は根拠の記録に使う（1: 色と内容、2: 色だけ）。段階3は過去の記録にだけ残る。
 * - `contentMatches` が `null`（AIの写真選定に失敗）でも、色の条件は変えない。
 * - カタログにない写真IDは使わない。足りない枚数は `shortage` に記録し、架空の写真や重複で埋めない。
 */
export function selectPhotos(input: {
	photos: readonly Photo[];
	colors: readonly PaletteId[];
	contentMatches: readonly ContentMatch[] | null;
	count: number;
	policyVersion: string;
}): PhotoSelection {
	const { photos, colors, contentMatches, count } = input;
	const byId = new Map(photos.map((photo) => [photo.id, photo]));
	const content = new Map<string, ContentMatch>();
	for (const match of contentMatches ?? []) {
		if (byId.has(match.photoId) && !content.has(match.photoId)) content.set(match.photoId, match);
	}
	const contentOrder = new Map([...content.keys()].map((id, index) => [id, index]));
	const pick = (photo: Photo, tier: 1 | 2): PhotoPick => {
		const match = content.get(photo.id);
		return {
			photoId: photo.id,
			tier,
			colorEvidence: colorMatch(photo, colors),
			contentEvidence:
				tier === 2 || !match
					? null
					: { questionIds: match.questionIds, matchedTags: match.matchedTags, reason: match.reason },
		};
	};
	const selected = photos
		.filter((photo) => colorMatch(photo, colors) !== null)
		.sort(
			(a, b) =>
				Number(colorMatch(a, colors)?.kind === "partial") - Number(colorMatch(b, colors)?.kind === "partial") ||
				(contentOrder.get(a.id) ?? content.size) - (contentOrder.get(b.id) ?? content.size),
		)
		.slice(0, Math.max(0, count))
		.map((photo) => pick(photo, content.has(photo.id) ? 1 : 2));
	return {
		policyVersion: input.policyVersion,
		requested: count,
		selected,
		shortage: Math.max(0, count - selected.length),
		contentStatus: contentMatches === null ? "unavailable" : "ai",
	};
}
