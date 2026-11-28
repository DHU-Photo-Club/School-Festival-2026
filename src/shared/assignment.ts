import type { Photo } from "./types.ts";

/**
 * 診断ごとに選定写真をシャッフルする。セッションIDを乱数の種にすることで、端末どうしで同じ順を使い、
 * 再読み込みでも割り当てを維持する。AIの選定順位や保存した選定根拠は変更しない。
 */
export function resultPhotoOrder(photoIds: readonly string[], sessionId: string): string[] {
	let seed = 2166136261;
	for (const char of sessionId) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
	// Mulberry32。セッションIDは診断開始ごとに新しいUUIDになる。
	const random = () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
	const shuffled = [...photoIds];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const other = Math.floor(random() * (index + 1));
		[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
	}
	return shuffled;
}

/**
 * 結果表示で画面に割り当てる写真。セッションIDがあれば選定写真をシャッフルし、画面番号順に割り当てる。
 * 写真がない画面は `null`（タイポグラフィ表示）。
 */
export function resultPhotoFor(
	photos: readonly Photo[],
	photoIds: readonly string[],
	displayOrder: number,
	sessionId?: string | null,
): Photo | null {
	const order = sessionId ? resultPhotoOrder(photoIds, sessionId) : photoIds;
	const id = order[displayOrder];
	return id === undefined ? null : (photos.find((photo) => photo.id === id) ?? null);
}
