import { GLASS_SETTINGS, SOUND_FILES, SOUND_MIX, welcomeNarrationGapAfterMs } from "../../data/sound.ts";
import type { AudioStatus } from "../../shared/protocol.ts";
import type { SoundCue } from "../../shared/sound.ts";
import { glassCycle, randomIn } from "../../shared/sound.ts";

/** 音量を調整できる系統。`master` は全体。 */
export const BUSES = ["master", "bgm", "glass", "narration", "effects"] as const;
export type Bus = (typeof BUSES)[number];

/** ガラス音の発音を先に予約しておく長さ。タイマーが遅れても、この範囲の発音は時刻どおりに鳴る。 */
const GLASS_LOOKAHEAD_S = 15;
/** ガラス音の予約を見直す間隔。 */
const GLASS_TICK_MS = 1_000;
/** 音量の変更にかける時間。急な変化で音が途切れないようにする。 */
const VOLUME_RAMP_S = 0.05;

/** 場面に入ってから、ナレーションを読み始めるまでの時間（ms）。画面の動きが出そろう時刻に合わせる。場面を足すと、ここも書かないと型エラーになる。 */
const NARRATION_DELAY_MS: Record<Extract<SoundCue, { kind: "narration" }>["scene"], number> = {
	welcome: 0,
	question: 0,
	questionSwitch: SOUND_MIX.questionSwitchNarrationDelayMs,
	judging: 0,
	result: SOUND_MIX.resultNarrationDelayMs,
};

interface ScheduledNarration {
	sources: AudioBufferSourceNode[];
	gain: GainNode;
	/** 最後のナレーションを読み終える時刻（`AudioContext` の時刻）。 */
	endsAt: number;
}

/**
 * サウンド用の画面の再生処理（仕様書11.2節）。BGMとガラス音は開始から止めずに鳴らし続け、
 * ナレーション、回答SE、完了SEは `cue` で鳴らす。
 *
 * 系統: BGM（`<audio>` のループ）→ 減音 → 全体、ガラス音（HRTFで位置を変える）→ 減音 → コンプレッサー → 全体、
 * ナレーション → 全体、回答SEと完了SE → 全体。ナレーションを読んでいる間はBGMとガラス音を下げる。
 */
export class SoundEngine {
	readonly context: AudioContext;
	private readonly gains: Record<Bus, GainNode>;
	private readonly bgmDuck: GainNode;
	private readonly glassDuck: GainNode;
	private readonly bgm: HTMLAudioElement;
	private readonly buffers = new Map<string, AudioBuffer>();
	private failed: string[] = [];
	private loaded = false;
	private started = false;
	private glassTimer: ReturnType<typeof setInterval> | null = null;
	private glassQueue: number[] = [];
	private glassLast: number | null = null;
	private glassNextAt = 0;
	private narration: ScheduledNarration | null = null;

	constructor(
		private readonly onStatus: (status: AudioStatus) => void,
		private readonly random: () => number = Math.random,
	) {
		this.context = new AudioContext({ latencyHint: "playback" });
		const gain = (value: number) => new GainNode(this.context, { gain: value });
		this.gains = {
			master: gain(1),
			bgm: gain(SOUND_MIX.bgm),
			glass: gain(SOUND_MIX.glass),
			narration: gain(SOUND_MIX.narration),
			effects: gain(SOUND_MIX.effects),
		};
		this.bgmDuck = gain(1);
		this.glassDuck = gain(1);
		const compressor = new DynamicsCompressorNode(this.context, GLASS_SETTINGS.compressor);
		this.gains.master.connect(this.context.destination);
		this.gains.bgm.connect(this.bgmDuck).connect(this.gains.master);
		this.gains.glass.connect(this.glassDuck).connect(compressor).connect(this.gains.master);
		this.gains.narration.connect(this.gains.master);
		this.gains.effects.connect(this.gains.master);

		// BGMは16分あり、復号すると数百MBになるため、`<audio>` で読みながら鳴らす。
		this.bgm = new Audio(SOUND_FILES.bgm);
		this.bgm.loop = true;
		this.bgm.preload = "auto";
		this.bgm.addEventListener("error", () => {
			if (!this.failed.includes(SOUND_FILES.bgm)) this.failed.push(SOUND_FILES.bgm);
			this.report();
		});
		this.context.createMediaElementSource(this.bgm).connect(this.gains.bgm);
		this.context.addEventListener("statechange", () => {
			if (this.context.state === "running") void this.begin();
			this.report();
		});
	}

