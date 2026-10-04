import { describe, expect, it } from 'vitest';
import { parseClientMessage, toDisplayState } from '../../src/shared/protocol.ts';
import { initialState } from '../../src/shared/machine.ts';

const parse = (value: unknown) => parseClientMessage(JSON.stringify(value));

describe('parseClientMessage', () => {
  it('JSONでないメッセージを拒否する', () => {
    expect(parseClientMessage('{oops')).toMatchObject({ ok: false, code: 'INVALID_MESSAGE', notJson: true });
  });

  it('version が1でなければ PROTOCOL_MISMATCH', () => {
    expect(parse({ version: 2, type: 'hello', clientId: 'a' })).toMatchObject({ ok: false, code: 'PROTOCOL_MISMATCH' });
    expect(parse({ type: 'hello', clientId: 'a' })).toMatchObject({ ok: false, code: 'PROTOCOL_MISMATCH' });
  });

  it.each([
    ['type がない', { version: 1 }],
    ['不明な type', { version: 1, type: 'state' }],
    ['clientId がない hello', { version: 1, type: 'hello' }],
    ['clientId が数値', { version: 1, type: 'hello', clientId: 3 }],
    ['requestId がない command', { version: 1, type: 'command', expectedRevision: 0, command: { name: 'start' } }],
    ['不明なコマンド', { version: 1, type: 'command', requestId: 'r', expectedRevision: 0, command: { name: 'skip' } }],
    ['回答IDが不正', { version: 1, type: 'command', requestId: 'r', expectedRevision: 0, command: { name: 'answer', questionId: 'q', stopId: 'middle' } }],
    ['expectedRevision が文字列', { version: 1, type: 'command', requestId: 'r', expectedRevision: '0', command: { name: 'start' } }],
    ['expectedRevision が負', { version: 1, type: 'command', requestId: 'r', expectedRevision: -1, command: { name: 'start' } }],
    ['setAccepting の値がない', { version: 1, type: 'command', requestId: 'r', expectedRevision: 0, command: { name: 'setAccepting' } }],
    ['未定義の色', { version: 1, type: 'command', requestId: 'r', expectedRevision: 0, command: { name: 'previewColor', colorId: 'pink' } }],
    ['clientSentAt がない ping', { version: 1, type: 'ping', pingId: 'p' }],
    ['actualStartedAt がない resultStarted', { version: 1, type: 'resultStarted', requestId: 'r', sessionId: 's', screenId: 'display-1' }],
    ['colorId が不正な diagnostic', { version: 1, type: 'diagnostic', requestId: 'r', name: 'qrGenerationFailed', sessionId: 's', colorId: 'x', occurredAt: 1 }],
    ['配列', [1, 2]],
  ])('%s は INVALID_MESSAGE', (_label, value) => {
    expect(parse(value)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
  });

  it('forceReset だけは expectedRevision を省略できる', () => {
    expect(parse({ version: 1, type: 'command', requestId: 'r', command: { name: 'forceReset' } }).ok).toBe(true);
    expect(parse({ version: 1, type: 'command', requestId: 'r', command: { name: 'start' } }).ok).toBe(false);
  });

  it('不明なフィールドを無視し、コマンド固有フィールドは command 内だけを読む', () => {
    const result = parse({
      version: 1,
      type: 'command',
      requestId: 'r',
      expectedRevision: 3,
      questionId: 'outside',
      extra: true,
      command: { name: 'answer', questionId: 'light', stopId: 'left', note: 'x' },
    });
    expect(result).toEqual({
      ok: true,
      message: {
        version: 1,
        type: 'command',
        requestId: 'r',
        expectedRevision: 3,
        command: { name: 'answer', questionId: 'light', stopId: 'left' },
      },
    });
  });

  it('エラー応答のために requestId を取り出す', () => {
    expect(parse({ version: 1, type: 'command', requestId: 'abc', command: { name: 'nope' } })).toMatchObject({ requestId: 'abc' });
  });
});

describe('toDisplayState', () => {
  it('展示ディスプレイへは8.5節の7項目だけを渡す', () => {
    const state = { ...initialState(1), answers: { light: 'left' as const }, questionIndex: 2, accepting: false };
    expect(toDisplayState(state)).toEqual({
      sessionId: null,
      phase: 'idle',
      resultColorId: null,
      previewColorId: null,
      phaseStartedAt: 1,
      phaseEndsAt: null,
      revision: 0,
    });
  });
});
