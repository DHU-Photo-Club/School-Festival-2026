// 原本（photos/originals）から表示用ファイルを書き出す（仕様書12.1節）。
// 写真IDはファイル名を小文字にし、先頭と末尾の記号を除き、英数字以外をハイフンにしたもの。
// 一つの写真IDから public/photos/{photoId}.avif と .jpg を、同じ原本・画角・寸法で書き出す。
import { mkdirSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { PHOTOS } from '../src/data/photos.ts';
import { LONG_SIDE_MAX } from '../build/validate-assets.ts';

const ROOT = join(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'photos', 'originals');
const OUTPUT = join(ROOT, 'public', 'photos');

function photoIdFromFileName(fileName: string): string {
  return fileName
    .slice(0, fileName.length - extname(fileName).length)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 長辺は3,840px以下。原本より大きくはしない。
const longSide = LONG_SIDE_MAX;
const defined = new Set(PHOTOS.map((photo) => photo.id));

mkdirSync(OUTPUT, { recursive: true });

for (const fileName of readdirSync(SOURCE).filter((name) => /\.(jpe?g|tiff?|png)$/i.test(name)).sort()) {
  const id = photoIdFromFileName(fileName);
  if (!defined.has(id)) console.warn(`写真定義にない写真です: ${fileName} → ${id}`);
  // 回転情報を画素へ反映し、sRGBのICCプロファイルを埋め込む。拡大はしない。
  const image = sharp(join(SOURCE, fileName))
    .rotate()
    .resize({ width: longSide, height: longSide, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .withIccProfile('srgb');
  const avif = await image.clone().avif({ quality: 60, effort: 6 }).toFile(join(OUTPUT, `${id}.avif`));
  const jpeg = await image.clone().jpeg({ quality: 85, mozjpeg: true }).toFile(join(OUTPUT, `${id}.jpg`));
  console.log(
    `${fileName} → ${id}  ${jpeg.width}x${jpeg.height}  avif ${(avif.size / 1024).toFixed(0)}KiB  jpg ${(jpeg.size / 1024).toFixed(0)}KiB`,
  );
}
