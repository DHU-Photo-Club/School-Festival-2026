<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { RESULT_COLORS } from "../../data/colors.ts";
import { EXHIBIT } from "../../data/exhibit.ts";
import { QUESTIONS } from "../../data/questions.ts";
import type { Command } from "../../shared/machine.ts";
import { easeOutCubic } from "../../shared/motion.ts";
import { resultUrl } from "../../shared/result-url.ts";
import type { ColorId, ExhibitState } from "../../shared/types.ts";
import { SLIDER_STOP_IDS } from "../../shared/types.ts";
import Pairing from "../common/Pairing.svelte";
import type { QrModel } from "../lib/qr.ts";
import { createQrModel, generateQrWithRetry } from "../lib/qr.ts";
import type { ConnectionStatus } from "../lib/realtime.ts";
import { RealtimeClient } from "../lib/realtime.ts";
import type { DeviceAuthStatus } from "../lib/session.ts";
import { fetchDeviceSession, watchReducedMotion } from "../lib/session.ts";
import QrCode from "./QrCode.svelte";
import ShardField from "./ShardField.svelte";
import type { SliderMode } from "./Slider.svelte";
import Slider from "./Slider.svelte";

/** 結果の色面が広がる時間（docs/visual-language.md 4.2節）。 */
const RESULT_GROW_MS = 1_400;
const NOTICE_MS = 4_000;

let auth = $state<DeviceAuthStatus>("checking");
let status = $state<ConnectionStatus>("connecting");
let exhibit = $state<ExhibitState | null>(null);
let pending = $state<Command["name"] | null>(null);
let stalled = $state(false);
let notice = $state<string | null>(null);
let reducedMotion = $state(false);
let now = $state(0);
let draft = $state<number | null>(null);
let interacting = $state(false);
let qr = $state<{ sessionId: string; url: string; model: QrModel | null; failed: boolean } | null>(null);

let client: RealtimeClient | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let questionKey = "";
let stopWatching = () => {};

const online = $derived(status === "open" && !stalled);
const question = $derived(
	exhibit?.phase === "question" && exhibit.questionIndex !== null ? QUESTIONS[exhibit.questionIndex] : null,
);
const answeredIndex = $derived.by(() => {
	if (!question || !exhibit) return null;
	const stopId = exhibit.answers[question.id];
	return stopId ? SLIDER_STOP_IDS.indexOf(stopId) : null;
});
const color = $derived(RESULT_COLORS.find((candidate) => candidate.id === exhibit?.resultColorId) ?? null);

function onState(next: ExhibitState) {
	exhibit = next;
	const key = `${next.sessionId}:${next.phase}:${next.questionIndex}`;
	if (key !== questionKey) {
		questionKey = key;
		// 新しい質問は未回答から、戻った質問は既存回答の位置から始める（仕様書5章、6.1節）。
		const q = next.phase === "question" && next.questionIndex !== null ? QUESTIONS[next.questionIndex] : null;
		const stopId = q ? next.answers[q.id] : undefined;
		draft = stopId ? SLIDER_STOP_IDS.indexOf(stopId) : null;
		interacting = false;
	}
	if (next.phase === "result" && next.sessionId && next.resultColorId && qr?.sessionId !== next.sessionId) {
		void prepareQr(next.sessionId, next.resultColorId);
	}
	if (next.phase !== "result") qr = null;
}

function showNotice(message: string) {
	notice = message;
	if (noticeTimer) clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => (notice = null), NOTICE_MS);
}

async function send(command: Command) {
	if (!client || !exhibit || pending || !online) return;
	// 「次へ」などのタップ直後に確定待ちを表示し、画面遷移は ack 受信後に行う（仕様書8.8節）。
	pending = command.name;
	const reply = await client.request({ type: "command", expectedRevision: exhibit.revision, command });
	pending = null;
	if (reply.type === "error") showNotice(reply.message);
}

