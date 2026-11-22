import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../../src/data/questions.ts";
import { INACTIVITY_MS, JUDGING_MS, RESULT_MS } from "../../src/shared/machine.ts";
import type { ResultRecord } from "../../src/shared/result.ts";
import type { DisplayState, ExhibitState, Sequence } from "../../src/shared/types.ts";
import type { Judge } from "../../src/worker/ai/judge.ts";
import { STALE_AFTER_MS } from "../../src/worker/core.ts";
import type { FakeConnection } from "./helpers.ts";
import { Harness, lastAdminState, sampleAnswer } from "./helpers.ts";

/** 最後の質問の手前まで答える。 */
function answerUntilLast(harness: Harness, ipad: FakeConnection) {
	harness.command(ipad, { name: "start" });
	harness.command(ipad, { name: "continue", nickname: "テスト" });
	for (const question of QUESTIONS.slice(0, -1))
		harness.command(ipad, { name: "answer", questionId: question.id, answer: sampleAnswer(question, 2) });
}

/** 最終問に答え、AIの選定を待ち始めたらその Promise を返す。 */
function answerLast(harness: Harness, ipad: FakeConnection): Promise<void> {
	const last = QUESTIONS[QUESTIONS.length - 1];
	const pending = harness.commandWithResult(ipad, {
		name: "answer",
		questionId: last.id,
		answer: sampleAnswer(last, 2),
	});
	if (!pending) throw new Error("最終回答でAIの選定が始まらなかった");
	return pending;
}

/** 全問に答え、AIの選定が終わるまで待つ。 */
async function answerAll(harness: Harness, ipad: FakeConnection) {
	answerUntilLast(harness, ipad);
	await answerLast(harness, ipad);
}

/** 呼び出しを手で解決できる `Judge`。 */
function manualJudge() {
	const calls: { resolve: (record: ResultRecord | null) => void; signal: AbortSignal }[] = [];
	const judge: Judge = (_answers, signal) =>
		new Promise((resolve) => {
			calls.push({ resolve, signal });
		});
	return { judge, calls };
}

describe("接続と配信", () => {
	it("接続した端末へ役割別の現在状態を送る", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		const admin = harness.connect("admin");
		expect(ipad.lastState()).toHaveProperty("answers");
		expect(Object.keys(display.lastState<DisplayState>()).sort()).toEqual(
			[
				"phase",
				"phaseEndsAt",
				"phaseStartedAt",
				"previewColorId",
				"result",
				"revision",
				"sequenceId",
				"sessionId",
			].sort(),
		);
		expect(lastAdminState(admin)).not.toHaveProperty("answers");
		expect(lastAdminState(admin)).not.toHaveProperty("nickname");
	});

	it("ニックネームは診断用iPadにだけ配信する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		const photo = harness.connect("photo", 1);
		const admin = harness.connect("admin");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "ひみつ" });
		expect(ipad.lastState()).toMatchObject({ phase: "question", nickname: "ひみつ" });
		expect(JSON.stringify(display.lastState())).not.toContain("ひみつ");
		expect(JSON.stringify(photo.lastState())).not.toContain("ひみつ");
		expect(JSON.stringify(lastAdminState(admin))).not.toContain("ひみつ");
	});

	it("8色の配点判定の版で保存した状態は、受付状態を保って待機から始める", () => {
		const harness = new Harness();
		const { judgeFailed: _judgeFailed, result: _result, ...rest } = harness.core.current();
		harness.store.put("state", { ...rest, phase: "result", resultColorId: "red", accepting: false, revision: 7 });
		expect(harness.core.current()).toMatchObject({
			phase: "idle",
			result: null,
			judgeFailed: false,
			accepting: false,
			revision: 8,
		});
	});

	it("受理したコマンドの結果を送信元を含む全端末へ配信する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		harness.command(ipad, { name: "start" });
		expect(ipad.lastState()).toMatchObject({ revision: 1, phase: "intro" });
		expect(display.lastState()).toMatchObject({ revision: 1, phase: "intro" });
	});

	it("拒否したコマンドでは状態を変えず、送信元へ現在状態を送り直す", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		ipad.clear();
		display.clear();
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		expect(ipad.states()).toHaveLength(1);
		expect(display.states()).toHaveLength(0);
		expect(harness.core.current().revision).toBe(0);
	});

	it("役割に許可されていないコマンドを拒否する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		const admin = harness.connect("admin");
		harness.command(ipad, { name: "forceReset" });
		harness.command(display, { name: "start" });
		harness.command(admin, { name: "start" });
		expect(harness.core.current()).toMatchObject({ phase: "idle", revision: 0 });
	});

	it("不正なメッセージとバイナリフレームを無視する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		ipad.clear();
		harness.sendRaw(ipad, "not json");
		harness.sendRaw(ipad, new ArrayBuffer(4));
		harness.send(ipad, { type: "command", command: { name: "answer", questionId: "x", answer: true } });
		expect(ipad.sent).toHaveLength(0);
		harness.command(ipad, { name: "start" });
		expect(harness.core.current().phase).toBe("intro");
	});

	it("展示ディスプレイと管理画面には回答内容を配信しない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		const admin = harness.connect("admin");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		harness.command(ipad, { name: "answer", questionId: "Q1", answer: ["q1_3"] });
		harness.command(ipad, { name: "answer", questionId: "Q2", answer: ["q2_4"] });
		harness.command(ipad, { name: "answer", questionId: "Q3", answer: 0.137 });
		expect(harness.core.current().questionIndex).toBe(3);
		for (const message of [...display.sent, ...admin.sent]) {
			expect(JSON.stringify(message)).not.toContain("0.137");
			expect(JSON.stringify(message)).not.toContain("q1_3");
			expect(JSON.stringify(message)).not.toContain('"answers"');
		}
	});

	it("ping に serverTime 付きの pong を返す", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.send(ipad, { type: "ping", clientSentAt: 123 });
		expect(ipad.sent.at(-1)).toEqual({ type: "pong", clientSentAt: 123, serverTime: harness.time });
	});

	it("診断用iPadが複数あっても、どれからでも操作できる", () => {
		const harness = new Harness();
		const first = harness.connect("controller");
		const second = harness.connect("controller");
		harness.command(first, { name: "start" });
		harness.command(second, { name: "continue", nickname: "テスト" });
		expect(harness.core.current().phase).toBe("question");
	});
});