	/** 読み込めなかった音源のパス。 */
	get failures(): readonly string[] {
		return this.failed;
	}

	get status(): AudioStatus {
		if (this.context.state !== "running") return "blocked";
		if (!this.loaded) return "loading";
		return this.failed.length > 0 ? "degraded" : "playing";
	}

	private report(): void {
		this.onStatus(this.status);
	}

	/**
	 * 音源を読み込み、ブラウザが許せば再生を始める。自動再生が止められていれば、画面の操作の後に `resume` を呼ぶ。
	 * 読み込めない音源があっても、残りの音源で続ける。
	 */
	async load(): Promise<void> {
		this.report();
		const paths = [...SOUND_FILES.glass, ...SOUND_FILES.narration, ...SOUND_FILES.answer, SOUND_FILES.complete];
		await Promise.all(
			paths.map(async (path) => {
				try {
					const response = await fetch(path);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					this.buffers.set(path, await this.context.decodeAudioData(await response.arrayBuffer()));
				} catch (error) {
					console.error(`音源を読み込めませんでした: ${path}`, error);
					this.failed.push(path);
				}
			}),
		);
		this.loaded = true;
		if (this.context.state === "running") await this.begin();
		this.report();
	}

	/** 画面の操作から呼ぶ。自動再生が止められていた音を出せるようにする。 */
	async resume(): Promise<void> {
		await this.context.resume();
		await this.begin();
		this.report();
	}

	/** BGMとガラス音を鳴らし始める。二度目以降は何もしない（BGMを重複して起動しない）。 */
	private async begin(): Promise<void> {
		if (this.started || !this.loaded || this.context.state !== "running") return;
		this.started = true;
		try {
			await this.bgm.play();
		} catch (error) {
			console.error("BGMを再生できませんでした", error);
		}
		this.glassNextAt = this.context.currentTime + 0.1;
		this.scheduleGlass();
		this.glassTimer = setInterval(() => this.scheduleGlass(), GLASS_TICK_MS);
	}

	/** 系統の音量（0〜1）を設定データの値に掛ける。 */
	setVolume(bus: Bus, value: number): void {
		const base = bus === "master" ? 1 : SOUND_MIX[bus];
		this.gains[bus].gain.setTargetAtTime(base * value, this.context.currentTime, VOLUME_RAMP_S);
	}

	/** ガラス音を先の時刻まで予約する。間隔は鳴り始めから次の鳴り始めまでで、余韻の重なりは許す。 */
	private scheduleGlass(): void {
		const horizon = this.context.currentTime + GLASS_LOOKAHEAD_S;
		// タブが止まっていた後は、過ぎた分をまとめて鳴らさず、今から数え直す。
		if (this.glassNextAt < this.context.currentTime) this.glassNextAt = this.context.currentTime + 0.1;
		while (this.glassNextAt < horizon) {
			if (this.glassQueue.length === 0) {
				this.glassQueue = glassCycle(SOUND_FILES.glass.length, this.glassLast, this.random);
			}
			const index = this.glassQueue.shift() as number;
			this.glassLast = index;
			const buffer = this.buffers.get(SOUND_FILES.glass[index]);
			if (buffer) this.playGlass(buffer, this.glassNextAt);
			this.glassNextAt += randomIn(GLASS_SETTINGS.intervalMs, this.random) / 1000;
		}
	}

	private playGlass(buffer: AudioBuffer, when: number): void {
		const { position } = GLASS_SETTINGS;
		const panner = new PannerNode(this.context, {
			panningModel: "HRTF",
			distanceModel: "inverse",
			rolloffFactor: 0,
			positionX: randomIn(position.x, this.random),
			positionY: randomIn(position.y, this.random),
			positionZ: randomIn(position.z, this.random),
		});
		const source = new AudioBufferSourceNode(this.context, { buffer });
		source.connect(panner).connect(this.gains.glass);
		source.addEventListener("ended", () => panner.disconnect());
		source.start(when);
	}

