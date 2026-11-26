// サウンド素材（refs/サウンド実装引き継ぎ/assets）から配信用の音源を public/sounds/ へ書き出す（仕様書11.2節）。
// 原本は書き換えない。BGM（AAC）はそのままコピーし、それ以外は Opus（Ogg）へ変換する。
// 展示ディスプレイと同じChromeで鳴らすため、Chromeが読めないCAFと、容量の大きい96kHzのWAVを残さない。
//
// 使い方: pnpm export-sounds [素材フォルダー]
// 素材フォルダーを省略すると refs/サウンド実装引き継ぎ/assets を読む。ffmpeg（libopus入り）が必要。
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SOUND_FILES } from "../src/data/sound.ts";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = resolve(process.argv[2] ?? join(ROOT, "refs", "サウンド実装引き継ぎ", "assets"));
const OUTPUT = join(ROOT, "public");

/** 書き出し先（`SOUND_FILES` のパス）と、素材フォルダーの中の原本の対応。 */
const GLASS_SOURCES = [
	"01_澄んだガラス_遠く",
	"02_やわらかな接触_遠く",
	"03_極小のかけら_遠く",
	"04_薄い大きなかけら_遠く",
	"05_深い空間_遠く",
	"06_短い余韻_遠く",
	"07_澄んだガラス_低く柔らかく",
	"08_澄んだガラス_細かく淡く",
	"09_やわらかな接触_低く柔らかく",
	"10_やわらかな接触_細かく淡く",
	"11_極小のかけら_低く柔らかく",
	"12_極小のかけら_細かく淡く",
	"13_薄い大きなかけら_低く柔らかく",
	"14_薄い大きなかけら_細かく淡く",
	"15_深い空間_低く柔らかく",
	"16_深い空間_細かく淡く",
	"17_短い余韻_低く柔らかく",
	"18_短い余韻_細かく淡く",
].map((name) => `ガラスの音/個別WAV_18種類/${name}.wav`);

interface Job {
	source: string;
	target: string;
	/** Opusのビットレート。`null` は変換せずにコピーする。 */
	bitrate: string | null;
}

const jobs: Job[] = [
	{ source: "BGM/BGM01.m4a", target: SOUND_FILES.bgm, bitrate: null },
	...SOUND_FILES.glass.map((target, index) => ({ source: GLASS_SOURCES[index], target, bitrate: "160k" })),
	...SOUND_FILES.narration.map((target, index) => ({
		source: `ナレーション/とまくらボイス/${index + 1}.wav`,
		target,
		bitrate: "128k",
	})),
	...SOUND_FILES.answer.map((target, index) => ({ source: `回答送信時/Q${index + 1}.caf`, target, bitrate: "192k" })),
	{ source: "回答送信時/Complete_v13_open_chord.caf", target: SOUND_FILES.complete, bitrate: "192k" },
];

if (GLASS_SOURCES.length !== SOUND_FILES.glass.length) throw new Error("ガラス音の原本と書き出し先の数が合いません");
const missing = jobs.filter((job) => !existsSync(join(SOURCE, job.source)));
if (missing.length > 0) {
	console.error(`素材が見つかりません（${SOURCE}）:\n${missing.map((job) => `- ${job.source}`).join("\n")}`);
	process.exit(1);
}

for (const job of jobs) {
	const from = join(SOURCE, job.source);
	// `SOUND_FILES` のパスは `/sounds/...`。先頭の `/` を除いて public/ の下へ置く。
	const to = join(OUTPUT, job.target.slice(1));
	mkdirSync(dirname(to), { recursive: true });
	if (job.bitrate === null) {
		copyFileSync(from, to);
	} else {
		// 48kHz（Opusの標準）へ変換する。チャンネル数（ステレオ）と音量は原本のまま。
		const result = spawnSync(
			"ffmpeg",
			[
				...["-hide_banner", "-loglevel", "error", "-y", "-i", from, "-map_metadata", "-1", "-vn"],
				...["-c:a", "libopus", "-b:a", job.bitrate, "-ar", "48000", to],
			],
			{ stdio: "inherit" },
		);
		if (result.error || result.status !== 0) {
			console.error(`${job.source} を変換できませんでした。ffmpeg（libopus入り）を入れてください。`);
			process.exit(1);
		}
	}
	console.log(`${job.source} → ${job.target}  ${(statSync(to).size / 1024).toFixed(0)}KiB`);
}
