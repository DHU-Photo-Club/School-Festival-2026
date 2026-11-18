// production build前の写真ファイル検証（仕様書12.1節）。
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Photo } from "../src/shared/types.ts";

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
