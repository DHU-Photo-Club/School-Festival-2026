import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePhotoFiles, validateSequenceComponents } from "../../scripts/validate-assets.ts";
import { createQrModel } from "../../src/client/lib/qr.ts";
import { PALETTE } from "../../src/data/palette.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { SEQUENCES } from "../../src/data/sequences.ts";
import { bestOffset } from "../../src/shared/clock.ts";
import {
	contrastRatio,
	validateExhibitData,
	validatePublicOrigin,
	validatePublishedUntil,
	validateSequences,
} from "../../src/shared/data-validation.ts";
import { COLORS } from "../../src/shared/motion.ts";
import {
	backgroundColor,
	foregroundColor,
	gradientStops,
	hslToRgb,
	NAME_MIN_CONTRAST,
	nameColor,
	nameGradientStops,
	rgbToHex,
} from "../../src/shared/palette.ts";
import { resultAvailability } from "../../src/shared/result-page.ts";
import { resultUrl } from "../../src/shared/result-url.ts";
import type { Question, Sequence } from "../../src/shared/types.ts";

const data = { palette: PALETTE, questions: QUESTIONS, photos: PHOTOS };

const paletteOf = (id: string) => {
	const color = PALETTE.colors.find((candidate) => candidate.id === id);
	if (!color) throw new Error(`パレットに ${id} がありません`);
	return color;
};

/** 質問定義から入力方式 `kind` の最初の質問を取り出す。 */
function sample<K extends Question["kind"]>(kind: K): Extract<Question, { kind: K }> {
	const question = QUESTIONS.find((candidate) => candidate.kind === kind);
	if (!question) throw new Error(`質問定義に ${kind} の質問がありません`);
	return question as Extract<Question, { kind: K }>;
}

