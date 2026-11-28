// 原本（originals/photos）から表示用ファイルを書き出し、写真カタログを更新する（仕様書12.1節）。
// originals/photos の下はサブフォルダーまで再帰的に探す。写真IDは photoIdFromPath（フォルダー名を含まない）。
// 一つの写真IDから public/photos/{photoId}.avif と .jpg を、同じ原本・画角・寸法で書き出す。
// 書き出し済みで原本より新しいファイルは書き出し直さない。`--force` を付けると全て書き出し直す。
// カタログにない写真は、画素から計算した色タグを付けて末尾に追加する（内容タグと説明は空）。
// 色タグを画素から計算した写真（`colorTagsFrom: "pixels"`）は、計算の方法を変えても反映されるよう毎回計算し直す。
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import sharp, { type Sharp } from "sharp";
import type { PhotoCatalogEntry } from "../src/data/photos.ts";
import { colorTagsFromPixels } from "./photo-colors.ts";
import {
	creditFromPath,
	ORIGINAL_PATTERN,
	ORIGINALS,
	PUBLIC_PHOTOS,
	photoIdFromPath,
	readCatalog,
	writeCatalog,
} from "./photo-catalog.ts";
import { AVIF_MAX_BYTES, JPEG_MAX_BYTES, LONG_SIDE_MAX } from "./validate-assets.ts";

const force = process.argv.includes("--force");

// サブフォルダーを含めて原本を集める。パスは ORIGINALS からの相対パス。隠しファイルと隠しフォルダーは除く。
const sources = readdirSync(ORIGINALS, { recursive: true, encoding: "utf8" })
	.filter((path) => ORIGINAL_PATTERN.test(path) && !path.split(sep).some((part) => part.startsWith(".")))
	.sort();

// 書き出し先は public/photos 直下の一か所なので、別のフォルダーに同じ写真IDになる原本があれば止める。
const pathsById = new Map<string, string[]>();
for (const path of sources) {
	const id = photoIdFromPath(path);
	pathsById.set(id, [...(pathsById.get(id) ?? []), path]);
}
const problems = [...pathsById].filter(([id, paths]) => !id || paths.length > 1);
if (problems.length > 0) {
	for (const [id, paths] of problems) {
		console.error(id ? `写真IDが重複しています: ${id} ← ${paths.join(", ")}` : `写真IDを作れません: ${paths.join(", ")}`);
	}
	console.error("ファイル名を変えてから、もう一度実行してください。");
	process.exit(1);
}

// 長辺は3,840px以下。原本より大きくはしない。
const longSide = LONG_SIDE_MAX;

mkdirSync(PUBLIC_PHOTOS, { recursive: true });

/** 容量上限（仕様書12.1節）を超えたら、画質を一段ずつ下げて書き出し直す。最初の画質が通常の画質。 */
const QUALITIES = { avif: [60, 55, 50, 45, 40], jpeg: [85, 80, 75, 70, 65] } as const;
const LIMITS = { avif: AVIF_MAX_BYTES, jpeg: JPEG_MAX_BYTES } as const;

async function encode(image: Sharp, format: "avif" | "jpeg", file: string) {
	for (const quality of QUALITIES[format]) {
		const encoded =
			format === "avif" ? image.clone().avif({ quality, effort: 6 }) : image.clone().jpeg({ quality, mozjpeg: true });
		const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
		if (data.length <= LIMITS[format] || quality === QUALITIES[format].at(-1)) {
			writeFileSync(file, data);
			if (quality !== QUALITIES[format][0]) console.log(`  ${format} は容量上限のため画質 ${quality} で書き出しました`);
			return info;
		}
	}
	throw new Error("unreachable");
}

const isFresh = (output: string, source: string) =>
	existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs;

const catalog = readCatalog();
const byId = new Map(catalog.map((entry) => [entry.id, entry]));
let nextIdleOrder = Math.max(-1, ...catalog.map((entry) => entry.idleOrder)) + 1;
let exported = 0;
const added: string[] = [];

for (const source of sources) {
	const id = photoIdFromPath(source);
	const sourceFile = join(ORIGINALS, source);
	const avifFile = join(PUBLIC_PHOTOS, `${id}.avif`);
	const jpegFile = join(PUBLIC_PHOTOS, `${id}.jpg`);
	let size: { width: number; height: number };

	if (!force && isFresh(avifFile, sourceFile) && isFresh(jpegFile, sourceFile)) {
		const { width, height } = await sharp(jpegFile).metadata();
		size = { width, height };
	} else {
		// 回転情報を画素へ反映し、sRGBのICCプロファイルを埋め込む。拡大はしない。
		const image = sharp(sourceFile)
			.rotate()
			.resize({ width: longSide, height: longSide, fit: "inside", withoutEnlargement: true })
			.toColourspace("srgb")
			.withIccProfile("srgb");
		const avif = await encode(image, "avif", avifFile);
		const jpeg = await encode(image, "jpeg", jpegFile);
		size = { width: jpeg.width, height: jpeg.height };
		exported += 1;
		console.log(
			`${source} → ${id}  ${jpeg.width}x${jpeg.height}  avif ${(avif.size / 1024).toFixed(0)}KiB  jpg ${(jpeg.size / 1024).toFixed(0)}KiB`,
		);
	}

	const entry = byId.get(id);
	if (entry) {
		Object.assign(entry, { source, ...size });
		if (entry.colorTagsFrom === "pixels") entry.colorTags = await colorTagsFromPixels(jpegFile);
		continue;
	}
	// 新しい写真。配布の可否は写真担当が確かめるまで許可しない。
	const creditName = creditFromPath(source);
	const created: PhotoCatalogEntry = {
		id,
		source,
		...size,
		idleEnabled: true,
		idleOrder: nextIdleOrder++,
		shareAllowed: false,
		creditName,
		colorTags: await colorTagsFromPixels(jpegFile),
		contentTags: [],
		moodTags: [],
		description: "",
		tagStatus: "provisional",
		colorTagsFrom: "pixels",
	};
	catalog.push(created);
	byId.set(id, created);
	added.push(id);
}

writeCatalog(catalog);

const found = new Set(sources.map(photoIdFromPath));
const missing = catalog.filter((entry) => !found.has(entry.id));
const colorless = catalog.filter(
	(entry) => found.has(entry.id) && entry.colorTags.overall.length + entry.colorTags.partial.length === 0,
);
console.log(`\n原本 ${sources.length} 枚（書き出し ${exported} 枚）。カタログへ ${added.length} 枚を追加しました。`);
// 原本はリポジトリにないため、原本が見つからない写真もカタログから消さない。
for (const entry of missing) console.warn(`原本が見つかりません（カタログには残します）: ${entry.id}（${entry.source}）`);
// 撮影者名のない写真は、フォルダーごとに枚数をまとめて知らせる。
const uncredited = new Map<string, number>();
for (const entry of catalog.filter((entry) => !entry.creditName && found.has(entry.id))) {
	const folder = dirname(entry.source);
	uncredited.set(folder, (uncredited.get(folder) ?? 0) + 1);
}
for (const [folder, count] of uncredited)
	console.warn(`撮影者名がわかりません: ${folder === "." ? "originals/photos 直下" : folder} の ${count} 枚`);
// 色タグのない写真（白黒や、パレットから離れた色だけの写真）は、どの結果にも選ばれない。待機画面には出る。
if (colorless.length > 0)
	console.warn(`色タグのない写真が ${colorless.length} 枚あります（結果には選ばれません）: ${colorless.map((entry) => entry.id).join(", ")}`);
