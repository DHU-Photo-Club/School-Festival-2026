import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../../src/data/questions.ts";
import { INACTIVITY_MS, JUDGING_MS, RESULT_MS } from "../../src/shared/machine.ts";
import type { DisplayState, ExhibitState, Sequence } from "../../src/shared/types.ts";
import { STALE_AFTER_MS } from "../../src/worker/core.ts";
import type { FakeConnection } from "./helpers.ts";
import { Harness, lastAdminState, sampleAnswer } from "./helpers.ts";

function answerAll(harness: Harness, ipad: FakeConnection) {
	harness.command(ipad, { name: "start" });
	harness.command(ipad, { name: "continue", nickname: "テスト" });
	for (const question of QUESTIONS)
		harness.command(ipad, { name: "answer", questionId: question.id, answer: sampleAnswer(question, 2) });
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
				"resultColorId",
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

	it("nickname がない保存済みの状態は null として読む", () => {
		const harness = new Harness();
		const { nickname: _nickname, ...legacy } = harness.core.current();
		harness.store.put("state", legacy);
		expect(harness.core.current().nickname).toBeNull();
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
		harness.command(ipad, { name: "answer", questionId: QUESTIONS[0].id, answer: 0.137 });
		for (const message of [...display.sent, ...admin.sent]) {
			expect(JSON.stringify(message)).not.toContain("0.137");
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
	it("最終回答が二度届いても結果は一つだけ生成される", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		for (const question of QUESTIONS) {
			harness.command(ipad, { name: "answer", questionId: question.id, answer: sampleAnswer(question, 1) });
		}
		const after = harness.core.current();
		harness.command(ipad, { name: "answer", questionId: QUESTIONS[6].id, answer: 0.75 });
		expect(harness.core.current()).toEqual(after);
		expect(after.phase).toBe("judging");
	});

	it("同じ回答が二度届いても、次の質問をとばさない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue", nickname: "テスト" });
		const answer = { name: "answer", questionId: QUESTIONS[0].id, answer: 0.25 };
		harness.command(ipad, answer);
		harness.command(ipad, answer);
		expect(harness.core.current().questionIndex).toBe(1);
	});

	it("最終回答の受理直後に永続状態の answers が空になる", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		answerAll(harness, ipad);
		const stored = harness.store.get<ExhibitState>("state");
		expect(stored?.answers).toEqual({});
		expect(stored?.resultColorId).not.toBeNull();
		harness.advance(JUDGING_MS);
		expect(harness.core.current()).toMatchObject({ phase: "result", answers: {} });
	});
});

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
			resultColorId: null,
			answers: {},
		});
	});

	it("強制リセット後に回答と結果が残らない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		harness.command(admin, { name: "forceReset" });
		expect(harness.core.current()).toMatchObject({
			phase: "idle",
			answers: {},
			resultColorId: null,
			questionIndex: null,
		});
	});
});

describe("期限", () => {
	it("result 開始から60秒後に操作がなくても idle へ戻して全端末へ配信する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", 1);
		answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		harness.alarm();
		expect(display.lastState()).toMatchObject({ phase: "result" });
		harness.advance(RESULT_MS);
		harness.alarm();
		expect(display.lastState()).toMatchObject({ phase: "idle", sessionId: null });
		expect(ipad.lastState()).toMatchObject({ phase: "idle" });
	});

	it("「最初に戻る」で全端末が同じ状態更新で idle へ戻る", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const displays = [1, 2, 3].map((screen) => harness.connect("display", screen));
		answerAll(harness, ipad);
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
		harness.command(ipad, { name: "answer", questionId: QUESTIONS[0].id, answer: 0.25 });
		expect(harness.core.nextWakeAt()).toBe(harness.time + INACTIVITY_MS);
		harness.advance(INACTIVITY_MS);
		harness.alarm();
		expect(harness.store.get<ExhibitState>("state")).toMatchObject({ phase: "idle", answers: {} });
	});

	it("期限切れの状態を送らず、接続時にも期限を確認する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		answerAll(harness, ipad);
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
