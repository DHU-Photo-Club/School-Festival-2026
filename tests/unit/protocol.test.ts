import { describe, expect, it } from "vitest";
import { initialState } from "../../src/shared/machine.ts";
import { parseClientMessage, toDisplayState } from "../../src/shared/protocol.ts";

describe("parseClientMessage", () => {
	it("JSONでないメッセージ、オブジェクトでない値、未知の type を拒否する", () => {
		for (const raw of ["{", "[]", "1", "null", JSON.stringify({ type: "hello" })]) {
			expect(parseClientMessage(raw)).toBeNull();
		}
	});

	it("コマンドの名前と固有フィールドを検証する", () => {
		const command = (value: unknown) => parseClientMessage(JSON.stringify({ type: "command", command: value }));
		expect(command({ name: "start" })).toEqual({ type: "command", command: { name: "start" } });
		expect(command({ name: "openDoor", extra: 1 })).toEqual({ type: "command", command: { name: "openDoor" } });
		expect(command({ name: "answer", questionId: "light", answer: "left" })).toEqual({
			type: "command",
			command: { name: "answer", questionId: "light", answer: "left" },
		});
		expect(command({ name: "answer", questionId: "sound", answer: ["birds", "rain"] })).toEqual({
			type: "command",
			command: { name: "answer", questionId: "sound", answer: ["birds", "rain"] },
		});
		expect(command({ name: "answer", questionId: "season", answer: 0.42 })).toMatchObject({
			command: { answer: 0.42 },
		});
		// 2Dマップの位置は x と y だけを受け取る。
		expect(command({ name: "answer", questionId: "place", answer: { x: 0.1, y: 0.9, z: 1 } })).toMatchObject({
			command: { answer: { x: 0.1, y: 0.9 } },
		});
		expect(
			(
				command({ name: "answer", questionId: "place", answer: { x: 0.1, y: 0.9, z: 1 } }) as never as {
					command: { answer: object };
				}
			).command.answer,
		).not.toHaveProperty("z");
		expect(command({ name: "setAccepting", accepting: false })).toMatchObject({
			command: { name: "setAccepting", accepting: false },
		});
		expect(command({ name: "previewColor", colorId: "jade" })).toMatchObject({
			command: { name: "previewColor", colorId: "jade" },
		});
		expect(command({ name: "continue", nickname: " ゆき " })).toEqual({
			type: "command",
			command: { name: "continue", nickname: " ゆき " },
		});
		expect(command({ name: "continue" })).toBeNull();
		expect(command({ name: "continue", nickname: 1 })).toBeNull();
		expect(command({ name: "continue", nickname: "あ".repeat(201) })).toBeNull();
		expect(command({ name: "answer", questionId: "light", stopId: "left" })).toBeNull();
		expect(command({ name: "answer", questionId: "light", answer: "" })).toBeNull();
		expect(command({ name: "answer", questionId: "light", answer: true })).toBeNull();
		expect(command({ name: "answer", questionId: "light", answer: null })).toBeNull();
		expect(command({ name: "answer", questionId: "place", answer: { x: 0.5 } })).toBeNull();
		expect(command({ name: "answer", questionId: "place", answer: { x: "0.5", y: 0.5 } })).toBeNull();
		expect(command({ name: "answer", questionId: "sound", answer: ["birds", 2] })).toBeNull();
		expect(command({ name: "answer", questionId: "sound", answer: Array(21).fill("birds") })).toBeNull();
		expect(command({ name: "answer", questionId: "", answer: "left" })).toBeNull();
		expect(command({ name: "setAccepting", accepting: "no" })).toBeNull();
		expect(command({ name: "previewColor", colorId: "black" })).toBeNull();
		expect(command({ name: "previewColor", colorId: "red" })).toBeNull();
		expect(command({ name: "releaseController" })).toBeNull();
		expect(command("start")).toBeNull();
	});

	it("不明なフィールドを無視し、コマンド固有フィールドは command 内だけを読む", () => {
		expect(
			parseClientMessage(
				JSON.stringify({
					type: "command",
					extra: 1,
					accepting: true,
					command: { name: "start", accepting: true },
				}),
			),
		).toEqual({ type: "command", command: { name: "start" } });
	});

	it("ping は数値の clientSentAt を持つ", () => {
		expect(parseClientMessage(JSON.stringify({ type: "ping", clientSentAt: 5 }))).toEqual({
			type: "ping",
			clientSentAt: 5,
		});
		expect(parseClientMessage(JSON.stringify({ type: "ping", clientSentAt: "5" }))).toBeNull();
	});
});

describe("toDisplayState", () => {
	it("展示ディスプレイへは回答内容と受付状態を渡さない", () => {
		const state = { ...initialState(1), answers: { light: "left" as const }, questionIndex: 2, accepting: false };
		expect(toDisplayState(state)).toEqual({
			sessionId: null,
			phase: "idle",
			sequenceId: null,
			result: null,
			previewColorId: null,
			phaseStartedAt: 1,
			phaseEndsAt: null,
			answeredAt: null,
			doorOpenedAt: null,
			revision: 0,
		});
	});

	it("扉を開いた時刻を渡す。この項目を持たない保存済みの状態は null にする", () => {
		expect(toDisplayState({ ...initialState(1), doorOpenedAt: 88 }).doorOpenedAt).toBe(88);
		const legacy = { ...initialState(1) } as Partial<ReturnType<typeof initialState>>;
		delete legacy.doorOpenedAt;
		expect(toDisplayState(legacy as ReturnType<typeof initialState>).doorOpenedAt).toBeNull();
	});

	it("回答を受け付けた時刻を渡す。この項目を持たない保存済みの状態は null にする", () => {
		expect(toDisplayState({ ...initialState(1), answeredAt: 77 }).answeredAt).toBe(77);
		const legacy = { ...initialState(1) } as Partial<ReturnType<typeof initialState>>;
		delete legacy.answeredAt;
		expect(toDisplayState(legacy as ReturnType<typeof initialState>).answeredAt).toBeNull();
	});

	it("結果は色名、二色、写真IDだけを渡し、結果ページのIDと読み取りは渡さない", () => {
		const state = {
			...initialState(1),
			phase: "result" as const,
			result: {
				id: "0123456789abcdef",
				name: "ミドリノヒカリ",
				reading: "読み取り",
				colors: ["emerald", "amber"] as const,
				photoIds: ["sdi0225"],
			},
		};
		expect(toDisplayState(state).result).toEqual({
			name: "ミドリノヒカリ",
			colors: ["emerald", "amber"],
			photoIds: ["sdi0225"],
		});
	});
});