function next() {
	if (!question || draft === null) return;
	void send({ name: "answer", questionId: question.id, stopId: SLIDER_STOP_IDS[draft] });
}

/** `result` へ入ったときにQRコードを生成する。失敗時は一度だけ再試行する（仕様書10.4節）。 */
async function prepareQr(sessionId: string, colorId: ColorId) {
	const fallbackUrl = `${__PUBLIC_ORIGIN__}/result/${encodeURIComponent(colorId)}`;
	qr = { sessionId, url: fallbackUrl, model: null, failed: false };
	let url = fallbackUrl;
	const outcome = await generateQrWithRetry(colorId, (id) => {
		url = resultUrl(__PUBLIC_ORIGIN__, id);
		return createQrModel(url);
	});
	if (qr?.sessionId !== sessionId) return;
	if (outcome.ok) {
		qr = { sessionId, url, model: outcome.model, failed: false };
		return;
	}
	console.error("QRコードを生成できませんでした", outcome.error instanceof Error ? outcome.error.name : "Error");
	qr = { sessionId, url, model: null, failed: true };
	void client?.request({
		type: "diagnostic",
		name: "qrGenerationFailed",
		sessionId,
		colorId,
		occurredAt: client.serverNow(),
	});
}

onMount(async () => {
	stopWatching = watchReducedMotion((reduced) => (reducedMotion = reduced));
	const session = await fetchDeviceSession().catch(() => null);
	if (!session) {
		auth = "unpaired";
		return;
	}
	if (session.role !== "controller") {
		// 役割が一致しない端末に `mismatch` 状態を表示せず、該当する画面へ移動させる。
		location.replace(`/${session.role}/${encodeURIComponent(session.screenId ?? "")}`);
		return;
	}
	auth = "ok";
	client = new RealtimeClient({
		role: "controller",
		onState: (state) => onState(state as ExhibitState),
		onStatus: (next) => {
			status = next;
			if (next === "unauthenticated") auth = "unpaired";
			// 再接続時は welcome のサーバー状態を正本とし、確定待ちを破棄する（仕様書8.8節）。
			if (next !== "open") interacting = false;
		},
		onStalled: (value) => (stalled = value),
		checkAuth: async () => (await fetchDeviceSession()) !== null,
	});
	client.start();
});

onDestroy(() => {
	client?.stop();
	stopWatching();
	if (noticeTimer) clearTimeout(noticeTimer);
});

const sliderMode = $derived.by((): SliderMode => {
	if (!online) return "disabled";
	if (pending === "answer") return "pending";
	if (draft === null) return "unanswered";
	if (!interacting && draft === answeredIndex) return "answered";
	return "active";
});

/** `result` の色面が広がる間だけ、補正済みサーバー時刻を毎フレーム更新する。 */
$effect(() => {
	if (exhibit?.phase !== "result" || reducedMotion || !client) return;
	const startedAt = exhibit.phaseStartedAt;
	const sync = client;
	let frame = 0;
	const tick = () => {
		const t = sync.serverNow();
		now = t;
		if (t - startedAt < RESULT_GROW_MS) frame = requestAnimationFrame(tick);
	};
	tick();
	return () => cancelAnimationFrame(frame);
});

const discScale = $derived(
	exhibit?.phase === "result" && !reducedMotion
		? 0.2 + 0.8 * easeOutCubic((now - exhibit.phaseStartedAt) / RESULT_GROW_MS)
		: 1,
);
</script>

