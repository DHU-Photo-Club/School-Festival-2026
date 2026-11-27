<script lang="ts">
import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
import { onDestroy, onMount } from "svelte";
import { sineInOut } from "svelte/easing";
import { fade } from "svelte/transition";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PALETTE } from "../../data/palette.ts";
import { QUESTIONS } from "../../data/questions.ts";
import { SEQUENCES } from "../../data/sequences.ts";
import { INITIAL_POSITION, isMapPoint, isValidAnswer, sameAnswer } from "../../shared/answer.ts";
import type { Command } from "../../shared/machine.ts";
import { easeOutCubic, introDescriptionRemainingMs, NICKNAME_FADE_IN_MS } from "../../shared/motion.ts";
import { NICKNAME_MAX_LENGTH, normalizeNickname } from "../../shared/nickname.ts";
import { backgroundColor, foregroundColor, gradientCss, paletteColor } from "../../shared/palette.ts";
import { resultUrl } from "../../shared/result-url.ts";
import { findSequence, sequenceBefore, sequenceDuration, sequenceTime } from "../../shared/sequence.ts";
import type { Answer, ExhibitState, PaletteColor, Question } from "../../shared/types.ts";
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
import {
	isQuestionSwitch,
	markDescendOrder,
	QUESTION_LOCK_MS,
	questionLeave,
	questionMotionStyle,
} from "./question-transition.ts";
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
/** 待機画面の「はじめる」を指で押している間は `true`。 */
let startPressed = $state(false);
/** `intro` で入力中のニックネーム。 */
let nicknameDraft = $state("");
let nicknameInput = $state<HTMLInputElement | null>(null);
/**
 * ニックネームの入力欄と進捗バーを出してよいか。展示ディスプレイが `intro` の説明の文を現れ終えるまでは出さない
 * （説明を読んでいる間に入力欄が出ないようにする）。
 */
let nicknameReady = $state(false);
/** `intro` の直前に再生するシーケンス。説明の文はここから数えた時刻で現れる。 */
const introLead = sequenceBefore(SEQUENCES, "intro");
/**
 * 質問の入れ替えの間は `true`。この間だけ次の質問に降りてくる動きを掛ける。入れ替えの途中で次の切り替えが
 * 起きると、降りかけの質問が動きを失って一瞬はっきり見えるため、入れ替えが終わるまで下部のボタンを無効にする。
 * 質問の区画（`.stage`）も `inert` にし、降りかけの入力に指、キーボード、読み上げのどれでも触れられないようにする
 * （要素ごとに表示が切り替わる間、読み上げに半端な質問を出さない）。
 * 質問の番号はこのiPadの「次へ」「戻る」でしか変わらないため、ボタンを無効にすれば途中の切り替えは起きない
 * （強制リセットは `idle` を経由するため入れ替えにならない）。
 */
let transitioning = $state(false);
let transitionTimer: ReturnType<typeof setTimeout> | undefined;
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
/** 結果の二色（AIの出力順）。 */
const resultColors = $derived.by((): [PaletteColor, PaletteColor] | null => {
	const result = exhibit?.phase === "result" ? exhibit.result : null;
	if (!result) return null;
	const [a, b] = result.colors.map((id) => paletteColor(PALETTE.colors, id));
	return a && b ? [a, b] : null;
});
const sequence = $derived(exhibit?.phase === "sequence" ? findSequence(SEQUENCES, exhibit.sequenceId) : null);
const SequenceView = $derived(sequence ? controllerSequence(sequence.id) : null);
const sequenceMs = $derived(sequence && exhibit ? sequenceDuration(sequence, exhibit) : 0);
const nickname = $derived(normalizeNickname(nicknameDraft));
/** 最大文字数を超えているか。`maxlength` はUTF-16の単位で数えて絵文字を2文字とするため使わない。 */
const nicknameTooLong = $derived(Array.from(nicknameDraft.trim()).length > NICKNAME_MAX_LENGTH);
/** 進捗バーの区画数。`intro` と各質問に一区画ずつ割り当てる。 */
const progressTotal = 1 + QUESTIONS.length;

