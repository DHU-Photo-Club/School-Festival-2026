import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../../src/data/questions.ts";
import { SEQUENCES } from "../../src/data/sequences.ts";
import { SOUND_CUES, SOUND_FILES } from "../../src/data/sound.ts";
import { parseRange } from "../../src/server/http.ts";
import { JUDGING_MS, RESULT_MS } from "../../src/shared/machine.ts";
import { parseClientMessage, type ServerMessage } from "../../src/shared/protocol.ts";
import type { SoundCue } from "../../src/shared/sound.ts";
import { glassCycle, soundCues } from "../../src/shared/sound.ts";
import type { SoundState } from "../../src/shared/types.ts";
import type { FakeConnection } from "./helpers.ts";
import { Harness, lastAdminState, sampleAnswer } from "./helpers.ts";

const IDS = QUESTIONS.map((question) => question.id);

/** サウンド用の接続が受け取った状態を順に `soundCues` へ通し、鳴らす音を集める。 */
function cuesOf(sound: FakeConnection): SoundCue[] {
	let previous: SoundState | null = null;
	const cues: SoundCue[] = [];
	for (const message of sound.sent as ServerMessage[]) {
		if (message.type !== "state") continue;
		const state = message.state as SoundState;
		cues.push(...soundCues(previous, state, IDS, SOUND_CUES));
		previous = state;
	}
	return cues;
}

/** 少し時間をおいて `index` 番目の質問に答える。 */
function answerAt(harness: Harness, ipad: FakeConnection, index: number) {
	harness.advance(1_000);
	const question = QUESTIONS[index];
	return harness.commandWithResult(ipad, { name: "answer", questionId: question.id, answer: sampleAnswer(question) });
}

describe("サウンドの対応表", () => {
	it("アプリの質問IDすべてに、引き継ぎ資料のQ2〜Q6とナレーション5〜10.wavが一つずつずれて対応する", () => {
		expect(Object.keys(SOUND_CUES.questions)).toEqual(IDS);
		expect(IDS.map((id) => SOUND_CUES.questions[id].answer)).toEqual([2, 3, 4, 5, 6]);
		expect(IDS.flatMap((id) => SOUND_CUES.questions[id].narration)).toEqual([5, 6, 7, 8, 9, 10]);
		expect(SOUND_CUES.nicknameAnswer).toBe(1);
		const used = [...SOUND_CUES.welcome, ...IDS.flatMap((id) => SOUND_CUES.questions[id].narration)]
			.concat(SOUND_CUES.judging, SOUND_CUES.result)
			.sort((a, b) => a - b);
		expect(used).toEqual(Array.from({ length: SOUND_FILES.narration.length }, (_, index) => index + 1));
	});
});

describe("soundCues", () => {
	it("一回の体験で、ナレーション、回答SE、完了SEを場面の順に一度ずつ鳴らす", async () => {
		const harness = new Harness({ sequences: SEQUENCES });
		const sound = harness.connect("sound");
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.advance(SEQUENCES[0].durationMs);
		harness.alarm();
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		for (let index = 0; index < QUESTIONS.length - 1; index += 1) answerAt(harness, ipad, index);
		await answerAt(harness, ipad, QUESTIONS.length - 1);
		harness.advance(JUDGING_MS);
		harness.alarm();
		harness.command(ipad, { name: "returnToIdle" });

		expect(cuesOf(sound)).toEqual([
			{ kind: "narration", numbers: [1, 2, 3, 4], scene: "welcome" },
			{ kind: "answer", number: 1 },
			{ kind: "narration", numbers: [5], scene: "question" },
			{ kind: "answer", number: 2 },
			{ kind: "narration", numbers: [6], scene: "question" },
			{ kind: "answer", number: 3 },
			{ kind: "narration", numbers: [7, 8], scene: "question" },
			{ kind: "answer", number: 4 },
			{ kind: "narration", numbers: [9], scene: "question" },
			{ kind: "answer", number: 5 },
			{ kind: "narration", numbers: [10], scene: "question" },
			{ kind: "answer", number: 6 },
			{ kind: "narration", numbers: [11], scene: "judging" },
			{ kind: "complete" },
			{ kind: "narration", numbers: [12], scene: "result" },
			{ kind: "stopNarration" },
		]);
	});

	it("戻ると戻った質問のナレーションを読み直し、回答SEは鳴らさない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		answerAt(harness, ipad, 0);
		const sound = harness.connect("sound");
		harness.command(ipad, { name: "back" });
		expect(cuesOf(sound)).toEqual([{ kind: "narration", numbers: [5], scene: "question" }]);
	});

	it("AIの選定に失敗して最終問へ戻ったら、色の探索のナレーションを止め、質問を読み直さない", async () => {
		const harness = new Harness({ judge: async () => null });
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		for (let index = 0; index < QUESTIONS.length - 1; index += 1) answerAt(harness, ipad, index);
		const sound = harness.connect("sound");
		await answerAt(harness, ipad, QUESTIONS.length - 1);
		expect(cuesOf(sound)).toEqual([
			{ kind: "answer", number: 6 },
			{ kind: "narration", numbers: [11], scene: "judging" },
			{ kind: "stopNarration" },
		]);
	});

	it("開いた直後の状態と、revision が飛んだ状態では過ぎた出来事を鳴らさない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		const sound = harness.connect("sound");
		const opened = sound.lastState<SoundState>();
		expect(soundCues(null, opened, IDS, SOUND_CUES)).toEqual([]);
		answerAt(harness, ipad, 0);
		answerAt(harness, ipad, 1);
		expect(soundCues(opened, sound.lastState<SoundState>(), IDS, SOUND_CUES)).toEqual([]);
	});

	it("切断中に体験が終わっていたら、ナレーションだけ止める", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		harness.command(ipad, { name: "start" });
		const sound = harness.connect("sound");
		const during = sound.lastState<SoundState>();
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		harness.command(admin, { name: "forceReset" });
		expect(soundCues(during, sound.lastState<SoundState>(), IDS, SOUND_CUES)).toEqual([{ kind: "stopNarration" }]);
	});

	it("結果の表示中に時間切れで待機へ戻ったときもナレーションを止める", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		for (let index = 0; index < QUESTIONS.length - 1; index += 1) answerAt(harness, ipad, index);
		await answerAt(harness, ipad, QUESTIONS.length - 1);
		harness.advance(JUDGING_MS);
		harness.alarm();
		const sound = harness.connect("sound");
		harness.advance(RESULT_MS);
		harness.alarm();
		expect(cuesOf(sound)).toEqual([{ kind: "stopNarration" }]);
	});
});

