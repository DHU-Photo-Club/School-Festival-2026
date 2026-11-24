import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { SPLIT_MAX, SPLIT_MIN } from "../../src/client/controller/split.ts";
import { PHOTOS } from "../../src/data/photos.ts";
import { QUESTIONS } from "../../src/data/questions.ts";
import { SEQUENCES } from "../../src/data/sequences.ts";
import { resultPhotoFor } from "../../src/shared/assignment.ts";
import type { Question } from "../../src/shared/types.ts";
import type { Device } from "./fixtures.ts";
import {
	answerInput,
	answerQuestion,
	backgroundHex,
	canvasPixel,
	choiceOption,
	dragCell,
	dragSlider,
	ExhibitHarness,
	enterNickname,
	expectQuestion,
	mapValue,
	recordQuestionOverlap,
	STUB_RESULT,
	sliderValue,
	stubScreenColor,
	tapCell,
	tapMapAt,
	tapSliderAt,
	tapStop,
} from "./fixtures.ts";

const revisionOf = async (device: Device) =>
	Number(await device.page.locator("main.display").getAttribute("data-revision"));

/**
 * 入力方式ごとの操作を一通り試す。終了時は、スライダーと2Dマップは最後に選んだ位置、
 * 単選択は最後の選択肢を選んだ状態、複数選択と順位つき選択は何も選んでいない状態。
 */
