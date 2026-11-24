// スマート電球（Matter）の中継スクリプト。会場のPCで動かす。
// Workerの `/api/realtime?role=light` から展示状態を受け取り、電球の色を変える。
// 通常は白色、結果の表示中はAIが選んだ二色を電球の並び順に交互に割り当てる（`src/shared/lights.ts`）。
//
//   pnpm lights pair <ペアリングコード>   電球を登録する（登録した順が電球の並び順）
//   pnpm lights list                      登録した電球の一覧
//   pnpm lights identify <番号>           電球を点滅させて、どれが何番かを確かめる
//   pnpm lights remove <番号>             電球の登録を外す
//   pnpm lights                           展示状態に合わせて電球を動かす（`LIGHT_ORIGIN` が必要）
//
// 設定は環境変数か `.env.lights` で渡す（`.env.lights.example`）。
import { join } from "node:path";
import type { ClientNode } from "@matter/main";
import { ControllerBehavior, Environment, Logger, LogLevel, NodeConnectionState, ServerNode } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import { ColorControlClient } from "@matter/main/behaviors/color-control";
import { IdentifyClient } from "@matter/main/behaviors/identify";
import { LevelControlClient } from "@matter/main/behaviors/level-control";
import { OnOffClient } from "@matter/main/behaviors/on-off";
import { GeneralCommissioning } from "@matter/main/clusters/general-commissioning";
import { LIGHT_SETTINGS } from "../src/data/lights.ts";
import { PALETTE } from "../src/data/palette.ts";
import type { LightTarget } from "../src/shared/lights.ts";
import {
	lightScene,
	lightTargets,
	sameTarget,
	toMatterHueSaturation,
	toMatterXy,
	toTransitionTime,
} from "../src/shared/lights.ts";
import type { ServerMessage } from "../src/shared/protocol.ts";
import type { DisplayState } from "../src/shared/types.ts";

const ROOT = join(import.meta.dirname, "..");
/** 生存確認の `ping` の間隔と、`pong` が途絶えたとみなす時間。iPadや展示ディスプレイと同じ値。 */
const PING_INTERVAL_MS = 5_000;
const PONG_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** 送信に失敗した電球へ送り直す間隔。 */
const RETRY_INTERVAL_MS = 5_000;
/** 電球の構成（エンドポイント）を読み終えるまで待つ上限と、確かめる間隔。 */
const SEED_TIMEOUT_MS = 30_000;
const SEED_POLL_MS = 250;
/** 展示へのWebSocketの接続が開くまで待つ上限。 */
const OPEN_TIMEOUT_MS = 15_000;
/** `identify` で点滅させる秒数。 */
const IDENTIFY_SECONDS = 10;

type ClientEndpoint = ClientNode["endpoints"] extends Iterable<infer E> ? E : never;

/** 色を変えられるエンドポイント一つ。一つの機器に複数あれば、それぞれを電球一つとして数える。 */
interface Bulb {
	label: string;
	peer: ClientNode;
	endpoint: ClientEndpoint;
	/** xy 色空間で色を指定できるか。できなければ色相と彩度で指定する。 */
	xy: boolean;
	/** xy 色空間に対応しないとき、白色を色温度で指定できるか。 */
	temperature: boolean;
	/** LevelControl の OnOff 機能があるか（`MoveToLevelWithOnOff` を使えるか）。 */
	levelWithOnOff: boolean;
	/** 最後に送り終えた目標。送信に失敗したら `null` に戻し、次の同期で送り直す。 */
	applied: LightTarget | null;
	busy: boolean;
	/** 送信中に再接続した。送り終えても `applied` を残さず、もう一度送る。 */
	resync: boolean;
}

function die(message: string): never {
	console.error(message);
	process.exit(1);
}

const environment = Environment.default;
// matter.js の保存先（コントローラーの鍵と登録した電球）。`MATTER_STORAGE_PATH` で変えられる。
if (environment.vars.get("storage.path") === undefined) {
	environment.vars.set("storage.path", join(ROOT, ".matter-lights"));
}
if (environment.vars.get("log.level") === undefined) Logger.level = LogLevel.WARN;