describe("サウンド用の配信と再生状態", () => {
	it("展示ディスプレイと同じ範囲に質問の番号だけを加え、回答とニックネームを送らない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		const sound = harness.connect("sound");
		const state = sound.lastState<SoundState>();
		expect(state.questionIndex).toBe(0);
		expect(state).not.toHaveProperty("answers");
		expect(state).not.toHaveProperty("nickname");
		expect(state.result).toBeNull();
	});

	it("サウンド用の再生状態を管理画面の端末一覧へ載せ、ほかの端末からの報告は無視する", () => {
		const harness = new Harness();
		const admin = harness.connect("admin");
		const sound = harness.connect("sound");
		const display = harness.connect("display", 1);
		expect(lastAdminState(admin).devices.find((device) => device.role === "sound")?.audio).toBeNull();
		harness.send(sound, { type: "audio", status: "blocked" });
		expect(lastAdminState(admin).devices.find((device) => device.role === "sound")?.audio).toBe("blocked");
		harness.send(sound, { type: "audio", status: "playing" });
		harness.send(display, { type: "audio", status: "blocked" });
		const devices = lastAdminState(admin).devices;
		expect(devices.find((device) => device.role === "sound")?.audio).toBe("playing");
		expect(devices.find((device) => device.role === "display")).not.toHaveProperty("audio");
	});

	it("再生状態のメッセージを検証する", () => {
		expect(parseClientMessage(JSON.stringify({ type: "audio", status: "degraded" }))).toEqual({
			type: "audio",
			status: "degraded",
		});
		expect(parseClientMessage(JSON.stringify({ type: "audio", status: "loud" }))).toBeNull();
		expect(parseClientMessage(JSON.stringify({ type: "audio" }))).toBeNull();
	});
});

describe("glassCycle", () => {
	/** 決まった列を返す乱数。 */
	function sequence(seed: number) {
		let value = seed;
		return () => {
			value = (value * 16807) % 2147483647;
			return (value - 1) / 2147483646;
		};
	}

	it("一巡で18種類を一度ずつ使い、一巡の境界で同じ音を続けない", () => {
		const random = sequence(7);
		let last: number | null = null;
		for (let round = 0; round < 500; round += 1) {
			const order = glassCycle(18, last, random);
			expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, index) => index));
			expect(order[0]).not.toBe(last);
			last = order[order.length - 1];
		}
	});

	it("乱数がいつも0でも、境界の重複を避ける", () => {
		const order = glassCycle(18, 1, () => 0);
		expect(order[0]).not.toBe(1);
	});
});

describe("parseRange", () => {
	it("一つの範囲を両端を含む位置へ直す", () => {
		expect(parseRange(undefined, 100)).toBeNull();
		expect(parseRange("bytes=0-", 100)).toEqual([0, 99]);
		expect(parseRange("bytes=10-19", 100)).toEqual([10, 19]);
		expect(parseRange("bytes=90-200", 100)).toEqual([90, 99]);
		expect(parseRange("bytes=-10", 100)).toEqual([90, 99]);
		expect(parseRange("bytes=-200", 100)).toEqual([0, 99]);
	});

	it("満たせない範囲と、読めない指定を区別する", () => {
		expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
		expect(parseRange("bytes=20-10", 100)).toBe("unsatisfiable");
		expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
		expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
		expect(parseRange("items=0-1", 100)).toBeNull();
		expect(parseRange("bytes=-", 100)).toBeNull();
	});
});