async function exploreInput(page: Page, question: Question) {
	const next = page.getByRole("button", { name: "次へ" });
	switch (question.kind) {
		case "slider": {
			// 操作面は画面の幅全体を覆う。仕切り線の可動範囲の右端をタップすると、左の領域が広がり左端の回答に、
			// 左端をタップすると右端の回答になる。
			const viewport = page.viewportSize();
			const area = await page.locator(".slider .area").boundingBox();
			if (!viewport || !area) throw new Error("slider area not found");
			expect(area.x).toBe(0);
			expect(area.width).toBeCloseTo(viewport.width, 0);
			for (const [split, value] of [
				[SPLIT_MAX, 0],
				[SPLIT_MIN, 1],
			]) {
				await page.mouse.click(viewport.width * split, viewport.height / 2);
				await expect.poll(() => sliderValue(page)).toBe(value);
				const divider = await page.locator(".slider .divider").boundingBox();
				if (!divider) throw new Error("slider divider not found");
				expect(Math.abs(divider.x + divider.width / 2 - viewport.width * split)).toBeLessThan(2);
			}
			// 可動範囲の外（画面の左右の端）をタップすると、近い側の端の回答になる。
			for (const [x, value] of [
				[1, 1],
				[viewport.width - 1, 0],
			]) {
				await page.mouse.click(x, viewport.height / 2);
				await expect.poll(() => sliderValue(page)).toBe(value);
			}
			// ボタンの並ぶ下部の余白はフッターが受け取り、操作面へ届かない。届けば中央の回答（0.5）になる。
			const footer = await page.locator(".question footer").boundingBox();
			if (!footer) throw new Error("footer not found");
			const gap = { x: footer.x + footer.width / 2, y: footer.y + footer.height / 2 };
			expect(
				await page.evaluate(
					({ x, y }) => document.elementFromPoint(x, y)?.matches(".question footer") ?? false,
					gap,
				),
			).toBe(true);
			await page.mouse.click(gap.x, gap.y);
			expect(await sliderValue(page)).toBe(0);
			// 画面のタップで5段階の回答位置すべてを選べる。補助文は最も近い回答位置のもの。
			for (const [stop, { caption }] of question.stops.entries()) {
				await tapStop(page, stop);
				await expect.poll(() => sliderValue(page)).toBeCloseTo(stop / 4, 2);
				expect(await sliderValue(page)).not.toBeNull();
				await expect(page.locator(".slider .caption")).toHaveText(caption);
			}
			// 回答位置の間をタップすると、つまみはスナップせずその位置に止まる。
			await tapSliderAt(page, 0.4);
			await expect.poll(() => sliderValue(page)).toBeCloseTo(0.4, 1);
			expect(await sliderValue(page)).not.toBeCloseTo(0.5, 2);
			await expect(page.locator(".slider .caption")).toHaveText(question.stops[2].caption);
			// つまみのドラッグで、指の位置へ移る。離した位置でスナップしない。
			await dragSlider(page, 0.9, 0.35, async () => {
				await expect(answerInput(page)).toHaveAttribute("data-mode", "dragging");
			});
			await expect(answerInput(page)).toHaveAttribute("data-mode", "active");
			await expect.poll(() => sliderValue(page)).toBeCloseTo(0.35, 1);
			expect(await sliderValue(page)).not.toBeCloseTo(0.25, 2);
			await expect(page.locator(".slider .caption")).toHaveText(question.stops[1].caption);
			// 読み上げとキーボード用のラジオボタンでも、矢印キーで別の回答位置へ移れる。
			// 選んだ回答位置へは、つまみがその回答位置ちょうどに動く。
			await page.getByRole("radio", { name: question.stops[1].caption, exact: true }).focus();
			await page.keyboard.press("ArrowRight");
			await expect(page.getByRole("radio", { name: question.stops[2].caption, exact: true })).toBeChecked();
			await expect.poll(() => sliderValue(page)).toBe(0.5);
			break;
		}
		case "map":
			// 平面のタップで9区画すべてを選べる。補助文は位置を含む区画のもの。
			for (const [cell, { caption }] of question.cells.entries()) {
				await tapCell(page, cell);
				await expect(page.locator(".map .area")).toHaveAttribute("data-cell", String(cell));
				await expect(page.locator(".map .caption")).toHaveText(caption);
			}
			// 区画の中心以外をタップすると、ピンはスナップせずその位置に止まる。
			await tapMapAt(page, 0.4, 0.2);
			await expect.poll(async () => (await mapValue(page))?.x).toBeCloseTo(0.4, 1);
			expect((await mapValue(page))?.y).toBeCloseTo(0.2, 1);
			await expect(page.locator(".map .area")).toHaveAttribute("data-cell", "1");
			// ピンのドラッグで、指の位置へ移る。
			await dragCell(page, 0, 8, async () => {
				await expect(answerInput(page)).toHaveAttribute("data-mode", "dragging");
				await expect(page.locator(".map .area")).toHaveAttribute("data-cell", "8");
			});
			await expect(answerInput(page)).toHaveAttribute("data-mode", "active");
			// 読み上げとキーボード用のラジオボタンでも、矢印キーで区画を選べる。
			await page.getByRole("radio", { name: question.cells[8].caption, exact: true }).focus();
			await page.keyboard.press("ArrowLeft");
			await expect(page.getByRole("radio", { name: question.cells[7].caption, exact: true })).toBeChecked();
			await expect(page.locator(".map .area")).toHaveAttribute("data-cell", "7");
			break;
		case "single":
			// 選び直すと、前に選んだ選択肢の選択が外れる。
			for (const [index, { label }] of question.options.entries()) {
				await choiceOption(page, question, index).click();
				await expect(choiceOption(page, question, index)).toHaveAttribute("aria-checked", "true");
				if (index > 0)
					await expect(choiceOption(page, question, index - 1)).toHaveAttribute("aria-checked", "false");
				await expect(page.locator(".choices .caption")).toHaveText(label);
			}
			break;
		case "ranked": {
			// 選んだ順に順位が付き、外すと残りが繰り上がる。上限に達すると選んでいない選択肢は押せない。
			const ranks = () => page.locator(".option.checked .rank").allInnerTexts();
			await choiceOption(page, question, 2).click();
			await expect(next).toBeDisabled();
			await choiceOption(page, question, 0).click();
			await expect(next).toBeEnabled();
			// 選択肢は定義順に並び、順位の印は選んだ順。
			expect(await page.locator(".option.checked .label").allInnerTexts()).toEqual([
				question.options[0].label,
				question.options[2].label,
			]);
			expect(await ranks()).toEqual(["2", "1"]);
			await expect(choiceOption(page, question, 1)).toHaveAttribute("aria-disabled", "true");
			await choiceOption(page, question, 2).click();
			expect(await ranks()).toEqual(["1"]);
			await choiceOption(page, question, 0).click();
			await expect(next).toBeDisabled();
			await expect(answerInput(page)).toHaveAttribute("data-mode", "unanswered");
			break;
		}
		case "multiple": {
			// 下限に届くまで「次へ」は無効、上限に達すると選んでいない選択肢は押せない。
			const picks = Array.from({ length: question.maxSelections }, (_, index) => index);
			for (const index of picks) {
				if (index + 1 < question.minSelections) await expect(next).toBeDisabled();
				await choiceOption(page, question, index).click();
				await expect(choiceOption(page, question, index)).toHaveAttribute("aria-checked", "true");
			}
			await expect(next).toBeEnabled();
			if (question.maxSelections < question.options.length)
				await expect(choiceOption(page, question, question.maxSelections)).toHaveAttribute(
					"aria-disabled",
					"true",
				);
			// 単独選択の選択肢（「どれとも決められない」）は上限でも押せ、ほかの選択を置き換える。
			const exclusive = question.options.findIndex((option) => option.exclusive);
			if (exclusive !== -1) {
				await expect(choiceOption(page, question, exclusive)).not.toHaveAttribute("aria-disabled", "true");
				await choiceOption(page, question, exclusive).click();
				await expect(page.locator(".option.checked")).toHaveCount(1);
				await expect(choiceOption(page, question, exclusive)).toHaveAttribute("aria-checked", "true");
				// ほかの選択肢を押すと、単独選択の選択肢は外れる。
				await choiceOption(page, question, picks[0]).click();
				await expect(choiceOption(page, question, exclusive)).toHaveAttribute("aria-checked", "false");
				await choiceOption(page, question, picks[1]).click();
			}
			// すべて外すと未回答へ戻る。
			for (const index of picks) await choiceOption(page, question, index).click();
			await expect(next).toBeDisabled();
			await expect(answerInput(page)).toHaveAttribute("data-mode", "unanswered");
			break;
		}
	}
}

