// 仮写真の生成。仕様書16章「写真点数、縦横比、配布許可」が決まるまでの仮素材を作る。
// 文字やUIを焼き込まず（仕様書12.2節）、ピントを外した写真のような色のにじみだけを描く。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { RESULT_COLORS } from '../src/data/colors.ts';
import { PHOTOS } from '../src/data/photos.ts';

const OUTPUT = join(import.meta.dirname, '..', 'public', 'photos');
const SIZES: [number, number][] = [
  [1920, 1280],
  [1280, 1920],
  [1920, 1080],
  [1536, 1920],
  [1600, 1600],
];

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

mkdirSync(OUTPUT, { recursive: true });

for (const [index, photo] of PHOTOS.entries()) {
  const color = RESULT_COLORS.find((candidate) => candidate.id === photo.resultColorId);
  if (!color) throw new Error(`未定義の色: ${photo.resultColorId}`);
  const [width, height] = SIZES[photo.resultOrder % SIZES.length];
  const random = mulberry32(index * 7919 + 17);
  const base = hexToRgb(color.baseColor);
  const deep = hexToRgb(color.backgroundColor);
  const light = hexToRgb(color.foregroundColor);
  const blobs = Array.from({ length: 4 }, () => ({
    x: random() * width,
    y: random() * height,
    r: (0.25 + random() * 0.35) * Math.max(width, height),
    tone: random() < 0.5 ? light : base,
    weight: 0.35 + random() * 0.4,
  }));
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      let rgb = deep.map((value, c) => value + (base[c] - value) * t * 0.55);
      for (const blob of blobs) {
        const d = Math.hypot(x - blob.x, y - blob.y) / blob.r;
        const k = Math.max(0, 1 - d * d) * blob.weight;
        rgb = rgb.map((value, c) => value + (blob.tone[c] - value) * k);
      }
      const grain = (random() - 0.5) * 10;
      const offset = (y * width + x) * 3;
      for (let c = 0; c < 3; c += 1) pixels[offset + c] = Math.max(0, Math.min(255, Math.round(rgb[c] + grain)));
    }
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } }).withIccProfile('srgb');
  await image.clone().avif({ quality: 55 }).toFile(join(OUTPUT, `${photo.id}.avif`));
  await image.clone().jpeg({ quality: 82, mozjpeg: true }).toFile(join(OUTPUT, `${photo.id}.jpg`));
  console.log(`${photo.id} ${width}x${height}`);
}
