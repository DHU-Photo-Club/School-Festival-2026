<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { RESULT_COLORS } from "../../data/colors.ts";
import type { Command } from "../../shared/machine.ts";
import type { AdminState } from "../../shared/protocol.ts";
import type { DeviceRole } from "../../shared/types.ts";
import type { AlertMessage, ConnectionStatus } from "../lib/realtime.ts";
import { RealtimeClient } from "../lib/realtime.ts";

interface SessionRow {
	id: string;
	role: DeviceRole;
	screenId: string | null;
	issuedAt: number;
	expiresAt: number;
	lastReceivedAt: number | null;
	connected: boolean;
}

const DEVICE_ROLES = ["controller", "display", "photo"] as const;
const DEVICE_LABELS = { controller: "診断用iPad", display: "展示ディスプレイ", photo: "写真用" } as const;
const PHASE_LABELS = {
	idle: "待機",
	sequence: "演出",
	intro: "導入",
	question: "質問",
	judging: "判定",
	result: "結果",
} as const;

let admin = $state<AdminState | null>(null);
let status = $state<ConnectionStatus>("connecting");
let busy = $state(false);
let message = $state<string | null>(null);
let alerts = $state<AlertMessage[]>([]);
let sessions = $state<SessionRow[]>([]);
let issued = $state<Partial<Record<DeviceRole, { code: string; expiresAt: number }>>>({});
let issuing = $state<Partial<Record<DeviceRole, boolean>>>({});
let client: RealtimeClient | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const colorName = (id: string | null) => RESULT_COLORS.find((color) => color.id === id)?.name ?? "—";
const time = (value: number | null) =>
	value === null ? "—" : new Date(value).toLocaleTimeString("ja-JP", { hour12: false });

const api = (path: string, init?: RequestInit) => fetch(path, { cache: "no-store", ...init });

/** WebSocket接続に使う管理セッションのCookieを用意する。管理画面は認証しない。 */
const ensureSession = async () => (await api("/api/admin/session", { method: "POST" })).ok;

async function loadSessions() {
	const response = await api("/api/admin/sessions");
	if (!response.ok) return;
	sessions = ((await response.json()) as { sessions: SessionRow[] }).sessions;
}

async function command(next: Command) {
	if (!client || !admin || busy) return;
	busy = true;
	const reply = await client.request(
		next.name === "forceReset"
			? { type: "command", command: next }
			: { type: "command", expectedRevision: admin.revision, command: next },
	);
	busy = false;
	message = reply.type === "error" ? reply.message : null;
	if (next.name === "releaseController") void loadSessions();
}

async function issueCode(role: DeviceRole) {
	if (issuing[role]) return;
	issuing[role] = true;
	try {
		const response = await api("/api/admin/pairing-codes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ role }),
		});
		const body = (await response.json()) as { code?: string; expiresAt?: number; message?: string };
		if (response.ok && body.code && body.expiresAt) {
			issued[role] = { code: body.code, expiresAt: body.expiresAt };
			message = null;
		} else {
			message = body.message ?? "コードを発行できませんでした。";
		}
	} catch {
		message = "コードを発行できませんでした。";
	} finally {
		issuing[role] = false;
	}
}

