import { readCookie, ADMIN_COOKIE, DEVICE_COOKIE } from './auth.ts';
import { goneResponse, notFoundResponse, resultAvailability } from './result-page.ts';

export { Exhibit } from './exhibit.ts';

/** 展示全体で一つのDurable Objectを使う（仕様書9.3節）。 */
const exhibit = (env: Env) => env.EXHIBIT.getByName('exhibit');

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/result/')) {
      const availability = resultAvailability(url.pathname, Date.now(), env.RESULTS_PUBLISHED_UNTIL);
      if (availability.status === 404) return notFoundResponse();
      if (availability.status === 410) return goneResponse();
      const spa = await env.ASSETS.fetch(new Request(new URL('/', url), request));
      const response = new Response(spa.body, spa);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    if (url.pathname === '/api/realtime') {
      const role = url.searchParams.get('role');
      const token = readCookie(request, role === 'admin' ? ADMIN_COOKIE : DEVICE_COOKIE);
      const status = await exhibit(env).authorizeRealtime(token, role, url.searchParams.get('screenId'));
      if (status !== 200) return new Response(null, { status });
      return exhibit(env).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) return exhibit(env).fetch(request);

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
