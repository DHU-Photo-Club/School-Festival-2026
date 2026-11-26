<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { QUESTIONS } from "../../data/questions.ts";
import { SOUND_CUES } from "../../data/sound.ts";
import type { AudioStatus } from "../../shared/protocol.ts";
import type { SoundCue } from "../../shared/sound.ts";
import { soundCues } from "../../shared/sound.ts";
import type { SoundState } from "../../shared/types.ts";
import type { ConnectionStatus } from "../lib/realtime.ts";
import { RealtimeClient } from "../lib/realtime.ts";
import type { Bus } from "./engine.ts";
import { BUSES, SoundEngine } from "./engine.ts";

const BUS_LABELS: Record<Bus, string> = {
	master: "全体",
	bgm: "BGM",
	glass: "ガラス音",
	narration: "ナレーション",
	effects: "回答SE・完了SE",
};
const AUDIO_LABELS: Record<AudioStatus, string> = {
	blocked: "音が止められています。画面のどこかをクリックしてください",
	loading: "音源を読み込んでいます",
	playing: "再生中",
	degraded: "再生中（読み込めなかった音源があります）",
};
const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
	connecting: "接続しています",
	open: "接続中",
	reconnecting: "再接続しています",
};
const PHASE_LABELS = {
	idle: "待機",
	sequence: "演出",
	intro: "導入",
	question: "質問",
	judging: "判定",
	result: "結果",
} as const;
/** 系統ごとの音量の調整を、このブラウザに残すキー。会場で決めた音量を再読み込みで失わないようにする。 */
const VOLUME_KEY = "dpc-sound-volumes";
const QUESTION_IDS = QUESTIONS.map((question) => question.id);

let engine: SoundEngine | null = null;
let client: RealtimeClient | null = null;
let previous: SoundState | null = null;
let audio = $state<AudioStatus>("loading");
let connection = $state<ConnectionStatus>("connecting");
let current = $state<SoundState | null>(null);
let failures = $state<readonly string[]>([]);
let volumes = $state<Record<Bus, number>>(loadVolumes());
let halted = $state(false);

function loadVolumes(): Record<Bus, number> {
	const defaults = Object.fromEntries(BUSES.map((bus) => [bus, 1])) as Record<Bus, number>;
	try {
		const stored = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "{}") as Partial<Record<Bus, unknown>>;
		for (const bus of BUSES) {
			const value = stored[bus];
			if (typeof value === "number" && value >= 0 && value <= 1) defaults[bus] = value;
		}
	} catch {
		// 保存できない環境では、毎回設定データの音量から始める。
	}
	return defaults;
}

function setVolume(bus: Bus, value: number): void {
	volumes[bus] = value;
	engine?.setVolume(bus, value);
	try {
		localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
	} catch {
		// 保存できなくても、この画面を開いている間は効く。
	}
}

function onState(state: SoundState): void {
	for (const cue of soundCues(previous, state, QUESTION_IDS, SOUND_CUES)) engine?.cue(cue);
	previous = state;
	current = state;
}

function resume(): void {
	if (engine && engine.context.state !== "running") void engine.resume();
}

function toggleHalt(): void {
	if (!engine) return;
	if (halted) {
		void engine.resumePlayback();
	} else {
		engine.halt();
	}
	halted = engine.isHalted;
}

function test(cue: SoundCue): void {
	engine?.cue(cue);
}

onMount(() => {
	engine = new SoundEngine((status) => {
		audio = status;
		failures = [...(engine?.failures ?? [])];
		client?.reportAudio(status);
	});
	for (const bus of BUSES) engine.setVolume(bus, volumes[bus]);
	client = new RealtimeClient({
		role: "sound",
		onState: (state) => onState(state as SoundState),
		onStatus: (status) => (connection = status),
	});
	client.start();
	client.reportAudio(engine.status);
	void engine.load();
});

onDestroy(() => {
	client?.stop();
	engine?.dispose();
});

const progress = $derived.by(() => {
	if (!current) return "";
	if (current.phase === "question" && current.questionIndex !== null) {
		return `${PHASE_LABELS.question} ${current.questionIndex + 1} / ${QUESTIONS.length}`;
	}
	return PHASE_LABELS[current.phase];
});
</script>

<svelte:window onpointerdown={resume} onkeydown={resume} />

