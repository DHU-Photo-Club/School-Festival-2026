// 結果ページのWorkerへ載せる静的ファイルを、`pnpm build` の成果物（dist/）から dist-results/ へ集める（仕様書10章）。
// 写真は配布を許可したもの（`shareAllowed: true`）だけを載せ、それ以外の写真を施設回線の外へ出さない。
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PHOTOS } from "../src/data/photos.ts";
import { ROOT } from "../src/server/config.ts";

const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "dist-results");

if (!existsSync(join(DIST, "index.html"))) {
	console.error("dist/index.html がありません。先に `pnpm build` を実行してください。");
	process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "photos"), { recursive: true });
cpSync(join(DIST, "index.html"), join(OUT, "index.html"));
cpSync(join(DIST, "assets"), join(OUT, "assets"), { recursive: true });
cpSync(join(DIST, "fonts"), join(OUT, "fonts"), { recursive: true });

const shared = PHOTOS.filter((photo) => photo.shareAllowed);
for (const photo of shared) {
	for (const ext of ["avif", "jpg"]) {
		cpSync(join(DIST, "photos", `${photo.id}.${ext}`), join(OUT, "photos", `${photo.id}.${ext}`));
	}
}
console.log(`dist-results/ を作りました（配布を許可した写真 ${shared.length} / ${PHOTOS.length} 枚）`);
