import type { PhotoPick, PhotoSelection } from "./result.ts";
import type { PaletteId, Photo, QuestionId } from "./types.ts";

/** AIが内容に合うと判定した写真一枚。並びはAIが合うと判断した順。 */
export interface ContentMatch {
	photoId: string;
	questionIds: readonly QuestionId[];
	matchedTags: readonly string[];
	reason: string;
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
 * 写真を段階1→2→3の順に選ぶ（refs/handoff 実装仕様書7.2節、7.3節）。
 * - 段階1: 色と内容の両方が合う。段階2: 色だけ合う（内容が不明でもよい）。段階3: 内容だけ合う。
 * - 各写真は上位の一つの段階だけに属し、同じ写真を二度選ばない。重み付きの合計で段階を入れ替えない。
 * - 段階内の順位は未決定のため、段階1と段階3はAIの判定順、段階2は全体の色を部分の色より先にし、
 *   同じならカタログの順にする。
 * - `contentMatches` が `null`（AIの写真選定に失敗）なら、内容は根拠不足として段階2だけを使う。
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
	const contentOrder = [...content.keys()];
	const pick = (photo: Photo, tier: PhotoPick["tier"]): PhotoPick => {
		const match = content.get(photo.id);
		return {
			photoId: photo.id,
			tier,
			colorEvidence: tier === 3 ? null : colorMatch(photo, colors),
			contentEvidence:
				tier === 2 || !match
					? null
					: { questionIds: match.questionIds, matchedTags: match.matchedTags, reason: match.reason },
		};
	};
	const tier1 = contentOrder
		.map((id) => byId.get(id) as Photo)
		.filter((photo) => colorMatch(photo, colors) !== null)
		.map((photo) => pick(photo, 1));
	const tier2 = photos
		.filter((photo) => !content.has(photo.id) && colorMatch(photo, colors) !== null)
		.sort(
			(a, b) =>
				Number(colorMatch(a, colors)?.kind === "partial") - Number(colorMatch(b, colors)?.kind === "partial"),
		)
		.map((photo) => pick(photo, 2));
	const tier3 = contentOrder
		.map((id) => byId.get(id) as Photo)
		.filter((photo) => colorMatch(photo, colors) === null)
		.map((photo) => pick(photo, 3));
	const selected = [...tier1, ...tier2, ...tier3].slice(0, Math.max(0, count));
	return {
		policyVersion: input.policyVersion,
		requested: count,
		selected,
		shortage: Math.max(0, count - selected.length),
		contentStatus: contentMatches === null ? "unavailable" : "ai",
	};
}
