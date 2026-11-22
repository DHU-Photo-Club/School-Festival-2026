/**
 * Mistral AI の Chat Completions API へプロンプトを送る（仕様書6.4節）。
 *
 * Docs: https://docs.mistral.ai/api/#tag/chat
 * `POST /chat/completions` へストリームせずに送り、返答の本文だけを返す。返答はJSONモード
 * （`response_format: { type: "json_object" }`）で受け取る。
 */

export const DEFAULT_MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
export const DEFAULT_MISTRAL_MODEL = "mistral-small-latest";

export interface MistralConfig {
	apiKey: string;
	model: string;
	/** 末尾スラッシュなし。省略すると `DEFAULT_MISTRAL_BASE_URL`。 */
	baseUrl?: string;
}

export interface PromptRequest {
	system?: string;
	prompt: string;
	maxTokens: number;
	signal?: AbortSignal;
}

export class MistralError extends Error {
	/** HTTPステータス。応答を受け取る前の失敗では `null`。 */
	readonly status: number | null;

	constructor(message: string, status: number | null = null) {
		super(message);
		this.name = "MistralError";
		this.status = status;
	}
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 返答から本文を取り出す。`content` は文字列か、推論モデルでは `{ type: "text", text }` と
 * `{ type: "thinking", ... }` の配列になる。配列なら `text` だけをつなぐ。
 */
function replyText(body: unknown): string {
	const choices = isObject(body) && Array.isArray(body.choices) ? body.choices : [];
	const message = isObject(choices[0]) && isObject(choices[0].message) ? choices[0].message : null;
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((chunk): chunk is Json => isObject(chunk) && chunk.type === "text" && typeof chunk.text === "string")
		.map((chunk) => chunk.text as string)
		.join("");
}

/**
 * エラー応答の本文から原因の説明を作る。`message` が文字列でなければ
 * （入力の検証エラーの詳細など）JSONのまま使う。検証エラーは送った回答の一部を含むことがある
 */
function errorMessage(status: number, raw: string): string {
	let detail = raw;
	try {
		const body: unknown = JSON.parse(raw);
		const message = isObject(body) ? (isObject(body.error) ? body.error.message : body.message) : undefined;
		if (typeof message === "string") detail = message;
		else if (message !== undefined) detail = JSON.stringify(message);
	} catch {
		// JSONでなければ本文をそのまま使う。
	}
	const hint: Record<number, string> = {
		401: "APIキーを確認してください（MISTRAL_API_KEY）",
		429: "レート制限です",
	};
	return `Mistral AI ${status}: ${detail}${hint[status] ? `（${hint[status]}）` : ""}`;
}

/** プロンプトを送り、返答の本文を返す。HTTPエラーと空の返答は `MistralError` を投げる。 */
export async function sendPrompt(
	config: MistralConfig,
	request: PromptRequest,
	fetchImpl: Fetch = fetch,
): Promise<string> {
	const baseUrl = (config.baseUrl ?? DEFAULT_MISTRAL_BASE_URL).replace(/\/+$/, "");
	const response = await fetchImpl(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${config.apiKey}`,
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify({
			model: config.model,
			max_tokens: request.maxTokens,
			stream: false,
			response_format: { type: "json_object" },
			messages: [
				...(request.system ? [{ role: "system", content: request.system }] : []),
				{ role: "user", content: request.prompt },
			],
		}),
		signal: request.signal,
	});

	if (!response.ok) throw new MistralError(errorMessage(response.status, await response.text()), response.status);
	const text = replyText(await response.json());

	if (!text.trim()) throw new MistralError("Mistral AI の返答に本文がありません", response.status);
	return text;
}
