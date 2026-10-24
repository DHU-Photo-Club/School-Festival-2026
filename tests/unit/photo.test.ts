import { describe, expect, it } from 'vitest';
import { QUESTIONS } from '../../src/data/questions.ts';
import { JUDGING_MS } from '../../src/shared/machine.ts';
import type { AdminState } from '../../src/shared/protocol.ts';
import { displayOrderOf, nextFreeScreenId, screenIdFor } from '../../src/shared/screens.ts';
import { PAIRING_TTL_MS, SESSION_TTL_MS } from '../../src/worker/core.ts';
import { Harness } from './helpers.ts';

describe('写真用の画面ID', () => {
  it('展示ディスプレイとは別に番号と並び順を扱う', () => {
    expect(screenIdFor(0, 'photo')).toBe('photo-1');
    expect(displayOrderOf('photo-12', 'photo')).toBe(11);
    expect(displayOrderOf('photo-1')).toBeNull();
    expect(displayOrderOf('display-1', 'photo')).toBeNull();
    expect(displayOrderOf('photo-0', 'photo')).toBeNull();
    expect(nextFreeScreenId(['photo-1', 'photo-3', 'display-2'], 'photo')).toBe('photo-2');
    expect(nextFreeScreenId(['photo-1'])).toBe('display-1');
  });
});

describe('写真用の登録と権限', () => {
  it('独立した連番で登録し、失効した番号を再利用する', () => {
    const harness = new Harness();
    const pair = (role: 'photo' | 'display', key: string) =>
      harness.core.pair(harness.core.issuePairingCode(role).code, key);
    expect(pair('photo', 'p1')).toMatchObject({ ok: true, session: { role: 'photo', screenId: 'photo-1' } });
    expect(pair('display', 'd1')).toMatchObject({ ok: true, session: { screenId: 'display-1' } });
    expect(pair('photo', 'p2')).toMatchObject({ ok: true, session: { screenId: 'photo-2' } });
    expect(harness.core.registeredScreens()).toEqual(['display-1']);
    expect(harness.core.registeredScreens('photo')).toEqual(['photo-1', 'photo-2']);
    harness.core.revokeSession('p1');
    expect(pair('photo', 'p3')).toMatchObject({ ok: true, session: { screenId: 'photo-1' } });
    harness.advance(SESSION_TTL_MS);
    expect(harness.core.registeredScreens('photo')).toEqual([]);
    expect(pair('photo', 'p4')).toMatchObject({ ok: true, session: { screenId: 'photo-1' } });
  });

  it('使用済み・期限切れのコードを拒否する', () => {
    const harness = new Harness();
    const { code } = harness.core.issuePairingCode('photo');
    expect(harness.core.pair(code, 'first').ok).toBe(true);
    expect(harness.core.pair(code, 'second').ok).toBe(false);
    const expired = harness.core.issuePairingCode('photo');
    harness.advance(PAIRING_TTL_MS);
    expect(harness.core.pair(expired.code, 'third').ok).toBe(false);
  });

  it('役割と画面IDを照合し、失効後の接続を拒否する', () => {
    const harness = new Harness();
    harness.core.issueSession('photo-key', 'device', 'photo', 'photo-1');
    expect(harness.core.authorizeRealtime('photo-key', 'photo', 'photo-1').ok).toBe(true);
    for (const [role, screenId] of [['photo', 'photo-2'], ['photo', null], ['display', 'photo-1'], ['controller', null]]) {
      expect(harness.core.authorizeRealtime('photo-key', role, screenId)).toEqual({ ok: false, status: 403 });
    }
    harness.core.revokeSession('photo-key');
    expect(harness.core.authorizeRealtime('photo-key', 'photo', 'photo-1')).toEqual({ ok: false, status: 401 });
  });

  it('展示操作・結果開始報告を禁止し、回答を配信しない', () => {
    const harness = new Harness();
    const photo = harness.connect('photo', { screenId: 'photo-1' });
    const controller = harness.connect('controller');
    expect(photo.ofType('welcome')[0].state).not.toHaveProperty('answers');
    expect(harness.command(photo, { name: 'start' })[0]).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
    expect(harness.command(photo, { name: 'forceReset' })[0]).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
    harness.send(photo, { type: 'resultStarted', requestId: 'result', sessionId: 's', screenId: 'photo-1', actualStartedAt: harness.time });
    expect(photo.last()).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
    harness.command(controller, { name: 'start' });
    harness.command(controller, { name: 'continue' });
    harness.command(controller, { name: 'answer', questionId: QUESTIONS[0].id, stopId: 'far-left' });
    expect(JSON.stringify(photo.sent)).not.toContain('"answers"');
    expect(JSON.stringify(photo.sent)).not.toContain('far-left');
  });

  it('接続状態と時刻補正を端末ごとに記録し、公開IDで失効できる', () => {
    const harness = new Harness();
    harness.connect('controller');
    const first = harness.connect('photo', { screenId: 'photo-1' });
    harness.connect('photo', { screenId: 'photo-2' });
    const admin = harness.connect('admin');
    harness.send(first, { type: 'diagnostic', requestId: 'clock', name: 'clockSync', minRoundTripTime: 20, offsetSpread: 10 });
    const devices = (admin.ofType('state').at(-1)?.state as AdminState).devices;
    expect(devices.find((device) => device.screenId === 'photo-1')).toMatchObject({
      role: 'photo', connected: true, clockSync: { minRoundTripTime: 20, offsetSpread: 10, degraded: false },
    });
    expect(devices.find((device) => device.screenId === 'photo-2')?.clockSync).toBeNull();
    expect(devices.find((device) => device.role === 'controller')?.clockSync).toBeNull();
    const session = harness.core.listDeviceSessions().find((entry) => entry.screenId === 'photo-1');
    expect(session?.connected).toBe(true);
    expect(harness.core.revokeDeviceSessionById(session!.id)).toBe(true);
    expect(first.closed?.code).toBe(4001);
    expect(harness.core.registeredScreens('photo')).toEqual(['photo-2']);
  });

  it('写真用は結果同期の計測対象に含めない', () => {
    const harness = new Harness();
    const controller = harness.connect('controller');
    harness.connect('display', { screenId: 'display-1' });
    harness.connect('photo', { screenId: 'photo-1' });
    const admin = harness.connect('admin');
    harness.command(controller, { name: 'start' });
    harness.command(controller, { name: 'continue' });
    for (const question of QUESTIONS) harness.command(controller, { name: 'answer', questionId: question.id, stopId: 'center' });
    harness.advance(JUDGING_MS);
    harness.alarm();
    const state = admin.ofType('state').at(-1)?.state as AdminState;
    expect(state.syncReport?.entries.map((entry) => entry.screenId)).toEqual(['display-1']);
  });
});
