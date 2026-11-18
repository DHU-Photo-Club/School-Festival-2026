import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../../src/data/questions.ts";
import { INACTIVITY_MS, JUDGING_MS, RESULT_MS } from "../../src/shared/machine.ts";
import type { AdminState } from "../../src/shared/protocol.ts";
import type { DisplayState, ExhibitState } from "../../src/shared/types.ts";
import { HELLO_TIMEOUT_MS, PAIRING_TTL_MS, SESSION_TTL_MS, STALE_AFTER_MS } from "../../src/worker/core.ts";
import type { FakeConnection } from "./helpers.ts";
import { Harness, lastAdminState } from "./helpers.ts";

function answerAll(harness: Harness, ipad: FakeConnection) {
	harness.command(ipad, { name: "start" });
	harness.command(ipad, { name: "continue" });
	for (const question of QUESTIONS)
		harness.command(ipad, { name: "answer", questionId: question.id, stopId: "center" });
}

describe("接続と配信", () => {
	it("hello に役割別の状態を welcome で返す", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", { screenId: "display-1" });
		const admin = harness.connect("admin");
		const ipadState = ipad.ofType("welcome")[0].state as ExhibitState;
		const displayState = display.ofType("welcome")[0].state as DisplayState;
		const adminState = admin.ofType("welcome")[0].state as AdminState;
		expect(ipadState).toHaveProperty("answers");
		expect(Object.keys(displayState).sort()).toEqual(
			[
				"phase",
				"phaseEndsAt",
				"phaseStartedAt",
				"previewColorId",
				"resultColorId",
				"revision",
				"sessionId",
			].sort(),
		);
		expect(adminState).not.toHaveProperty("answers");
		// 展示ディスプレイの一覧は、登録済みの画面だけ。
		expect(adminState.devices.map((device) => device.screenId)).toEqual([null, "display-1"]);
	});

	it("command の送信元には ack、ほかの端末には state を配信する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", { screenId: "display-1" });
		const admin = harness.connect("admin");
		display.clear();
		admin.clear();
		const [response] = harness.command(ipad, { name: "start" });
		expect(response).toMatchObject({ type: "ack", revision: 1 });
		expect(ipad.ofType("state")).toHaveLength(0);
		expect(display.ofType("state")[0]).toMatchObject({ revision: 1, state: { phase: "intro" } });
		expect(admin.ofType("state").at(-1)?.state).not.toHaveProperty("answers");
	});

	it("展示ディスプレイと管理画面には回答内容を配信しない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", { screenId: "display-1" });
		const admin = harness.connect("admin");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue" });
		harness.command(ipad, { name: "answer", questionId: QUESTIONS[0].id, stopId: "far-left" });
		for (const message of [...display.sent, ...admin.sent]) {
			expect(JSON.stringify(message)).not.toContain("far-left");
			expect(JSON.stringify(message)).not.toContain('"answers"');
		}
	});

	it("接続、切断、拒否した要求では revision を増やさない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.connect("display", { screenId: "display-2" }).close(1000, "bye");
		harness.command(ipad, { name: "continue" });
		harness.command(ipad, { name: "start" }, { expectedRevision: 99 });
		expect(harness.core.current().revision).toBe(0);
		harness.command(ipad, { name: "start" });
		expect(harness.core.current().revision).toBe(1);
	});
});