describe("二重操作", () => {
	it("最終回答が二度届いてもAIの選定は一度だけ行う", async () => {
		const { judge, calls } = manualJudge();
		const harness = new Harness({ judge });
		const ipad = harness.connect("controller");
		answerUntilLast(harness, ipad);
		const pending = answerLast(harness, ipad);
		const after = harness.core.current();
		const last = QUESTIONS[QUESTIONS.length - 1];
		expect(
			harness.commandWithResult(ipad, { name: "answer", questionId: last.id, answer: sampleAnswer(last, 2) }),
		).toBeNull();
		expect(harness.core.current()).toEqual(after);
		expect(after.phase).toBe("judging");
		expect(calls).toHaveLength(1);
		calls[0].resolve(null);
		await pending;
	});

	it("同じ回答が二度届いても、次の質問をとばさない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		const answer = { name: "answer", questionId: QUESTIONS[0].id, answer: sampleAnswer(QUESTIONS[0]) };
		harness.command(ipad, answer);
		harness.command(ipad, answer);
		expect(harness.core.current().questionIndex).toBe(1);
	});

	it("AIの選定が終わると、展示状態の answers を消して結果を設定する", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		answerUntilLast(harness, ipad);
		const pending = answerLast(harness, ipad);
		// 選定の間は、失敗したときに最終問へ戻れるよう回答を保つ。
		expect(Object.keys(harness.store.get<ExhibitState>("state")?.answers ?? {})).toHaveLength(QUESTIONS.length);
		await pending;
		const stored = harness.store.get<ExhibitState>("state");
		expect(stored?.answers).toEqual({});
		expect(stored?.result).toMatchObject({ name: "開発用の仮の色", colors: ["emerald", "amber"] });
		harness.advance(JUDGING_MS);
		expect(harness.core.current()).toMatchObject({ phase: "result", answers: {} });
	});
});

