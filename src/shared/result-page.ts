import { EXHIBIT } from "../data/exhibit.ts";
import { RESULT_ID_PATTERN } from "./result.ts";

export type ResultRoute = { kind: "page" | "data"; id: string };

export type ResultAvailability = ({ status: 200 } & ResultRoute) | { status: 404 } | { status: 410 };

/**
 * `/result/{id}`（結果ページ）と `/result/{id}/data`（結果ページが読むJSON）の公開判定（仕様書10.1節）。
 * 形式の合わないIDは期間にかかわらず404、`RESULTS_PUBLISHED_UNTIL` 以降は410とする。
 * 終了日時を解釈できない場合は公開しない。IDの結果が保存されているかは呼び出し側で確かめる。
 */
export function resultAvailability(pathname: string, now: number, publishedUntil: string): ResultAvailability {
	const match = pathname.match(/^\/result\/([^/]+)(\/data)?\/?$/);
	if (!match || !RESULT_ID_PATTERN.test(match[1])) return { status: 404 };
	const until = Date.parse(publishedUntil);
	if (Number.isNaN(until) || now >= until) return { status: 410 };
	return { status: 200, kind: match[2] ? "data" : "page", id: match[1] };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(title: string, body: string): string {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  @font-face {
    font-family: 'MOBO-Regular';
    src: url('/fonts/MOBO-Regular.otf') format('opentype');
    font-style: normal;
    font-weight: 400;
    font-display: swap;
  }
  body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 12px; padding: 24px;
    background: #0B0B0B; color: #E8E6E3; font-family: 'MOBO-Regular', system-ui, sans-serif; text-align: center; }
  h1 { font-size: 20px; font-weight: 600; margin: 0; }
  p { margin: 0; color: #B5B2AE; }
</style>
</head>
<body>${body}</body>
</html>`;
}

/** 公開終了後のページ。展示名だけを表示し、色名、診断文、代表画像を含めない。 */
export function goneResponse(): Response {
	return new Response(
		page(EXHIBIT.title, `<h1>${escapeHtml(EXHIBIT.title)}</h1><p>この展示の結果ページは公開を終了しました</p>`),
		{ status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
	);
}

export function notFoundResponse(): Response {
	return new Response(page(EXHIBIT.title, `<h1>${escapeHtml(EXHIBIT.title)}</h1><p>ページが見つかりません</p>`), {
		status: 404,
		headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
	});
}
