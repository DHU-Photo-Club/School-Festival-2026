// 写真カタログ（src/data/photo-catalog.json）を読み書きする、export-photos の補助。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, sep } from "node:path";
import type { PhotoCatalogEntry } from "../src/data/photos.ts";

export const ROOT = join(import.meta.dirname, "..");
export const ORIGINALS = join(ROOT, "originals", "photos");
export const PUBLIC_PHOTOS = join(ROOT, "public", "photos");
export const CATALOG_FILE = join(ROOT, "src", "data", "photo-catalog.json");

/** 原本として扱う画像の拡張子。 */
export const ORIGINAL_PATTERN = /\.(jpe?g|tiff?|png)$/i;

/**
 * 写真ID。フォルダーと拡張子と末尾の「 - 撮影者名」を除いたファイル名を、小文字にして英数字以外をハイフンにし、
 * 先頭と末尾のハイフンを除く。「DSC01737 - 辻󠄀涼太.jpeg」は「dsc01737」になる。
 * 日本語など英数字以外の文字が消える名前は、消えた分を区別できるよう、名前から作った6桁のハッシュを末尾に付ける
 * （「りょた-01.jpg」は「01-」とハッシュ、「歩き２.jpg」は「2-」とハッシュ）。フォルダーを移してもIDは変わらない。
 */
export function photoIdFromPath(path: string): string {
	const stem = basename(path, extname(path));
	const credit = stem.lastIndexOf(" - ");
	const name = (credit >= 0 ? stem.slice(0, credit) : stem).normalize("NFKC").trim();
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (/^[\x20-\x7e]*$/.test(name)) return slug;
	const hash = createHash("sha1").update(name).digest("hex").slice(0, 6);
	return slug ? `${slug}-${hash}` : `photo-${hash}`;
}

/**
 * 原本のパスから撮影者名を読む。ファイル名かフォルダー名の「〇〇 - 撮影者名」の撮影者名を使い、
 * ファイル名を優先する。どちらにもなければ `null`。
 */
export function creditFromPath(path: string): string | null {
	const parts = path.split(sep);
	parts[parts.length - 1] = basename(path, extname(path));
	for (const part of parts.reverse()) {
		const index = part.lastIndexOf(" - ");
		if (index >= 0) {
			const name = part.slice(index + 3).trim();
			if (name) return name;
		}
	}
	return null;
}

export function readCatalog(): PhotoCatalogEntry[] {
	return JSON.parse(readFileSync(CATALOG_FILE, "utf8")) as PhotoCatalogEntry[];
}

export function writeCatalog(entries: readonly PhotoCatalogEntry[]): void {
	writeFileSync(CATALOG_FILE, `${JSON.stringify(entries, null, "\t")}\n`);
}
