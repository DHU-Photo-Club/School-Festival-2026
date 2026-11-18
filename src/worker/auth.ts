import { SESSION_TTL_MS } from './core.ts';

export const ADMIN_COOKIE = 'dpc_admin';
export const DEVICE_COOKIE = 'dpc_device';

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** 32 byteの乱数から作るセッショントークン（仕様書8.4節）。 */
export function newToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** ストレージにはトークンそのものではなくSHA-256の値を保存する。 */
export async function authKeyFromToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return base64url(new Uint8Array(digest));
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

/**
 * ループバック、未指定アドレス、プライベートIPv4、CGNAT（100.64.0.0/10）、`.local` のホスト名なら `true`。
 * `[::1]` 以外のIPv6（リンクローカル `fe80::/10`、IPv4射影 `::ffff:a.b.c.d` など）は対象外とし、`Secure` を付ける。
 */
function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host === '[::1]' || host === '0.0.0.0' || host.endsWith('.local')) return true;
  return /^(127|10|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))(\.\d{1,3})+$/.test(host)
    && host.split('.').length === 4;
}

/**
 * セッションCookieの `Set-Cookie` 値を返す。
 * `Secure` 属性は、ローカルネットワークのホストへのHTTPリクエストの場合だけ省略する。
 * ブラウザはlocalhost以外のHTTPオリジンから届いた `Secure` 付きCookieを保存しないため、
 * LAN内のHTTP開発サーバーでは端末登録が成立しない。公開ホストへのHTTPリクエストには `Secure` を付ける。
 */
export function sessionCookie(request: Request, name: string, token: string): string {
  const url = new URL(request.url);
  const secure = url.protocol === 'http:' && isLocalNetworkHost(url.hostname) ? '' : ' Secure;';
  return `${name}=${token}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly;${secure} SameSite=Strict`;
}