/**
 * 質問の最初の下書き。スライダーと2Dマップは真ん中から始め、そのまま「次へ」で送れる（案内文の
 * 「真ん中でも大丈夫です」）。選択式は未選択から始める。
 */
function initialDraft(question: Question): Answer | null {
	if (question.kind === "slider") return INITIAL_POSITION;
	if (question.kind === "map") return { x: INITIAL_POSITION, y: INITIAL_POSITION };
	return null;
}

function onState(next: ExhibitState) {
	const previousIndex = exhibit?.phase === "question" ? exhibit.questionIndex : null;
	if (isQuestionSwitch(previousIndex, next.phase === "question" ? next.questionIndex : null) && !reducedMotion) {
		transitioning = true;
		clearTimeout(transitionTimer);
		transitionTimer = setTimeout(() => (transitioning = false), QUESTION_LOCK_MS);
	}
	exhibit = next;
	pending = null;
	const key = `${next.sessionId}:${next.phase}:${next.questionIndex}`;
	if (key !== questionKey) {
		questionKey = key;
		// 新しい質問は未回答から、戻った質問は既存回答から始める（仕様書5章、6.1節）。
		const q = next.phase === "question" && next.questionIndex !== null ? QUESTIONS[next.questionIndex] : null;
		draft = q ? (next.answers[q.id] ?? initialDraft(q)) : null;
		interacting = false;
		// 新しいセッションの `intro` は空欄から始める。
		if (next.phase === "intro") nicknameDraft = "";
	}
}

