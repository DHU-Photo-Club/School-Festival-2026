import type { Photo } from "../shared/types.ts";
import catalog from "./photo-catalog.json" with { type: "json" };

/**
 * 写真カタログ（refs/handoff 実装仕様書7.4節、examples/photo-catalog.json）。ファイルは
 * `public/photos/{id}.avif` と `public/photos/{id}.jpg`。
 *
 * 中身は `photo-catalog.json`。原本を `originals/photos/` の下（サブフォルダー可）に置き、
 * `pnpm export-photos` で表示用ファイルを書き出すと、見つけた写真がカタログへ追加される。
 * 追加された写真の色タグは画素から計算する（`colorTagsFrom: "pixels"`、書き出しのたびに計算し直す）。
 * 内容タグ、雰囲気タグ、説明は空のままで、AIの内容の判定には渡さず、色だけで選ぶ（段階2）。
 *
 * 仮データ（`tagStatus: "provisional"`）: タグと説明は、実装担当が写真を見て付けた値か、画素から計算した値。
 * タグの語彙と色の「近い」の基準は未決定（実装仕様書11章 2、3）のため、写真担当が見直す。
 * `shareAllowed`、`creditName` も仮の値。
 */
export type PhotoCatalogEntry = Photo & {
	/** `originals/photos/` からの原本の相対パス。 */
	source: string;
	/** 色タグを人が付けたか（`manual`）、画素から計算したか（`pixels`）。 */
	colorTagsFrom: "manual" | "pixels";
};

export const PHOTO_CATALOG = catalog as readonly PhotoCatalogEntry[];

export const PHOTOS: readonly Photo[] = PHOTO_CATALOG.map(
	({ source: _source, colorTagsFrom: _colorTagsFrom, ...photo }) => photo,
);
