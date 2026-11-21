<script lang="ts">
import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
import { onDestroy, onMount } from "svelte";
import { RESULT_COLORS } from "../../data/colors.ts";
import { EXHIBIT } from "../../data/exhibit.ts";
import { QUESTIONS } from "../../data/questions.ts";
import { SEQUENCES } from "../../data/sequences.ts";
import { isMapPoint, isValidAnswer, sameAnswer } from "../../shared/answer.ts";
import type { Command } from "../../shared/machine.ts";
import { easeOutCubic } from "../../shared/motion.ts";
import { NICKNAME_MAX_LENGTH, normalizeNickname } from "../../shared/nickname.ts";
import { resultUrl } from "../../shared/result-url.ts";
import { findSequence, sequenceDuration, sequenceTime } from "../../shared/sequence.ts";
import type { Answer, ExhibitState } from "../../shared/types.ts";
import { createQrModel } from "../lib/qr.ts";
import type { ConnectionStatus } from "../lib/realtime.ts";
import { RealtimeClient } from "../lib/realtime.ts";
import { watchReducedMotion } from "../lib/reduced-motion.ts";
import { controllerSequence } from "../sequences/controllers.ts";
import ChoiceList from "./ChoiceList.svelte";
import type { InputMode } from "./input-mode.ts";
import MapPad from "./MapPad.svelte";
import ProgressBar from "./ProgressBar.svelte";
import QrCode from "./QrCode.svelte";
import Slider from "./Slider.svelte";

/** 結果の色面が広がる時間（docs/visual-language.md 4.2節）。 */
const RESULT_GROW_MS = 1_400;

let status = $state<ConnectionStatus>("connecting");
let exhibit = $state<ExhibitState | null>(null);
/** 送信してからサーバーの `state` が届くまでのコマンド。その間は操作を無効にする。 */
let pending = $state<Command["name"] | null>(null);
let reducedMotion = $state(false);
let now = $state(0);
/** 確定前の回答。サーバーへは「次へ」で送る。 */
let draft = $state<Answer | null>(null);
/** スライダーと2Dマップを指で動かしている間は `true`。 */
let interacting = $state(false);
/** `intro` で入力中のニックネーム。 */
let nicknameDraft = $state("");
let nicknameInput = $state<HTMLInputElement | null>(null);
/** 日本語入力の変換中なら `true`。 */
let composing = false;

let client: RealtimeClient | null = null;
let questionKey = "";
let stopWatching = () => {};

const online = $derived(status === "open");
const question = $derived(
	exhibit?.phase === "question" && exhibit.questionIndex !== null ? QUESTIONS[exhibit.questionIndex] : null,
);
/** サーバーが受理済みの回答。前の質問へ戻ったときに使う。 */
const answered = $derived(question && exhibit ? (exhibit.answers[question.id] ?? null) : null);
/** 「次へ」で送れる回答がそろっているか。複数選択は選択数が下限に届くまで送れない。 */
const canSubmit = $derived(question !== null && isValidAnswer(question, draft));
const color = $derived(RESULT_COLORS.find((candidate) => candidate.id === exhibit?.resultColorId) ?? null);
const sequence = $derived(exhibit?.phase === "sequence" ? findSequence(SEQUENCES, exhibit.sequenceId) : null);
const SequenceView = $derived(sequence ? controllerSequence(sequence.id) : null);
const sequenceMs = $derived(sequence && exhibit ? sequenceDuration(sequence, exhibit) : 0);
const nickname = $derived(normalizeNickname(nicknameDraft));
/** 最大文字数を超えているか。`maxlength` はUTF-16の単位で数えて絵文字を2文字とするため使わない。 */
const nicknameTooLong = $derived(Array.from(nicknameDraft.trim()).length > NICKNAME_MAX_LENGTH);
/** 進捗バーの区画数。`intro` と各質問に一区画ずつ割り当てる。 */
const progressTotal = 1 + QUESTIONS.length;

function onState(next: ExhibitState) {
	exhibit = next;
	pending = null;
	const key = `${next.sessionId}:${next.phase}:${next.questionIndex}`;
	if (key !== questionKey) {
		questionKey = key;
		// 新しい質問は未回答から、戻った質問は既存回答から始める（仕様書5章、6.1節）。
		const q = next.phase === "question" && next.questionIndex !== null ? QUESTIONS[next.questionIndex] : null;
		draft = q ? (next.answers[q.id] ?? null) : null;
		interacting = false;
		// 新しいセッションの `intro` は空欄から始める。
		if (next.phase === "intro") nicknameDraft = "";
	}
}

