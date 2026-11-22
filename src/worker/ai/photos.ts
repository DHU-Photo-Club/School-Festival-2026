import type { ContentMatch } from "../../shared/photo-selection.ts";
import type { Photo, QuestionId } from "../../shared/types.ts";
import type { Checked } from "./color.ts";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** 理由の文字数の上限。内部用の記録で、来場者には見せない。 */
const REASON_MAX = 120;

/** AIへ渡す写真カタログ。内容の判定に使う情報だけを渡す（色は実装側で判定する）。 */
export function photoCatalogInput(photos: readonly Photo[]) {
	return photos.map((photo) => ({
		id: photo.id,
		contentTags: photo.contentTags,
		moodTags: photo.moodTags,
		description: photo.description,
	}));
}

/**
 * AIの写真の出力を検証する。カタログにない写真ID、重複、根拠の欠けた項目は使わずに捨て、捨てた数を返す
 * （refs/handoff 実装仕様書7.4節。架空の写真IDを使わない）。形が壊れている場合は失敗にする。
 */
export function checkPhotoOutput(
	value: unknown,
	photos: readonly Photo[],
	questionIds: readonly QuestionId[],
): Checked<{ matches: ContentMatch[]; dropped: number }> {
	if (!isObject(value) || !Array.isArray(value.contentMatches))
		return { ok: false, error: "contentMatches の配列がありません" };
	const known = new Set(photos.map((photo) => photo.id));
	const matches: ContentMatch[] = [];
	let dropped = 0;
	for (const item of value.contentMatches as unknown[]) {
		const valid =
			isObject(item) &&
			typeof item.photoId === "string" &&
			known.has(item.photoId) &&
			!matches.some((match) => match.photoId === item.photoId) &&
			Array.isArray(item.questionIds) &&
			item.questionIds.length > 0 &&
			item.questionIds.every((id) => typeof id === "string" && questionIds.includes(id)) &&
			Array.isArray(item.matchedTags) &&
			item.matchedTags.every((tag) => typeof tag === "string") &&
			typeof item.reason === "string" &&
			item.reason.trim().length > 0;
		if (!valid) {
			dropped += 1;
			continue;
		}
		matches.push({
			photoId: item.photoId as string,
			questionIds: [...new Set(item.questionIds as string[])],
			matchedTags: item.matchedTags as string[],
			reason: Array.from((item.reason as string).trim())
				.slice(0, REASON_MAX)
				.join(""),
		});
	}
	return { ok: true, value: { matches, dropped } };
}
