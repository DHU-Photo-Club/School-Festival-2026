<script lang="ts">
import "./admin.css";
import ActivityIcon from "@lucide/svelte/icons/activity";
import EyeOffIcon from "@lucide/svelte/icons/eye-off";
import ImageIcon from "@lucide/svelte/icons/image";
import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
import LightbulbIcon from "@lucide/svelte/icons/lightbulb";
import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
import MonitorIcon from "@lucide/svelte/icons/monitor";
import MonitorSmartphoneIcon from "@lucide/svelte/icons/monitor-smartphone";
import PaletteIcon from "@lucide/svelte/icons/palette";
import PauseIcon from "@lucide/svelte/icons/pause";
import PlayIcon from "@lucide/svelte/icons/play";
import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
import TabletIcon from "@lucide/svelte/icons/tablet";
import { onDestroy, onMount } from "svelte";
import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";
import { cn } from "$lib/utils.js";
import { EXHIBIT } from "../../data/exhibit.ts";
import { PALETTE } from "../../data/palette.ts";
import type { Command } from "../../shared/machine.ts";
import { backgroundColor, baseColor, foregroundColor, gradientCss, paletteColor } from "../../shared/palette.ts";
import type { AdminState, DeviceStatus } from "../../shared/protocol.ts";
import type { DeviceRole } from "../../shared/types.ts";
import type { ConnectionStatus } from "../lib/realtime.ts";
import { RealtimeClient } from "../lib/realtime.ts";

const DEVICE_ROLES = ["controller", "display", "photo", "light"] as const;
const DEVICE_LABELS = {
	controller: "診断用iPad",
	display: "展示ディスプレイ",
	photo: "写真用",
	light: "電球の中継",
} as const;
const DEVICE_ICONS = { controller: TabletIcon, display: MonitorIcon, photo: ImageIcon, light: LightbulbIcon } as const;
/** 各端末で開くURL。展示ディスプレイは来場者から見た順に1から番号を振る。電球の中継はURLではなくコマンドで動かす。 */
const DEVICE_PATHS = {
	controller: "/",
	display: "/display/1, /display/2…",
	photo: "/photo/1, /photo/2…",
	light: "pnpm lights",
} as const;
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
	devices: "md:col-span-2 wide:col-span-1 wide:col-start-2 wide:row-start-1 wide:row-span-2",
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

let admin = $state<AdminState | null>(null);
let status = $state<ConnectionStatus>("connecting");
/** 送信してからサーバーの `state` が届くまで `true`。 */
let busy = $state(false);
let client: RealtimeClient | null = null;

const time = (value: number | null) =>
	value === null ? "—" : new Date(value).toLocaleTimeString("ja-JP", { hour12: false });
const devicesOf = (role: DeviceRole): DeviceStatus[] => admin?.devices.filter((device) => device.role === role) ?? [];
const deviceName = (device: DeviceStatus) =>
	device.screen === null ? DEVICE_LABELS[device.role] : `${DEVICE_LABELS[device.role]} ${device.screen}`;
const deviceKey = (device: DeviceStatus) => (device.screen === null ? device.role : `${device.role}-${device.screen}`);

/** 結果の二色。 */
const resultColors = $derived(
	admin?.result
		? admin.result.colors.map((id) => paletteColor(PALETTE.colors, id)).filter((color) => color !== null)
		: [],
);

function command(next: Command) {
	if (!client || !admin || busy) return;
	busy = client.send(next);
}

onMount(() => {
	client = new RealtimeClient({
		role: "admin",
		onState: (state) => {
			admin = state as AdminState;
			busy = false;
		},
		onStatus: (next) => {
			status = next;
			if (next !== "open") busy = false;
		},
	});
	client.start();
});

onDestroy(() => client?.stop());
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

