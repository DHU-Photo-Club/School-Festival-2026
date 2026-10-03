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

export function sessionCookie(name: string, token: string): string {
  return `${name}=${token}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
