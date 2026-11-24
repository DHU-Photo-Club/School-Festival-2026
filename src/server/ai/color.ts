import { COLOR_OUTPUT_LIMITS } from "../../data/ai.ts";
import type { ColorChoice, ColorOutput } from "../../shared/result.ts";
import type { Palette, PaletteId, QuestionId } from "../../shared/types.ts";

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** 文字数（サロゲートペアを1文字として数える）。 */
const length = (text: string) => Array.from(text).length;

/** 空でない文字列で、`max` 文字以内か。前後の空白は除いて数える。 */
const text = (value: unknown, max: number): value is string =>
	typeof value === "string" && value.trim().length > 0 && length(value.trim()) <= max;

/** 二色の列挙に使う記号（refs/handoff 実装仕様書5章）。 */
const ENUMERATION = /[×＋+/／]/;

/**
 * AIの二色の出力を検証する（refs/handoff 実装仕様書8章「出力検証」）。
 * JSONの形、必須項目、文字数、色数2、重複なし、実在のID、パレットの版、質問IDの有効性、理由の存在を確かめる。
 * 自由な h/s/l は受け取らない。名前がカタカナ中心かどうかは正規表現では確かめきれないため、列挙の記号と
 * 改行だけを拒否する。
 */
export function checkColorOutput(
	value: unknown,
	palette: Palette,
	questionIds: readonly QuestionId[],
): Checked<ColorOutput> {
	const fail = (error: string): Checked<ColorOutput> => ({ ok: false, error });
	const limits = COLOR_OUTPUT_LIMITS;
	if (!isObject(value)) return fail("JSONのオブジェクトではありません");
	if (value.paletteVersion !== palette.version) return fail(`paletteVersion が ${palette.version} ではありません`);
	if (!text(value.name, limits.name)) return fail(`name は${limits.name}文字以内の色名にします`);
	if (ENUMERATION.test(value.name) || /\n/.test(value.name)) return fail("name に二色の列挙や改行があります");
	if (!text(value.nameReason, limits.nameReason)) return fail(`nameReason は${limits.nameReason}文字以内にします`);
	if (!text(value.reading, limits.reading)) return fail(`reading は${limits.reading}文字以内にします`);
	if (!text(value.relationship, limits.relationship))
		return fail(`relationship は${limits.relationship}文字以内にします`);
	if (!Array.isArray(value.colors) || value.colors.length !== 2) return fail("colors は2件にします");
	const ids = new Set(palette.colors.map((color) => color.id));
	const colors: ColorChoice[] = [];
	for (const color of value.colors as unknown[]) {
		if (!isObject(color)) return fail("colors の要素がオブジェクトではありません");
		if (["h", "s", "l"].some((key) => Object.hasOwn(color, key))) return fail("自由な h/s/l は受け付けません");
		if (typeof color.id !== "string" || !ids.has(color.id as PaletteId))
			return fail(`色ID ${String(color.id)} はパレットにありません`);
		if (!text(color.reason, limits.reason)) return fail(`各色の reason は${limits.reason}文字以内にします`);
		const evidence = color.evidence;
		if (
			!Array.isArray(evidence) ||
			evidence.length === 0 ||
			!evidence.every((id) => typeof id === "string" && questionIds.includes(id))
		)
			return fail("各色の evidence は有効な質問IDの配列にします");
		colors.push({ id: color.id as PaletteId, reason: color.reason.trim(), evidence: [...new Set(evidence)] });
	}
	if (colors[0].id === colors[1].id) return fail("二色は異なるIDにします");
	return {
		ok: true,
		value: {
			paletteVersion: palette.version,
			name: value.name.trim(),
			nameReason: value.nameReason.trim(),
			reading: value.reading.trim(),
			colors: [colors[0], colors[1]],
			relationship: value.relationship.trim(),
		},
	};
}