describe("検証と権限", () => {
	it("役割に許可されていないコマンドは FORBIDDEN", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		const display = harness.connect("display", { screenId: "display-1" });
		expect(harness.command(ipad, { name: "forceReset" })[0]).toMatchObject({ type: "error", code: "FORBIDDEN" });
		expect(harness.command(admin, { name: "start" })[0]).toMatchObject({ type: "error", code: "FORBIDDEN" });
		expect(harness.command(display, { name: "start" })[0]).toMatchObject({ type: "error", code: "FORBIDDEN" });
	});

	it("expectedRevision が一致しない要求は STALE_REVISION で最新状態を返す", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const [response] = harness.command(ipad, { name: "start" }, { expectedRevision: 5 });
		expect(response).toMatchObject({ type: "error", code: "STALE_REVISION", state: { revision: 0 } });
	});

	it("forceReset 以外は expectedRevision が必須", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const [response] = harness.command(ipad, { name: "start" }, { expectedRevision: null });
		expect(response).toMatchObject({ type: "error", code: "INVALID_MESSAGE" });
	});

	it("不正なメッセージを拒否し、連続3回で 4000 で閉じる", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.send(ipad, { type: "command", requestId: "a", expectedRevision: 0, command: { name: "answer" } });
		harness.send(ipad, { type: "ping", pingId: "x" });
		expect(ipad.closed).toBeNull();
		harness.send(ipad, { type: "unknown" });
		expect(ipad.ofType("error").map((error) => error.code)).toEqual([
			"INVALID_MESSAGE",
			"INVALID_MESSAGE",
			"INVALID_MESSAGE",
		]);
		expect(ipad.closed?.code).toBe(4000);
	});

	it("有効なメッセージで不正の連続回数を戻す", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.send(ipad, { type: "unknown" });
		harness.send(ipad, { type: "unknown" });
		harness.send(ipad, { type: "ping", pingId: "p", clientSentAt: 1 });
		harness.send(ipad, { type: "unknown" });
		expect(ipad.closed).toBeNull();
	});

	it("JSONでないメッセージでは接続を閉じる", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.core.handleMessage(ipad, "{not json");
		expect(ipad.closed).not.toBeNull();
	});

	it("version が1でなければ PROTOCOL_MISMATCH を送って 4002 で閉じる", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.core.handleMessage(ipad, JSON.stringify({ version: 2, type: "ping", pingId: "p", clientSentAt: 1 }));
		expect(ipad.last()).toMatchObject({ type: "error", code: "PROTOCOL_MISMATCH" });
		expect(ipad.closed?.code).toBe(4002);
	});

	it("不明なフィールドは無視する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.send(ipad, {
			type: "command",
			requestId: "r",
			expectedRevision: 0,
			extra: 1,
			command: { name: "start", extra: true },
		});
		expect(ipad.last()).toMatchObject({ type: "ack", requestId: "r" });
	});

	it("接続から5秒以内に hello がなければ 4008 で閉じる", () => {
		const harness = new Harness();
		const display = harness.connect("display", { screenId: "display-1", hello: false });
		harness.advance(HELLO_TIMEOUT_MS - 1);
		harness.alarm();
		expect(display.closed).toBeNull();
		harness.advance(1);
		harness.alarm();
		expect(display.closed?.code).toBe(4008);
	});

	it("ping に serverTime 付きの pong を返す", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.send(ipad, { type: "ping", pingId: "p1", clientSentAt: 123 });
		expect(ipad.last()).toEqual({
			version: 1,
			type: "pong",
			pingId: "p1",
			clientSentAt: 123,
			serverTime: harness.time,
		});
	});
});

