import { describe, expect, it } from 'vitest';
import { sessionCookie } from '../../src/worker/auth.ts';

// E2Eは http://localhost で動き、ブラウザはlocalhostなら Secure 付きCookieも保存するため、
// LAN内のHTTP開発サーバーで端末登録できなくなる不具合はE2Eでは検出できない。ここで属性を固定する。

const cookieFor = (url: string) => sessionCookie(new Request(url), 'dpc_device', 'token');

describe('sessionCookie', () => {
  it('HTTPSのリクエストには Secure を付ける', () => {
    expect(cookieFor('https://dpc-school-festival.example.workers.dev/api/pair')).toContain('Secure;');
    expect(cookieFor('https://192.168.1.10:5173/api/pair')).toContain('Secure;');
  });

  it('公開ホストへのHTTPリクエストにも Secure を付ける', () => {
    expect(cookieFor('http://dpc-school-festival.example.workers.dev/api/pair')).toContain('Secure;');
    expect(cookieFor('http://8.8.8.8/api/pair')).toContain('Secure;');
    expect(cookieFor('http://172.32.0.1/api/pair')).toContain('Secure;');
    expect(cookieFor('http://100.128.0.1/api/pair')).toContain('Secure;');
    expect(cookieFor('http://172.15.0.1/api/pair')).toContain('Secure;');
    expect(cookieFor('http://100.63.0.1/api/pair')).toContain('Secure;');
  });

  it('プライベートIPで始まるだけの公開ホスト名には Secure を付ける', () => {
    for (const host of ['10.example.com', '192.168.1.10.evil.com', '127.0.0.1.nip.io', '10.0.0.1.nip.io']) {
      expect(cookieFor(`http://${host}/api/pair`)).toContain('Secure;');
    }
  });

  it('ローカルネットワークのホストへのHTTPリクエストでは Secure を省略する', () => {
    for (const host of ['localhost:5173', '127.0.0.1', '[::1]', '10.0.0.5', '172.16.0.1', '192.168.1.10:5173', '100.74.28.125', 'pc.local',
      '172.31.255.255', '100.64.0.1', '100.127.255.255', 'LOCALHOST', 'localhost.', '192.168.1.10.', '0.0.0.0:5173']) {
      expect(cookieFor(`http://${host}/api/pair`)).not.toContain('Secure');
    }
  });

  it('HttpOnly と SameSite=Strict は常に付ける', () => {
    for (const url of ['https://example.com/', 'http://192.168.1.10/']) {
      expect(cookieFor(url)).toMatch(/^dpc_device=token; Path=\/; Max-Age=\d+; HttpOnly;( Secure;)? SameSite=Strict$/);
    }
  });
});