async function createController(): Promise<ServerNode> {
	return ServerNode.create(ServerNode.RootEndpointWithoutGroupcast.with(ControllerBehavior), {
		environment,
		id: "light-bridge",
		commissioning: { enabled: false },
		controller: { adminFabricLabel: "dpc-school-festival" },
		subscriptions: { persistenceEnabled: false },
	});
}

/**
 * 構成を読み終えるまで待つ。上限を過ぎたら `false`。
 * `lifecycle.seeded` は待ち始める前の通知を繰り返さないため、`isSeeded` を一定間隔で確かめる。
 */
async function waitSeeded(peer: ClientNode): Promise<boolean> {
	const deadline = Date.now() + SEED_TIMEOUT_MS;
	while (!peer.lifecycle.isSeeded) {
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, SEED_POLL_MS));
	}
	return true;
}

/** 登録した機器を登録した順に並べる。 */
function commissionedPeers(controller: ServerNode): ClientNode[] {
	const at = (peer: ClientNode) => Number(peer.state.commissioning.commissionedAt ?? 0);
	return [...controller.peers.commissioned].sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
}

function productName(peer: ClientNode): string {
	const info = peer.maybeStateOf(BasicInformationClient);
	return [info?.vendorName, info?.productName].filter(Boolean).join(" ") || "（名前不明）";
}

/** 電球の並び。機器の登録順、機器の中ではエンドポイント番号の順。 */
async function collectBulbs(controller: ServerNode): Promise<Bulb[]> {
	const bulbs: Bulb[] = [];
	for (const peer of commissionedPeers(controller)) {
		if (!(await waitSeeded(peer))) {
			console.warn(`${peer.id}（${productName(peer)}）の構成を読めませんでした。電球の並びから外します。`);
			continue;
		}
		const endpoints = [...peer.endpoints]
			.filter((endpoint) => endpoint.behaviors.has(ColorControlClient))
			.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
		if (endpoints.length === 0) console.warn(`${peer.id}（${productName(peer)}）は色を変えられない機器です。`);
		for (const endpoint of endpoints) {
			const features = endpoint.featuresOf(ColorControlClient);
			if (!features.xy && !features.hueSaturation) {
				console.warn(`${peer.id} の endpoint ${endpoint.number} は色温度しか変えられないため使いません。`);
				continue;
			}
			const level = endpoint.behaviors.has(LevelControlClient) ? endpoint.featuresOf(LevelControlClient) : null;
			bulbs.push({
				label: `${bulbs.length + 1}. ${productName(peer)}（${peer.id} endpoint ${endpoint.number}）`,
				peer,
				endpoint,
				xy: Boolean(features.xy),
				temperature: Boolean(features.colorTemperature),
				levelWithOnOff: Boolean(level?.onOff),
				applied: null,
				busy: false,
				resync: false,
			});
		}
	}
	return bulbs;
}

/** 消灯中でも色を変える（Matter ColorControl の ExecuteIfOff）。 */
const COLOR_OPTIONS = { optionsMask: { executeIfOff: true }, optionsOverride: { executeIfOff: true } } as const;

/** どの命令で失敗したかをエラーに残す。 */
async function step(name: string, run: () => Promise<unknown>): Promise<void> {
	try {
		await run();
	} catch (error) {
		throw new Error(`${name}の命令に失敗しました`, { cause: error });
	}
}