for (const displayCount of [1, 3]) {
	test(`展示${displayCount}画面: 開始から結果、最初に戻るまで`, async ({ browser }) => {
		test.setTimeout(240_000);
		const harness = await ExhibitHarness.open(browser);
		const displays = await harness.openDisplays(displayCount);
		const ipad = await harness.openDevice("controller");
		const { page } = ipad;

		await page.getByRole("button", { name: "はじめる" }).click();
		await enterNickname(page);
		await expectQuestion(page, 0);
		for (const display of displays)
			await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "question");

		const explored = new Set<Question["kind"]>();
		for (const [index, question] of QUESTIONS.entries()) {
			await expectQuestion(page, index);
			await expect(page.getByRole("heading", { name: question.prompt })).toBeVisible();
			await expect(page.getByText(question.guide)).toBeVisible();
			const next = page.getByRole("button", { name: "次へ" });
			await expect(answerInput(page)).toHaveAttribute("data-answer-input", question.kind);
			if (question.kind === "slider" || question.kind === "map") {
				// スライダーと2Dマップは真ん中から始まり、そのまま「次へ」で送れる。
				await expect(next).toBeEnabled();
				await expect(answerInput(page)).toHaveAttribute("data-mode", "active");
				if (question.kind === "slider") expect(await sliderValue(page)).toBe(0.5);
				else expect(await mapValue(page)).toEqual({ x: 0.5, y: 0.5 });
			} else {
				// 初めて開いた選択式の質問では「次へ」が無効で、入力は未回答の表示。
				await expect(next).toBeDisabled();
				await expect(answerInput(page)).toHaveAttribute("data-mode", "unanswered");
			}

			const before = await revisionOf(displays[0]);
			if (!explored.has(question.kind)) {
				// 入力方式ごとに最初の質問で操作を一通り試す。操作だけでは revision が増えない。
				explored.add(question.kind);
				await exploreInput(page, question);
				await page.waitForTimeout(300);
				expect(await revisionOf(displays[0])).toBe(before);
			}
			await answerQuestion(page, question, index);
			await expect(next).toBeEnabled();
			// 最初の質問から次の質問へ移るときに、前後の質問が重なって入れ替わることを確かめる（docs/visual-language.md 4.5節）。
			const overlap = index === 0 ? await recordQuestionOverlap(page) : null;
			await next.click();
			if (overlap) {
				await expectQuestion(page, 1);
				expect(await overlap()).toBe(2);
			}
			if (index < QUESTIONS.length - 1) {
				// 一問確定するたびに全画面の revision が増える。破片の輪のふくらみは単体テスト（motion.test.ts）で確かめる。
				for (const display of displays) await expect.poll(() => revisionOf(display)).toBe(before + 1);
			}
			if (index === 1) {
				// 戻ると直前の回答が復元され、変更して再確定できる。
				expect(question.kind).toBe("multiple");
				await page.getByRole("button", { name: "戻る" }).click();
				await expectQuestion(page, 1);
				await expect(choiceOption(page, question, 1)).toHaveAttribute("aria-checked", "true");
				await expect(answerInput(page)).toHaveAttribute("data-mode", "answered");
				await choiceOption(page, question, 3).click();
				await expect(answerInput(page)).toHaveAttribute("data-mode", "active");
				await page.getByRole("button", { name: "次へ" }).click();
				await expectQuestion(page, 2);
			}
		}

		await expect(page.getByText("あなたの色を選んでいます")).toBeVisible();
		for (const display of displays)
			await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "judging");

		// iPadに色名と二色を表示し、展示ディスプレイは二色を画面の順に交互に見せる。
		await expect(page.getByText("あなたの色は")).toBeVisible({ timeout: 5_000 });
		await expect(page.locator(".color-name")).toHaveText(STUB_RESULT.name);
		await expect(page.locator(".palette-names")).toHaveText(
			`${stubScreenColor(0).name} と ${stubScreenColor(1).name}`,
		);
		for (const [displayOrder, display] of displays.entries()) {
			await expect(display.page.locator("main.display")).toHaveAttribute(
				"data-result-color",
				stubScreenColor(displayOrder).id,
			);
		}
		await displays[0].page.waitForTimeout(4_500);
		const shown: string[] = [];
		for (const [displayOrder, display] of displays.entries()) {
			expect(await canvasPixel(display.page, 0.01, 0.01)).toBe(backgroundHex(stubScreenColor(displayOrder)));
			// 写真がある画面は選定した写真の displayOrder 番目、足りない画面は複製せずに色名のタイポグラフィ。
			const assigned = resultPhotoFor(PHOTOS, STUB_RESULT.photoIds, displayOrder);
			if (assigned) {
				await expect(display.page.locator("main.display")).toHaveAttribute("data-result-view", "photo");
				await expect(display.page.locator(`.photo[data-result-photo="${assigned.id}"] img`)).toBeVisible();
				shown.push(assigned.id);
			} else {
				await expect(display.page.locator("main.display")).toHaveAttribute("data-result-view", "typography");
				await expect(display.page.locator(".color-name")).toHaveText(stubScreenColor(displayOrder).name);
			}
		}
		// 同じ写真を複数の画面へ割り当てない。
		expect(new Set(shown).size).toBe(shown.length);

		// QRコードと結果URL。結果ページのIDは16桁の16進数。
		await expect(page.getByRole("img", { name: "結果ページのQRコード" })).toBeVisible();
		await expect(page.locator(".url")).toHaveText(/^https:\/\/.+\/result\/[0-9a-f]{16}$/);

		// 結果表示中に再読み込みした画面は、演出を再生せず完了状態を表示する。
		await displays[0].page.reload();
		await expect(displays[0].page.locator("main.display")).toHaveAttribute(
			"data-result-color",
			stubScreenColor(0).id,
		);
		expect(await canvasPixel(displays[0].page, 0.01, 0.01)).toBe(backgroundHex(stubScreenColor(0)));

		await page.getByRole("button", { name: "最初に戻る" }).click();
		await expect(page.getByRole("button", { name: "はじめる" })).toBeVisible();
		for (const display of displays)
			await expect(display.page.locator("main.display")).toHaveAttribute("data-phase", "idle");
		await expect(page.locator(".qr")).toHaveCount(0);

		for (const device of [...displays, ipad]) await device.context.close();
		await harness.close();
	});
}