describe("AIの選定", () => {
	it("結果の記録を保存し、結果ページには配布を許可した写真だけを渡す", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		await answerAll(harness, ipad);
		const id = harness.core.current().result?.id ?? "";
		const record = harness.core.resultRecord(id);
		expect(record).toMatchObject({ schemaVersion: "color-result-v1", id, questionVersion: "questions-v0.3" });
		expect(Object.keys(record?.answers ?? {})).toHaveLength(QUESTIONS.length);
		const shared = harness.core.publicResult(id);
		expect(shared).toMatchObject({ id, name: "開発用の仮の色" });
		expect(shared).not.toHaveProperty("answers");
		const shareable = new Set(record?.photos.selected.filter((pick) => pick.photoId).map((pick) => pick.photoId));
		for (const photoId of shared?.photoIds ?? []) expect(shareable.has(photoId)).toBe(true);
		expect(harness.core.publicResult("0123456789abcdef")).toBeNull();
		expect(harness.core.publicResult("../state")).toBeNull();
	});

	it("展示ディスプレイには結果ページのIDと読み取りを渡さない", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		await answerAll(harness, ipad);
		const result = display.lastState<DisplayState>().result;
		expect(result).toEqual({ name: "開発用の仮の色", colors: ["emerald", "amber"], photoIds: expect.any(Array) });
	});

	it("選定に失敗したら、回答を保ったまま最終問へ戻して judgeFailed を立てる", async () => {
		const harness = new Harness({ judge: async () => null });
		const ipad = harness.connect("controller");
		await answerAll(harness, ipad);
		expect(harness.core.current()).toMatchObject({
			phase: "question",
			questionIndex: QUESTIONS.length - 1,
			result: null,
			judgeFailed: true,
		});
		expect(Object.keys(harness.core.current().answers)).toHaveLength(QUESTIONS.length);
		// もう一度「次へ」を押すと選定をやり直す。
		const pending = answerLast(harness, ipad);
		expect(harness.core.current()).toMatchObject({ phase: "judging", judgeFailed: false });
		await pending;
	});

	it("選定が設定されていなければ、固定の結果を作らずに最終問へ戻す", async () => {
		const harness = new Harness({ judge: null });
		const ipad = harness.connect("controller");
		await answerAll(harness, ipad);
		expect(harness.core.current()).toMatchObject({ phase: "question", judgeFailed: true, result: null });
		expect(harness.log.join("\n")).toContain("AIの選定が設定されていない");
	});

	it("選定が例外を投げても judging に取り残さない", async () => {
		const harness = new Harness({
			judge: async () => {
				throw new Error("壊れた");
			},
		});
		const ipad = harness.connect("controller");
		await answerAll(harness, ipad);
		expect(harness.core.current()).toMatchObject({ phase: "question", judgeFailed: true });
		expect(harness.log.join("\n")).toContain("壊れた");
	});

	it("judging の期限までに決まらなければ最終問へ戻し、後から届いた結果は使わない", async () => {
		const { judge, calls } = manualJudge();
		const harness = new Harness({ judge, judgingMaxMs: 10_000 });
		const ipad = harness.connect("controller");
		answerUntilLast(harness, ipad);
		const pending = answerLast(harness, ipad);
		harness.advance(10_000);
		harness.alarm();
		expect(harness.core.current()).toMatchObject({ phase: "question", judgeFailed: true });
		const { record } = await stubRecord();
		calls[0].resolve(record);
		await pending;
		expect(harness.core.current()).toMatchObject({ phase: "question", result: null });
		expect(harness.core.resultRecord(record.id)).toBeNull();
	});

	it("早く決まっても judging を最短の長さだけ見せる", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		await answerAll(harness, ipad);
		const state = harness.core.current();
		expect(state.phase).toBe("judging");
		expect(state.phaseEndsAt).toBe(state.phaseStartedAt + JUDGING_MS);
	});

	it("選定の途中で強制リセットされたら、後から届いた結果を使わない", async () => {
		const { judge, calls } = manualJudge();
		const harness = new Harness({ judge });
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		answerUntilLast(harness, ipad);
		const pending = answerLast(harness, ipad);
		harness.command(admin, { name: "forceReset" });
		const { record } = await stubRecord();
		calls[0].resolve(record);
		await pending;
		expect(harness.core.current()).toMatchObject({ phase: "idle", result: null, answers: {} });
	});
});

/** 仮の選定と同じ形の結果の記録。 */
async function stubRecord(): Promise<{ record: ResultRecord }> {
	const harness = new Harness();
	const ipad = harness.connect("controller");
	await answerAll(harness, ipad);
	const record = harness.core.resultRecord(harness.core.current().result?.id ?? "");
	if (!record) throw new Error("記録がない");
	return { record };
}

