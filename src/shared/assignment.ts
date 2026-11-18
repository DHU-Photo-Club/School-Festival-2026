import type { ColorId, Photo } from "./types.ts";

const byOrderThenId = (order: (photo: Photo) => number) => (a: Photo, b: Photo) =>
	order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 待機用の共通プレイリスト（仕様書7.2.3節）。`idleOrder` 昇順、同値は写真ID昇順。 */
export function idlePlaylist(photos: readonly Photo[]): Photo[] {
	return photos.filter((photo) => photo.idleEnabled).sort(byOrderThenId((photo) => photo.idleOrder));
}

/** 結果色の写真（仕様書7.2.4節）。`resultOrder` 昇順、同値は写真ID昇順。 */
export function resultPhotos(photos: readonly Photo[], colorId: ColorId): Photo[] {
	return photos.filter((photo) => photo.resultColorId === colorId).sort(byOrderThenId((photo) => photo.resultOrder));
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

/** 結果表示で画面に割り当てる写真。写真がない画面は `null`（タイポグラフィ表示）。 */
export function resultPhotoFor(photos: readonly Photo[], colorId: ColorId, displayOrder: number): Photo | null {
	return resultPhotos(photos, colorId)[displayOrder] ?? null;
}
