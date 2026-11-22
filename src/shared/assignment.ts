import type { Photo } from "./types.ts";

const byOrderThenId = (order: (photo: Photo) => number) => (a: Photo, b: Photo) =>
	order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 待機用の共通プレイリスト（仕様書7.2.3節）。`idleOrder` 昇順、同値は写真ID昇順。 */
export function idlePlaylist(photos: readonly Photo[]): Photo[] {
	return photos.filter((photo) => photo.idleEnabled).sort(byOrderThenId((photo) => photo.idleOrder));
}

/**
 * 待機枠で画面に表示する写真。`displayOrder >= P` の画面は `null`（展示タイトルを表示する）。
 * `(cycleIndex + displayOrder) mod P` 番目を返す。
 */
export function idlePhotoFor(playlist: readonly Photo[], cycleIndex: number, displayOrder: number): Photo | null {
	const count = playlist.length;
	if (displayOrder >= count) return null;
	return playlist[(((cycleIndex + displayOrder) % count) + count) % count];
}

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