describe("強制リセット", () => {
	it("強制リセットの後に届いた iPad 操作では診断が復帰しない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		harness.command(ipad, { name: "start" });
		harness.command(admin, { name: "forceReset" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		expect(harness.core.current()).toMatchObject({
			phase: "idle",
			sessionId: null,
			result: null,
			answers: {},
		});
	});

	it("強制リセット後に回答と結果が残らない", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		await answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		harness.command(admin, { name: "forceReset" });
		expect(harness.core.current()).toMatchObject({
			phase: "idle",
			answers: {},
			result: null,
			questionIndex: null,
		});
	});
});

describe("期限", () => {
	it("result 開始から60秒後に操作がなくても idle へ戻して全端末へ配信する", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		await answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		harness.alarm();
		expect(display.lastState()).toMatchObject({ phase: "result" });
		harness.advance(RESULT_MS);
		harness.alarm();
		expect(display.lastState()).toMatchObject({ phase: "idle", sessionId: null });
		expect(ipad.lastState()).toMatchObject({ phase: "idle" });
	});

	it("「最初に戻る」で全端末が同じ状態更新で idle へ戻る", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const displays = [1, 2, 3].map((screen) => harness.connect("display", screen));
		await answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		harness.command(ipad, { name: "returnToIdle" });
		const revision = harness.core.current().revision;
		for (const display of displays) expect(display.lastState()).toMatchObject({ phase: "idle", revision });
	});

	it("question で5分操作がなければ idle へ戻して回答を消去する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		harness.command(ipad, { name: "answer", questionId: QUESTIONS[0].id, answer: sampleAnswer(QUESTIONS[0]) });
		expect(harness.core.nextWakeAt()).toBe(harness.time + INACTIVITY_MS);
		harness.advance(INACTIVITY_MS);
		harness.alarm();
		expect(harness.store.get<ExhibitState>("state")).toMatchObject({ phase: "idle", answers: {} });
	});

	it("期限切れの状態を送らず、接続時にも期限を確認する", async () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		await answerAll(harness, ipad);
		harness.advance(JUDGING_MS + RESULT_MS + 5);
		const display = harness.connect("display", 1);
		expect(display.lastState()).toMatchObject({ phase: "idle" });
	});
});

describe("管理画面の端末一覧", () => {
	it("接続中の端末を種別と画面番号の順に並べる", () => {
		const harness = new Harness();
		harness.connect("photo", 1);
		harness.connect("display", 2);
		harness.connect("display", 1);
		harness.connect("controller");
		const admin = harness.connect("admin");
		expect(lastAdminState(admin).devices.map(({ role, screen }) => [role, screen])).toEqual([
			["controller", null],
			["display", 1],
			["display", 2],
			["photo", 1],
		]);
	});

	it("切断した端末は一覧から消え、15秒受信のない端末は切断と表示する", () => {
		const harness = new Harness();
		const admin = harness.connect("admin");
		const first = harness.connect("display", 1);
		const second = harness.connect("display", 2);
		harness.disconnect(second);
		expect(lastAdminState(admin).devices).toEqual([
			{ role: "display", screen: 1, connected: true, lastReceivedAt: harness.time },
		]);
		harness.advance(STALE_AFTER_MS);
		harness.send(admin, { type: "ping", clientSentAt: 0 });
		expect(lastAdminState(admin).devices[0]).toMatchObject({ screen: 1, connected: false });
		harness.send(first, { type: "ping", clientSentAt: 0 });
		harness.connect("display", 3);
		expect(lastAdminState(admin).devices[0]).toMatchObject({ screen: 1, connected: true });
	});

	it("同じ画面の古い接続が残っていても一行にまとめる", () => {
		const harness = new Harness();
		const admin = harness.connect("admin");
		harness.connect("display", 1);
		harness.advance(STALE_AFTER_MS);
		harness.connect("display", 1);
		expect(lastAdminState(admin).devices).toEqual([
			{ role: "display", screen: 1, connected: true, lastReceivedAt: harness.time },
		]);
	});
});

describe("シーケンス", () => {
	const opening: Sequence = { id: "opening", before: "intro", durationMs: 1_500 };

	it("start でシーケンスを全端末へ配信し、alarm で intro へ進める", () => {
		const harness = new Harness({ sequences: [opening] });
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		harness.command(ipad, { name: "start" });
		expect(display.lastState()).toMatchObject({ phase: "sequence", sequenceId: "opening" });
		expect(harness.core.nextWakeAt()).toBe(harness.time + 1_500);
		harness.advance(1_500);
		harness.alarm();
		expect(display.lastState()).toMatchObject({ phase: "intro", sequenceId: null });
		expect(ipad.lastState()).toMatchObject({ phase: "intro" });
	});
});