function send(command: Command) {
	if (!client || !exhibit || pending || !online) return;
	// タップ直後に確定待ちを表示し、画面遷移はサーバーの state を受け取ってから行う。
	pending = command.name;
	if (!client.send(command)) pending = null;
}

/**
 * 送信できない入力（空、または長すぎる）では入力欄へフォーカスを戻す。
 * ボタンを無効にすると、押しても何も起きないように見えるため、ボタンは押せるままにする。
 */
function submitNickname(event: SubmitEvent) {
	event.preventDefault();
	if (composing) return;
	if (nickname === null) {
		nicknameInput?.focus();
		return;
	}
	send({ name: "continue", nickname });
}

/**
 * 日本語入力の変換確定に使うEnterでは送信しない。Safariは確定時の keydown で
 * `isComposing` を `false`、`keyCode` を229にする。
 */
function onNicknameKeydown(event: KeyboardEvent) {
	if (event.key === "Enter" && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault();
}

function next() {
	if (!question || !isValidAnswer(question, draft)) return;
	send({ name: "answer", questionId: question.id, answer: draft });
}

/** 結果ページのURLとQRコード。生成できなければQRコードの代わりにURLだけを表示する。 */
const qr = $derived.by(() => {
	if (exhibit?.phase !== "result" || !exhibit.resultColorId) return null;
	const url = `${__PUBLIC_ORIGIN__}/result/${encodeURIComponent(exhibit.resultColorId)}`;
	try {
		return { url, model: createQrModel(resultUrl(__PUBLIC_ORIGIN__, exhibit.resultColorId)) };
	} catch (error) {
		console.error("QRコードを生成できませんでした", error instanceof Error ? error.name : "Error");
		return { url, model: null };
	}
});

onMount(() => {
	stopWatching = watchReducedMotion((reduced) => (reducedMotion = reduced));
	client = new RealtimeClient({
		role: "controller",
		onState: (state) => onState(state as ExhibitState),
		onStatus: (next) => {
			status = next;
			if (next !== "open") {
				// 再接続後はサーバーの状態を正とし、確定待ちと操作中の表示を解除する。
				pending = null;
				interacting = false;
			}
		},
	});
	client.start();
});

onDestroy(() => {
	client?.stop();
	stopWatching();
});

const inputMode = $derived.by((): InputMode => {
	if (!online) return "disabled";
	if (pending === "answer") return "pending";
	if (draft === null || (Array.isArray(draft) && draft.length === 0)) return "unanswered";
	if (!interacting && sameAnswer(draft, answered)) return "answered";
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

/** `sequence` の間は、シーケンスのコンポーネントへ渡す補正済みサーバー時刻を毎フレーム更新する。 */
$effect(() => {
	if (exhibit?.phase !== "sequence" || !client) return;
	const endsAt = exhibit.phaseEndsAt;
	const sync = client;
	let frame = 0;
	const tick = () => {
		const t = sync.serverNow();
		now = t;
		if (endsAt === null || t < endsAt) frame = requestAnimationFrame(tick);
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

{#if !exhibit}
	<main class="screen center"><p class="muted">接続しています</p></main>
{:else}
	<main
		class="screen"
		data-phase={exhibit.phase}
		style:background={exhibit.phase === "result" && color ? color.backgroundColor : undefined}
		style:color={exhibit.phase === "result" && color ? color.foregroundColor : undefined}
	>
		{#if exhibit.phase === "idle" && !exhibit.accepting}
			<section class="center stack top">
				<h1>{EXHIBIT.title}</h1>
				<p class="lead">ただいま受付を停止しています</p>
				<p class="muted">しばらくお待ちください</p>
			</section>
		{:else if exhibit.phase === "idle"}
			<section class="center stack top">
				<h1>{EXHIBIT.welcomeMessage}</h1>
				<button
					type="button"
					class="primary-button"
					disabled={!online || pending !== null}
					onclick={() => send({ name: "start" })}
				>
					{pending === "start" ? "準備しています" : "はじめる"}
				</button>
			</section>
		{:else if exhibit.phase === "sequence"}
			<section class="center" data-sequence={exhibit.sequenceId}>
				{#if sequence && SequenceView}
					<SequenceView
						t={sequenceTime(sequenceMs, exhibit.phaseStartedAt, now)}
						durationMs={sequenceMs}
						sessionId={exhibit.sessionId}
						{reducedMotion}
					/>
				{/if}
			</section>
		{:else if exhibit.phase === "intro"}
			<section class="step">
				<ProgressBar total={progressTotal} current={0} label="ニックネームの入力" />
				<form class="intro" onsubmit={submitNickname} aria-busy={pending === "continue"}>
					<h1><label for="nickname">ニックネームを入力して下さい</label></h1>
					<div class="nickname-field">
						<input
							id="nickname"
							type="text"
							bind:this={nicknameInput}
							bind:value={nicknameDraft}
							placeholder="好きな名前を入力..."
							aria-invalid={nicknameTooLong}
							aria-describedby="nickname-hint"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							enterkeyhint="go"
							disabled={!online || pending !== null}
							onkeydown={onNicknameKeydown}
							oncompositionstart={() => (composing = true)}
							oncompositionend={() => (composing = false)}
						>
						<button
							type="submit"
							class="nickname-submit"
							aria-label={pending === "continue" ? "準備しています" : "進む"}
							disabled={!online || pending !== null}
						>
							<ArrowRightIcon aria-hidden="true" size={24} strokeWidth={2} />
						</button>
					</div>
					<p id="nickname-hint" class="nickname-hint" aria-live="polite">
						{nicknameTooLong ? `${NICKNAME_MAX_LENGTH}文字までにしてください` : ""}
					</p>
				</form>
			</section>
		{:else if exhibit.phase === "question" && question && exhibit.questionIndex !== null}
			<section class="step question">
				<ProgressBar
					total={progressTotal}
					current={exhibit.questionIndex + 1}
					label="質問 {exhibit.questionIndex + 1} / {QUESTIONS.length}"
				/>
				<div class="body">
					<h1 class="prompt">{question.prompt}</h1>
					{#key question.id}
						{#if question.kind === "slider"}
							<Slider
								{question}
								value={typeof draft === "number" ? draft : null}
								mode={inputMode}
								onselect={(position) => (draft = position)}
								oninteract={(value) => (interacting = value)}
							/>
						{:else if question.kind === "map"}
							<MapPad
								{question}
								value={isMapPoint(draft) ? draft : null}
								mode={inputMode}
								onselect={(point) => (draft = point)}
								oninteract={(value) => (interacting = value)}
							/>
						{:else}
							<ChoiceList
								{question}
								value={draft}
								mode={inputMode}
								onselect={(answer) => (draft = answer)}
							/>
						{/if}
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
						disabled={!online || pending !== null || !canSubmit}
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
					{#if qr?.model}
						<QrCode model={qr.model} label="結果ページのQRコード" />
						<p class="url">{qr.url}</p>
						<p class="hint">カメラで読み取ると、結果をあなたの端末で開けます</p>
					{:else if qr}
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

		{#if status !== "open"}
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
/* 進捗バーを上端に置き、残りの高さに本文を置く。 */
.step {
	display: grid;
	grid-template-rows: auto 1fr;
	/* 列幅を内容の最小幅で広げず、画面の幅に収める。 */
	grid-template-columns: minmax(0, 1fr);
	gap: 32px;
	width: 100%;
}
.intro {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	align-content: center;
	justify-items: center;
	gap: 40px;
	/*
	 * 上の進捗バーと間隔（36px）と、下の案内文の行（約43px）がほぼ釣り合うため、
	 * 下の余白を足さなくても見出しと入力欄が画面全体のほぼ中央に来る。
	 */
}
.intro h1 {
	text-align: center;
	letter-spacing: 0.12em;
}
.nickname-field {
	display: flex;
	width: min(100%, 500px);
	height: 64px;
}
.nickname-field input {
	flex: 1;
	min-width: 0;
	padding: 0 24px;
	border: 1.5px solid var(--text);
	border-right: 0;
	border-radius: 0;
	background: var(--idle);
	color: var(--text);
	font-size: 22px;
	letter-spacing: 0.04em;
	-webkit-appearance: none;
	appearance: none;
}
.nickname-field input::placeholder {
	color: var(--placeholder);
}
.nickname-field input:focus {
	outline: none;
}
.nickname-field:focus-within {
	outline: 2px solid var(--text);
	outline-offset: 3px;
}
.nickname-submit {
	display: grid;
	place-items: center;
	width: 64px;
	padding: 0;
	border: 0;
	background: var(--text);
	color: var(--idle);
	cursor: pointer;
	touch-action: manipulation;
}
.nickname-submit:disabled {
	opacity: 0.35;
	cursor: default;
}
/* 案内文の有無で入力欄の位置が動かないよう、一行分の高さを常に確保する。 */
.nickname-hint {
	min-height: 1.7em;
	margin-top: -24px;
	font-size: 16px;
	color: var(--muted);
}
.question {
	grid-template-rows: auto 1fr auto;
	justify-items: center;
	align-items: center;
	margin: 0 auto;
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
.overlay {
	position: fixed;
	inset: 0;
	display: grid;
	place-content: center;
	gap: 8px;
	text-align: center;
	background: rgba(255, 255, 255, 0.97);
	color: var(--text);
	font-size: 20px;
}
</style>
