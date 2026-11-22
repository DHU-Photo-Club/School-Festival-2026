import { describe, expect, it } from "vitest";
import { MistralError, sendPrompt } from "../../src/worker/mistral.ts";

interface Captured {
	url: string;
	init: RequestInit;
	body: Record<string, unknown>;
	headers: Record<string, string>;
}

function fakeFetch(reply: unknown, status = 200) {
	const calls: Captured[] = [];
	const fetchImpl = async (url: string, init: RequestInit) => {
		calls.push({
			url,
			init,
			body: JSON.parse(String(init.body)),
			headers: init.headers as Record<string, string>,
		});
		return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status });
	};
	return { calls, fetchImpl };
}

describe("sendPrompt", () => {
	it("/chat/completions へJSONモードで送り、本文を返す", async () => {
		const { calls, fetchImpl } = fakeFetch({ choices: [{ message: { content: '{"colorId":"blue"}' } }] });
		const text = await sendPrompt(
			{ apiKey: "key", model: "mistral-small-latest" },
			{ system: "sys", prompt: "hi", maxTokens: 10 },
			fetchImpl,
		);
		expect(text).toBe('{"colorId":"blue"}');
		expect(calls[0].url).toBe("https://api.mistral.ai/v1/chat/completions");
		expect(calls[0].headers).toMatchObject({ authorization: "Bearer key" });
		expect(calls[0].body).toEqual({
			model: "mistral-small-latest",
			max_tokens: 10,
			stream: false,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: "hi" },
			],
		});
	});

	it("ベースURLを上書きでき、推論モデルの配列の本文から text だけを読む", async () => {
		const { calls, fetchImpl } = fakeFetch({
			choices: [
				{
					message: {
						content: [
							{ type: "thinking", thinking: [{ type: "text", text: "考え中" }] },
							{ type: "text", text: "ok" },
						],
					},
				},
			],
		});
		const text = await sendPrompt(
			{ apiKey: "key", model: "magistral-small-latest", baseUrl: "https://example.test/v1/" },
			{ prompt: "hi", maxTokens: 10 },
			fetchImpl,
		);
		expect(text).toBe("ok");
		expect(calls[0].url).toBe("https://example.test/v1/chat/completions");
		expect(calls[0].body.messages).toEqual([{ role: "user", content: "hi" }]);
	});

	it("HTTPエラーと空の返答は MistralError を投げる", async () => {
		const config = { apiKey: "bad", model: "mistral-small-latest" };
		const unauthorized = fakeFetch({ message: "Unauthorized" }, 401);
		await expect(sendPrompt(config, { prompt: "hi", maxTokens: 1 }, unauthorized.fetchImpl)).rejects.toThrow(
			/401: Unauthorized.*MISTRAL_API_KEY/,
		);
		const empty = fakeFetch({ choices: [{ message: { content: "" } }] });
		await expect(sendPrompt(config, { prompt: "hi", maxTokens: 1 }, empty.fetchImpl)).rejects.toBeInstanceOf(
			MistralError,
		);
	});
});

describe("エラーのログ", () => {
	const config = { apiKey: "key", model: "mistral-small-latest" };

	it("JSONでない本文は、そのまま含める", async () => {
		const html = `<html>\n  <body>Bad Gateway${"x".repeat(400)}</body>\n</html>`;
		await expect(
			sendPrompt(config, { prompt: "hi", maxTokens: 1 }, fakeFetch(html, 502).fetchImpl),
		).rejects.toThrow(`Mistral AI 502: ${html}`);
	});

	it("message が文字列でない検証エラーは、詳細をJSONのまま含める", async () => {
		const body = { message: { detail: [{ loc: ["body", "max_tokens"], msg: "too small", input: 0 }] } };
		await expect(
			sendPrompt(config, { prompt: "hi", maxTokens: 0 }, fakeFetch(body, 422).fetchImpl),
		).rejects.toThrow('Mistral AI 422: {"detail":[{"loc":["body","max_tokens"],"msg":"too small","input":0}]}');
	});
});
