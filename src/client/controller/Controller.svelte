<script lang="ts">
import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
import { onDestroy, onMount } from "svelte";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PALETTE } from "../../data/palette.ts";
import { QUESTIONS } from "../../data/questions.ts";
import { SEQUENCES } from "../../data/sequences.ts";
import { INITIAL_POSITION, isMapPoint, isValidAnswer, sameAnswer } from "../../shared/answer.ts";
import type { Command } from "../../shared/machine.ts";
import { easeOutCubic } from "../../shared/motion.ts";
import { NICKNAME_MAX_LENGTH, normalizeNickname } from "../../shared/nickname.ts";
import { backgroundColor, foregroundColor, gradientCss, paletteColor } from "../../shared/palette.ts";
import { resultUrl } from "../../shared/result-url.ts";
import { findSequence, sequenceDuration, sequenceTime } from "../../shared/sequence.ts";
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
	QUESTION_TRANSITION_MS,
	type QuestionPart,
	questionDirectionOf,
	questionEnter,
	questionLeave,
	questionMotion,
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
/** 直前の質問の切り替えの向き。`1` は次の質問へ進んだとき、`-1` は前の質問へ戻ったとき。 */
let questionDirection: 1 | -1 = 1;
/**
 * 去る質問の入力方式。去る質問の入れ替えの設定を求める時点では `question` がすでに次の質問を指すため、
 * 切り替える前に控える。
 */
let leavingKind: Question["kind"] | null = null;
/**
 * 質問の入れ替えの間は `true`。入れ替えの途中で次の切り替えが起きると、入りかけの質問が去る動きの始めに
 * 不透明へ戻って見えるため、入れ替えが終わるまで下部のボタンを無効にする。
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
	const direction = questionDirectionOf(previousIndex, next.phase === "question" ? next.questionIndex : null);
	// `direction` が値を持てば `previousIndex` も値を持つが、型の絞り込みのために両方を確かめる。
	if (previousIndex !== null && direction !== null) {
		questionDirection = direction;
		leavingKind = QUESTIONS[previousIndex].kind;
		if (!reducedMotion) {
			transitioning = true;
			clearTimeout(transitionTimer);
			// 入る質問の最後のフレームより先に解除しないよう、1フレーム分（約17ms）待ってから解除する。
			transitionTimer = setTimeout(() => (transitioning = false), QUESTION_TRANSITION_MS + 17);
		}
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

/** 次の質問の入り方。入る質問は表示中の `question`。 */
function enterQuestion(node: Element, part: QuestionPart) {
	if (!question) return { duration: 0 };
	return questionEnter(node, questionMotion(part, question.kind, questionDirection, reducedMotion));
}

/** 前の質問の去り方。去る質問は切り替える前に控えた `leavingKind`。 */
function leaveQuestion(node: Element, part: QuestionPart) {
	if (!leavingKind) return { duration: 0 };
	return questionLeave(node, questionMotion(part, leavingKind, questionDirection, reducedMotion));
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
		data-phase={exhibit.phase}
		style:background={exhibit.phase === "result" && resultColors ? backgroundColor(resultColors[0]) : undefined}
		style:color={exhibit.phase === "result" && resultColors ? foregroundColor(resultColors[0]) : undefined}
	>
		{#if exhibit.phase === "idle" && !exhibit.accepting}
			<section class="center stack top">
				<h1>{EXHIBIT.title}</h1>
				<p class="lead">ただいま受付を停止しています</p>
				<p class="muted">しばらくお待ちください</p>
			</section>
		{:else if exhibit.phase === "idle"}
			<section class="center top welcome">
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
				<!--
					前後の質問を同じ区画に重ねて入れ替える（docs/visual-language.md 4.5節）。次の動きはSvelte 5の
					仕組みに頼る: `{#key}` は去る質問の `out:` が終わるまで旧DOMを残し、`out:` は旧要素を `inert` にする。
					`in:` / `out:` はローカル（`|global` なし）のため、`{#if}` の分岐ごと作り直す `intro` から最初の質問、
					最後の質問から `judging` では動かない。重なりはE2Eテスト（flow.spec.ts）で確かめる。
				-->
				<div class="stage" data-transitioning={transitioning}>
					{#key exhibit.questionIndex}
						<div
							class="body"
							class:split={question.kind === "slider"}
							in:enterQuestion={"body"}
							out:leaveQuestion={"body"}
						>
							<div class="heading" in:enterQuestion={"heading"} out:leaveQuestion={"heading"}>
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
.stage > .body {
	grid-area: 1 / 1;
}
/* 入れ替えの間は、ずれて半透明の質問に触れて回答が変わらないよう、下部のボタンと同じく入力も受け付けない。 */
.stage[data-transitioning="true"] > .body {
	pointer-events: none;
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
