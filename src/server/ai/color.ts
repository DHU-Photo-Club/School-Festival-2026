import { COLOR_OUTPUT_LIMITS } from "../../data/ai.ts";
import type { ColorChoice, ColorOutput } from "../../shared/result.ts";
import type { Palette, PaletteId, QuestionId } from "../../shared/types.ts";

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** 文字数（サロゲートペアを1文字として数える）。 */
const length = (text: string) => Array.from(text).length;

/** 空でない文字列で、`max` 文字以内かを検証する。前後の空白は除いて数える。 */
function checkText(value: unknown, field: string, max: number): Checked<string> {
	if (value === undefined) return { ok: false, error: `${field}がありません` };
	if (typeof value !== "string") return { ok: false, error: `${field}が文字列ではありません` };
	const trimmed = value.trim();
	if (trimmed.length === 0) return { ok: false, error: `${field}が空です` };
	const count = length(trimmed);
	if (count > max) return { ok: false, error: `${field}が上限（${max}文字）を超えています（${count}文字）` };
	return { ok: true, value: trimmed };
}

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
	if (!isObject(value)) return fail("応答からJSONオブジェクトを読み取れません");
	const name = checkText(value.name, "色名（name）", limits.name);
	if (!name.ok) return name;
	if (ENUMERATION.test(name.value) || /\n/.test(String(value.name)))
		return fail("色名（name）に二色の列挙記号や改行が含まれています");
	const nameReason = checkText(value.nameReason, "命名理由（nameReason）", limits.nameReason);
	if (!nameReason.ok) return nameReason;
	const reading = checkText(value.reading, "回答全体の読み取り（reading）", limits.reading);
	if (!reading.ok) return reading;
	const relationship = checkText(value.relationship, "二色の関係（relationship）", limits.relationship);
	if (!relationship.ok) return relationship;
	if (!Array.isArray(value.colors)) return fail("選定色（colors）が配列ではありません");
	if (value.colors.length !== 2) return fail(`選定色（colors）は2件必要ですが${value.colors.length}件でした`);
	const ids = new Set(palette.colors.map((color) => color.id));
	const colors: ColorChoice[] = [];
	for (const [index, color] of (value.colors as unknown[]).entries()) {
		const nth = `選定色（colors）の${index + 1}件目`;
		if (!isObject(color)) return fail(`${nth}がオブジェクトではありません`);
		if (["h", "s", "l"].some((key) => Object.hasOwn(color, key)))
			return fail(`${nth}に禁止された自由なHSL値（h/s/l）が含まれています`);
		if (typeof color.id !== "string" || !ids.has(color.id as PaletteId))
			return fail(`${nth}の色ID「${String(color.id)}」はパレットに存在しません`);
		const reason = checkText(color.reason, `${nth}の理由（reason）`, limits.reason);
		if (!reason.ok) return reason;
		const evidence = color.evidence;
		if (
			!Array.isArray(evidence) ||
			evidence.length === 0 ||
			!evidence.every((id) => typeof id === "string" && questionIds.includes(id))
		)
			return fail(`${nth}の根拠（evidence）が有効な質問IDの配列ではありません`);
		colors.push({ id: color.id as PaletteId, reason: reason.value, evidence: [...new Set(evidence)] });
	}
	if (colors[0].id === colors[1].id) return fail(`選定色（colors）の2色が同じ色ID（${colors[0].id}）です`);
	return {
		ok: true,
		value: {
			paletteVersion: palette.version,
			name: name.value,
			nameReason: nameReason.value,
			reading: reading.value,
			colors: [colors[0], colors[1]],
			relationship: relationship.value,
		},
	};
}
