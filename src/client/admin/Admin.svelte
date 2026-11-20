<script lang="ts">
import "./admin.css";
import ActivityIcon from "@lucide/svelte/icons/activity";
import BanIcon from "@lucide/svelte/icons/ban";
import BellIcon from "@lucide/svelte/icons/bell";
import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
import EyeOffIcon from "@lucide/svelte/icons/eye-off";
import ImageIcon from "@lucide/svelte/icons/image";
import InboxIcon from "@lucide/svelte/icons/inbox";
import InfoIcon from "@lucide/svelte/icons/info";
import KeyRoundIcon from "@lucide/svelte/icons/key-round";
import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
import MonitorIcon from "@lucide/svelte/icons/monitor";
import MonitorSmartphoneIcon from "@lucide/svelte/icons/monitor-smartphone";
import PaletteIcon from "@lucide/svelte/icons/palette";
import PauseIcon from "@lucide/svelte/icons/pause";
import PlayIcon from "@lucide/svelte/icons/play";
import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
import TabletIcon from "@lucide/svelte/icons/tablet";
import TimerIcon from "@lucide/svelte/icons/timer";
import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
import UnplugIcon from "@lucide/svelte/icons/unplug";
import { onDestroy, onMount } from "svelte";
import * as Alert from "$lib/components/ui/alert/index.js";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import * as Table from "$lib/components/ui/table/index.js";
import { cn } from "$lib/utils.js";
import { RESULT_COLORS } from "../../data/colors.ts";
import { EXHIBIT } from "../../data/exhibit.ts";
import type { Command } from "../../shared/machine.ts";
import type { AdminState, DeviceStatus } from "../../shared/protocol.ts";
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
const DEVICE_ICONS = { controller: TabletIcon, display: MonitorIcon, photo: ImageIcon } as const;
const PHASE_LABELS = {
	idle: "待機",
	sequence: "演出",
	intro: "導入",
	question: "質問",
	judging: "判定",
	result: "結果",
} as const;

/** 全パネルを1画面に収める配置（`wide`）での位置。狭い画面では2列または1列に並べる。 */
const PANEL_CLASSES = {
	state: "wide:col-start-1 wide:row-start-1",
	preview: "wide:col-start-1 wide:row-start-2",
	devices: "md:col-span-2 wide:col-start-2 wide:row-start-1",
	sync: "wide:col-start-2 wide:row-start-2 wide:row-span-2",
	notices: "wide:col-start-1 wide:row-start-3",
	registration: "md:col-span-2 wide:col-span-1 wide:col-start-3 wide:row-start-2 wide:row-span-2",
} as const;

/** パネルの本文。`wide` の配置ではパネルの高さに合わせ、はみ出した分を本文の中でスクロールする。 */
const SCROLL_BODY = "wide:min-h-0 wide:flex-1 wide:overflow-y-auto [scrollbar-width:thin]";
/** 数値を大きく見せる枠と、その中の項目名と値。 */
const TILE = "min-w-0 rounded-lg border bg-muted/40 px-3 py-2.5";
const TILE_LABEL = "text-xs text-muted-foreground";
const TILE_VALUE = "mt-1 truncate text-lg leading-tight font-semibold tabular-nums";
/** 項目名と値の一覧（`dt` と `dd` を交互に並べる）。 */
const DETAILS =
	"grid grid-cols-[max-content_1fr] *:border-b *:py-1 [&>:nth-last-child(-n+2)]:border-0 [&>dt]:pr-3 [&>dt]:text-muted-foreground";
/** 表の見出し行。本文をスクロールしても上端に残す。 */
const STICKY_HEAD = "sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--color-border)] [&_tr]:border-0";

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

const colorOf = (id: string | null) => RESULT_COLORS.find((color) => color.id === id) ?? null;
const colorName = (id: string | null) => colorOf(id)?.name ?? "—";
const time = (value: number | null) =>
	value === null ? "—" : new Date(value).toLocaleTimeString("ja-JP", { hour12: false });
