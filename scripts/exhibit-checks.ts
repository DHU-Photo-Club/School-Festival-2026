// production build時の検証（仕様書10.1節、10.2節、12.1節、12.2節、11.2節）。失敗したらビルドを止める。
import { join } from "node:path";
import type { Plugin } from "vite";
import { PALETTE } from "../src/data/palette.ts";
import { PHOTOS } from "../src/data/photos.ts";
import { QUESTIONS } from "../src/data/questions.ts";
import { SEQUENCES } from "../src/data/sequences.ts";
import { SOUND_FILES } from "../src/data/sound.ts";
import { ROOT, readWranglerConfig } from "../src/server/config.ts";
import {
	validateExhibitData,
	validatePublicOrigin,
	validatePublishedUntil,
	validateSequences,
} from "../src/shared/data-validation.ts";
import { validatePhotoFiles, validateSequenceComponents, validateSoundFiles } from "./validate-assets.ts";

export function exhibitChecks(): Plugin {
	let isBuild = false;
	let checked = false;
	return {
		name: "exhibit-checks",
		configResolved(config) {
			isBuild = config.command === "build";
		},
		async buildStart() {
			if (!isBuild || checked) return;
			checked = true;
			const wrangler = readWranglerConfig();
			const errors = [
				...validatePublicOrigin(wrangler.vars.PUBLIC_ORIGIN, wrangler.name),
				...validatePublishedUntil(wrangler.vars.RESULTS_PUBLISHED_UNTIL),
				...validateExhibitData({
					palette: PALETTE,
					questions: QUESTIONS,
					photos: PHOTOS,
				}),
				...validateSequences(SEQUENCES),
				...validateSequenceComponents(SEQUENCES, join(ROOT, "src", "client", "sequences")),
				...(await validatePhotoFiles(PHOTOS, join(ROOT, "public", "photos"))),
				...validateSoundFiles(
					[
						SOUND_FILES.bgm,
						...SOUND_FILES.glass,
						...SOUND_FILES.narration,
						...SOUND_FILES.answer,
						SOUND_FILES.complete,
					],
					join(ROOT, "public"),
				),
			];
			if (errors.length > 0) {
				this.error(`展示データの検証に失敗しました:\n${errors.map((error) => `- ${error}`).join("\n")}`);
			}
		},
	};
}
