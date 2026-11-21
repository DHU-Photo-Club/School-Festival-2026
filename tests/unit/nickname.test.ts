import { describe, expect, it } from "vitest";
import { NICKNAME_MAX_LENGTH, normalizeNickname } from "../../src/shared/nickname.ts";

describe("normalizeNickname", () => {
	it("前後の空白を除き、連続する空白を一つにまとめる", () => {
		expect(normalizeNickname("  ゆき　 ちゃん \n")).toBe("ゆき ちゃん");
	});

	it("制御文字と書式文字を除き、NFCへ正規化する", () => {
		expect(normalizeNickname("ゆ​き‮")).toBe("ゆき");
		expect(normalizeNickname("が")).toBe("が");
	});

	it("空、または最大文字数を超える場合は null", () => {
		expect(normalizeNickname("")).toBeNull();
		expect(normalizeNickname(" ​ ")).toBeNull();
		expect(normalizeNickname("a".repeat(NICKNAME_MAX_LENGTH))).toBe("a".repeat(NICKNAME_MAX_LENGTH));
		expect(normalizeNickname("a".repeat(NICKNAME_MAX_LENGTH + 1))).toBeNull();
	});

	it("絵文字などのサロゲートペアは一文字として数える", () => {
		expect(normalizeNickname("🎨".repeat(NICKNAME_MAX_LENGTH))).toBe("🎨".repeat(NICKNAME_MAX_LENGTH));
	});
});
