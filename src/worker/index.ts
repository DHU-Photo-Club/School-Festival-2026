import { goneResponse, notFoundResponse, resultAvailability } from "./result-page.ts";

export { Exhibit } from "./exhibit.ts";

/** 展示全体で一つのDurable Objectを使う。 */
const exhibit = (env: Env) => env.EXHIBIT.getByName("exhibit");

/**
 * 認証はアプリでは行わない。本番では Cloudflare Access が `/result/*` と静的ファイル以外を保護する
 * （docs/README.md 14章）。
 */
export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/result/")) {
			const availability = resultAvailability(url.pathname, Date.now(), env.RESULTS_PUBLISHED_UNTIL);
			if (availability.status === 404) return notFoundResponse();
			if (availability.status === 410) return goneResponse();
			const result = await exhibit(env).publicResult(availability.id);
			if (!result) return notFoundResponse();
			if (availability.kind === "data") {
				return Response.json(result, { headers: { "Cache-Control": "no-store" } });
			}
			const spa = await env.ASSETS.fetch(new Request(new URL("/", url), request));
			const response = new Response(spa.body, spa);
			response.headers.set("Cache-Control", "no-store");
			return response;
		}

		if (url.pathname === "/api/realtime") return exhibit(env).fetch(request);
		if (url.pathname.startsWith("/api/")) return new Response("Not Found", { status: 404 });

		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
