/**
 * `wrangler types` が生成しない、任意の環境変数（仕様書6.4節）。
 * `MISTRAL_API_KEY` は `wrangler secret put` で設定し、ローカルでは `.dev.vars` に書く。
 */
interface Env {
	/** Mistral AI のAPIキー。なければ結果を決められない（`AI_STUB` を除く）。 */
	MISTRAL_API_KEY?: string;
	/** 使うモデルのID。省略すると `mistral-small-latest`。 */
	MISTRAL_MODEL?: string;
	/** APIのベースURL。省略すると `https://api.mistral.ai/v1`。 */
	MISTRAL_BASE_URL?: string;
	/** `"1"` なら AI へ接続せず、開発用の仮の結果を返す。開発とE2Eテスト専用。本番では設定しない。 */
	AI_STUB?: string;
}
