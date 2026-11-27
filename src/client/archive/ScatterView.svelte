<script lang="ts">
	import { getContext, onMount, untrack, type Snippet } from "svelte";
	import type { ArchiveEntry } from "./entries";
	import OrbImage from "./OrbImage.svelte";
	import { refreshOrbInteractions } from "./orb-interaction";
	import { entranceFilter, entrancePose, orbEntranceDelay } from "./entrance";
	import { UI_ENTRANCE_CONTEXT, type UiEntranceController } from "./ui-entrance";
	const uiIntro = getContext<UiEntranceController>(UI_ENTRANCE_CONTEXT);
	import { ScatterCamera, LOGO_TARGET, MIN_SCALE, MAX_SCALE, floatingLagSeconds, limitVector, stepFloating, centeredPose, type FloatingState } from "./scatter-camera";

	let { entries, children, targetId = null, searchRequest = 0, onSelect = () => {}, intro = false, onIntroComplete = () => {}, paused = false }: { paused?: boolean; entries: ArchiveEntry[]; children: Snippet; targetId?: string | null; searchRequest?: number; onSelect?: (id: string) => void; intro?: boolean; onIntroComplete?: (interrupted: boolean) => void } = $props();
	let introActive = $state(untrack(() => intro));
	let logoArrival: HTMLDivElement;
	const camera = new ScatterCamera([]);
	let pose = $state(camera.pose);
	let dragging = $state(false);
	let viewport: HTMLDivElement;
	let mounted = false;
	let frameId = 0;
	let lastFrame = 0;
	let renderedPose = camera.pose;
	let lastMove = 0;
	let tapStart = { x: 0, y: 0 };
	let moved = false;
	const pointers = new Map<number, { x: number; y: number }>();
	type FloatingOrb = { node: HTMLElement; arrival: HTMLElement; anchor: HTMLElement; visible: boolean; lag: number; state: FloatingState };
	const floating = new Map<string, FloatingOrb>();
	let visibility: IntersectionObserver | null = null;
	const zeroFloat = (): FloatingState => ({ x: 0, y: 0, vx: 0, vy: 0 });

	function clearFloating() {
		for (const item of floating.values()) { item.state = zeroFloat(); item.node.style.transform = ""; }
	}

	function finishIntro(interrupted = true) {
		if (!introActive) return;
		introActive = false;
		for (const item of floating.values()) {
			for (const property of ["--intro-scale", "--intro-opacity", "--intro-filter"]) item.arrival.style.removeProperty(property);
		}
		onIntroComplete(interrupted);
		requestAnimationFrame(() => window.dispatchEvent(new Event("archive:scene-settled")));
	}

	function updateIntro(now: number) {
		if (!introActive) return;
		const elapsed = uiIntro.elapsed(now);
		const logo = entrancePose(0, 0, elapsed, 0, "logo");
		logoArrival.style.setProperty("--intro-scale", String(logo.scale));
		logoArrival.style.setProperty("--intro-opacity", String(logo.opacity));
		logoArrival.style.setProperty("--intro-filter", entranceFilter(logo.blur));
		let complete = logo.done;
		for (const [index, entry] of entries.entries()) {
			const item = floating.get(entry.id);
			if (!item) continue;
			const arrival = entrancePose(entry.x, entry.y, elapsed, orbEntranceDelay(entry.id, index));
			item.anchor.style.setProperty("--intro-x", `${arrival.x}px`);
			item.anchor.style.setProperty("--intro-y", `${arrival.y}px`);
			item.arrival.style.setProperty("--intro-scale", String(arrival.scale));
			item.arrival.style.setProperty("--intro-opacity", String(arrival.opacity));
			item.arrival.style.setProperty("--intro-filter", entranceFilter(arrival.blur));
			complete &&= arrival.done;
		}
		if (complete) finishIntro(false);
	}

	function ensureFrame() {
		if (paused || !mounted || frameId || document.visibilityState !== "visible") return;
		lastFrame = performance.now();
		frameId = requestAnimationFrame(frame);
	}

	function frame(now: number) {
		frameId = 0;
		if (paused) return;
		const dt = Math.max(0.008, Math.min(0.032, (now - lastFrame) / 1000));
		lastFrame = now;
		updateIntro(now);
		if (!introActive) camera.advance(dt);
		const next = camera.pose;
		const velocity = camera.mode === "pinching" ? { x: 0, y: 0 } : limitVector({
			x: (next.x - renderedPose.x + camera.width / 2 * (next.scale - renderedPose.scale)) / dt,
			y: (next.y - renderedPose.y + camera.height / 2 * (next.scale - renderedPose.scale)) / dt,
		}, 2000);
		let drifting = false;
		for (const [id, item] of floating) {
			if (introActive || !item.visible || camera.reducedMotion || (camera.mode === "idle" && id === camera.centeredId)) {
				item.state = zeroFloat(); item.node.style.transform = ""; continue;
			}
			let strength = 1;
			if (camera.lockedTarget?.id === id) {
				const destination = centeredPose(camera.lockedTarget, next.scale, camera.width, camera.height);
				strength = Math.min(1, Math.hypot(next.x - destination.x, next.y - destination.y) / 80);
			}
			item.state = stepFloating(item.state, velocity, item.lag, dt, strength);
			const moving = Math.hypot(item.state.x, item.state.y) > 0.05 || Math.hypot(item.state.vx, item.state.vy) > 0.5;
			if (!moving) item.state = zeroFloat();
			item.node.style.transform = `translate(${item.state.x / next.scale}px, ${item.state.y / next.scale}px)`;
			drifting ||= moving;
		}
		if (introActive || next.x !== renderedPose.x || next.y !== renderedPose.y || next.scale !== renderedPose.scale) refreshOrbInteractions();
		pose = next;
		renderedPose = next;
		if (introActive || camera.running || drifting) frameId = requestAnimationFrame(frame);
	}

	function registerFloat(node: HTMLElement, id: string) {
		const anchor = node.closest<HTMLElement>(".orb-anchor") ?? node;
		floating.set(id, { node, arrival: node.parentElement ?? node, anchor, visible: false, lag: floatingLagSeconds(id), state: zeroFloat() });
		anchor.dataset.floatId = id;
		visibility?.observe(anchor);
		return { destroy() { visibility?.unobserve(anchor); floating.delete(id); } };
	}

	function point(event: PointerEvent) {
		const rect = viewport.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function down(event: PointerEvent) {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		finishIntro();
		if (!pointers.size) { tapStart = { x: event.clientX, y: event.clientY }; moved = false; } else moved = true;
		viewport.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, point(event));
		camera.beginInteraction(pointers.size > 1 ? "pinching" : "dragging");
		dragging = true; lastMove = performance.now(); ensureFrame();
	}

	function move(event: PointerEvent) {
		if (!pointers.has(event.pointerId)) return;
		if (Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 8) moved = true;
		const before = [...pointers.values()];
		pointers.set(event.pointerId, point(event));
		const after = [...pointers.values()];
		const now = performance.now();
		if (after.length === 1) {
			camera.panBy(after[0].x - before[0].x, after[0].y - before[0].y, (now - lastMove) / 1000, true);
		} else {
			const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
			const distance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
			const oldX = (before[0].x + before[1].x) / 2, oldY = (before[0].y + before[1].y) / 2;
			if (oldDistance > 0) camera.zoomAt(camera.scale * distance / oldDistance, oldX, oldY);
			camera.panBy((after[0].x + after[1].x) / 2 - oldX, (after[0].y + after[1].y) / 2 - oldY);
		}
		lastMove = now; ensureFrame();
	}

	function up(event: PointerEvent) {
		const mode = camera.mode;
		if (!pointers.delete(event.pointerId)) return;
		dragging = pointers.size > 0;
		if (pointers.size) { camera.beginInteraction(pointers.size > 1 ? "pinching" : "dragging"); lastMove = performance.now(); return; }
		if (!moved && event.type === "pointerup") {
			let hit: string | null = null, best = Infinity;
			for (const [id, item] of floating) {
				const rect = item.node.querySelector(".orb-image")?.getBoundingClientRect();
				if (!rect) continue;
				const distance = Math.hypot(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
				if (distance < Math.min(rect.width, rect.height) / 2 + 8 && distance < best) { hit = id; best = distance; }
			}
			if (hit) { camera.stopMotion(); onSelect(hit); return; }
		}
		camera.endInteraction(mode === "dragging" && event.type === "pointerup" && performance.now() - lastMove < 100);
		ensureFrame();
	}

	function wheel(event: WheelEvent) {
		event.preventDefault();
		if (pointers.size) return;
		finishIntro();
		camera.beginInteraction();
		if (event.ctrlKey || event.metaKey) {
			const rect = viewport.getBoundingClientRect();
			camera.zoomAt(camera.scale * Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
		} else {
			const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? camera.height : 1;
			camera.panBy(-event.deltaX * factor, -event.deltaY * factor);
		}
		camera.queueSnap(); ensureFrame();
	}

	function reset() {
		finishIntro();
		pointers.clear(); dragging = false; camera.reset(); clearFloating();
		pose = camera.pose; renderedPose = camera.pose; ensureFrame();
	}

	function zoomBy(factor: number) {
		finishIntro();
		pointers.clear(); dragging = false;
		camera.zoomBy(factor); ensureFrame();
	}

	function keydown(event: KeyboardEvent) {
		if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home", "0"].includes(event.key)) return;
		event.preventDefault();
		finishIntro();
		if (event.key === "+" || event.key === "=") zoomBy(1.2);
		else if (event.key === "-") zoomBy(1 / 1.2);
		else if (event.key === "Home" || event.key === "0") reset();
		else {
			pointers.clear(); dragging = false; camera.beginInteraction();
			camera.panBy(event.key === "ArrowLeft" ? 60 : event.key === "ArrowRight" ? -60 : 0, event.key === "ArrowUp" ? 60 : event.key === "ArrowDown" ? -60 : 0);
			camera.queueSnap(); ensureFrame();
		}
	}

	$effect(() => { if (!intro) untrack(() => finishIntro()); });
	$effect(() => { const targets = entries; untrack(() => { camera.setTargets(targets); ensureFrame(); }); });
	$effect(() => {
		const id = targetId; void searchRequest;
		untrack(() => {
			if (id) { finishIntro(); pointers.clear(); dragging = false; camera.focus(id); }
			else camera.cancelSearch();
			ensureFrame();
		});
	});

	onMount(() => {
		mounted = true;
		const bounds = viewport.getBoundingClientRect();
		camera.resize(bounds.width, bounds.height);
		if (matchMedia("(min-width: 1024px)").matches) camera.zoomAt(1.5);
		renderedPose = camera.pose; pose = camera.pose;
		uiIntro.start();
		const reduced = matchMedia("(prefers-reduced-motion: reduce)");
		function preferenceChanged() { camera.setReducedMotion(reduced.matches); if (reduced.matches) { clearFloating(); finishIntro(); } ensureFrame(); }
		preferenceChanged();
		visibility = new IntersectionObserver((observations) => {
			for (const observation of observations) {
				const item = floating.get((observation.target as HTMLElement).dataset.floatId ?? "");
				if (item) { item.visible = observation.isIntersecting; if (!item.visible) { item.state = zeroFloat(); item.node.style.transform = ""; } }
			}
			ensureFrame();
		});
		for (const item of floating.values()) visibility.observe(item.anchor);
		const resize = new ResizeObserver(([entry]) => {
			camera.resize(entry.contentRect.width, entry.contentRect.height);
			clearFloating(); renderedPose = camera.pose; pose = camera.pose; ensureFrame();
		});
		resize.observe(viewport);
		function visibilityChanged() {
			if (document.visibilityState !== "visible") { cancelAnimationFrame(frameId); frameId = 0; }
			else ensureFrame();
		}
		viewport.addEventListener("wheel", wheel, { passive: false });
		reduced.addEventListener("change", preferenceChanged);
		document.addEventListener("visibilitychange", visibilityChanged);
		ensureFrame();
		return () => {
			mounted = false; cancelAnimationFrame(frameId); pointers.clear(); resize.disconnect(); visibility?.disconnect();
			viewport.removeEventListener("wheel", wheel); reduced.removeEventListener("change", preferenceChanged); document.removeEventListener("visibilitychange", visibilityChanged);
		};
	});
	$effect(() => { if (paused) { cancelAnimationFrame(frameId); frameId = 0; camera.stopMotion(); pointers.clear(); dragging = false; } else ensureFrame(); });
</script>

<!-- Focusable map surface with pointer and keyboard navigation. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div bind:this={viewport} class="scatter-viewport" data-entering={introActive} class:dragging role="application" aria-label="写真の散らばりビュー。スワイプで移動、ピンチで拡大縮小。操作終了後は最寄りのオーブへ移動します。矢印キーで移動、プラスとマイナスで拡大縮小、Homeで初期位置。" tabindex="0" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onlostpointercapture={up} onkeydown={keydown}>
	<div class="scatter-world" style:transform={`translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`}>
		<div bind:this={logoArrival} class="logo-arrival">
			<div class="logo-floating" use:registerFloat={LOGO_TARGET.id}>{@render children()}</div>
		</div>
		{#each entries as entry (entry.id)}
			<div class="orb-anchor" style:--intro-x={`${entry.x * 1.5}px`} style:--intro-y={`${entry.y * 1.5}px`} style:left={`calc(50% + ${entry.x}px)`} style:top={`calc(50% + ${entry.y}px)`}>
				<div class="orb-arrival">
				<div role="button" tabindex="0" aria-label={`${entry.nickname}の詳細を開く`} onclick={() => onSelect(entry.id)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onSelect(entry.id); } }} class="floating-body" class:is-target={targetId === entry.id} use:registerFloat={entry.id}>
					<OrbImage src={entry.scatterImage} motionKey={entry.id} {paused} scale={pose.scale} />
					<p class="orb-caption">{entry.nickname}</p>
				</div>
				</div>
			</div>
		{/each}
	</div>
</div>
<div class="map-controls" role="group" aria-label="ビューの操作" use:uiIntro.control>
	<span class="ui-surface" aria-hidden="true" use:uiIntro.part={{ group: "camera", layer: 0 }}></span>
	<button type="button" aria-label="縮小" onclick={() => zoomBy(1 / 1.25)} disabled={pose.scale <= MIN_SCALE}><span class="ui-label" use:uiIntro.part={{ group: "camera", layer: 1, item: 0 }}>−</span></button>
	<button type="button" aria-label="初期位置に戻す" onclick={reset}><span class="ui-label" use:uiIntro.part={{ group: "camera", layer: 1, item: 1 }}>{Math.round(pose.scale * 100)}%</span></button>
	<button type="button" aria-label="拡大" onclick={() => zoomBy(1.25)} disabled={pose.scale >= MAX_SCALE}><span class="ui-label" use:uiIntro.part={{ group: "camera", layer: 1, item: 2 }}>＋</span></button>
</div>
{#if entries.length === 0}<p class="empty" role="status">該当するニックネームが見つかりません</p>{/if}

<style>
	.scatter-viewport { position: absolute; inset: 0; overflow: hidden; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; }
	.scatter-viewport.dragging { cursor: grabbing; }
	.scatter-viewport:focus-visible { outline: 1px solid #777; outline-offset: -2px; }
	.scatter-world { position: absolute; inset: 0; transform-origin: 0 0; background: #000; pointer-events: none; --brand-center-y: 50%; }
	.orb-anchor { position: absolute; width: 150px; transform: translate(-50%, -69.1055px); text-align: center; }
	.logo-arrival { position: absolute; inset: 0; transform-origin: 50% 50%; }
	.logo-floating { position: absolute; inset: 0; }
	.orb-arrival { transform-origin: 75px 69.1055px; }
	.scatter-viewport[data-entering="true"] .logo-arrival {
		transform: scale(var(--intro-scale, 2.5));
		opacity: var(--intro-opacity, 0);
		/* Filter only the tightly bounded logo, not this viewport-sized positioning layer. */
		--logo-intro-filter: var(--intro-filter, blur(20px));
	}
	.scatter-viewport[data-entering="true"] .orb-anchor {
		transform: translate(-50%, -69.1055px) translate(var(--intro-x), var(--intro-y));
	}
	.scatter-viewport[data-entering="true"] .orb-arrival {
		transform: scale(var(--intro-scale, 2.5));
		opacity: var(--intro-opacity, 0);
		--orb-intro-filter: var(--intro-filter, blur(14px));
	}
	@media (prefers-reduced-motion: reduce) {
		.scatter-viewport[data-entering="true"] .logo-arrival, .scatter-viewport[data-entering="true"] .orb-arrival { transform: none; opacity: 1; --logo-intro-filter: none; --orb-intro-filter: none; }
		.scatter-viewport[data-entering="true"] .orb-anchor { transform: translate(-50%, -69.1055px); }
	}
	.floating-body { margin: 0; }
	.orb-caption { margin-bottom: 0; position: relative; z-index: 1; margin-top: 7px; font: 12.781px/1.45 "Hiragino Mincho ProN", "Yu Mincho", serif; color: #fff; }
	.floating-body.is-target .orb-caption { text-decoration: underline; text-underline-offset: 5px; }
	.map-controls { position: absolute; z-index: 4; top: max(90px, calc(env(safe-area-inset-top) + 66px)); right: var(--side-gap, 20px); height: 44px; display: flex; gap: 2px; padding: 4px; background: transparent; border-radius: 8px; }
	.ui-surface { position: absolute; inset: 0; z-index: 0; background: #242424b3; border-radius: inherit; backdrop-filter: blur(5px); pointer-events: none; }
	.ui-label { display: inline-block; }
	button { position: relative; z-index: 1; min-width: 38px; min-height: 36px; border: 0; border-radius: 4px; background: transparent; color: #ccc; font: 13px system-ui, sans-serif; cursor: pointer; touch-action: manipulation; }
	button:disabled { opacity: .35; }
	button:focus-visible { outline: 1px solid white; }
	button { transition: background-color 140ms ease-out, color 140ms ease-out; }
	@media (hover: hover) and (pointer: fine) {
		button:not(:disabled):hover { background: #ffffff14; color: #fff; }
	}
	@media (prefers-reduced-motion: reduce) {
		button { transition: none; }
	}
	.empty { position: absolute; top: 62%; left: 20px; right: 20px; text-align: center; pointer-events: none; font: 13px sans-serif; color: #999; }
</style>