async function revoke(id: string) {
	await api(`/api/admin/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
	await loadSessions();
}

let destroyed = false;

onMount(async () => {
	await ensureSession().catch(() => false);
	if (destroyed) return;
	client = new RealtimeClient({
		role: "admin",
		onState: (state) => (admin = state as AdminState),
		onStatus: (next) => {
			status = next;
			// 管理セッションが12時間で失効したら、読み込み直して新しいセッションで接続する。
			if (next === "unauthenticated") location.reload();
		},
		onAlert: (alert) => (alerts = [alert, ...alerts].slice(0, 20)),
		// 接続できなかったときはセッションを用意し直して再接続する。発行に失敗しても再接続の間隔を空けて試す。
		checkAuth: async () => {
			await ensureSession().catch(() => false);
			return true;
		},
	});
	client.start();
	void loadSessions();
	refreshTimer = setInterval(() => void loadSessions(), 5_000);
});

onDestroy(() => {
	destroyed = true;
	client?.stop();
	if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<main class="admin">
	<header>
		<h1>運営管理</h1>
		<span class="badge" data-ok={status === "open"}>{status === "open" ? "サーバー接続中" : "サーバー切断"}</span>
	</header>

	{#if message}
		<p class="message" role="alert">{message}</p>
	{/if}

	<div class="dashboard">
		{#if admin}
			<section class="state-panel">
				<h2>展示状態</h2>
				<dl>
					<dt>段階</dt>
					<dd data-testid="phase">
						{PHASE_LABELS[admin.phase]}（{admin.phase}{admin.sequenceId ? `: ${admin.sequenceId}` : ""}）
					</dd>
					<dt>結果色</dt>
					<dd data-testid="result-color">{colorName(admin.resultColorId)}</dd>
					<dt>受付</dt>
					<dd>{admin.accepting ? "受付中" : "停止中"}</dd>
					<dt>revision</dt>
					<dd data-testid="revision">{admin.revision}</dd>
					<dt>セッション</dt>
					<dd>{admin.sessionId ?? "—"}</dd>
					<dt>操作端末</dt>
					<dd>
						{admin.controllerAssigned
							? admin.devices.some((device) => device.role === "controller" && device.connected)
								? "割り当て済み"
								: "割り当て済み（切断中）"
							: "未割り当て"}
					</dd>
					<dt>障害</dt>
					<dd class:bad={admin.lastInternalErrorAt !== null}>
						{admin.lastInternalErrorAt === null
							? "なし"
							: `${time(admin.lastInternalErrorAt)} にサーバー内部の失敗`}
					</dd>
				</dl>
				<div class="actions">
					<button
						type="button"
						onclick={() => command({ name: "setAccepting", accepting: !admin?.accepting })}
						disabled={busy}
					>
						{admin.accepting ? "受付を停止" : "受付を再開"}
					</button>
					<button
						type="button"
						class="danger"
						onclick={() => command({ name: "forceReset" })}
						disabled={busy}
					>
						強制リセット
					</button>
					<button
						type="button"
						onclick={() => command({ name: "releaseController" })}
						disabled={busy || !admin.controllerAssigned}
					>
						操作端末を解放
					</button>
				</div>
			</section>

			<section class="devices-panel">
				<h2>端末</h2>
				<p data-testid="display-count">
					展示ディスプレイ {admin.devices.filter((device) => device.role === "display").length} 台（登録済み）
				</p>
				<div class="device-columns">
					{#each DEVICE_ROLES as role (role)}
						<div class="device-group" role="group" aria-labelledby="devices-{role}">
							<h3 id="devices-{role}">{DEVICE_LABELS[role]}</h3>
							<div class="device-list">
								{#each admin.devices.filter(
									(device) => device.role === role,
								) as device (device.screenId ?? "controller")}
									<article class="device-card" data-testid="device-{device.screenId ?? "controller"}">
										<div class="device-heading">
											<h4>{device.screenId ?? DEVICE_LABELS.controller}</h4>
											<span class:bad={!device.connected}
												>{device.connected ? "接続中" : "切断"}</span
											>
										</div>
										<dl class="device-details">
											<dt>最終受信</dt>
											<dd>{time(device.lastReceivedAt)}</dd>
											<dt>準備</dt>
											<dd>
												{#if device.role !== "display"}
													—
												{:else if device.preload}
													準備完了（成功 {device.preload.succeeded}件{device.preload
														.failedPhotoIds.length > 0
														? `、失敗 ${device.preload.failedPhotoIds.join(", ")}`
														: ""}）
												{:else}
													未報告
												{/if}
											</dd>
											<dt>時刻同期</dt>
											<dd class:bad={device.clockSync?.degraded}>
												{#if device.clockSync}
													{device.clockSync.degraded ? "同期精度低下" : "正常"}（往復
													{Math.round(device.clockSync.minRoundTripTime)}ms、差
													{Math.round(device.clockSync.offsetSpread)}ms）
												{:else}
													未計測
												{/if}
											</dd>
										</dl>
									</article>
								{:else}
									<p class="muted">登録済みの端末はありません。</p>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</section>

			<section class="sync-panel">
				<h2>結果同期</h2>
				{#if admin.syncReport}
					<p>
						同期差
						<strong data-testid="sync-spread"
							>{admin.syncReport.syncSpread === null
								? "—"
								: `${Math.round(admin.syncReport.syncSpread)}ms`}</strong
						>
						／ 最終回答の受理から表示開始まで
						<strong
							>{admin.syncReport.startLatency === null
								? "—"
								: `${Math.round(admin.syncReport.startLatency)}ms`}</strong
						>
					</p>
					<table>
						<thead>
							<tr>
								<th>画面</th>
								<th>開始時刻</th>
								<th>結果開始時刻との差</th>
								<th>計測対象外の理由</th>
							</tr>
						</thead>
						<tbody>
							{#each admin.syncReport.entries as entry (entry.screenId)}
								<tr>
									<td>{entry.screenId}</td>
									<td>{entry.actualStartedAt === null ? "未報告" : time(entry.actualStartedAt)}</td>
									<td>
										{entry.actualStartedAt === null
											? "—"
											: `${Math.round(entry.actualStartedAt - (admin.syncReport?.resultStartAt ?? 0))}ms`}
									</td>
									<td>{entry.excludedReason ?? "—"}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="muted">まだ計測していません。</p>
				{/if}
			</section>

			<section class="preview-panel">
				<h2>結果色の表示確認</h2>
				<div class="colors">
					{#each RESULT_COLORS as color (color.id)}
						<button
							type="button"
							class="swatch"
							style:background={color.backgroundColor}
							style:color={color.foregroundColor}
							aria-pressed={admin.previewColorId === color.id}
							disabled={busy || admin.phase !== "idle"}
							onclick={() => command({ name: "previewColor", colorId: color.id })}
						>
							<span class="dot" style:background={color.baseColor}></span>{color.name}
						</button>
					{/each}
					<button
						type="button"
						disabled={busy || admin.previewColorId === null}
						onclick={() => command({ name: "clearPreview" })}
					>
						表示確認を終了
					</button>
				</div>
			</section>

			<section class="notices-panel">
				<h2>運用通知</h2>
				{#if alerts.length === 0}
					<p class="muted">通知はありません。</p>
				{:else}
					<ul>
						{#each alerts as alert (alert.sessionId + alert.occurredAt)}
							<li data-testid="alert">
								{time(alert.occurredAt)}
								QRコード生成失敗（qrGenerationFailed） 結果色 {colorName(alert.colorId)} ／ セッション
								{alert.sessionId}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<section class="registration-panel">
			<h2>端末の登録</h2>
			<div class="pairing-columns">
				{#each DEVICE_ROLES as role (role)}
					<form
						class="pairing"
						aria-label="{DEVICE_LABELS[role]}のコード発行"
						onsubmit={(event) => {
							event.preventDefault();
							void issueCode(role);
						}}
					>
						<h3>{DEVICE_LABELS[role]}</h3>
						<button type="submit" disabled={issuing[role]}>
							{issuing[role] ? "発行中…" : "コードを発行"}
						</button>
						<div class="pairing-result" aria-live="polite">
							{#if issued[role]}
								<p class="code">
									<strong data-testid="pairing-code">{issued[role].code}</strong>
								</p>
							{/if}
						</div>
					</form>
				{/each}
			</div>
			<p class="muted">
				展示ディスプレイは、登録した順に
				display-1、display-2…と番号が付き、その順に写真を割り当てます。来場者から見た順に登録してください。
				写真用は photo-1、photo-2…と番号が付き、診断とは独立して待機用の写真を8秒ごとに繰り返し表示します。
			</p>
			<table>
				<thead>
					<tr>
						<th>端末</th>
						<th>発行</th>
						<th>最終受信</th>
						<th>接続</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each sessions as session (session.id)}
						<tr data-testid="session-{session.id}">
							<td>
								{session.role === "controller"
									? DEVICE_LABELS.controller
									: `${DEVICE_LABELS[session.role]} ${session.screenId}`}
							</td>
							<td>{time(session.issuedAt)}</td>
							<td>{time(session.lastReceivedAt)}</td>
							<td>{session.connected ? "接続中" : "切断"}</td>
							<td><button type="button" onclick={() => revoke(session.id)}>失効</button></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	</div>
</main>

<style>
.admin {
	max-width: 1920px;
	margin: 0 auto;
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 16px;
	font-size: 14px;
	line-height: 1.5;
}
.dashboard {
	display: grid;
	gap: 16px;
	min-height: 0;
}
section {
	min-width: 0;
	padding: 16px;
	border: 1px solid var(--line);
	border-radius: 12px;
	background: #121211;
	overflow-wrap: anywhere;
}
section > p {
	margin: 0 0 12px;
}
section > p:last-child {
	margin-bottom: 0;
}
.pairing-columns + p {
	margin-top: 12px;
}
.pairing-columns {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 12px;
}
.pairing {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 8px;
	min-width: 0;
	padding: 10px;
	border: 1px solid var(--line);
	border-radius: 8px;
	background: #1a1918;
}
.pairing h3 {
	margin: 0;
	font-size: 14px;
}
.pairing button {
	flex: none;
	margin-top: 0;
	padding: 8px;
}
.pairing-result {
	min-height: 30px;
}
.pairing-result > p {
	margin: 0;
}
.devices-panel {
	display: flex;
	flex-direction: column;
}
.device-columns {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 12px;
}
.device-group {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
}
.device-group h3 {
	margin: 0 0 10px;
	font-size: 14px;
}
.device-list {
	display: grid;
	align-content: start;
	gap: 8px;
	min-height: 0;
}
.device-list > p {
	margin: 0;
}
.device-card {
	min-width: 0;
	padding: 12px;
	border: 1px solid var(--line);
	border-radius: 8px;
	background: #1a1918;
}
.device-heading {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: baseline;
	gap: 4px 8px;
	margin-bottom: 8px;
}
.device-heading h4 {
	margin: 0;
	font-size: 14px;
}
.device-details {
	margin: 0;
	gap: 4px 8px;
}
ul {
	margin: 0;
	padding-left: 20px;
}
li + li {
	margin-top: 8px;
}
header {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 16px;
	flex-shrink: 0;
}
h1 {
	margin: 0;
	font-size: 22px;
}
h2 {
	margin: 0 0 12px;
	font-size: 17px;
}
.badge {
	padding: 4px 10px;
	border-radius: 12px;
	background: #5a1d1d;
}
.badge[data-ok="true"] {
	background: #1d3a2a;
}
dl {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 6px 16px;
	margin: 0 0 12px;
}
dt {
	color: var(--muted);
}
dd {
	margin: 0;
}
.actions,
.colors {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
button {
	padding: 8px 14px;
	border: 1px solid var(--line);
	border-radius: 8px;
	background: #1a1918;
	color: var(--text);
	cursor: pointer;
}
button:disabled {
	opacity: 0.4;
	cursor: default;
}
.danger {
	border-color: #a33;
}
.swatch {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}
.swatch[aria-pressed="true"] {
	outline: 3px solid var(--text);
}
.dot {
	width: 14px;
	height: 14px;
	border-radius: 50%;
}
table {
	width: 100%;
	border-collapse: collapse;
}
th,
td {
	padding: 6px 8px;
	border-bottom: 1px solid var(--line);
	text-align: left;
}
.bad {
	color: #ff8a80;
}
.muted {
	color: var(--muted);
}
.message {
	margin: 0;
	padding: 10px 14px;
	border-radius: 8px;
	background: #3a2a10;
}
.code {
	margin: 0;
}
.code strong {
	display: block;
	font-size: 20px;
	letter-spacing: 0.1em;
	white-space: nowrap;
}
@media (max-width: 767px) {
	.device-columns,
	.pairing-columns {
		grid-template-columns: minmax(0, 1fr);
	}
}
@media (min-width: 1200px) and (min-height: 800px) {
	.admin {
		height: 100dvh;
	}
	.dashboard {
		flex: 1;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr);
		grid-template-rows: minmax(310px, 1.2fr) minmax(170px, 0.7fr) minmax(120px, 0.6fr);
		grid-template-areas:
			"state devices devices"
			"preview sync registration"
			"notices sync registration";
	}
	section {
		min-height: 0;
		overflow: auto;
		scrollbar-gutter: stable;
	}
	.state-panel {
		grid-area: state;
	}
	.devices-panel {
		grid-area: devices;
	}
	.device-columns {
		flex: 1;
		min-height: 0;
	}
	.device-list {
		overflow: auto;
		scrollbar-gutter: stable;
	}
	.sync-panel {
		grid-area: sync;
	}
	.preview-panel {
		grid-area: preview;
	}
	.notices-panel {
		grid-area: notices;
	}
	.registration-panel {
		grid-area: registration;
	}
	th {
		position: sticky;
		top: -16px;
		background: #121211;
	}
}
</style>
