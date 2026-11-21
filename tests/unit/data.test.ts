import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePhotoFiles, validateSequenceComponents } from "../../scripts/validate-assets.ts";
import { createQrModel } from "../../src/client/lib/qr.ts";
import { RESULT_COLORS } from "../../src/data/colors.ts";
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
import { resultUrl } from "../../src/shared/result-url.ts";
import type { Sequence } from "../../src/shared/types.ts";
import { COLOR_IDS } from "../../src/shared/types.ts";
import { resultAvailability } from "../../src/worker/result-page.ts";

const data = { colors: RESULT_COLORS, questions: QUESTIONS, photos: PHOTOS };
const representative = (colorId: string) => RESULT_COLORS.find((color) => color.id === colorId)?.representativePhotoId;

describe("展示データ", () => {
	it("仮データは検証を通る", () => {
		expect(validateExhibitData(data)).toEqual([]);
	});

	it("全色の文字色と背景色のコントラスト比は4.5:1以上", () => {
		for (const color of RESULT_COLORS)
			expect(contrastRatio(color.foregroundColor, color.backgroundColor)).toBeGreaterThanOrEqual(4.5);
	});

	it("代表画像が同色でない、配布不可、クレジットなし、存在しない場合を検出する", () => {
		const photos = PHOTOS.map((photo) =>
			photo.id === representative("red")
				? { ...photo, shareAllowed: false }
				: photo.id === representative("blue")
					? { ...photo, creditName: null }
					: photo,
		);
		const colors = RESULT_COLORS.map((color) =>
			color.id === "green"
				? { ...color, representativePhotoId: representative("cyan") ?? "" }
				: color.id === "violet"
					? { ...color, representativePhotoId: "none" }
					: color,
		);
		const errors = validateExhibitData({ ...data, photos, colors });
		expect(errors).toEqual(
			expect.arrayContaining([
				"red の代表画像は配布許可がありません",
				"blue の代表画像に creditName がありません",
				"green の代表画像が同じ結果色の写真ではありません",
				"violet の代表画像 none が存在しません",
			]),
		);
	});

	it("写真IDの重複と形式違反、未定義の resultColorId を検出する", () => {
		const photos = [
			...PHOTOS,
			{ ...PHOTOS[0] },
			{ ...PHOTOS[1], id: "Bad_ID" },
			{ ...PHOTOS[2], id: "photo-x", resultColorId: "pink" as never },
		];
		const errors = validateExhibitData({ ...data, photos });
		expect(errors).toEqual(
			expect.arrayContaining([
				`写真ID ${PHOTOS[0].id} が重複しています`,
				"写真ID Bad_ID の形式が不正です",
				"写真 photo-x の resultColorId pink は未定義です",
			]),
		);
	});

	it("コントラスト不足と50文字を超えるメッセージを検出する", () => {
		const colors = RESULT_COLORS.map((color) =>
			color.id === "yellow" ? { ...color, foregroundColor: "#555555", message: "あ".repeat(51) } : color,
		);
		expect(validateExhibitData({ ...data, colors })).toEqual(
			expect.arrayContaining([
				"yellow の foregroundColor と backgroundColor のコントラスト比が4.5:1未満です",
				"yellow のメッセージが50文字を超えています",
			]),
		);
	});

	it("質問の入力方式ごとの定義の誤りを検出する", () => {
		const [season, time, place, light, sound] = QUESTIONS;
		if (season.kind !== "slider" || time.kind !== "single" || place.kind !== "map" || sound.kind !== "multiple")
			throw new Error("仮データの入力方式が想定と異なります");
		const questions = [
			{ ...season, stops: [...season.stops].reverse() as unknown as typeof season.stops },
			{ ...time, options: [time.options[0], { ...time.options[0] }, { ...time.options[1], id: "Bad_ID" }] },
			{ ...place, cells: place.cells.slice(1) as unknown as typeof place.cells, topLabel: " " },
			{
				...place,
				id: "place-2",
				cells: place.cells.map((cell, i) =>
					i === 0 ? { ...cell, caption: "" } : cell,
				) as unknown as typeof place.cells,
			},
			{
				...season,
				id: "season-2",
				stops: season.stops.map((stop, i) =>
					i === 0 ? { ...stop, scores: { red: Number.NaN } } : stop,
				) as unknown as typeof season.stops,
			},
			{ ...light, kind: "dial" } as never,
			{ ...sound, minSelections: 3, maxSelections: 2 },
			{
				...sound,
				id: "sound-2",
				options: [{ ...sound.options[0], scores: { pink: 1 } as never }, sound.options[1]],
			},
		];
		expect(validateExhibitData({ ...data, questions })).toEqual(
			expect.arrayContaining([
				`質問 ${season.id} の回答位置が不正です`,
				`質問 ${time.id} の選択肢IDが重複しています`,
				`質問 ${time.id} の選択肢ID Bad_ID は英小文字、数字、ハイフンで書きます`,
				`質問 ${place.id} の区画が不正です`,
				`質問 ${place.id} の4辺の語がありません`,
				"質問 place-2 top-left の補助文がありません",
				"質問 season-2 far-left の点数が不正です",
				`質問 ${light.id} の kind は single、multiple、slider、map のいずれかにします`,
				`質問 ${sound.id} の選択数は 1 <= minSelections <= maxSelections <= 選択肢の数 にします`,
				`質問 sound-2 ${sound.options[0].id} の pink は未定義です`,
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

	it("PUBLIC_ORIGIN から生成した8色の結果URLはすべてHTTPSで、クエリと fragment を含まない", () => {
		const origin = "https://dpc-school-festival.tbd-subdomain.workers.dev";
		for (const colorId of COLOR_IDS) {
			const url = new URL(resultUrl(origin, colorId));
			expect(url.protocol).toBe("https:");
			expect(url.href).toBe(`${origin}/result/${colorId}`);
			expect(url.search).toBe("");
			expect(url.hash).toBe("");
		}
		expect(() => resultUrl("http://example.com", "red")).toThrow();
		expect(() => resultUrl(origin, "pink")).toThrow();
	});

	it("RESULTS_PUBLISHED_UNTIL はISO 8601形式のUTC時刻", () => {
		expect(validatePublishedUntil("2026-12-31T15:00:00Z")).toEqual([]);
		expect(validatePublishedUntil("2026-12-31 15:00")).not.toEqual([]);
		expect(validatePublishedUntil("2026-12-31T15:00:00+09:00")).not.toEqual([]);
	});

	it("結果ページは公開期間内200、終了日時以降410、未定義の colorId は期間にかかわらず404", () => {
		const until = "2026-12-31T15:00:00Z";
		const end = Date.parse(until);
		expect(resultAvailability("/result/red", end - 1, until)).toEqual({ status: 200, colorId: "red" });
		expect(resultAvailability("/result/red", end, until)).toEqual({ status: 410 });
		expect(resultAvailability("/result/pink", end - 1, until)).toEqual({ status: 404 });
		expect(resultAvailability("/result/pink", end + 1, until)).toEqual({ status: 404 });
		expect(resultAvailability("/result/red", 0, "invalid")).toEqual({ status: 410 });
	});
});

describe("QRコード", () => {
	it("Quiet Zone 4モジュールを含む正方形のモデルを作る", () => {
		const model = createQrModel("https://dpc-school-festival.tbd-subdomain.workers.dev/result/magenta");
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
