<script lang="ts">
import type { Snippet } from "svelte";
import type { Keystone } from "../../shared/keystone.ts";
import {
	CORNER_LABELS,
	IDENTITY_KEYSTONE,
	keystoneCorners,
	keystoneTransform,
	moveCorner,
	parseKeystone,
} from "../../shared/keystone.ts";

/**
 * 台形補正。プロジェクターで斜めから投影したときのゆがみを打ち消すよう、中身全体を四隅の位置合わせで射影変換する。
 * 補正はこのブラウザに `storageKey` ごとに残す（会場の端末とプロジェクターの組み合わせごとに決まるため、サーバーには送らない）。
 *
 * `K` で調整を始め、角をドラッグするか、`1`〜`4` で角を選んで矢印キーで1px（`Shift` で10px）ずつ動かす。
 * `R` で補正を消し、`K` か `Esc` で調整を終える。
 */
let { storageKey, children }: { storageKey: string; children: Snippet } = $props();

let width = $state(1);
let height = $state(1);
// svelte-ignore state_referenced_locally
let keystone = $state<Keystone>(load(storageKey));
let editing = $state(false);
let selected = $state(0);
let dragging: { index: number; pointerId: number } | null = null;

const transform = $derived(keystoneTransform(keystone, width, height));
const corners = $derived(keystoneCorners(keystone, width, height));

function load(key: string): Keystone {
	try {
		const stored = localStorage.getItem(key);
		return (stored && parseKeystone(JSON.parse(stored))) || IDENTITY_KEYSTONE;
	} catch {
		return IDENTITY_KEYSTONE;
	}
}

function save(next: Keystone) {
	keystone = next;
	try {
		if (next.every(([x, y]) => x === 0 && y === 0)) localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, JSON.stringify(next));
	} catch {
		// 保存できないブラウザでも、このタブの中では補正を使う。
	}
}

/** 角 `index` を画面上の点（画素）へ動かす。 */
function moveTo(index: number, x: number, y: number) {
	const base = keystoneCorners(IDENTITY_KEYSTONE, width, height)[index];
	save(moveCorner(keystone, index, [(x - base[0]) / width, (y - base[1]) / height]));
}

function onKey(event: KeyboardEvent) {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	const key = event.key.toLowerCase();
	if (key === "k") {
		editing = !editing;
		return;
	}
	if (!editing) return;
	if (key === "escape") editing = false;
	else if (key === "r") save(IDENTITY_KEYSTONE);
	else if (["1", "2", "3", "4"].includes(key)) selected = Number(key) - 1;
	else if (key === "tab") selected = (selected + (event.shiftKey ? 3 : 1)) % 4;
	else {
		const step = event.shiftKey ? 10 : 1;
		const delta = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key];
		if (!delta) return;
		const [x, y] = corners[selected];
		moveTo(selected, x + delta[0], y + delta[1]);
	}
	event.preventDefault();
}

function onPointerDown(event: PointerEvent, index: number) {
	selected = index;
	dragging = { index, pointerId: event.pointerId };
	(event.currentTarget as Element).setPointerCapture(event.pointerId);
	event.preventDefault();
}

function onPointerMove(event: PointerEvent) {
	if (!dragging || dragging.pointerId !== event.pointerId) return;
	moveTo(dragging.index, event.clientX, event.clientY);
}

function onPointerUp(event: PointerEvent) {
	if (dragging?.pointerId === event.pointerId) dragging = null;
}
</script>

<svelte:window bind:innerWidth={width} bind:innerHeight={height} onkeydown={onKey} />

<div class="keystone" data-keystone={transform === "none" ? "none" : "applied"}>
	<div class="surface" style:transform={transform === "none" ? null : transform}>
		{@render children()}
		{#if editing}
			<div class="grid" aria-hidden="true"></div>
		{/if}
	</div>
	{#if editing}
		<div class="editor" data-testid="keystone-editor">
			<svg viewBox="0 0 {width} {height}" aria-hidden="true">
				<polygon points={corners.map(([x, y]) => `${x},${y}`).join(" ")} />
			</svg>
			{#each corners as [x, y], index (index)}
				<button
					type="button"
					class="handle"
					class:selected={index === selected}
					style:left="{x}px"
					style:top="{y}px"
					aria-label="{CORNER_LABELS[index]}の角"
					data-corner={index}
					onpointerdown={(event) => onPointerDown(event, index)}
					onpointermove={onPointerMove}
					onpointerup={onPointerUp}
					onpointercancel={onPointerUp}
				>
					{index + 1}
				</button>
			{/each}
			<p class="help">
				台形補正（{CORNER_LABELS[selected]}を選択中）<br>
				角をドラッグ ／ 1〜4で角を選び矢印で1px（Shiftで10px）<br>
				R: 補正を消す ／ K・Esc: 終了
			</p>
		</div>
	{/if}
</div>

<style>
/* 補正で空いた四角形の外側は黒にする。 */
.keystone {
	position: fixed;
	inset: 0;
	overflow: hidden;
	background: #000000;
}
/*
 * 中身の基準になる面。transform を持つと、中の position: fixed の要素もこの面を基準にするので、
 * 中身全体がまとめてゆがむ。
 */
.surface {
	position: absolute;
	inset: 0;
	overflow: hidden;
	transform-origin: 0 0;
}
.grid {
	position: absolute;
	inset: 0;
	z-index: 1000;
	pointer-events: none;
	--line: rgb(255 255 255 / 0.45);
	background-image:
		linear-gradient(to right, var(--line) 1px, transparent 1px),
		linear-gradient(to bottom, var(--line) 1px, transparent 1px);
	background-size: 10% 10%;
	box-shadow: inset 0 0 0 2px #ffffff;
}
.editor {
	position: absolute;
	inset: 0;
	z-index: 1000;
	cursor: default;
}
svg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}
polygon {
	fill: none;
	stroke: #ffd400;
	stroke-width: 2;
}
.handle {
	position: absolute;
	width: 44px;
	height: 44px;
	margin: -22px 0 0 -22px;
	border: 2px solid #ffd400;
	border-radius: 50%;
	background: rgb(0 0 0 / 0.6);
	color: #ffd400;
	font:
		600 16px / 1 system-ui,
		sans-serif;
	cursor: grab;
	touch-action: none;
}
.handle.selected {
	background: #ffd400;
	color: #000000;
}
.help {
	position: absolute;
	top: 50%;
	left: 50%;
	margin: 0;
	padding: 12px 16px;
	transform: translate(-50%, -50%);
	border-radius: 8px;
	background: rgb(0 0 0 / 0.75);
	color: #ffffff;
	font:
		14px / 1.6 system-ui,
		sans-serif;
	text-align: center;
	pointer-events: none;
}
</style>