describe("展示データ", () => {
	it("パレット、質問定義、写真カタログは検証を通る", () => {
		expect(validateExhibitData(data)).toEqual([]);
	});

	it("パレットは refs/handoff の13色で、各色の文字色と背景色のコントラスト比は4.5:1以上", () => {
		expect(PALETTE.version).toBe("scenery-v2");
		expect(PALETTE.colors).toHaveLength(13);
		for (const color of PALETTE.colors)
			expect(contrastRatio(foregroundColor(color), backgroundColor(color))).toBeGreaterThanOrEqual(4.5);
	});

	it("展示の結果の色名の端点は、黒に対して6:1以上になるまで明度だけを上げたパレットの色", () => {
		for (const color of PALETTE.colors) {
			const named = nameColor(color);
			expect({ h: named.h, s: named.s }).toEqual({ h: color.h, s: color.s });
			expect(named.l).toBeGreaterThanOrEqual(color.l);
			expect(contrastRatio(rgbToHex(hslToRgb(named.h, named.s, named.l)), COLORS.dark)).toBeGreaterThanOrEqual(
				NAME_MIN_CONTRAST,
			);
			// 明度を上げるのは、6:1に届くために必要な分だけ。
			if (named.l > color.l)
				expect(contrastRatio(rgbToHex(hslToRgb(named.h, named.s, named.l - 1)), COLORS.dark)).toBeLessThan(
					NAME_MIN_CONTRAST,
				);
		}
		// 藍色や瑠璃色は明るくし、山吹色などはパレットの色のまま使う。
		expect(nameColor(paletteOf("indigo")).l).toBeGreaterThan(paletteOf("indigo").l);
		expect(nameColor(paletteOf("gold"))).toEqual(paletteOf("gold"));
	});

	it("展示の結果の色名のグラデーションは、どの二色でも黒の背景に対して4.5:1以上", () => {
		expect(validateExhibitData(data).filter((error) => error.includes("グラデーション"))).toEqual([]);
		// パレットの色そのものを端点にすると4.5:1を下回る組み合わせがあるので、明るくした色を使う。
		const base = PALETTE.colors.flatMap((first) =>
			PALETTE.colors.flatMap((second) =>
				nameGradientStops(first, second).map((stop) => contrastRatio(rgbToHex(stop), COLORS.dark)),
			),
		);
		expect(Math.min(...base)).toBeLessThan(4.5);
		const named = PALETTE.colors.flatMap((first) =>
			PALETTE.colors.flatMap((second) =>
				nameGradientStops(nameColor(first), nameColor(second)).map((stop) =>
					contrastRatio(rgbToHex(stop), COLORS.dark),
				),
			),
		);
		expect(Math.min(...named)).toBeGreaterThanOrEqual(4.5);
	});

	it("展示の結果の色名のグラデーションは、両端がパレットの二色で、補色に近い二色の中間も灰色に濁らない", () => {
		/** 8bitの各成分の最大と最小の差。灰色では0になる。 */
		const spread = (rgb: readonly number[]) => Math.max(...rgb) - Math.min(...rgb);
		for (const first of PALETTE.colors) {
			for (const second of PALETTE.colors) {
				const stops = nameGradientStops(first, second);
				expect(stops).toHaveLength(13);
				expect(stops[0]).toEqual(gradientStops(first, second)[0]);
				expect(stops[12]).toEqual(gradientStops(first, second)[12]);
			}
		}
		const [indigo, gold] = [paletteOf("indigo"), paletteOf("gold")];
		const middle = nameGradientStops(indigo, gold)[6];
		expect(spread(middle)).toBeGreaterThan(80);
		// sRGB の直線補間では、同じ二色の中間が灰色に近くなる。
		expect(spread(gradientStops(indigo, gold)[6])).toBeLessThan(40);
	});

	it("パレットの色IDの欠落、範囲外のHSLを検出する", () => {
		const palette = {
			version: PALETTE.version,
			colors: PALETTE.colors.slice(1).map((color) => (color.id === "sky" ? { ...color, h: 400 } : color)),
		};
		expect(validateExhibitData({ ...data, palette })).toEqual(
			expect.arrayContaining([expect.stringContaining("パレットの色IDは"), "パレット sky の HSL が範囲外です"]),
		);
	});

	it("質問定義は refs/handoff の5問と同じIDと入力方式", () => {
		expect(QUESTIONS.map((question) => [question.id, question.kind])).toEqual([
			["Q1", "multiple"],
			["Q2", "multiple"],
			["Q3", "slider"],
			["Q4", "map"],
			["Q5", "ranked"],
		]);
	});

	it("写真IDの重複と形式違反、パレットにない色タグ、配布許可とクレジットの矛盾を検出する", () => {
		const photos = [
			...PHOTOS,
			{ ...PHOTOS[0] },
			{ ...PHOTOS[1], id: "Bad_ID" },
			{ ...PHOTOS[2], id: "photo-x", colorTags: { overall: ["pink" as never], partial: [] } },
			{ ...PHOTOS[3], id: "photo-y", shareAllowed: true, creditName: null },
			{ ...PHOTOS[4], id: "photo-z", width: 0, description: " " },
		];
		const errors = validateExhibitData({ ...data, photos });
		expect(errors).toEqual(
			expect.arrayContaining([
				`写真ID ${PHOTOS[0].id} が重複しています`,
				"写真ID Bad_ID の形式が不正です",
				"写真 photo-x の色タグ pink はパレットにありません",
				"写真 photo-y は配布を許可していますが creditName がありません",
				"写真 photo-z の寸法は正の整数にします",
				"写真 photo-z の説明がありません",
			]),
		);
	});

	it("質問の入力方式ごとの定義の誤りを検出する", () => {
		const multiple = sample("multiple");
		const slider = sample("slider");
		const map = sample("map");
		const ranked = sample("ranked");
		const questions = [
			{ ...slider, stops: [...slider.stops].reverse() as unknown as typeof slider.stops },
			{
				...slider,
				id: "slider-2",
				interpretation: [
					{ upTo: 60, label: "a" },
					{ upTo: 40, label: "b" },
				],
			},
			{
				...multiple,
				options: [multiple.options[0], { ...multiple.options[0] }, { ...multiple.options[1], id: "Bad ID" }],
			},
			{ ...map, cells: map.cells.slice(1) as unknown as typeof map.cells, topLabel: " " },
			{
				...map,
				id: "map-2",
				cells: map.cells.map((cell, i) =>
					i === 0 ? { ...cell, caption: "" } : cell,
				) as unknown as typeof map.cells,
			},
			{ ...slider, id: "slider-3", kind: "dial" } as never,
			{ ...ranked, minSelections: 3, maxSelections: 2 },
			{
				...ranked,
				id: "ranked-2",
				guide: "",
				options: ranked.options.map((o, i) => ({ ...o, exclusive: i === 0 })),
			},
		];
		expect(validateExhibitData({ ...data, questions })).toEqual(
			expect.arrayContaining([
				`質問 ${slider.id} の回答位置が不正です`,
				"質問 slider-2 の補助ラベルは上限の昇順で、最後を100にします",
				`質問 ${multiple.id} の選択肢IDが重複しています`,
				`質問 ${multiple.id} の選択肢ID Bad ID は英数字、ハイフン、アンダースコアで書きます`,
				`質問 ${map.id} の区画が不正です`,
				`質問 ${map.id} の4辺の語がありません`,
				"質問 map-2 top-left の補助文がありません",
				"質問 slider-3 の kind は single、multiple、ranked、slider、map のいずれかにします",
				`質問 ${ranked.id} の選択数は 1 <= minSelections <= maxSelections <= 選択肢の数 にします`,
				"質問 ranked-2 の案内文がありません",
				`質問 ranked-2 ${ranked.options[0].id} の単独選択は複数選択の質問だけで使えます`,
			]),
		);
	});

	it("全写真IDに同寸法のAVIFとJPEGがあり、容量上限と長辺3,840px以下を満たす", async () => {
		expect(await validatePhotoFiles(PHOTOS, join(import.meta.dirname, "..", "..", "public", "photos"))).toEqual([]);
	}, 60_000);

	it("写真ファイルの欠落を検出する", async () => {
		const errors = await validatePhotoFiles(
			[{ ...PHOTOS[0], id: "missing-photo" }],
			join(import.meta.dirname, "..", "..", "public", "photos"),
		);
		expect(errors).toEqual(["missing-photo.avif: ファイルがありません", "missing-photo.jpg: ファイルがありません"]);
	});
});