/** 前の質問の去り方。 */
function leaveQuestion(node: Element) {
	return questionLeave(node, { reducedMotion });
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
	if (exhibit?.phase !== "result" || !exhibit.result) return null;
	const url = `${__PUBLIC_ORIGIN__}/result/${encodeURIComponent(exhibit.result.id)}`;
	try {
		return { url, model: createQrModel(resultUrl(__PUBLIC_ORIGIN__, exhibit.result.id)) };
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
	clearTimeout(transitionTimer);
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

/** `intro` に入ったら、展示ディスプレイが説明の文を現れ終える時刻に、ニックネームの入力欄を出す。 */
$effect(() => {
	if (exhibit?.phase !== "intro" || !client) {
		nicknameReady = false;
		return;
	}
	const sync = client;
	const state = { phaseStartedAt: exhibit.phaseStartedAt };
	let timer = 0;
	const check = () => {
		const remaining = introDescriptionRemainingMs(state, sync.serverNow(), reducedMotion, introLead);
		nicknameReady = remaining <= 0;
		if (remaining > 0) timer = window.setTimeout(check, remaining);
	};
	check();
	return () => window.clearTimeout(timer);
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
/**
 * 押下中にボタンが消えると `pointerup` が届かず、待機画面へ戻ったときに押下の表示が復帰する。
 * ボタンを表示しない状態では押下の表示を解除する。受付停止では `phase` が `idle` のままで
 * ボタンだけが消えるため、`accepting` も条件に入れる。
 */
$effect(() => {
	if (exhibit?.phase !== "idle" || !exhibit.accepting || !online || pending !== null) startPressed = false;
});
</script>

{#if !exhibit}
	<main class="screen center"><p class="muted">接続しています</p></main>
{:else}
	<main
		class="screen"
		class:blank-intro={pending === "start" || (exhibit.phase === "sequence" && exhibit.sequenceId === introLead?.id) || (exhibit.phase === "intro" && !nicknameReady)}
		data-phase={exhibit.phase}
		style:background={exhibit.phase === "judging" ? "#000000" : exhibit.phase === "result" && resultColors ? backgroundColor(resultColors[0]) : undefined}
		style:color={exhibit.phase === "judging" ? "#ffffff" : exhibit.phase === "result" && resultColors ? foregroundColor(resultColors[0]) : undefined}
	>
		{#if exhibit.phase === "idle" && !exhibit.accepting}
			<section class="center stack top">
				<h1>{EXHIBIT.title}</h1>
				<p class="lead">ただいま受付を停止しています</p>
				<p class="muted">しばらくお待ちください</p>
			</section>
		{:else if exhibit.phase === "idle"}
			<section class="center top welcome" out:fade={{ duration: reducedMotion ? 0 : 600, easing: sineInOut }}>
				<h1>{EXHIBIT.welcomeMessage}</h1>
				<button
					type="button"
					class="primary-button welcome-start"
					data-pressed={startPressed}
					disabled={!online || pending !== null}
					onpointerdown={() => (startPressed = true)}
					onpointerup={() => (startPressed = false)}
					onpointercancel={() => (startPressed = false)}
					onpointerleave={() => (startPressed = false)}
					onclick={() => send({ name: "start" })}
				>
					<span class="welcome-label">{pending === "start" ? "準備しています" : "はじめる"}</span>
					<span class="welcome-arrow">
						<ArrowRightIcon aria-hidden="true" size={24} strokeWidth={2} />
					</span>
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
			{#if nicknameReady}
				<section
					class="step"
					in:fade={{ duration: reducedMotion ? 0 : NICKNAME_FADE_IN_MS, easing: sineInOut }}
				>
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
			{/if}
		{:else if exhibit.phase === "question" && question && exhibit.questionIndex !== null}
			<section class="step question">
				<ProgressBar
					total={progressTotal}
					current={exhibit.questionIndex + 1}
					label="質問 {exhibit.questionIndex + 1} / {QUESTIONS.length}"
				/>
				<!--
					前後の質問を同じ区画に重ねて入れ替える（docs/visual-language.md 4.5節）。前の質問の消え方はSvelte 5の
					仕組みに頼る: `{#key}` は去る質問の `out:` が終わるまで旧DOMを残し、`out:` は旧要素を `inert` にする。
					`out:` はローカル（`|global` なし）のため、`{#if}` の分岐ごと消える最後の質問から `judging` へ移るときは動かない。
					前後の質問とも、`markDescendOrder` が順番を付けた要素ごとにCSSで動きを掛ける。次の質問は `data-transitioning="true"` の間だけ降りてきて、
					前の質問は `questionLeave` で `data-leaving` が付き、DOMに残る間だけ奥へ落ちる。`out:` は最後の要素が落ち終わるまで前の質問を残すだけで、
					質問全体には何も掛けない。
					重なりはE2Eテスト（flow.spec.ts）で確かめる。
				-->
				<div
					class="stage"
					data-transitioning={transitioning}
					inert={transitioning}
					style={questionMotionStyle()}
				>
					{#key exhibit.questionIndex}
						<div
							class="body"
							class:split={question.kind === "slider"}
							use:markDescendOrder
							out:leaveQuestion
						>
							<div class="heading">
								<h1 class="prompt">{question.prompt}</h1>
								<p class="guide">{question.guide}</p>
								{#if exhibit.judgeFailed}
									<p class="retry" role="alert">
										色をうまく選べませんでした。もう一度「次へ」を押してください
									</p>
								{/if}
							</div>
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
						</div>
					{/key}
				</div>
				<footer>
					{#if exhibit.questionIndex > 0}
						<button
							type="button"
							class="secondary-button"
							disabled={!online || pending !== null || transitioning}
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
						disabled={!online || pending !== null || transitioning || !canSubmit}
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
		{:else if exhibit.phase === "result" && exhibit.result && resultColors}
			<section class="result">
				<div class="identity">
					<div class="disc-box">
						<div
							class="disc"
							style:background={gradientCss(resultColors[0], resultColors[1])}
							style:transform="scale({discScale})"
						></div>
					</div>
					<p class="caption">あなたの色は</p>
					<h1 class="color-name">{exhibit.result.name}</h1>
					<p class="palette-names">{resultColors[0].name} と {resultColors[1].name}</p>
					<p class="message">{exhibit.result.reading}</p>
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
						style:background={foregroundColor(resultColors[0])}
						style:color={backgroundColor(resultColors[0])}
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
.screen.blank-intro {
	background: #000;
	transition: background-color 600ms ease-in-out;
}
.screen.blank-intro > * {
	visibility: hidden;
	pointer-events: none;
}
/* 開始画面だけは退場フェードが終わるまで見せ、背景と一緒に黒へ沈める。 */
.screen.blank-intro > .welcome {
	visibility: visible;
	position: absolute;
	inset: 0;
	padding: inherit;
}
@media (prefers-reduced-motion: reduce) {
	.screen.blank-intro {
		transition: none;
	}
}

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
/* h1 の文字サイズが vmin に比例するため、間隔も同じ vmin 基準で 40〜72px の範囲にする。 */
.top.welcome {
	gap: clamp(40px, 7vmin, 72px);
}
/* .primary-button は min-width で内容より広い箱になり、既定の寄せではラベルと矢印が左端へ寄るため、中央揃えと縦位置を指定する。 */
.welcome-start {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 12px;
	/* 送信中の「準備しています」（実測245.6px）を表示しても幅が変わらないよう、長い方のラベルに合わせる。 */
	min-width: 246px;
	transition: transform 120ms;
	/* iOSの既定のタップ表示は、押下の応答と重ねない。 */
	-webkit-tap-highlight-color: transparent;
}
/* タップの応答は、色を変えずに縮小と矢印の移動で返す。 */
.welcome-start[data-pressed="true"] {
	transform: scale(0.96);
}
.welcome-arrow {
	display: flex;
	transition: transform 120ms;
}
.welcome-start[data-pressed="true"] .welcome-arrow {
	transform: translateX(6px);
}
@media (prefers-reduced-motion: reduce) {
	.welcome-start,
	.welcome-arrow {
		transition: none;
	}
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
/* 入れ替えの間は前後の質問が同時にあるため、同じ区画に重ねて、質問の位置とフッターを動かさない。 */
.stage {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	align-self: stretch;
	justify-self: stretch;
	align-items: center;
	justify-items: center;
}
/*
 * 前後の質問ごとに重なり順を独立させる。独立させないと、前の質問のスライダーの操作面（`position: absolute`）や
 * 2Dマップの平面（`position: relative`）など `position` を指定した要素が、`position` を指定していない次の質問の
 * 要素より手前に描かれる。`isolation` は絶対配置の基準を作らないため、
 * スライダーの操作面は今までどおり画面全体を基準にする（`position: relative` にすると操作面が縮む）。
 */
.stage > .body {
	grid-area: 1 / 1;
	isolation: isolate;
}
/* 入れ替えの間は `.stage` を `inert` にする。`inert` に対応しない古いブラウザでも指で触れないよう、指の入力も止める。 */
.stage[data-transitioning="true"] {
	pointer-events: none;
}
/*
 * 次の質問は、要素ごとに少しずつ遅れて、画面の手前から拡大されてぼけた状態で降りてきて、画面に貼り付く。
 * 前の質問は、それより先に、要素ごとに少しずつ遅れて、画面の奥へ縮んでぼけながら落ちて消える（docs/visual-language.md 4.5節）。
 * 動かす要素の印（`data-descend`）と順番は `markDescendOrder` が付ける。前の質問は `questionLeave` が付ける `data-leaving` で見分ける（実行時に
 * 付けるため、`:global` にしないと使われないセレクタとして削られる）。Svelteも去る質問にプロパティとして `inert` を設定するが、
 * `inert` に対応しない古いブラウザでは属性にならないため、見分けには使わない。
 * 前の質問の動きは `data-transitioning` を条件にしない。`data-leaving` は去る質問がDOMに残る間だけ存在するため、それだけで
 * 足りる。描画が遅れて `data-transitioning="true"` が先に外れても、前の質問は透明のままDOMから消える。
 */
.stage[data-transitioning="true"] > .body:not([data-leaving]) :global([data-descend]),
.stage > .body:global([data-leaving]) :global([data-descend]) {
	/* 拡大縮小とぼかしを毎フレーム描き直すため、入れ替えの間だけ合成用の層に分ける。 */
	will-change: scale, filter, opacity;
}
.stage[data-transitioning="true"] > .body:not([data-leaving]) :global([data-descend]) {
	/* 次の質問は、前の質問がすべて落ちきるまでの時間 `--enter-delay` だけ待ってから降り始める。 */
	--descend-delay: calc(var(--enter-delay) + var(--descend-step, 0) * var(--motion-stagger));
	animation:
		question-descend var(--enter-duration) var(--enter-easing) var(--descend-delay) both,
		question-appear var(--enter-fade) ease-out var(--descend-delay) both;
}
.stage > .body:global([data-leaving]) :global([data-descend]) {
	--descend-delay: calc(var(--descend-step, 0) * var(--motion-stagger));
	animation:
		question-recede var(--leave-duration) var(--leave-easing) var(--descend-delay) both,
		question-vanish var(--leave-fade) var(--leave-easing) var(--descend-delay) both;
}
/*
 * 四つのキーフレームは、要素の本来の見た目になる側（入る動きの `to` と去る動きの `from`）を書かない。書かない側は要素自身の値になるため、上限に達して
 * 薄くした選択肢（不透明度0.35）は、0.35まで現れ、0.35から消える。ぼかしの本来の値 `none` はぼかし0と同じように
 * 補間され、終わったときにフィルタを残さない。
 */
@keyframes question-descend {
	from {
		scale: var(--enter-scale);
		filter: blur(var(--enter-blur));
	}
}
/*
 * 降り始めるまでは見えないだけでなく `visibility: hidden` にし、読み上げにも出さない。reduced-motionでは
 * `data-transitioning` を立てず、前の質問もすぐに消すため、この動きは掛からない。CSS側の `prefers-reduced-motion` で止めると、
 * 動かないのにボタンを無効にする時間だけが残るため、reduced-motionの判定は `onState` にまとめる。
 */
@keyframes question-appear {
	from {
		opacity: 0;
		visibility: hidden;
	}
}
@keyframes question-recede {
	to {
		scale: var(--leave-scale);
		filter: blur(var(--leave-blur));
	}
}
/* 透明になった各要素は、前の質問がDOMから消えるまで `animation-fill-mode: both` で透明のままにする。 */
@keyframes question-vanish {
	to {
		opacity: 0;
		visibility: hidden;
	}
}
.question .body {
	display: grid;
	gap: 56px;
	justify-items: center;
	width: 100%;
}
.heading {
	display: grid;
	gap: 12px;
	justify-items: center;
	text-align: center;
}
.prompt {
	text-align: center;
	font-size: clamp(26px, 5vmin, 40px);
}
.guide {
	font-size: 17px;
	color: var(--muted);
}
.retry {
	padding: 8px 16px;
	border: 1.5px solid var(--text);
	font-size: 17px;
}
/* スライダーは画面全体を左右に分けるため、質問文と補助文を上部に寄せる。 */
.question .body.split {
	align-self: start;
	gap: 8px;
}
.question footer {
	display: flex;
	justify-content: space-between;
	width: 100%;
	gap: 16px;
	/* 画面全体を覆うスライダーの操作面より前に出す。ボタンの押し損じで回答が変わらないよう、余白も指を受け取る。 */
	position: relative;
	z-index: 1;
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
.palette-names {
	font-size: 15px;
	opacity: 0.8;
}
.message {
	max-width: 32em;
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
	/* 質問画面のフッター（`z-index: 1`）より前に出す。 */
	z-index: 2;
	display: grid;
	place-content: center;
	gap: 8px;
	text-align: center;
	background: rgba(255, 255, 255, 0.97);
	color: var(--text);
	font-size: 20px;
}
</style>