describe("冪等性と二重確定", () => {
	it("同じ requestId の再送には同じ応答を返し、revision を増やさない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", { screenId: "display-1" });
		const first = harness.command(ipad, { name: "start" }, { requestId: "same", expectedRevision: 0 });
		display.clear();
		const second = harness.command(ipad, { name: "start" }, { requestId: "same", expectedRevision: 0 });
		expect(second.at(-1)).toEqual(first[0]);
		expect(harness.core.current().revision).toBe(1);
		expect(display.sent).toHaveLength(0);
	});

	it("保存済みの error も同じ応答を返す", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "continue" }, { requestId: "bad" });
		harness.command(ipad, { name: "start" });
		const replay = harness.command(ipad, { name: "continue" }, { requestId: "bad", expectedRevision: 1 });
		expect(replay.at(-1)).toMatchObject({ type: "error", code: "INVALID_PHASE", state: { revision: 0 } });
	});

	it("最終回答を連打しても結果は一つだけ生成される", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue" });
		for (const question of QUESTIONS.slice(0, -1)) {
			harness.command(ipad, { name: "answer", questionId: question.id, stopId: "left" });
		}
		const revision = harness.core.current().revision;
		const final = { name: "answer", questionId: QUESTIONS[6].id, stopId: "left" };
		const first = harness.command(ipad, final, { expectedRevision: revision })[0];
		const second = harness.command(ipad, final, { expectedRevision: revision })[0];
		const resent = harness.command(ipad, final, {
			requestId: (first as { requestId: string }).requestId,
			expectedRevision: revision,
		});
		expect(first).toMatchObject({ type: "ack", revision: revision + 1 });
		expect(second).toMatchObject({ type: "error", code: "STALE_REVISION" });
		expect(resent.at(-1)).toEqual(first);
		expect(harness.core.current()).toMatchObject({ phase: "judging", revision: revision + 1 });
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

describe("強制リセットと操作端末", () => {
	it("iPad操作と強制リセットが競合しても最終状態は idle で、遅れた操作で復帰しない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		harness.command(ipad, { name: "start" });
		const revisionSeenByIpad = harness.core.current().revision;
		harness.command(admin, { name: "forceReset" }, { expectedRevision: null });
		const [late] = harness.command(ipad, { name: "continue" }, { expectedRevision: revisionSeenByIpad });
		expect(late).toMatchObject({ type: "error", code: "STALE_REVISION" });
		expect(harness.core.current()).toMatchObject({
			phase: "idle",
			sessionId: null,
			resultColorId: null,
			answers: {},
		});
	});

	it("forceReset は expectedRevision に関係なく受理し revision を1増やす", () => {
		const harness = new Harness();
		const admin = harness.connect("admin");
		const [response] = harness.command(admin, { name: "forceReset" }, { expectedRevision: 42 });
		expect(response).toMatchObject({ type: "ack", revision: 1 });
	});

	it("強制リセット後に回答と結果が残らない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		harness.command(admin, { name: "forceReset" }, { expectedRevision: null });
		expect(harness.core.current()).toMatchObject({
			phase: "idle",
			answers: {},
			resultColorId: null,
			questionIndex: null,
		});
	});

	it("二台目のiPadには CONTROLLER_IN_USE を返し、管理画面で解放すると操作端末にできる", () => {
		const harness = new Harness();
		const first = harness.connect("controller", { clientId: "ipad-a" });
		const second = harness.connect("controller", { clientId: "ipad-b" });
		const admin = harness.connect("admin");
		expect(second.last()).toMatchObject({ type: "error", code: "CONTROLLER_IN_USE" });
		expect(harness.command(second, { name: "start" })[0]).toMatchObject({
			type: "error",
			code: "CONTROLLER_IN_USE",
		});
		expect(harness.core.current().phase).toBe("idle");

		harness.command(admin, { name: "releaseController" });
		expect(first.closed?.code).toBe(4001);
		expect(harness.core.resolveSession(first.meta.authKey)).toBeNull();
		harness.send(second, { type: "hello", clientId: "ipad-b" });
		expect(second.last()).toMatchObject({ type: "welcome" });
		expect(harness.command(second, { name: "start" })[0]).toMatchObject({ type: "ack" });
	});

	it("同じiPadの再接続へ操作権限を移し、古い接続を 4009 で閉じる", () => {
		const harness = new Harness();
		const authKey = "ipad-key";
		const session = harness.core.issueSession(authKey, "device", "controller", null);
		const old = harness.open(authKey, session, { clientId: "ipad-a" });
		const fresh = harness.open(authKey, session, { clientId: "ipad-a" });
		expect(old.closed?.code).toBe(4009);
		expect(fresh.last()).toMatchObject({ type: "welcome" });
	});
});

describe("期限", () => {
	it("result 開始から60秒後に操作がなくても idle へ戻して全端末へ配信する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const display = harness.connect("display", { screenId: "display-1" });
		answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		harness.alarm();
		expect(display.ofType("state").at(-1)?.state).toMatchObject({ phase: "result" });
		harness.advance(RESULT_MS);
		harness.alarm();
		expect(display.ofType("state").at(-1)?.state).toMatchObject({ phase: "idle", sessionId: null });
		expect(ipad.ofType("state").at(-1)?.state).toMatchObject({ phase: "idle" });
	});

	it("「最初に戻る」で全端末が同じ状態更新で idle へ戻る", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const displays = ["display-1", "display-2", "display-3"].map((screenId) =>
			harness.connect("display", { screenId }),
		);
		answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		const [ack] = harness.command(ipad, { name: "returnToIdle" });
		expect(ack).toMatchObject({ type: "ack" });
		for (const display of displays) {
			expect(display.ofType("state").at(-1)).toMatchObject({
				revision: (ack as { revision: number }).revision,
				state: { phase: "idle" },
			});
		}
	});

	it("question で5分操作がなければ idle へ戻して回答を消去する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue" });
		harness.command(ipad, { name: "answer", questionId: QUESTIONS[0].id, stopId: "left" });
		expect(harness.core.nextWakeAt()).toBeLessThanOrEqual(harness.time + INACTIVITY_MS);
		harness.advance(INACTIVITY_MS);
		// 15秒の切断判定も同時に起きるが、展示状態は期限で idle へ戻る。
		harness.alarm();
		expect(harness.store.get<ExhibitState>("state")).toMatchObject({ phase: "idle", answers: {} });
	});

	it("期限切れの状態を配信せず、次の要求の前に期限を確認する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		answerAll(harness, ipad);
		harness.advance(JUDGING_MS + RESULT_MS + 5);
		const display = harness.connect("display", { screenId: "display-1" });
		expect(display.ofType("welcome")[0].state).toMatchObject({ phase: "idle" });
	});

	it("有効メッセージが15秒届かない端末を切断扱いにし、再接続の welcome 後に接続中へ戻す", () => {
		const harness = new Harness();
		const admin = harness.connect("admin");
		const authKey = "display-key";
		const session = harness.core.issueSession(authKey, "device", "display", "display-1");
		const display = harness.open(authKey, session);
		const connectedOf = () =>
			lastAdminState(admin).devices.find((device) => device.screenId === "display-1")?.connected;
		harness.advance(5_000);
		harness.send(admin, { type: "ping", pingId: "a1", clientSentAt: 1 });
		harness.alarm();
		expect(connectedOf()).toBe(true);
		harness.advance(STALE_AFTER_MS);
		harness.send(admin, { type: "ping", pingId: "a2", clientSentAt: 1 });
		harness.alarm();
		expect(display.closed).not.toBeNull();
		expect(connectedOf()).toBe(false);
		harness.open(authKey, session);
		expect(connectedOf()).toBe(true);
	});
});

