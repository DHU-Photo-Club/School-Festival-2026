// production build前の写真ファイル検証（仕様書12.1節）。
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Photo, Sequence } from "../src/shared/types.ts";

const MIB = 1024 * 1024;
export const AVIF_MAX_BYTES = 2 * MIB;
export const JPEG_MAX_BYTES = 3 * MIB;
export const LONG_SIDE_MAX = 3840;

interface Decoded {
	width: number;
	height: number;
}

async function inspect(
	file: string,
	format: "heif" | "jpeg",
	errors: string[],
	label: string,
): Promise<Decoded | null> {
	try {
		const metadata = await sharp(file).metadata();
		if (metadata.format !== format) errors.push(`${label}: 形式が ${metadata.format} です`);
		if (metadata.orientation !== undefined && metadata.orientation !== 1) {
			errors.push(`${label}: 回転情報を画素へ反映していません`);
		}
		if (metadata.hasAlpha) errors.push(`${label}: 透過を含んでいます`);
		if (metadata.space !== "srgb") errors.push(`${label}: sRGBではありません（${metadata.space}）`);
		// 画素まで復号できることを確認する。
		const { info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
		return { width: info.width, height: info.height };
	} catch {
		errors.push(`${label}: デコードできません`);
		return null;
	}
}

/** 写真ファイルの欠落、容量、デコード、寸法を確認し、問題の一覧を返す。 */
export async function validatePhotoFiles(photos: readonly Photo[], photosDir: string): Promise<string[]> {
	const errors: string[] = [];

	for (const photo of photos) {
		const avif = join(photosDir, `${photo.id}.avif`);
		const jpeg = join(photosDir, `${photo.id}.jpg`);
		const found: Decoded[] = [];
		for (const [file, format, limit] of [
			[avif, "heif", AVIF_MAX_BYTES],
			[jpeg, "jpeg", JPEG_MAX_BYTES],
		] as const) {
			const label = file.slice(photosDir.length + 1);
			if (!existsSync(file)) {
				errors.push(`${label}: ファイルがありません`);
				continue;
			}
			if (statSync(file).size > limit) errors.push(`${label}: 容量上限 ${limit / MIB}MiB を超えています`);
			const decoded = await inspect(file, format, errors, label);
			if (decoded) found.push(decoded);
		}
		if (found.length === 2 && (found[0].width !== found[1].width || found[0].height !== found[1].height)) {
			errors.push(`${photo.id}: AVIFとJPEGの画素寸法が一致しません`);
		}
		for (const decoded of found.slice(0, 1)) {
			// 長辺は3,840px以下（仕様書12.1節）。
			if (Math.max(decoded.width, decoded.height) > LONG_SIDE_MAX) {
				errors.push(`${photo.id}: 長辺が上限 ${LONG_SIDE_MAX}px を超えています`);
			}
		}
	}
	return errors;
}

/** 各シーケンスの iPad 用と展示ディスプレイ用のコンポーネントがあるかを確認し、問題の一覧を返す。 */
export function validateSequenceComponents(sequences: readonly Sequence[], dir: string): string[] {
	const errors: string[] = [];
	for (const sequence of sequences) {
		const folder = join(dir, sequence.id);
		// 実行時の `import.meta.glob` は大文字と小文字を区別するため、ファイル名を一覧と完全一致で比べる。
		const files = existsSync(folder) ? readdirSync(folder) : [];
		for (const file of ["Controller.svelte", "Display.svelte"]) {
			if (!files.includes(file)) {
				errors.push(`シーケンス ${sequence.id} の ${sequence.id}/${file} がありません`);
			}
		}
	}
	return errors;
}

/** サウンド用の画面が読む音源（`src/data/sound.ts` の `SOUND_FILES`）の欠落を確認する（仕様書11.2節）。 */
export function validateSoundFiles(paths: readonly string[], publicDir: string): string[] {
	return paths
		.filter((path) => !existsSync(join(publicDir, path.slice(1))))
		.map((path) => `${path.slice(1)}: ファイルがありません（pnpm export-sounds で書き出す）`);
}