<main class="sound" data-audio={audio}>
	<h1>サウンド</h1>
	<p class="lead">
		会場のスピーカーにつないだPCで、このページを一つだけ開いておきます。BGMとガラス音は開いている間ずっと鳴り、
		ナレーションと効果音は展示の進行に合わせて鳴ります。
	</p>

	{#if audio === "blocked"}
		<button class="primary-button start" type="button" onclick={resume}>音を出す</button>
	{/if}

	<button class="halt" type="button" data-halted={halted} onclick={toggleHalt}>
		{halted ? "音を再開する" : "すべての音を止める"}
	</button>
	{#if halted}
		<p class="note" data-testid="halt-note">
			止めている間は、BGM、ガラス音、ナレーション、効果音のすべてが鳴りません。展示の進行の音も鳴らしません。
		</p>
	{/if}

	<dl class="status">
		<dt>音</dt>
		<dd data-testid="audio-status">{AUDIO_LABELS[audio]}</dd>
		<dt>接続</dt>
		<dd>{CONNECTION_LABELS[connection]}</dd>
		<dt>展示</dt>
		<dd data-testid="sound-phase">{progress}</dd>
	</dl>

	{#if failures.length > 0}
		<section class="failures" aria-labelledby="failures-title">
			<h2 id="failures-title">読み込めなかった音源</h2>
			<ul>
				{#each failures as path (path)}
					<li>{path}</li>
				{/each}
			</ul>
			<p>
				<code>pnpm export-sounds</code>
				で書き出してから <code>pnpm build</code> し直し、このページを再読み込みしてください。
			</p>
		</section>
	{/if}

	<section aria-labelledby="volume-title">
		<h2 id="volume-title">音量</h2>
		<p class="note">設定データの音量に掛ける倍率です。このブラウザに保存します。</p>
		<div class="volumes">
			{#each BUSES as bus (bus)}
				<label>
					<span>{BUS_LABELS[bus]}</span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={volumes[bus]}
						oninput={(event) => setVolume(bus, Number(event.currentTarget.value))}
					>
					<output>{Math.round(volumes[bus] * 100)}%</output>
				</label>
			{/each}
		</div>
	</section>

	<section aria-labelledby="test-title">
		<h2 id="test-title">試聴</h2>
		<div class="tests">
			<button type="button" onclick={() => test({ kind: "answer", number: 1 })}>回答SE Q1</button>
			<button type="button" onclick={() => test({ kind: "answer", number: 6 })}>回答SE Q6</button>
			<button type="button" onclick={() => test({ kind: "complete" })}>完了SE</button>
			<button type="button" onclick={() => test({ kind: "narration", numbers: [1], scene: "welcome" })}>
				ナレーション 1
			</button>
			<button type="button" onclick={() => test({ kind: "stopNarration" })}>ナレーションを止める</button>
		</div>
	</section>
</main>

<style>
.sound {
	display: grid;
	gap: 24px;
	align-content: start;
	max-width: 720px;
	min-height: 100%;
	margin: 0 auto;
	padding: 32px 16px;
}

h1,
h2,
p {
	margin: 0;
}

h1 {
	font-size: 1.5rem;
}

h2 {
	font-size: 1rem;
	margin-bottom: 8px;
}

.lead,
.note {
	color: var(--muted);
	line-height: 1.6;
}

.note {
	font-size: 0.875rem;
	margin-bottom: 12px;
}

.start {
	justify-self: start;
}

.halt {
	justify-self: start;
	padding: 10px 16px;
	border: 1px solid #b3261e;
	border-radius: 6px;
	background: transparent;
	color: #b3261e;
	font-weight: 600;
	cursor: pointer;
}

.halt[data-halted="true"] {
	background: #b3261e;
	color: #fff;
}

.status {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 6px 16px;
	margin: 0;
}

.status dt {
	color: var(--muted);
}

.status dd {
	margin: 0;
}

[data-audio="blocked"] [data-testid="audio-status"],
.failures {
	color: #b3261e;
}

.failures ul {
	margin: 0 0 8px;
	padding-left: 1.25em;
	font-family: ui-monospace, monospace;
	font-size: 0.875rem;
}

.volumes {
	display: grid;
	gap: 12px;
}

.volumes label {
	display: grid;
	grid-template-columns: 9em minmax(0, 1fr) 3.5em;
	align-items: center;
	gap: 12px;
}

.volumes output {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.tests {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.tests button {
	padding: 8px 12px;
	border: 1px solid var(--line);
	border-radius: 6px;
	background: transparent;
	color: inherit;
	cursor: pointer;
}
</style>
