import type { Photo } from "./types.ts";

/**
 * 結果表示で画面に割り当てる写真。AIの選定で段階1→2→3の順に並んだ `photoIds` の `displayOrder` 番目。
 * 写真がない画面は `null`（タイポグラフィ表示）。
 */
export function resultPhotoFor(
	photos: readonly Photo[],
	photoIds: readonly string[],
	displayOrder: number,
): Photo | null {
	const id = photoIds[displayOrder];
	return id === undefined ? null : (photos.find((photo) => photo.id === id) ?? null);
}