/** 電球一つを目標の色へ移す。点灯と明るさもそろえる。 */
async function applyTarget(bulb: Bulb, target: LightTarget): Promise<void> {
	const { endpoint } = bulb;
	const scene = lightScene(target, LIGHT_SETTINGS);
	const transitionTime = toTransitionTime(scene.transitionSeconds);
	const hasLevel = endpoint.behaviors.has(LevelControlClient);
	const levelRequest = { level: scene.level, transitionTime, optionsMask: {}, optionsOverride: {} };
	if (hasLevel && bulb.levelWithOnOff) {
		await step("点灯と明るさ（MoveToLevelWithOnOff）", () =>
			endpoint.commandsOf(LevelControlClient).moveToLevelWithOnOff(levelRequest),
		);
	} else {
		// LevelControl の OnOff 機能がない電球は、点灯と明るさを別の命令で送る。
		if (endpoint.behaviors.has(OnOffClient)) {
			await step("点灯（On）", () => endpoint.commandsOf(OnOffClient).on());
		}
		if (hasLevel) {
			await step("明るさ（MoveToLevel）", () =>
				endpoint.commandsOf(LevelControlClient).moveToLevel(levelRequest),
			);
		}
	}
	const color = endpoint.commandsOf(ColorControlClient);
	if (bulb.xy) {
		await step("色（MoveToColor）", () =>
			color.moveToColor({ ...toMatterXy(scene.xy), transitionTime, ...COLOR_OPTIONS }),
		);
		return;
	}
	if (target.kind === "white" && bulb.temperature) {
		await step("色温度（MoveToColorTemperature）", () =>
			color.moveToColorTemperature({
				colorTemperatureMireds: LIGHT_SETTINGS.whiteMireds,
				transitionTime,
				...COLOR_OPTIONS,
			}),
		);
		return;
	}
	const hs = target.kind === "white" ? { hue: 0, saturation: 0 } : toMatterHueSaturation(target.color);
	await step("色（MoveToHueAndSaturation）", () =>
		color.moveToHueAndSaturation({ ...hs, transitionTime, ...COLOR_OPTIONS }),
	);
}

const targetName = (target: LightTarget) =>
	target.kind === "white" ? "白色" : (PALETTE.colors.find((c) => c.id === target.colorId)?.name ?? target.colorId);

/** 展示状態に合わせて電球を動かす。 */
class LightSync {
	private state: DisplayState | null = null;
	private readonly bulbs: Bulb[];

	constructor(bulbs: Bulb[]) {
		this.bulbs = bulbs;
	}

	update(state: DisplayState | null): void {
		this.state = state;
		this.syncAll();
	}

	/** 電球が再接続したら、電源の入れ直しで色が戻っている場合に備えて送り直す。 */
	reset(peer: ClientNode): void {
		for (const bulb of this.bulbs) {
			if (bulb.peer !== peer) continue;
			bulb.applied = null;
			bulb.resync = true;
		}
		this.syncAll();
	}

	/**
	 * 一定間隔で呼ぶ。送れなかった電球に送り直し、アプリや壁のスイッチで消された電球を点け直す。
	 * 消灯は購読で届いた状態から分かる。色や明るさだけを変えられた場合は、次の段階の切り替えまで直らない。
	 */
	tick(): void {
		for (const bulb of this.bulbs) {
			if (bulb.applied && bulb.endpoint.maybeStateOf(OnOffClient)?.onOff === false) {
				console.warn(`${bulb.label} が消えているため、点け直します。`);
				bulb.applied = null;
			}
		}
		this.syncAll();
	}

	syncAll(): void {
		this.bulbs.forEach((bulb, index) => {
			this.sync(bulb, () => this.targetAt(index)).catch((error: unknown) => {
				console.error(`${bulb.label} の同期で予期しないエラーが起きました。`, error);
			});
		});
	}

	private targetAt(index: number): LightTarget {
		return lightTargets(this.state, PALETTE.colors, this.bulbs.length)[index];
	}