describe("認証とペアリング", () => {
	it("未認証は401、役割不一致と画面ID不一致は403", () => {
		const harness = new Harness();
		harness.core.issueSession("display-key", "device", "display", "display-1");
		expect(harness.core.authorizeRealtime(null, "display", "display-1")).toEqual({ ok: false, status: 401 });
		expect(harness.core.authorizeRealtime("unknown", "display", "display-1")).toEqual({ ok: false, status: 401 });
		expect(harness.core.authorizeRealtime("display-key", "controller", null)).toEqual({ ok: false, status: 403 });
		expect(harness.core.authorizeRealtime("display-key", "display", "display-2")).toEqual({
			ok: false,
			status: 403,
		});
		expect(harness.core.authorizeRealtime("display-key", "display", "display-1").ok).toBe(true);
	});

	it("セッションは12時間で失効し、接続中なら UNAUTHENTICATED を送って 4001 で閉じる", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.advance(SESSION_TTL_MS - 1);
		harness.send(ipad, { type: "ping", pingId: "p", clientSentAt: 1 });
		expect(ipad.closed).toBeNull();
		harness.advance(1);
		harness.alarm();
		expect(ipad.ofType("error").at(-1)?.code).toBe("UNAUTHENTICATED");
		expect(ipad.closed?.code).toBe(4001);
	});

	it("新しいセッションの発行時に失効済みのセッションを削除する", () => {
		const harness = new Harness();
		harness.core.issueSession("old-admin", "admin", "admin", null);
		harness.advance(SESSION_TTL_MS);
		harness.core.issueSession("new-admin", "admin", "admin", null);
		expect(harness.store.get("session:old-admin")).toBeUndefined();
		expect(harness.store.get("session:new-admin")).toBeDefined();
	});

	it("ペアリングコードは一回限りで、5分を超えると使えない", () => {
		const harness = new Harness();
		const issued = harness.core.issuePairingCode("controller");
		expect(issued.code).toMatch(/^\d{6}$/);
		expect(harness.core.pair(issued.code, "k1").ok).toBe(true);
		expect(harness.core.pair(issued.code, "k2").ok).toBe(false);

		const expiring = harness.core.issuePairingCode("controller");
		harness.advance(PAIRING_TTL_MS);
		expect(harness.core.pair(expiring.code, "k3").ok).toBe(false);
	});

	it("展示ディスプレイには登録順に、使用中でない最小の番号の画面IDを振る", () => {
		const harness = new Harness();
		const pairDisplay = (key: string) => {
			const paired = harness.core.pair(harness.core.issuePairingCode("display").code, key);
			return paired.ok ? paired.session.screenId : null;
		};
		expect(pairDisplay("k1")).toBe("display-1");
		expect(pairDisplay("k2")).toBe("display-2");
		expect(pairDisplay("k3")).toBe("display-3");
		expect(harness.core.registeredScreens()).toEqual(["display-1", "display-2", "display-3"]);
		// 失効させた番号は次の登録で使う。
		harness.core.revokeSession("k2");
		expect(pairDisplay("k4")).toBe("display-2");
		// 有効期限が切れた端末は台数に数えない。
		harness.advance(SESSION_TTL_MS);
		expect(harness.core.registeredScreens()).toEqual([]);
		expect(pairDisplay("k5")).toBe("display-1");
	});

	it("管理画面の端末一覧は、登録した展示ディスプレイの台数だけ並ぶ", () => {
		const harness = new Harness();
		const admin = harness.connect("admin");
		for (const key of ["a", "b", "c", "d", "e"])
			harness.core.pair(harness.core.issuePairingCode("display").code, key);
		const devices = lastAdminState(admin).devices;
		expect(devices.filter((device) => device.role === "display").map((device) => device.screenId)).toEqual([
			"display-1",
			"display-2",
			"display-3",
			"display-4",
			"display-5",
		]);
	});

	it("端末セッションを失効させると接続を閉じる", () => {
		const harness = new Harness();
		const display = harness.connect("display", { screenId: "display-1" });
		const [session] = harness.core.listDeviceSessions();
		expect(harness.core.revokeDeviceSessionById(session.id)).toBe(true);
		expect(display.closed?.code).toBe(4001);
		expect(harness.core.listDeviceSessions()).toHaveLength(0);
	});
});

