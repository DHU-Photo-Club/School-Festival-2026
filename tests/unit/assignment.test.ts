import { describe, expect, it } from 'vitest';
import { PHOTOS } from '../../src/data/photos.ts';
import { idlePhotoFor, idlePlaylist, resultPhotoFor, resultPhotos } from '../../src/shared/assignment.ts';
import { COLOR_IDS } from '../../src/shared/types.ts';
import type { Photo } from '../../src/shared/types.ts';

/** 三画面構成（仕様書9.5節）。 */
const DISPLAY_ORDERS = [0, 1, 2];

const photo = (id: string, patch: Partial<Photo> = {}): Photo => ({
  id,
  resultColorId: 'red',
  resultOrder: 0,
  idleEnabled: true,
  idleOrder: 0,
  shareAllowed: false,
  creditName: 'x',
  ...patch,
});

describe('待機プレイリスト', () => {
  it('idleEnabled の写真を idleOrder 昇順、同値は写真ID昇順で並べる', () => {
    const list = idlePlaylist([
      photo('c', { idleOrder: 1 }),
      photo('b', { idleOrder: 0 }),
      photo('a', { idleOrder: 1 }),
      photo('z', { idleEnabled: false }),
    ]);
    expect(list.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });

  it('(cycleIndex + displayOrder) mod P 番目を表示し、同時刻に同じ写真を複数画面へ表示しない', () => {
    const playlist = idlePlaylist(PHOTOS);
    for (let cycle = 0; cycle < playlist.length * 2; cycle += 1) {
      const shown = DISPLAY_ORDERS.map((order) => idlePhotoFor(playlist, cycle, order)?.id);
      expect(new Set(shown).size).toBe(DISPLAY_ORDERS.length);
      expect(shown[0]).toBe(playlist[cycle % playlist.length].id);
    }
  });

  it('displayOrder >= P の画面は写真の代わりに展示タイトルを表示する', () => {
    const playlist = [photo('a'), photo('b')];
    expect(idlePhotoFor(playlist, 5, 1)?.id).toBe('a');
    expect(idlePhotoFor(playlist, 5, 2)).toBeNull();
    expect(idlePhotoFor([], 0, 0)).toBeNull();
  });
});

describe('結果写真の割り当て', () => {
  it('resultOrder 昇順、同値は写真ID昇順で並べ、displayOrder と同じ番号を割り当てる', () => {
    const photos = [photo('r2', { resultOrder: 1 }), photo('r1b', { resultOrder: 0 }), photo('r1a', { resultOrder: 0 })];
    expect(resultPhotos(photos, 'red').map((entry) => entry.id)).toEqual(['r1a', 'r1b', 'r2']);
    expect(resultPhotoFor(photos, 'red', 2)?.id).toBe('r2');
  });

  it('写真が足りない画面は複製せずタイポグラフィ表示（null）にする。P が0なら全画面', () => {
    const photos = [photo('r1')];
    expect(resultPhotoFor(photos, 'red', 1)).toBeNull();
    expect(resultPhotoFor(photos, 'blue', 0)).toBeNull();
  });

  it('仮データでは全色で画面ごとに異なる写真が割り当たる', () => {
    for (const colorId of COLOR_IDS) {
      const shown = DISPLAY_ORDERS.map((order) => resultPhotoFor(PHOTOS, colorId, order)?.id ?? null);
      const photos = shown.filter((id) => id !== null);
      expect(new Set(photos).size).toBe(photos.length);
    }
  });
});