	/** 送信中に目標が変わったら、送り終えてから最新の目標を送る。 */
	private async sync(bulb: Bulb, targetOf: () => LightTarget): Promise<void> {
		if (bulb.busy) return;
		bulb.busy = true;
		try {
			for (;;) {
				const target = targetOf();
				if (bulb.applied && sameTarget(bulb.applied, target)) return;
				if (!bulb.peer.lifecycle.isConnected) {
					bulb.applied = null;
					return;
				}
				bulb.resync = false;
				try {
					await applyTarget(bulb, target);
					// 送信中に再接続したら、電球の状態が送る前に戻っている場合があるため、もう一度送る。
					bulb.applied = bulb.resync ? null : target;
					console.log(`${bulb.label} → ${targetName(target)}`);
				} catch (error) {
					bulb.applied = null;
					console.warn(
						`${bulb.label} へ送れませんでした。電球とつながっていれば${RETRY_INTERVAL_MS / 1000}秒ごとに、切れていればつながり直したときに送り直します。`,
						error,
					);
					return;
				}
			}
		} finally {
			bulb.busy = false;
		}
	}
}

/** Workerの展示状態を受け取る。切れたら待ち時間を倍にしながら接続し直す。 */
function connectExhibit(origin: string, onState: (state: DisplayState) => void): void {
	const url = new URL("/api/realtime", origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("role", "light");
	// Cloudflare Access のサービストークン（仕様書14章）。開発サーバーでは不要。
	const headers: Record<string, string> = {};
	const clientId = process.env.CF_ACCESS_CLIENT_ID?.trim();
	const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET?.trim();
	if (clientId && clientSecret) {
		headers["CF-Access-Client-Id"] = clientId;
		headers["CF-Access-Client-Secret"] = clientSecret;
	}

	let attempt = 0;
	let lastPongAt = 0;
	let socket: WebSocket | null = null;

	const reconnect = () => {
		const current = socket;
		socket = null;
		current?.close();
		const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
		attempt += 1;
		console.warn(`展示の状態を受け取れません。${(delay / 1000).toFixed(1)}秒後に接続し直します。`);
		setTimeout(open, delay);
	};

	const open = () => {
		// Node.js の WebSocket（undici）は第2引数でリクエストヘッダーを受け付ける。
		const next = new WebSocket(url, { headers } as unknown as string[]);
		socket = next;
		lastPongAt = Date.now();
		// 応答のない回線では `open` も `close` も届かないため、待つ上限を設ける。
		const openTimer = setTimeout(() => {
			if (next === socket && next.readyState === WebSocket.CONNECTING) reconnect();
		}, OPEN_TIMEOUT_MS);
		next.addEventListener("open", () => {
			clearTimeout(openTimer);
			attempt = 0;
			console.log(`展示に接続しました: ${url.origin}`);
		});
		next.addEventListener("message", (event) => {
			if (next !== socket || typeof event.data !== "string") return;
			let message: ServerMessage;
			try {
				message = JSON.parse(event.data) as ServerMessage;
			} catch {
				return;
			}
			if (message.type === "pong") lastPongAt = Date.now();
			else onState(message.state as DisplayState);
		});
		next.addEventListener("close", () => {
			clearTimeout(openTimer);
			if (next === socket) reconnect();
		});
		next.addEventListener("error", () => {
			// `close` が続いて届くため、ここでは何もしない。
		});
	};

	setInterval(() => {
		if (socket?.readyState !== WebSocket.OPEN) return;
		if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
			reconnect();
			return;
		}
		try {
			socket.send(JSON.stringify({ type: "ping", clientSentAt: Date.now() }));
		} catch (error) {
			console.warn("生存確認を送れませんでした。", error);
		}
	}, PING_INTERVAL_MS);
	open();
}

