<script lang="ts">
import type { Snippet } from "svelte";
import { onMount } from "svelte";
import type { Keystone } from "../../shared/keystone.ts";
import {
	CORNER_LABELS,
	formatKeystone,
	IDENTITY_KEYSTONE,
	keystoneCorners,
	keystoneEnvName,
	keystoneTransform,
	moveCorner,
	parseKeystone,
	sameKeystone,
} from "../../shared/keystone.ts";

/**
 * 台形補正。プロジェクターで斜めから投影したときのゆがみを打ち消すよう、中身全体を四隅の位置合わせで射影変換する。
 * 補正の正本は会場サーバーの `.env`（`KEYSTONE_{パス}`）で、`/api/keystone` から受け取る。
 *
 * `K` で調整を始め、角をドラッグするか、`1`〜`4` で角を選んで矢印キーで1px（`Shift` で10px）ずつ動かす。
 * 調整した値は `.env` へ書き写す一行として表示し、書き写すまでの下書きとしてこのブラウザに残す。下書きは、
 * 調整を始めたときの `.env` の値が変わったら（書き写して再起動したら）捨てる。`R` で `.env` の値に戻し、
 * `Delete` で補正なしにし、`K` か `Esc` で調整を終える。
 */
let { path, children }: { path: string; children: Snippet } = $props();

/** 下書きを残すキー。 */
// svelte-ignore state_referenced_locally
const draftKey = `dpc-keystone:${path}`;
// svelte-ignore state_referenced_locally
const envName = keystoneEnvName(path);

let width = $state(1);
let height = $state(1);
/** `.env` の補正。受け取るまでは `null`。 */
let base = $state<Keystone | null>(null);
let keystone = $state<Keystone>(IDENTITY_KEYSTONE);
let editing = $state(false);
let selected = $state(0);
let copied = $state(false);
let envLine = $state<HTMLTextAreaElement>();
let dragging: { index: number; pointerId: number } | null = null;

const transform = $derived(keystoneTransform(keystone, width, height));
const corners = $derived(keystoneCorners(keystone, width, height));
const line = $derived(`${envName}=${formatKeystone(keystone)}`);
const pending = $derived(base !== null && !sameKeystone(keystone, base));

/** 下書き。調整を始めたときの `.env` の値（`base`）と、調整した値（`value`）。 */
function loadDraft(): { base: Keystone; value: Keystone } | null {
	try {
		const stored = JSON.parse(localStorage.getItem(draftKey) ?? "null") as {
			base?: unknown;
			value?: unknown;
		} | null;
		const draftBase = parseKeystone(stored?.base);
		const value = parseKeystone(stored?.value);
		return draftBase && value ? { base: draftBase, value } : null;
	} catch {
		return null;
	}
}

function writeDraft(next: Keystone, from: Keystone) {
	try {
		if (sameKeystone(next, from)) localStorage.removeItem(draftKey);
		else localStorage.setItem(draftKey, JSON.stringify({ base: from, value: next }));
	} catch {
		// 保存できないブラウザでも、このタブの中では補正を使う。
	}
}

onMount(async () => {
	let fromEnv = IDENTITY_KEYSTONE;
	try {
		const response = await fetch("/api/keystone", { cache: "no-store" });
		if (response.ok) fromEnv = parseKeystone((await response.json())?.[path]) ?? IDENTITY_KEYSTONE;
	} catch {
		// 受け取れなければ補正しない。
	}
	const draft = loadDraft();
	const keep = draft !== null && sameKeystone(draft.base, fromEnv);
	base = fromEnv;
	keystone = keep ? draft.value : fromEnv;
	if (!keep) writeDraft(fromEnv, fromEnv);
});

function save(next: Keystone) {
	if (!base) return;
	keystone = next;
	copied = false;
	writeDraft(next, base);
}

/** 角 `index` を画面上の点（画素）へ動かす。 */
function moveTo(index: number, x: number, y: number) {
	const origin = keystoneCorners(IDENTITY_KEYSTONE, width, height)[index];
	save(moveCorner(keystone, index, [(x - origin[0]) / width, (y - origin[1]) / height]));
}

/** `.env` へ書き写す一行をクリップボードへ写す。会場のLAN（http）では Clipboard API が使えないため、選択してコピーする。 */
async function copyLine() {
	try {
		if (navigator.clipboard) await navigator.clipboard.writeText(line);
		else {
			envLine?.select();
			document.execCommand("copy");
		}
		copied = true;
	} catch {
		envLine?.select();
	}
}

function onKey(event: KeyboardEvent) {
	if (event.ctrlKey || event.metaKey || event.altKey || !base) return;
	const key = event.key.toLowerCase();
	if (key === "k") {
		editing = !editing;
		return;
	}
	if (!editing) return;
	if (key === "escape") editing = false;
	else if (key === "r") save(base);
	else if (key === "delete" || key === "backspace") save(IDENTITY_KEYSTONE);
	else if (key === "c") void copyLine();
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
			<div class="help">
				<p>
					台形補正（{CORNER_LABELS[selected]}を選択中）<br>
					角をドラッグ ／ 1〜4で角を選び矢印で1px（Shiftで10px）<br>
					R: .envの値に戻す ／ Delete: 補正なし ／ C: 一行をコピー ／ K・Esc: 終了
				</p>
				<p class="status" data-testid="keystone-status">
					{pending ? "未反映。下の一行を会場サーバーの.envに書いて再起動する" : ".envの値と同じ"}
				</p>
				<textarea
					bind:this={envLine}
					readonly
					rows="2"
					spellcheck="false"
					data-testid="keystone-env"
					onfocus={(event) => event.currentTarget.select()}
				>{line}</textarea>
				<button type="button" class="copy" onclick={copyLine}>{copied ? "コピーしました" : "コピー"}</button>
			</div>
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