{#if auth === "unpaired"}
	<Pairing />
{:else if status === "controllerInUse"}
	<main class="screen center stack">
		<p class="lead">別の端末で診断を操作しています。</p>
		<p class="muted">スタッフにお声がけください。</p>
	</main>
{:else if auth === "checking" || !exhibit}
	<main class="screen center"><p class="muted">接続しています</p></main>
{:else}
	<main
		class="screen"
		data-phase={exhibit.phase}
		style:background={exhibit.phase === "result" && color ? color.backgroundColor : undefined}
		style:color={exhibit.phase === "result" && color ? color.foregroundColor : undefined}
	>
		{#if exhibit.phase === "idle"}
			<ShardField still={reducedMotion || !exhibit.accepting} dim={!exhibit.accepting} />
		{/if}
		{#if exhibit.phase === "idle" && !exhibit.accepting}
			<section class="center stack top">
				<h1>{EXHIBIT.title}</h1>
				<p class="lead">ただいま受付を停止しています</p>
				<p class="muted">しばらくお待ちください</p>
			</section>
		{:else if exhibit.phase === "idle"}
			<section class="center stack top">
				<h1>{EXHIBIT.title}</h1>
				<p class="muted">いくつかの質問に答えると、今のあなたを表す色がひとつ選ばれます。</p>
				<button
					type="button"
					class="primary-button"
					disabled={!online || pending !== null}
					onclick={() => send({ name: "start" })}
				>
					{pending === "start" ? "準備しています" : "診断をはじめる"}
				</button>
			</section>
		{:else if exhibit.phase === "intro"}
			<section class="center stack">
				<h1>はじめる前に</h1>
				<div class="intro">
					<p>所要時間はおよそ2分です。7つの質問に、直感で答えてください。</p>
					<p>
						正解や得点はありません。この診断は展示作品として楽しむためのもので、回答から選ばれた「今のあなたの色」をお届けします。
					</p>
					<p class="muted">名前などの個人情報は入力しません。</p>
				</div>
				<button
					type="button"
					class="primary-button"
					disabled={!online || pending !== null}
					onclick={() => send({ name: "continue" })}
				>
					{pending === "continue" ? "準備しています" : "進む"}
				</button>
			</section>
		{:else if exhibit.phase === "question" && question && exhibit.questionIndex !== null}
			<section class="question">
				<header>
					<p class="progress">{exhibit.questionIndex + 1} / {QUESTIONS.length}</p>
				</header>
				<div class="body">
					<h1 class="prompt">{question.prompt}</h1>
					{#key question.id}
						<Slider
							{question}
							value={draft}
							mode={sliderMode}
							onselect={(index) => (draft = index)}
							oninteract={(value) => (interacting = value)}
						/>
					{/key}
				</div>
				<footer>
					{#if exhibit.questionIndex > 0}
						<button
							type="button"
							class="secondary-button"
							disabled={!online || pending !== null}
							onclick={() => send({ name: "back" })}
						>
							戻る
						</button>
					{:else}
						<span></span>
					{/if}
					<button
						type="button"
						class="primary-button"
						disabled={!online || pending !== null || draft === null}
						onclick={next}
					>
						{pending === "answer" ? "送信しています" : "次へ"}
					</button>
				</footer>
			</section>
		{:else if exhibit.phase === "judging"}
			<section class="center stack">
				<p class="lead">あなたの色を選んでいます</p>
			</section>
		{:else if exhibit.phase === "result" && color}
			<section class="result">
				<div class="identity">
					<div class="disc-box">
						<div class="disc" style:background={color.baseColor} style:transform="scale({discScale})"></div>
					</div>
					<p class="caption">あなたの色は</p>
					<h1 class="color-name">{color.name}</h1>
					<p class="message">{color.message}</p>
				</div>
				<div class="takeaway">
					{#if qr && !qr.failed && qr.model}
						<QrCode model={qr.model} label="結果ページのQRコード" />
						<p class="url">{qr.url}</p>
						<p class="hint">カメラで読み取ると、結果をあなたの端末で開けます</p>
					{:else if qr?.failed}
						<div class="qr-fallback">
							<p>QRコードを表示できませんでした</p>
							<p class="url">結果URL: {qr.url}</p>
						</div>
					{/if}
					<button
						type="button"
						class="primary-button return"
						style:background={color.foregroundColor}
						style:color={color.backgroundColor}
						disabled={!online || pending !== null}
						onclick={() => send({ name: "returnToIdle" })}
					>
						最初に戻る
					</button>
				</div>
			</section>
		{/if}

		{#if notice}
			<p class="notice" role="status">{notice}</p>
		{/if}

		{#if status === "closed"}
			<div class="overlay">
				<p>この画面は使用できません。</p>
				<p class="muted">スタッフにお声がけください。</p>
			</div>
		{:else if stalled}
			<div class="overlay">
				<p>操作を受け付けられませんでした。</p>
				<p class="muted">スタッフにお声がけください。</p>
			</div>
		{:else if status !== "open"}
			<div class="overlay">
				<p>再接続しています</p>
				<p class="muted">しばらくお待ちください</p>
			</div>
		{/if}
	</main>
{/if}

<style>
.screen {
	position: relative;
	min-height: 100dvh;
	padding: max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom));
	display: grid;
	overflow-x: hidden;
}
.center {
	display: grid;
	place-content: center;
	grid-template-columns: minmax(0, 1fr);
	justify-items: center;
	text-align: center;
}
.stack {
	gap: 24px;
}
.top {
	position: relative;
	gap: 20px;
	width: 100%;
}
.top .muted {
	font-size: 15px;
}
h1 {
	margin: 0;
	font-size: clamp(26px, 4.5vmin, 40px);
	font-weight: 600;
	letter-spacing: 0.06em;
}
p {
	margin: 0;
	line-height: 1.7;
}
.lead {
	font-size: 22px;
}
.muted {
	color: var(--muted);
}
.intro {
	display: grid;
	gap: 12px;
	width: 100%;
	font-size: 18px;
}
.question {
	display: grid;
	grid-template-rows: auto 1fr auto;
	gap: 32px;
	justify-items: center;
	align-items: center;
	width: 100%;
	margin: 0 auto;
}
.question header {
	justify-self: stretch;
}
.progress {
	font-size: 20px;
	letter-spacing: 0.1em;
}
.question .body {
	display: grid;
	gap: 56px;
	justify-items: center;
	width: 100%;
}
.prompt {
	text-align: center;
	font-size: clamp(26px, 5vmin, 40px);
}
.question footer {
	display: flex;
	justify-content: space-between;
	width: 100%;
	gap: 16px;
}
.result {
	display: grid;
	gap: 24px;
	align-content: center;
	justify-items: center;
	text-align: center;
}
.identity,
.takeaway {
	display: grid;
	gap: 12px;
	justify-items: center;
}
.disc-box {
	width: min(30vmin, 240px);
	height: min(30vmin, 240px);
}
.disc {
	width: 100%;
	height: 100%;
	border-radius: 50%;
}
.caption {
	font-size: 16px;
	opacity: 0.8;
}
.color-name {
	font-size: clamp(32px, 6vmin, 48px);
}
.message {
	font-size: 18px;
}
.url {
	font-size: 14px;
	word-break: break-all;
	user-select: text;
	-webkit-user-select: text;
}
.hint {
	font-size: 14px;
	opacity: 0.8;
}
.qr-fallback {
	display: grid;
	gap: 8px;
}
.return {
	margin-top: 12px;
}
@media (orientation: landscape) and (min-width: 900px) {
	.result {
		grid-template-columns: 1fr 1fr;
		align-items: center;
		width: 100%;
		margin: 0 auto;
	}
}
.notice {
	position: fixed;
	left: 50%;
	bottom: max(24px, env(safe-area-inset-bottom));
	transform: translateX(-50%);
	padding: 12px 20px;
	border-radius: 12px;
	background: #1f1e1d;
	color: var(--text);
}
.overlay {
	position: fixed;
	inset: 0;
	display: grid;
	place-content: center;
	gap: 8px;
	text-align: center;
	background: rgba(11, 11, 11, 0.94);
	color: var(--text);
	font-size: 20px;
}
</style>