describe("公開URL", () => {
	it("PUBLIC_ORIGIN はHTTPSでデプロイ先の workers.dev と一致する必要がある", () => {
		expect(
			validatePublicOrigin("https://dpc-school-festival.tbd-subdomain.workers.dev", "dpc-school-festival"),
		).toEqual([]);
		expect(validatePublicOrigin("http://dpc-school-festival.a.workers.dev", "dpc-school-festival")).toContain(
			"PUBLIC_ORIGIN はHTTPSにします",
		);
		expect(
			validatePublicOrigin("https://dpc-school-festival.a.workers.dev/", "dpc-school-festival").length,
		).toBeGreaterThan(0);
		expect(validatePublicOrigin("https://other.a.workers.dev", "dpc-school-festival").length).toBeGreaterThan(0);
		expect(validatePublicOrigin("https://example.com", "dpc-school-festival").length).toBeGreaterThan(0);
	});

	it("結果URLはHTTPSで、結果IDだけを含み、クエリと fragment を含まない", () => {
		const origin = "https://dpc-school-festival.tbd-subdomain.workers.dev";
		const url = new URL(resultUrl(origin, "0123456789abcdef"));
		expect(url.protocol).toBe("https:");
		expect(url.href).toBe(`${origin}/result/0123456789abcdef`);
		expect(url.search).toBe("");
		expect(url.hash).toBe("");
		expect(() => resultUrl("http://example.com", "0123456789abcdef")).toThrow();
		expect(() => resultUrl(origin, "red")).toThrow();
		expect(() => resultUrl(origin, "0123456789ABCDEF")).toThrow();
	});

	it("RESULTS_PUBLISHED_UNTIL はISO 8601形式のUTC時刻", () => {
		expect(validatePublishedUntil("2026-12-31T15:00:00Z")).toEqual([]);
		expect(validatePublishedUntil("2026-12-31 15:00")).not.toEqual([]);
		expect(validatePublishedUntil("2026-12-31T15:00:00+09:00")).not.toEqual([]);
	});

	it("結果ページとそのデータは公開期間内200、終了日時以降410、形式の合わないIDは期間にかかわらず404", () => {
		const until = "2026-12-31T15:00:00Z";
		const end = Date.parse(until);
		const id = "0123456789abcdef";
		expect(resultAvailability(`/result/${id}`, end - 1, until)).toEqual({ status: 200, kind: "page", id });
		expect(resultAvailability(`/result/${id}/data`, end - 1, until)).toEqual({ status: 200, kind: "data", id });
		expect(resultAvailability(`/result/${id}`, end, until)).toEqual({ status: 410 });
		expect(resultAvailability("/result/red", end - 1, until)).toEqual({ status: 404 });
		expect(resultAvailability("/result/red", end + 1, until)).toEqual({ status: 404 });
		expect(resultAvailability(`/result/${id}/other`, end - 1, until)).toEqual({ status: 404 });
		expect(resultAvailability(`/result/${id}`, 0, "invalid")).toEqual({ status: 410 });
	});
});