test("「はじめる」の後、iPadと展示ディスプレイがシーケンスを再生して intro へ入る", async ({ browser }) => {
	const sequence = SEQUENCES.find((candidate) => candidate.before === "intro");
	test.skip(!sequence, "intro の前のシーケンスが定義されていない");
	if (!sequence) return;
	const harness = await ExhibitHarness.open(browser);
	const [display] = await harness.openDisplays(1);
	const ipad = await harness.openDevice("controller");
	const { page } = ipad;
	const main = display.page.locator("main.display");
	try {
		await page.getByRole("button", { name: "はじめる" }).click();
		// iPadと展示ディスプレイのどちらにも、シーケンスのコンポーネントを表示する。
		await expect(page.locator(`main[data-phase="sequence"] [data-sequence="${sequence.id}"]`)).toBeVisible();
		await expect(main).toHaveAttribute("data-phase", "sequence");
		await expect(main.locator(`.sequence[data-sequence="${sequence.id}"]`)).toHaveCount(1);
		// 再生時間が過ぎるとサーバーが intro へ進め、展示ディスプレイの重ねた層を外す。
		await expect(page.getByRole("button", { name: "進む" })).toBeVisible({ timeout: sequence.durationMs + 10_000 });
		await expect(main).toHaveAttribute("data-phase", "intro");
		await expect(main.locator(".sequence")).toHaveCount(0);
	} finally {
		for (const device of [display, ipad]) await device.context.close();
		await harness.close();
	}
});
