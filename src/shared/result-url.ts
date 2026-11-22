import { RESULT_ID_PATTERN } from "./result.ts";

/**
 * QRコードへ格納する結果URL（仕様書10.3節）。`PUBLIC_ORIGIN` と結果IDを検証してから組み立てる。
 * クエリ文字列、fragment、`sessionId`、回答内容を含めない。
 */
export function resultUrl(publicOrigin: string, resultId: string): string {
	const origin = new URL(publicOrigin);
	if (origin.protocol !== "https:" || origin.origin !== publicOrigin) throw new Error("PUBLIC_ORIGIN が不正です");
	if (!RESULT_ID_PATTERN.test(resultId)) throw new Error("結果IDが不正です");
	return `${publicOrigin}/result/${resultId}`;
}