describe("結果同期の計測", () => {
	it("結果開始前から接続済みの画面だけで同期差を求める", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		const d1 = harness.connect("display", { screenId: "display-1" });
		const d2 = harness.connect("display", { screenId: "display-2" });
		// display-3 は登録済みだが、結果開始時点では接続していない。
		const d3Session = harness.core.issueSession("d3-key", "device", "display", "display-3");
		answerAll(harness, ipad);
		const judging = harness.core.current();
		const startAt = judging.phaseEndsAt as number;
		harness.advance(JUDGING_MS);
		harness.alarm();
		const d3 = harness.open("d3-key", d3Session);
		const report = (connection: FakeConnection, screenId: string, actualStartedAt: number) =>
			harness.send(connection, {
				type: "resultStarted",
				requestId: `r-${screenId}`,
				sessionId: judging.sessionId,
				screenId,
				actualStartedAt,
			});
		report(d1, "display-1", startAt + 8);
		report(d2, "display-2", startAt + 20);
		report(d3, "display-3", startAt + 500);
		expect(d1.last()).toMatchObject({ type: "ack" });
		const sync = lastAdminState(admin).syncReport;
		expect(sync).toMatchObject({
			sessionId: judging.sessionId,
			resultStartAt: startAt,
			syncSpread: 12,
			startLatency: startAt + 20 - judging.phaseStartedAt,
		});
		expect(sync?.entries.find((entry) => entry.screenId === "display-3")?.excludedReason).toBe("開始時点で切断");
	});

	it("認証セッションの screenId と一致しない報告は受理しない", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const d1 = harness.connect("display", { screenId: "display-1" });
		answerAll(harness, ipad);
		const { sessionId } = harness.core.current();
		harness.advance(JUDGING_MS);
		harness.send(d1, {
			type: "resultStarted",
			requestId: "x",
			sessionId,
			screenId: "display-2",
			actualStartedAt: 1,
		});
		expect(d1.last()).toMatchObject({ type: "error", code: "FORBIDDEN" });
	});
});

describe("運用通知", () => {
	it("現在のセッションと結果色に一致する qrGenerationFailed だけを管理画面へ alert で配信する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		answerAll(harness, ipad);
		harness.advance(JUDGING_MS);
		const { sessionId, resultColorId } = harness.core.current();
		const other = resultColorId === "red" ? "blue" : "red";
		harness.send(ipad, {
			type: "diagnostic",
			requestId: "d1",
			name: "qrGenerationFailed",
			sessionId,
			colorId: other,
			occurredAt: 1,
		});
		expect(ipad.last()).toMatchObject({ type: "error", code: "INVALID_PHASE" });
		harness.send(ipad, {
			type: "diagnostic",
			requestId: "d2",
			name: "qrGenerationFailed",
			sessionId,
			colorId: resultColorId,
			occurredAt: 2,
		});
		expect(ipad.last()).toMatchObject({ type: "ack", requestId: "d2" });
		expect(admin.ofType("alert")).toEqual([
			{ version: 1, type: "alert", name: "qrGenerationFailed", sessionId, colorId: resultColorId, occurredAt: 2 },
		]);
		expect(harness.core.current().phase).toBe("result");
	});

	it("先読み報告を管理画面の端末一覧へ反映する", () => {
		const harness = new Harness();
		const admin = harness.connect("admin");
		const display = harness.connect("display", { screenId: "display-2" });
		harness.send(display, {
			type: "diagnostic",
			requestId: "p",
			name: "preloadReport",
			succeeded: 9,
			failedPhotoIds: ["kari-red-02"],
		});
		const device = lastAdminState(admin).devices.find((entry) => entry.screenId === "display-2");
		expect(device?.preload).toEqual({ succeeded: 9, failedPhotoIds: ["kari-red-02"] });
	});
});