<!-- 展示状態を受信するまでの表示。 -->
{#snippet loading()}
	<div
		class="flex flex-col items-center justify-center gap-2 py-6 text-center text-muted-foreground"
		role="status"
		data-testid="admin-loading"
	>
		<LoaderCircleIcon class="size-5 animate-spin opacity-60" />
		<p class="text-xs">読み込み中…</p>
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
				{#if status === "open"}
					{@render statusBadge(true, "サーバー接続中", "")}
				{:else}
					<Badge variant="outline" class="gap-1.5 text-muted-foreground">
						<LoaderCircleIcon class="animate-spin" />
						{status === "connecting" ? "サーバーへ接続しています" : "サーバーへ再接続しています"}
					</Badge>
				{/if}
			</div>
		</div>
	</header>

	<div class="content flex-1 wide:min-h-0 wide:overflow-y-auto">
		<div class="mx-auto flex w-full max-w-[1880px] flex-col gap-4 p-4 wide:h-full">
			<div
				class="dashboard grid gap-4 md:grid-cols-2 wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] wide:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]"
			>
				<section class={cn("state-panel min-h-0 min-w-0", PANEL_CLASSES.state)} aria-labelledby="state-title">
					<Card.Root size="sm" class="h-full">
						<Card.Header class="border-b">
							<Card.Title class="flex items-center gap-2">
								<ActivityIcon class="size-4 text-muted-foreground" />
								<h2 id="state-title">展示状態</h2>
							</Card.Title>
							{#if admin}
								<Card.Action>
									{@render statusBadge(admin.accepting, "受付中", "受付停止中")}
								</Card.Action>
							{/if}
						</Card.Header>
						<Card.Content class={cn("flex flex-col gap-3", SCROLL_BODY)}>
							{#if !admin}
								{@render loading()}
							{:else}
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
											{#if resultColors.length === 2}
												<span
													class="size-3 shrink-0 rounded-full ring-1 ring-foreground/15"
													style:background={gradientCss(resultColors[0], resultColors[1])}
													aria-hidden="true"
												></span>
											{/if}
											<span
												class="truncate"
												data-testid="result-color"
												title={resultColors.map((color) => color.name).join(" と ")}
												>{admin?.result?.name ??
													(admin?.judgeFailed ? "選定に失敗" : "—")}</span
											>
										</p>
									</div>
								</div>
								<dl class={cn(DETAILS, "text-[0.8rem]")}>
									<dt>revision</dt>
									<dd class="font-mono" data-testid="revision">{admin.revision}</dd>
									<dt>セッション</dt>
									<dd class="font-mono break-all">{admin.sessionId ?? "—"}</dd>
								</dl>
							{/if}
						</Card.Content>
						<Card.Footer class="actions flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={() => command({ name: "setAccepting", accepting: !admin?.accepting })}
								disabled={busy || !admin}
							>
								{#if !admin}
									受付状態を取得中
								{:else if admin.accepting}
									<PauseIcon />受付を停止
								{:else}
									<PlayIcon />受付を再開
								{/if}
							</Button>
							<Button
								variant="destructive"
								size="sm"
								class="ml-auto"
								onclick={() => command({ name: "forceReset" })}
								disabled={busy || !admin}
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
									disabled={busy || (admin?.previewColorId ?? null) === null}
									onclick={() => command({ name: "clearPreview" })}
								>
									<EyeOffIcon />表示確認を終了
								</Button>
							</Card.Action>
						</Card.Header>
						<Card.Content class={SCROLL_BODY}>
							<div class="colors grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-1.5 p-0.5">
								{#each PALETTE.colors as color (color.id)}
									<Button
										variant="outline"
										class="swatch h-8 justify-start gap-2 border-foreground/10 px-3 ring-offset-2 ring-offset-card hover:brightness-110 aria-pressed:ring-2 aria-pressed:ring-primary"
										style="background: {backgroundColor(color)}; color: {foregroundColor(color)};"
										aria-pressed={admin?.previewColorId === color.id}
										disabled={busy || admin?.phase !== "idle"}
										onclick={() => command({ name: "previewColor", colorId: color.id })}
									>
										<span
											class="size-3 shrink-0 rounded-full ring-1 ring-white/30"
											style:background={baseColor(color)}
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
							<Card.Description class="text-xs">
								接続している端末だけを表示します。最後の受信から15秒を過ぎると切断と表示します。
							</Card.Description>
						</Card.Header>
						<Card.Content class="wide:min-h-0 wide:flex-1">
							<div
								class="device-columns grid gap-3 md:grid-cols-2 wide:h-full wide:grid-cols-4 wide:grid-rows-[minmax(0,1fr)]"
							>
								{#each DEVICE_ROLES as role (role)}
									{@const devices = devicesOf(role)}
									{@const RoleIcon = DEVICE_ICONS[role]}
									<div
										class="device-group flex min-h-0 min-w-0 flex-col rounded-lg bg-muted/60 p-2"
										role="group"
										aria-labelledby="devices-{role}"
									>
										<div class="flex items-center justify-between gap-2 px-1 pt-0.5">
											<div class="flex items-center gap-1.5 text-muted-foreground">
												<RoleIcon class="size-3.5" />
												<h3 id="devices-{role}" class="text-xs font-medium">
													{DEVICE_LABELS[role]}
												</h3>
											</div>
											<span class="text-[0.7rem] text-muted-foreground tabular-nums">
												{#if admin}
													{devices.filter((device) => device.connected).length}台接続
												{/if}
											</span>
										</div>
										<p class="px-1 pb-2 font-mono text-[0.7rem] text-muted-foreground">
											{DEVICE_PATHS[role]}
										</p>
										<div
											class="device-list grid content-start gap-2 wide:min-h-0 wide:flex-1 wide:overflow-y-auto [scrollbar-width:thin]"
										>
											{#if !admin}
												{@render loading()}
											{:else}
												{#each devices as device (deviceKey(device))}
													<article
														class="device-card min-w-0 rounded-lg border bg-card p-2.5 shadow-xs"
														data-testid="device-{deviceKey(device)}"
													>
														<div
															class="mb-1.5 flex flex-wrap items-center justify-between gap-1.5"
														>
															<h4 class="text-[0.8rem] font-medium">
																{deviceName(device)}
															</h4>
															{@render statusBadge(device.connected, "接続中", "切断")}
														</div>
														<dl class={cn(DETAILS, "text-xs")}>
															<dt>最終受信</dt>
															<dd class="font-mono">{time(device.lastReceivedAt)}</dd>
														</dl>
													</article>
												{:else}
													<p class="px-1 py-4 text-center text-xs text-muted-foreground">
														接続している端末はありません。
													</p>
												{/each}
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</Card.Content>
					</Card.Root>
				</section>
			</div>
		</div>
	</div>
</main>
