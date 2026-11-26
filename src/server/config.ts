import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";

export const ROOT = join(import.meta.dirname, "..", "..");

/** 結果ページのWorkerの設定（`wrangler.jsonc`）のうち、会場サーバーとビルドが読む部分。 */
export interface WranglerConfig {
	name: string;
	vars: { PUBLIC_ORIGIN: string; RESULTS_PUBLISHED_UNTIL: string };
}

/** `wrangler.jsonc` を読む。公開元と公開終了日時の正本はこのファイルに置く（仕様書10.1節）。 */
export function readWranglerConfig(): WranglerConfig {
	return parse(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8")) as WranglerConfig;
}

/** 会場サーバーの設定（仕様書14章）。環境変数は `.env` に書く。 */
export interface ServerConfig {
	/** SQLiteのファイル。`:memory:` ならプロセスの終了で破棄する。 */
	dataFile: string;
	/** 結果ページのWorkerのorigin。QRコードと同じ値で、結果の送り先にもなる。 */
	publicOrigin: string;
	/** 結果ページの公開終了日時（ISO 8601、UTC）。 */
	resultsPublishedUntil: string;
	/** 結果ページのWorkerへ結果を送るときのトークン。なければ結果を送らない。 */
	resultsUploadToken: string | undefined;
	mistralApiKey: string | undefined;
	mistralModel: string | undefined;
	mistralBaseUrl: string | undefined;
	/** `true` なら AI へ接続せず、開発用の仮の結果を返す。開発とE2Eテスト専用。 */
	aiStub: boolean;
}

const optional = (value: string | undefined) => value?.trim() || undefined;

/** 環境変数と `wrangler.jsonc` から設定を作る。`overrides` はE2Eテストの開発サーバーが使う。 */
export function serverConfig(
	env: Record<string, string | undefined>,
	overrides: Partial<ServerConfig> = {},
): ServerConfig {
	const wrangler = readWranglerConfig();
	return {
		dataFile: optional(env.DATA_FILE) ?? join(ROOT, "data", "exhibit.sqlite"),
		publicOrigin: wrangler.vars.PUBLIC_ORIGIN,
		resultsPublishedUntil: wrangler.vars.RESULTS_PUBLISHED_UNTIL,
		resultsUploadToken: optional(env.RESULTS_UPLOAD_TOKEN),
		mistralApiKey: optional(env.MISTRAL_API_KEY),
		mistralModel: optional(env.MISTRAL_MODEL),
		mistralBaseUrl: optional(env.MISTRAL_BASE_URL),
		aiStub: env.AI_STUB === "1",
		...overrides,
	};
}