const ms = (value: number | null) => (value === null ? "—" : `${Math.round(value)}ms`);
const devicesOf = (role: DeviceRole): DeviceStatus[] => admin?.devices.filter((device) => device.role === role) ?? [];

const controllerConnected = $derived(
	admin?.devices.some((device) => device.role === "controller" && device.connected) ?? false,
);

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

<!-- 接続状態のバッジ。正常は緑、異常は赤の点と文字で示す。 -->
{#snippet statusBadge(ok: boolean, okLabel: string, badLabel: string)}
	<Badge
		variant="outline"
		class={cn(
			"gap-1.5",
			ok
				? "border-emerald-600/20 bg-emerald-500/10 text-emerald-700"
				: "border-destructive/20 bg-destructive/10 text-red-700",
		)}
	>
		<span class={cn("size-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-destructive")} aria-hidden="true"></span>
		{ok ? okLabel : badLabel}
	</Badge>
{/snippet}

<!-- 空の状態の表示。 -->
{#snippet empty(text: string)}
	<div class="flex flex-col items-center justify-center gap-2 py-6 text-center text-muted-foreground">
		<InboxIcon class="size-5 opacity-60" />
		<p class="text-xs">{text}</p>
	</div>
{/snippet}

<main class="admin flex min-h-dvh flex-col bg-muted/50 font-sans text-sm text-foreground antialiased wide:h-dvh">
	<header class="sticky top-0 z-20 shrink-0 border-b bg-background/85 backdrop-blur-md">
		<div class="mx-auto flex h-14 w-full max-w-[1880px] items-center justify-between gap-3 px-4">
			<div class="flex min-w-0 items-center gap-3">
				<div
					class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
				>
					<LayoutDashboardIcon class="size-4" />
				</div>
				<div class="min-w-0 leading-tight">
					<h1 class="text-sm font-semibold">運営管理</h1>
					<p class="truncate text-xs text-muted-foreground">{EXHIBIT.title}</p>
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				{#if admin}
					<Badge variant="secondary" class="hidden sm:inline-flex">
						<ActivityIcon />{PHASE_LABELS[admin.phase]}
					</Badge>
				{/if}
				{@render statusBadge(status === "open", "サーバー接続中", "サーバー切断")}
			</div>
		</div>
	</header>

	<div class="content flex-1 wide:min-h-0 wide:overflow-y-auto">
		<div class="mx-auto flex w-full max-w-[1880px] flex-col gap-4 p-4 wide:h-full">
			{#if message}
				<Alert.Root variant="destructive" class="message shrink-0 shadow-sm">
					<CircleAlertIcon />
					<Alert.Description>{message}</Alert.Description>
				</Alert.Root>
			{/if}

			<div
				class="dashboard grid gap-4 md:grid-cols-2 wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)] wide:grid-rows-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,3fr)]"
			>
				{#if admin}
					{@const resultColor = colorOf(admin.resultColorId)}
					<section
						class={cn("state-panel min-h-0 min-w-0", PANEL_CLASSES.state)}
						aria-labelledby="state-title"
					>
						<Card.Root size="sm" class="h-full">
							<Card.Header class="border-b">
								<Card.Title class="flex items-center gap-2">
									<ActivityIcon class="size-4 text-muted-foreground" />
									<h2 id="state-title">展示状態</h2>
								</Card.Title>
								<Card.Action>
									{@render statusBadge(admin.accepting, "受付中", "受付停止中")}
								</Card.Action>
							</Card.Header>
							<Card.Content class={cn("flex flex-col gap-3", SCROLL_BODY)}>
								<div class="grid grid-cols-2 gap-2">
									<div class={TILE}>
										<p class={TILE_LABEL}>段階</p>
										<p class={TILE_VALUE} data-testid="phase">
											{PHASE_LABELS[admin.phase]}
											<span class="font-mono text-xs font-normal text-muted-foreground"
												>{admin.phase}{admin.sequenceId ? `: ${admin.sequenceId}` : ""}</span
											>
										</p>
									</div>
									<div class={TILE}>
										<p class={TILE_LABEL}>結果色</p>
										<p class={cn(TILE_VALUE, "flex items-center gap-2")}>
											{#if resultColor}
												<span
													class="size-3 shrink-0 rounded-full ring-1 ring-foreground/15"
													style:background={resultColor.baseColor}
													aria-hidden="true"
												></span>
											{/if}
											<span class="truncate" data-testid="result-color"
												>{resultColor?.name ?? "—"}</span
											>
										</p>
									</div>
								</div>
								<dl class={cn(DETAILS, "text-[0.8rem]")}>
									<dt>revision</dt>
									<dd class="font-mono" data-testid="revision">{admin.revision}</dd>
									<dt>セッション</dt>
									<dd class="font-mono">{admin.sessionId ?? "—"}</dd>
									<dt>操作端末</dt>
									<dd class:text-destructive={admin.controllerAssigned && !controllerConnected}>
										{admin.controllerAssigned
											? controllerConnected
												? "割り当て済み"
												: "割り当て済み（切断中）"
											: "未割り当て"}
									</dd>
									<dt>障害</dt>
									<dd class:text-destructive={admin.lastInternalErrorAt !== null}>
										{admin.lastInternalErrorAt === null
											? "なし"
											: `${time(admin.lastInternalErrorAt)} にサーバー内部の失敗`}
									</dd>
								</dl>
							</Card.Content>
							<Card.Footer class="actions flex-wrap gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => command({ name: "setAccepting", accepting: !admin?.accepting })}
									disabled={busy}
								>
									{#if admin.accepting}
										<PauseIcon />
									{:else}
										<PlayIcon />
									{/if}
									{admin.accepting ? "受付を停止" : "受付を再開"}
								</Button>
								<Button
									variant="outline"
									size="sm"
									onclick={() => command({ name: "releaseController" })}
									disabled={busy || !admin.controllerAssigned}
								>
									<UnplugIcon />操作端末を解放
								</Button>
								<Button
									variant="destructive"
									size="sm"
									class="ml-auto"
									onclick={() => command({ name: "forceReset" })}
									disabled={busy}
								>
									<RotateCcwIcon />強制リセット
								</Button>
							</Card.Footer>
						</Card.Root>
					</section>

					<section
						class={cn("preview-panel min-h-0 min-w-0", PANEL_CLASSES.preview)}
						aria-labelledby="preview-title"
					>
						<Card.Root size="sm" class="h-full">
							<Card.Header class="border-b">
								<Card.Title class="flex items-center gap-2">
									<PaletteIcon class="size-4 text-muted-foreground" />
									<h2 id="preview-title">結果色の表示確認</h2>
								</Card.Title>
								<Card.Description class="text-xs">待機中のみ使えます。</Card.Description>
								<Card.Action>
									<Button
										variant="outline"
										size="xs"
										disabled={busy || admin.previewColorId === null}
										onclick={() => command({ name: "clearPreview" })}
									>
										<EyeOffIcon />表示確認を終了
									</Button>
								</Card.Action>
							</Card.Header>
							<Card.Content class={SCROLL_BODY}>
								<div class="colors grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-1.5 p-0.5">
									{#each RESULT_COLORS as color (color.id)}
										<Button
											variant="outline"
											class="swatch h-8 justify-start gap-2 border-foreground/10 px-3 ring-offset-2 ring-offset-card hover:brightness-110 aria-pressed:ring-2 aria-pressed:ring-primary"
											style="background: {color.backgroundColor}; color: {color.foregroundColor};"
											aria-pressed={admin.previewColorId === color.id}
											disabled={busy || admin.phase !== "idle"}
											onclick={() => command({ name: "previewColor", colorId: color.id })}
										>
											<span
												class="size-3 shrink-0 rounded-full ring-1 ring-white/30"
												style:background={color.baseColor}
											></span>{color.name}
										</Button>
									{/each}
								</div>
							</Card.Content>
						</Card.Root>
					</section>

					<section
						class={cn("devices-panel min-h-0 min-w-0", PANEL_CLASSES.devices)}
						aria-labelledby="devices-title"
					>
						<Card.Root size="sm" class="h-full">
							<Card.Header class="border-b">
								<Card.Title class="flex items-center gap-2">
									<MonitorSmartphoneIcon class="size-4 text-muted-foreground" />
									<h2 id="devices-title">端末</h2>
								</Card.Title>
								<Card.Description class="text-xs" data-testid="display-count">
									展示ディスプレイ
									{devicesOf("display").length}
									台（登録済み）
								</Card.Description>
							</Card.Header>
							<Card.Content class="wide:min-h-0 wide:flex-1">
								<div
									class="device-columns grid gap-3 md:grid-cols-3 wide:h-full wide:grid-rows-[minmax(0,1fr)]"
								>
									{#each DEVICE_ROLES as role (role)}
										{@const devices = devicesOf(role)}
										{@const RoleIcon = DEVICE_ICONS[role]}
										<div
											class="device-group flex min-h-0 min-w-0 flex-col rounded-lg bg-muted/60 p-2"
											role="group"
											aria-labelledby="devices-{role}"
										>
											<div class="flex items-center justify-between gap-2 px-1 pt-0.5 pb-2">
												<div class="flex items-center gap-1.5 text-muted-foreground">
													<RoleIcon class="size-3.5" />
													<h3 id="devices-{role}" class="text-xs font-medium">
														{DEVICE_LABELS[role]}
													</h3>
												</div>
												<span class="text-[0.7rem] text-muted-foreground tabular-nums">
													{devices.filter((device) => device.connected)
														.length}/{devices.length}
													接続
												</span>
											</div>
											<div
												class="device-list grid content-start gap-2 wide:min-h-0 wide:flex-1 wide:overflow-y-auto [scrollbar-width:thin]"
											>
												{#each devices as device (device.screenId ?? "controller")}
													<article
														class="device-card min-w-0 rounded-lg border bg-card p-2.5 shadow-xs"
														data-testid="device-{device.screenId ?? "controller"}"
													>
														<div
															class="mb-1.5 flex flex-wrap items-center justify-between gap-1.5"
														>
															<h4
																class={cn(
																	"text-[0.8rem] font-medium",
																	device.screenId && "font-mono",
																)}
															>
																{device.screenId ?? DEVICE_LABELS.controller}
															</h4>
															{@render statusBadge(device.connected, "接続中", "切断")}
														</div>
														<dl class={cn(DETAILS, "text-xs")}>
															<dt>最終受信</dt>
															<dd class="font-mono">{time(device.lastReceivedAt)}</dd>
															<dt>準備</dt>
															<dd
																class:text-destructive={(device.preload?.failedPhotoIds
																	.length ?? 0) > 0}
															>
																{#if device.role !== "display"}
																	—
																{:else if device.preload}
																	準備完了（成功 {device.preload.succeeded}件{device
																		.preload.failedPhotoIds.length > 0
																		? `、失敗 ${device.preload.failedPhotoIds.join(", ")}`
																		: ""}）
																{:else}
																	未報告
																{/if}
															</dd>
															<dt>時刻同期</dt>
															<dd class:text-destructive={device.clockSync?.degraded}>
																{#if device.clockSync}
																	{device.clockSync.degraded
																		? "同期精度低下"
																		: "正常"}（往復
																	{Math.round(
																		device.clockSync.minRoundTripTime,
																	)}ms、差
																	{Math.round(device.clockSync.offsetSpread)}ms）
																{:else}
																	未計測
																{/if}
															</dd>
														</dl>
													</article>
												{:else}
													<p class="px-1 py-4 text-center text-xs text-muted-foreground">
														登録済みの端末はありません。
													</p>
												{/each}
											</div>
										</div>
									{/each}
								</div>
							</Card.Content>
						</Card.Root>
					</section>

					<section class={cn("sync-panel min-h-0 min-w-0", PANEL_CLASSES.sync)} aria-labelledby="sync-title">
						<Card.Root size="sm" class="h-full">
							<Card.Header class="border-b">
								<Card.Title class="flex items-center gap-2">
									<TimerIcon class="size-4 text-muted-foreground" />
									<h2 id="sync-title">結果同期</h2>
								</Card.Title>
								<Card.Description class="text-xs">
									各画面が結果を表示し始めた時刻のずれを計測します。
								</Card.Description>
							</Card.Header>
							<Card.Content class={cn("flex flex-col gap-3", SCROLL_BODY)}>
								{#if admin.syncReport}
									{@const report = admin.syncReport}
									<div class="grid shrink-0 grid-cols-2 gap-2">
										<div class={TILE}>
											<p class={TILE_LABEL}>同期差</p>
											<p class={TILE_VALUE} data-testid="sync-spread">{ms(report.syncSpread)}</p>
										</div>
										<div class={TILE}>
											<p class={TILE_LABEL}>最終回答の受理から表示開始まで</p>
											<p class={TILE_VALUE}>{ms(report.startLatency)}</p>
										</div>
									</div>
									<Table.Root class="text-xs">
										<Table.Header class={STICKY_HEAD}>
											<Table.Row>
												<Table.Head>画面</Table.Head>
												<Table.Head>開始時刻</Table.Head>
												<Table.Head class="text-right">結果開始時刻との差</Table.Head>
												<Table.Head>計測対象外の理由</Table.Head>
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{#each report.entries as entry (entry.screenId)}
												<Table.Row>
													<Table.Cell class="font-mono">{entry.screenId}</Table.Cell>
													<Table.Cell class="tabular-nums">
														{entry.actualStartedAt === null
															? "未報告"
															: time(entry.actualStartedAt)}
													</Table.Cell>
													<Table.Cell class="text-right font-mono tabular-nums">
														{entry.actualStartedAt === null
															? "—"
															: `${Math.round(entry.actualStartedAt - report.resultStartAt)}ms`}
													</Table.Cell>
													<Table.Cell class="whitespace-normal text-muted-foreground">
														{entry.excludedReason ?? "—"}
													</Table.Cell>
												</Table.Row>
											{/each}
										</Table.Body>
									</Table.Root>
								{:else}
									{@render empty("まだ計測していません。")}
								{/if}
							</Card.Content>
						</Card.Root>
					</section>

					<section
						class={cn("notices-panel min-h-0 min-w-0", PANEL_CLASSES.notices)}
						aria-labelledby="notices-title"
					>
						<Card.Root size="sm" class="h-full">
							<Card.Header class="border-b">
								<Card.Title class="flex items-center gap-2">
									<BellIcon class="size-4 text-muted-foreground" />
									<h2 id="notices-title">運用通知</h2>
								</Card.Title>
								{#if alerts.length > 0}
									<Card.Action>
										<Badge variant="destructive">{alerts.length}件</Badge>
									</Card.Action>
								{/if}
							</Card.Header>
							<Card.Content class={SCROLL_BODY}>
								{#if alerts.length === 0}
									{@render empty("通知はありません。")}
								{:else}
									<ul class="divide-y">
										{#each alerts as alert (alert.sessionId + alert.occurredAt)}
											<li class="flex gap-2.5 py-2 first:pt-0 last:pb-0" data-testid="alert">
												<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-amber-500" />
												<div class="min-w-0 text-xs">
													<p class="font-medium">
														QRコード生成失敗<span class="font-normal text-muted-foreground"
															>（<span class="font-mono">qrGenerationFailed</span>）</span
														>
													</p>
													<p class="text-muted-foreground">
														<span class="font-mono">{time(alert.occurredAt)}</span>
														結果色 {colorName(alert.colorId)} ／ セッション
														<span class="font-mono break-all">{alert.sessionId}</span>
													</p>
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</Card.Content>
						</Card.Root>
					</section>
				{/if}

				<section
					class={cn("registration-panel min-h-0 min-w-0", PANEL_CLASSES.registration)}
					aria-labelledby="registration-title"
				>
					<Card.Root size="sm" class="h-full">
						<Card.Header class="border-b">
							<Card.Title class="flex items-center gap-2">
								<KeyRoundIcon class="size-4 text-muted-foreground" />
								<h2 id="registration-title">端末の登録</h2>
							</Card.Title>
							<Card.Description class="text-xs">
								コードを発行し、登録する端末の画面で入力します。
							</Card.Description>
						</Card.Header>
						<Card.Content class={cn("flex flex-col gap-3", SCROLL_BODY)}>
							<div class="pairing-columns grid shrink-0 gap-2 md:grid-cols-3">
								{#each DEVICE_ROLES as role (role)}
									{@const RoleIcon = DEVICE_ICONS[role]}
									<form
										class="pairing flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/40 p-2.5"
										aria-label="{DEVICE_LABELS[role]}のコード発行"
										onsubmit={(event) => {
											event.preventDefault();
											void issueCode(role);
										}}
									>
										<h3 class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
											<RoleIcon class="size-3.5" />{DEVICE_LABELS[role]}
										</h3>
										<Button
											type="submit"
											size="sm"
											variant={issuing[role] ? "secondary" : "default"}
											class="w-full disabled:opacity-100"
											disabled={issuing[role]}
										>
											{#if issuing[role]}
												<LoaderCircleIcon class="animate-spin" />
											{/if}
											{issuing[role] ? "発行中…" : "コードを発行"}
										</Button>
										<div class="flex min-h-[3.25rem] flex-col items-center justify-center">
											<div class="pairing-result" aria-live="polite">
												{#if issued[role]}
													<p
														class="font-mono text-xl font-semibold tracking-[0.18em] tabular-nums"
														data-testid="pairing-code"
													>
														{issued[role].code}
													</p>
												{/if}
											</div>
											{#if issued[role]}
												<p class="text-[0.7rem] text-muted-foreground">
													{time(issued[role].expiresAt)}
													まで有効
												</p>
											{/if}
										</div>
									</form>
								{/each}
							</div>
							<p class="flex shrink-0 gap-2 rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
								<InfoIcon class="mt-0.5 size-3.5 shrink-0" />
								<span>
									展示ディスプレイは、登録した順に
									display-1、display-2…と番号が付き、その順に写真を割り当てます。来場者から見た順に登録してください。
									写真用は
									photo-1、photo-2…と番号が付き、診断とは独立して待機用の写真を8秒ごとに繰り返し表示します。
								</span>
							</p>
							<Table.Root class="text-xs">
								<Table.Header class={STICKY_HEAD}>
									<Table.Row>
										<Table.Head>端末</Table.Head>
										<Table.Head class="hidden sm:table-cell">発行</Table.Head>
										<Table.Head>最終受信</Table.Head>
										<Table.Head>接続</Table.Head>
										<Table.Head><span class="sr-only">操作</span></Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each sessions as session (session.id)}
										{@const RoleIcon = DEVICE_ICONS[session.role]}
										<Table.Row data-testid="session-{session.id}">
											<Table.Cell class="whitespace-normal">
												<span class="flex items-center gap-1.5">
													<RoleIcon class="size-3.5 shrink-0 text-muted-foreground" />
													<span>
														{session.role === "controller"
															? DEVICE_LABELS.controller
															: `${DEVICE_LABELS[session.role]} ${session.screenId}`}
													</span>
												</span>
											</Table.Cell>
											<Table.Cell class="hidden font-mono sm:table-cell"
												>{time(session.issuedAt)}</Table.Cell
											>
											<Table.Cell class="font-mono">{time(session.lastReceivedAt)}</Table.Cell>
											<Table.Cell>
												{@render statusBadge(session.connected, "接続中", "切断")}
											</Table.Cell>
											<Table.Cell class="text-right">
												<Button
													variant="ghost"
													size="xs"
													class="text-destructive hover:bg-destructive/10 hover:text-destructive"
													onclick={() => revoke(session.id)}
												>
													<BanIcon />失効
												</Button>
											</Table.Cell>
										</Table.Row>
									{:else}
										<Table.Row class="hover:bg-transparent">
											<Table.Cell colspan={5} class="py-6 text-center text-muted-foreground">
												発行済みのセッションはありません。
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</Card.Content>
					</Card.Root>
				</section>
			</div>
		</div>
	</div>
</main>
