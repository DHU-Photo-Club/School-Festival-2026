import type { ColorId, Photo, Question, ResultColor, Sequence } from "./types.ts";
import { COLOR_IDS, SEQUENCE_TARGETS } from "./types.ts";

/** 写真IDの形式（仕様書12.1節）。 */
export const PHOTO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 結果メッセージの上限（仕様書7.1節）。 */
export const MESSAGE_MAX_LENGTH = 50;
/** 色名などの文字と背景の最小コントラスト比（仕様書7.2.2節）。 */
export const MIN_CONTRAST = 4.5;

function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2のコントラスト比。 */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** 色定義、診断定義、写真定義の整合性を確認し、問題の一覧を返す。 */
export function validateExhibitData(input: {
	colors: readonly ResultColor[];
	questions: readonly Question[];
	photos: readonly Photo[];
}): string[] {
	const errors: string[] = [];
	const { colors, questions, photos } = input;

	const colorIds = colors.map((color) => color.id);
	for (const id of COLOR_IDS) {
		if (!colorIds.includes(id)) errors.push(`結果色 ${id} の定義がありません`);
	}
	if (new Set(colorIds).size !== colorIds.length) errors.push("結果色IDが重複しています");
	if (new Set(colors.map((color) => color.tieBreakPriority)).size !== colors.length) {
		errors.push("同点時の優先順位が重複しています");
	}

	const photoById = new Map<string, Photo>();
	for (const photo of photos) {
		if (!PHOTO_ID_PATTERN.test(photo.id)) errors.push(`写真ID ${photo.id} の形式が不正です`);
		if (photoById.has(photo.id)) errors.push(`写真ID ${photo.id} が重複しています`);
		photoById.set(photo.id, photo);
		if (!COLOR_IDS.includes(photo.resultColorId as ColorId)) {
			errors.push(`写真 ${photo.id} の resultColorId ${photo.resultColorId} は未定義です`);
		}
		for (const [field, value] of [
			["resultOrder", photo.resultOrder],
			["idleOrder", photo.idleOrder],
		] as const) {
			if (!Number.isInteger(value) || value < 0)
				errors.push(`写真 ${photo.id} の ${field} は0以上の整数にします`);
		}
	}

	for (const color of colors) {
		for (const field of ["baseColor", "backgroundColor", "foregroundColor"] as const) {
			if (!HEX_COLOR.test(color[field])) errors.push(`${color.id} の ${field} が #RRGGBB 形式ではありません`);
		}
		if (contrastRatio(color.foregroundColor, color.backgroundColor) < MIN_CONTRAST) {
			errors.push(`${color.id} の foregroundColor と backgroundColor のコントラスト比が4.5:1未満です`);
		}
		if ([...color.message].length > MESSAGE_MAX_LENGTH)
			errors.push(`${color.id} のメッセージが50文字を超えています`);
		const representative = photoById.get(color.representativePhotoId);
		if (!color.representativePhotoId) errors.push(`${color.id} の representativePhotoId がありません`);
		else if (!representative) errors.push(`${color.id} の代表画像 ${color.representativePhotoId} が存在しません`);
		else {
			if (representative.resultColorId !== color.id)
				errors.push(`${color.id} の代表画像が同じ結果色の写真ではありません`);
			if (!representative.shareAllowed) errors.push(`${color.id} の代表画像は配布許可がありません`);
			if (!representative.creditName) errors.push(`${color.id} の代表画像に creditName がありません`);
		}
	}

	const questionIds = questions.map((question) => question.id);
	if (new Set(questionIds).size !== questionIds.length) errors.push("質問IDが重複しています");
	for (const question of questions) {
		const stopIds = question.stops.map((stop) => stop.id).join(",");
		if (stopIds !== "far-left,left,center,right,far-right") errors.push(`質問 ${question.id} の回答位置が不正です`);
		for (const stop of question.stops) {
			const scored = Object.entries(stop.scores);
			if (scored.length < 1 || scored.length > 2)
				errors.push(`質問 ${question.id} ${stop.id} の加点は1〜2色にします`);
			for (const [colorId, points] of scored) {
				if (!COLOR_IDS.includes(colorId as ColorId))
					errors.push(`質問 ${question.id} ${stop.id} の ${colorId} は未定義です`);
				if (typeof points !== "number" || points <= 0)
					errors.push(`質問 ${question.id} ${stop.id} の点数が不正です`);
			}
		}
	}

	return errors;
}

/**
 * `PUBLIC_ORIGIN` の確認（仕様書10.1節）。HTTPSで、末尾スラッシュがなく、
 * Worker名から決まる `https://{workerName}.{subdomain}.workers.dev` と一致する必要がある。
 */
export function validatePublicOrigin(origin: string, workerName: string): string[] {
	const errors: string[] = [];
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return ["PUBLIC_ORIGIN がURLではありません"];
	}
	if (url.protocol !== "https:") errors.push("PUBLIC_ORIGIN はHTTPSにします");
	if (origin.endsWith("/") || url.origin !== origin)
		errors.push("PUBLIC_ORIGIN はパスと末尾スラッシュなしのoriginにします");
	const escaped = workerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (!new RegExp(`^${escaped}\\.[a-z0-9-]+\\.workers\\.dev$`).test(url.hostname)) {
		errors.push(`PUBLIC_ORIGIN がデプロイ先 ${workerName}.<subdomain>.workers.dev と一致しません`);
	}
	return errors;
}

/** `RESULTS_PUBLISHED_UNTIL` はISO 8601形式のUTC時刻にする（仕様書10.1節）。 */
export function validatePublishedUntil(value: string): string[] {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
		return ["RESULTS_PUBLISHED_UNTIL はISO 8601形式のUTC時刻にします"];
	}
	return [];
}

/** シーケンス定義の整合性を確認し、問題の一覧を返す。 */
export function validateSequences(sequences: readonly Sequence[]): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	const targets = new Set<string>();
	for (const sequence of sequences) {
		const label = `シーケンス ${sequence.id}`;
		if (!PHOTO_ID_PATTERN.test(sequence.id)) errors.push(`${label} のIDは英小文字、数字、ハイフンで書きます`);
		if (ids.has(sequence.id)) errors.push(`${label} のIDが重複しています`);
		ids.add(sequence.id);
		if (!SEQUENCE_TARGETS.includes(sequence.before)) errors.push(`${label} の before が不正です`);
		else if (targets.has(sequence.before)) errors.push(`${sequence.before} の前に再生するシーケンスが複数あります`);
		else targets.add(sequence.before);
		if (!Number.isSafeInteger(sequence.durationMs) || sequence.durationMs <= 0)
			errors.push(`${label} の durationMs は正の整数にします`);
	}
	return errors;
}
