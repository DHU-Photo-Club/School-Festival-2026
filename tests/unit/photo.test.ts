import { describe, expect, it } from "vitest";
import { QUESTIONS } from "../../src/data/questions.ts";
import { parseScreenNumber } from "../../src/shared/screens.ts";
import { Harness } from "./helpers.ts";

describe("画面番号", () => {
	it("URLの1以上の整数だけを画面番号として読む", () => {
		expect(parseScreenNumber("1")).toBe(1);
		expect(parseScreenNumber("12")).toBe(12);
		for (const value of ["0", "01", "-1", "1.5", "display-1", "", "1000", null]) {
			expect(parseScreenNumber(value)).toBeNull();
		}
	});
});

describe("写真用", () => {
	it("展示を操作できず、回答を受け取らない", () => {
		const harness = new Harness();
		const photo = harness.connect("photo", 1);
		const controller = harness.connect("controller");
		harness.command(photo, { name: "start" });
		harness.command(photo, { name: "forceReset" });
		expect(harness.core.current().revision).toBe(0);
		harness.command(controller, { name: "start" });
		harness.command(controller, { name: "continue", nickname: "テスト" });
		harness.command(controller, { name: "answer", questionId: QUESTIONS[0].id, answer: 0.137 });
		expect(JSON.stringify(photo.sent)).not.toContain('"answers"');
		expect(JSON.stringify(photo.sent)).not.toContain("0.137");
	});
});