async function run(controller: ServerNode): Promise<void> {
	const origin = process.env.LIGHT_ORIGIN?.trim();
	if (!origin)
		die("LIGHT_ORIGIN に展示のURL（例: https://dpc-school-festival.<subdomain>.workers.dev）を設定してください。");

	await controller.start();
	const bulbs = await collectBulbs(controller);
	if (bulbs.length === 0)
		die("色を変えられる電球が登録されていません。pnpm lights pair <ペアリングコード> で登録してください。");
	console.log(`電球 ${bulbs.length} 個:`);
	for (const bulb of bulbs) console.log(`  ${bulb.label}`);

	// 電球の操作が失敗しても中継を止めない。画面の診断には影響しないため、続けるほうがよい。
	process.on("unhandledRejection", (error) => console.error("予期しないエラーが起きました。", error));
	process.on("uncaughtException", (error) => console.error("予期しないエラーが起きました。", error));

	const sync = new LightSync(bulbs);
	for (const peer of new Set(bulbs.map((bulb) => bulb.peer))) {
		peer.lifecycle.connectionStateChanged.on((state) => {
			if (state === NodeConnectionState.Connected) sync.reset(peer);
		});
	}
	// 展示に接続するまでは白色にする。
	sync.update(null);
	setInterval(() => sync.tick(), RETRY_INTERVAL_MS);
	connectExhibit(origin, (state) => sync.update(state));
}

async function pair(controller: ServerNode, pairingCode: string | undefined): Promise<void> {
	if (!pairingCode) die("使い方: pnpm lights pair <ペアリングコード（11桁の数字か MT: から始まるQRコードの文字列）>");
	await controller.start();
	console.log("電球を探しています。電球と同じネットワークにつないでおいてください。");
	const peer = await controller.peers.commission({
		pairingCode: pairingCode.replace(/[\s-]/g, ""),
		regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.Indoor,
		regulatoryCountryCode: "JP",
	});
	await waitSeeded(peer);
	console.log(`登録しました: ${peer.id}（${productName(peer)}）`);
}

async function bulbAt(controller: ServerNode, number: string | undefined, usage: string): Promise<Bulb> {
	const index = Number(number) - 1;
	await controller.start();
	const bulbs = await collectBulbs(controller);
	const bulb = Number.isInteger(index) ? bulbs[index] : undefined;
	if (!bulb) die(`${usage}\n番号は pnpm lights list で確かめてください。`);
	return bulb;
}

async function list(controller: ServerNode): Promise<void> {
	await controller.start();
	const bulbs = await collectBulbs(controller);
	if (bulbs.length === 0) console.log("電球は登録されていません。");
	bulbs.forEach((bulb, index) => {
		const mode = bulb.xy ? "xy" : "色相・彩度";
		console.log(`${bulb.label}  ${mode}  → 結果の${index % 2 === 0 ? "一色目" : "二色目"}`);
	});
}

async function identify(controller: ServerNode, number: string | undefined): Promise<void> {
	const bulb = await bulbAt(controller, number, "使い方: pnpm lights identify <番号>");
	if (!bulb.endpoint.behaviors.has(IdentifyClient)) {
		die(`${bulb.label} は点滅の機能（Identify）を持っていません。`);
	}
	await bulb.endpoint.commandsOf(IdentifyClient).identify({ identifyTime: IDENTIFY_SECONDS });
	console.log(`${bulb.label} を${IDENTIFY_SECONDS}秒点滅させます。`);
}

async function remove(controller: ServerNode, number: string | undefined): Promise<void> {
	const bulb = await bulbAt(controller, number, "使い方: pnpm lights remove <番号>");
	try {
		await bulb.peer.decommission();
	} catch (error) {
		console.warn("電球と通信できなかったため、この端末の記録だけを消します。電球の初期化が必要です。", error);
		await bulb.peer.delete();
	}
	console.log(`${bulb.label} の登録を外しました。`);
}

const [command, ...args] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const controller = await createController();
const shutdown = async () => {
	await controller.close();
	process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

switch (command) {
	case undefined:
	case "run":
		await run(controller);
		break;
	case "pair":
		await pair(controller, args[0]);
		await shutdown();
		break;
	case "list":
		await list(controller);
		await shutdown();
		break;
	case "identify":
		await identify(controller, args[0]);
		await shutdown();
		break;
	case "remove":
		await remove(controller, args[0]);
		await shutdown();
		break;
	default:
		die(`知らないコマンドです: ${command}（pair、list、identify、remove、run）`);
}