describe("QRコード", () => {
	it("Quiet Zone 4モジュールを含む正方形のモデルを作る", () => {
		const model = createQrModel("https://dpc-school-festival.tbd-subdomain.workers.dev/result/0123456789abcdef");
		expect((model.size - 8 - 17) % 4).toBe(0);
		expect(model.path).toMatch(/^M4 4h1v1h-1z/);
	});
});

describe("時刻補正", () => {
	it("往復時間が最も短い計測の補正値を使う", () => {
		const sample = (sent: number, rtt: number, offset: number) => ({
			clientSentAt: sent,
			clientReceivedAt: sent + rtt,
			serverTime: sent + rtt / 2 + offset,
		});
		expect(bestOffset([sample(0, 10, 100), sample(200, 500, 900), sample(600, 8, 98)])).toBe(98);
		expect(bestOffset([])).toBeNull();
	});
});

describe("シーケンス定義", () => {
	it("仮データは検証を通り、各シーケンスのコンポーネントがある", () => {
		expect(validateSequences(SEQUENCES)).toEqual([]);
		expect(validateSequenceComponents(SEQUENCES, join(import.meta.dirname, "../../src/client/sequences"))).toEqual(
			[],
		);
	});

	it("IDと before の重複、不正な再生時間を検出する", () => {
		const sequences: Sequence[] = [
			{ id: "a", before: "intro", durationMs: 1_000 },
			{ id: "a", before: "intro", durationMs: 0 },
			{ id: "b", before: "question", durationMs: 1.5 },
		];
		expect(validateSequences(sequences)).toEqual([
			"シーケンス a のIDが重複しています",
			"intro の前に再生するシーケンスが複数あります",
			"シーケンス a の durationMs は正の整数にします",
			"シーケンス b の durationMs は正の整数にします",
		]);
	});

	it("コンポーネントのないシーケンスを検出する", () => {
		const missing: Sequence = { id: "missing", before: "intro", durationMs: 1_000 };
		expect(validateSequenceComponents([missing], join(import.meta.dirname, "../../src/client/sequences"))).toEqual([
			"シーケンス missing の missing/Controller.svelte がありません",
			"シーケンス missing の missing/Display.svelte がありません",
		]);
	});
});
