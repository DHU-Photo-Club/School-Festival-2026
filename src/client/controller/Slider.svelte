<script lang="ts">
  import type { Question } from '../../shared/types.ts';

  export type SliderMode = 'unanswered' | 'active' | 'pending' | 'answered' | 'disabled';

  let {
    question,
    value,
    mode,
    onselect,
    oninteract,
  }: {
    question: Question;
    /** 選択中の位置（0〜4）。未回答は `null`。 */
    value: number | null;
    mode: SliderMode;
    onselect: (index: number) => void;
    oninteract: (interacting: boolean) => void;
  } = $props();

  /** つまみのタップ領域の半分（44 CSS px の半分、仕様書7.1節）。 */
  const HALF = 22;
  const STOPS = [0, 1, 2, 3, 4];

  let area = $state<HTMLDivElement>();
  let dragging = $state(false);

  const shown = $derived(value ?? 2);
  const position = (index: number) => `calc(${HALF}px + (100% - ${HALF * 2}px) * ${index / 4})`;

  const caption = $derived.by(() => {
    switch (mode) {
      case 'disabled':
        return '操作できません';
      case 'pending':
        return '送信しています';
      case 'unanswered':
        return '動かして選んでください';
      case 'answered':
        return `回答済み: ${question.stops[shown].caption}`;
      default:
        return question.stops[shown].caption;
    }
  });

  function nearest(clientX: number): number {
    if (!area) return shown;
    const rect = area.getBoundingClientRect();
    const ratio = (clientX - rect.left - HALF) / Math.max(1, rect.width - HALF * 2);
    return Math.min(4, Math.max(0, Math.round(ratio * 4)));
  }

  // トラックの任意位置のタップとつまみのドラッグの両方で最寄りの位置を選ぶ（仕様書7.1節）。
  function down(event: PointerEvent) {
    if (mode === 'disabled' || mode === 'pending') return;
    area?.setPointerCapture(event.pointerId);
    dragging = true;
    oninteract(true);
    onselect(nearest(event.clientX));
  }

  function move(event: PointerEvent) {
    if (!dragging) return;
    const index = nearest(event.clientX);
    if (index !== value) onselect(index);
  }

  function up(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    area?.releasePointerCapture(event.pointerId);
    oninteract(false);
  }
</script>

<div class="slider" data-mode={dragging ? 'dragging' : mode}>
  <div class="ends">
    <span>{question.leftLabel}</span>
    <span>{question.rightLabel}</span>
  </div>
  <div
    class="area"
    bind:this={area}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="presentation"
  >
    <input
      type="range"
      min="0"
      max="4"
      step="1"
      value={shown}
      disabled={mode === 'disabled' || mode === 'pending'}
      tabindex="-1"
      aria-label={question.prompt}
      aria-valuetext={value === null ? '未回答' : question.stops[value].caption}
    />
    {#each STOPS as index (index)}
      <span class="tick" class:current={value === index} style:left={position(index)}></span>
    {/each}
    <span class="thumb" style:left={position(shown)}></span>
  </div>
  <p class="caption" aria-live="polite">{caption}</p>
</div>

<style>
  .slider {
    width: 100%;
    max-width: 640px;
    min-width: 280px;
    display: grid;
    gap: 8px;
  }
  .area {
    position: relative;
    height: 64px;
    touch-action: none;
    cursor: pointer;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent;
    pointer-events: none;
    -webkit-appearance: none;
    appearance: none;
  }
  input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: #5a5754;
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 44px;
    height: 44px;
    margin-top: -20px;
    opacity: 0;
  }
  input::-moz-range-track {
    height: 4px;
    background: #5a5754;
  }
  input::-moz-range-thumb {
    width: 44px;
    height: 44px;
    opacity: 0;
  }
  .tick {
    position: absolute;
    top: 50%;
    width: 4px;
    height: 16px;
    border-radius: 2px;
    background: #8a8784;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .tick.current {
    width: 6px;
    height: 28px;
    background: var(--text);
  }
  .thumb {
    position: absolute;
    top: 50%;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: var(--text);
    border: 3px solid var(--text);
    pointer-events: none;
    transition:
      width 120ms,
      height 120ms;
  }
  /* 未回答: 中央に薄く、破線の枠。 */
  [data-mode='unanswered'] .thumb {
    background: transparent;
    border: 3px dashed #8a8784;
    opacity: 0.8;
  }
  /* 操作中: 大きく、太い実線の枠。 */
  [data-mode='dragging'] .thumb,
  [data-mode='active'] .thumb {
    width: 40px;
    height: 40px;
    border: 5px solid var(--idle);
    box-shadow: 0 0 0 3px var(--text);
  }
  /* 確定待ち: 点線の輪が回る。 */
  [data-mode='pending'] .thumb {
    background: transparent;
    border: 4px dotted var(--text);
    animation: turn 1.6s linear infinite;
  }
  /* 確定済み: 二重線。 */
  [data-mode='answered'] .thumb {
    width: 32px;
    height: 32px;
    border: 6px double var(--idle);
    box-shadow: 0 0 0 2px var(--text);
  }
  /* 無効: 枠なしの暗い円。 */
  [data-mode='disabled'] .thumb {
    background: var(--line);
    border-color: var(--line);
  }
  [data-mode='disabled'] .area {
    cursor: default;
  }
  @keyframes turn {
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-mode='pending'] .thumb {
      animation: none;
    }
    .thumb {
      transition: none;
    }
  }
  .ends {
    display: flex;
    justify-content: space-between;
    font-size: 18px;
  }
  .caption {
    margin: 0;
    min-height: 1.6em;
    text-align: center;
    font-size: 18px;
    color: var(--muted);
  }
  [data-mode='active'] .caption,
  [data-mode='dragging'] .caption,
  [data-mode='answered'] .caption {
    color: var(--text);
  }
</style>