describe("レビュー指摘への対応", () => {
	it("強制リセットで、冪等性記録に残った回答も消える", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue" });
		harness.command(ipad, { name: "answer", questionId: QUESTIONS[0].id, stopId: "far-left" });
		const withAnswers = () =>
			[...harness.store.data.entries()].filter(
				([key, value]) => key.startsWith("idem:") && value.includes("far-left"),
			);
		expect(withAnswers().length).toBeGreaterThan(0);
		harness.command(admin, { name: "forceReset" }, { expectedRevision: null });
		expect(withAnswers()).toEqual([]);
	});

	it("最終回答の受理で冪等性記録の回答も消え、最終回答の再送には同じ応答を返す", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		harness.command(ipad, { name: "start" });
		harness.command(ipad, { name: "continue" });
		for (const question of QUESTIONS.slice(0, -1))
			harness.command(ipad, { name: "answer", questionId: question.id, stopId: "far-right" });
		const revision = harness.core.current().revision;
		const final = { name: "answer", questionId: QUESTIONS[6].id, stopId: "far-right" };
		const [first] = harness.command(ipad, final, { requestId: "final", expectedRevision: revision });
		expect(
			[...harness.store.data.entries()].filter(
				([key, value]) => key.startsWith("idem:") && /"answers":\{"/.test(value),
			),
		).toEqual([]);
		const replay = harness.command(ipad, final, { requestId: "final", expectedRevision: revision });
		expect(replay.at(-1)).toEqual(first);
	});

	it("再接続した展示ディスプレイの前回の先読み報告を消す", () => {
		const harness = new Harness();
		const admin = harness.connect("admin");
		const display = harness.connect("display", { screenId: "display-1" });
		harness.send(display, {
			type: "diagnostic",
			requestId: "p",
			name: "preloadReport",
			succeeded: 10,
			failedPhotoIds: [],
		});
		harness.send(display, { type: "hello", clientId: "again" });
		const device = lastAdminState(admin).devices.find((entry) => entry.screenId === "display-1");
		expect(device?.preload).toBeNull();
	});

	it("サーバーより先に結果開始時刻を過ぎた画面の報告も計測に加える", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		const d1 = harness.connect("display", { screenId: "display-1" });
		answerAll(harness, ipad);
		const { sessionId, phaseEndsAt } = harness.core.current();
		harness.advance(JUDGING_MS - 5);
		harness.send(d1, {
			type: "resultStarted",
			requestId: "early",
			sessionId,
			screenId: "display-1",
			actualStartedAt: (phaseEndsAt as number) + 2,
		});
		expect(d1.last()).toMatchObject({ type: "ack", requestId: "early" });
		harness.advance(5);
		harness.alarm();
		const sync = lastAdminState(admin).syncReport;
		expect(sync?.entries.find((entry) => entry.screenId === "display-1")?.actualStartedAt).toBe(
			(phaseEndsAt as number) + 2,
		);
	});

	it("処理中の例外には INTERNAL_ERROR を返し、状態を変えず、管理画面に障害を表示する", () => {
		const harness = new Harness();
		const ipad = harness.connect("controller");
		const admin = harness.connect("admin");
		const put = harness.store.put.bind(harness.store);
		harness.store.put = (key, value) => {
			if (key === "state") throw new Error("storage failure");
			put(key, value);
		};
		const [response] = harness.command(ipad, { name: "start" });
		harness.store.put = put;
		expect(response).toMatchObject({ type: "error", code: "INTERNAL_ERROR", retryable: true });
		expect(harness.core.current()).toMatchObject({ phase: "idle", revision: 0 });
		expect(lastAdminState(admin).lastInternalErrorAt).not.toBeNull();
	});
});
