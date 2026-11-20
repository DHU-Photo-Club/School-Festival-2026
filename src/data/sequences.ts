import type { Sequence } from "../shared/types.ts";

/**
 * 時間経過で自動で進む、iPadと展示ディスプレイの連動演出。`before` の段階へ入る直前に `durationMs` の間再生する。
 * `before` ごとに一つまで定義できる。見た目は `src/client/sequences/<id>/Controller.svelte`（iPad）と
 * `src/client/sequences/<id>/Display.svelte`（展示ディスプレイ）で書く。
 *
 * 仮データ: 演出の内容が決まる前の値。
 */
export const SEQUENCES: readonly Sequence[] = [{ id: "opening", before: "intro", durationMs: 3_600 }];