	/** 状態の変化で決まった音を鳴らす。再生を始める前（クリック待ち、読み込み中）の出来事は鳴らさない。 */
	cue(cue: SoundCue): void {
		if (!this.started) return;
		switch (cue.kind) {
			case "answer":
				this.playEffect(SOUND_FILES.answer[cue.number - 1]);
				return;
			case "complete":
				this.playEffect(SOUND_FILES.complete);
				return;
			case "stopNarration":
				this.stopNarration();
				return;
			case "narration": {
				const fading = this.stopNarration();
				const delay = NARRATION_DELAY_MS[cue.scene] / 1000;
				this.playNarration(cue.numbers, this.context.currentTime + Math.max(fading, delay), cue.scene === "welcome");
				return;
			}
		}
	}

	private playEffect(path: string | undefined): void {
		const buffer = path === undefined ? undefined : this.buffers.get(path);
		if (!buffer) return;
		const source = new AudioBufferSourceNode(this.context, { buffer });
		source.connect(this.gains.effects);
		source.start();
	}

	/** `numbers` のナレーションを `startAt` から間をあけて順に読み、その間はBGMとガラス音を下げる。 */
	private playNarration(numbers: readonly number[], startAt: number, welcome = false): void {
		const gain = new GainNode(this.context, { gain: 1 });
		gain.connect(this.gains.narration);
		const sources: AudioBufferSourceNode[] = [];
		let at = startAt;
		for (const number of numbers) {
			const buffer = this.buffers.get(SOUND_FILES.narration[number - 1]);
			if (!buffer) continue;
			const source = new AudioBufferSourceNode(this.context, { buffer });
			source.connect(gain);
			source.start(at);
			sources.push(source);
			// 企画説明01〜03は連続再生し、04以降や質問内の間隔は保つ。
			at += buffer.duration + (welcome ? welcomeNarrationGapAfterMs(number) : SOUND_MIX.narrationGapMs) / 1000;
		}
		if (sources.length === 0) {
			gain.disconnect();
			return;
		}
		const endsAt = at - SOUND_MIX.narrationGapMs / 1000;
		const narration: ScheduledNarration = { sources, gain, endsAt };
		this.narration = narration;
		sources[sources.length - 1].addEventListener("ended", () => {
			if (this.narration === narration) this.narration = null;
			gain.disconnect();
		});
		const { duck } = SOUND_MIX;
		for (const [node, level] of [
			[this.bgmDuck, duck.bgm],
			[this.glassDuck, duck.glass],
		] as const) {
			const param = node.gain;
			param.cancelScheduledValues(this.context.currentTime);
			param.setValueAtTime(param.value, this.context.currentTime);
			param.linearRampToValueAtTime(
				param.value,
				Math.max(this.context.currentTime, startAt - duck.attackMs / 1000),
			);
			param.linearRampToValueAtTime(level, startAt);
			param.setValueAtTime(level, endsAt);
			param.linearRampToValueAtTime(1, endsAt + duck.releaseMs / 1000);
		}
	}

	/** 読んでいる（予約した）ナレーションをフェードアウトで止め、減音を戻す。フェードにかかる秒数を返す。 */
	private stopNarration(): number {
		const narration = this.narration;
		this.narration = null;
		const now = this.context.currentTime;
		const fade = SOUND_MIX.narrationFadeOutMs / 1000;
		// 次のナレーションを続けて読む場合は、`playNarration` がこの戻りを予約し直す。
		for (const node of [this.bgmDuck, this.glassDuck]) {
			const param = node.gain;
			param.cancelScheduledValues(now);
			param.setValueAtTime(param.value, now);
			param.linearRampToValueAtTime(1, now + SOUND_MIX.duck.releaseMs / 1000);
		}
		if (!narration || narration.endsAt <= now) return 0;
		narration.gain.gain.cancelScheduledValues(now);
		narration.gain.gain.setValueAtTime(narration.gain.gain.value, now);
		narration.gain.gain.linearRampToValueAtTime(0, now + fade);
		for (const source of narration.sources) source.stop(now + fade);
		return fade;
	}

	/** ページを閉じるときに呼ぶ。 */
	dispose(): void {
		if (this.glassTimer) clearInterval(this.glassTimer);
		this.bgm.pause();
		void this.context.close();
	}
}
