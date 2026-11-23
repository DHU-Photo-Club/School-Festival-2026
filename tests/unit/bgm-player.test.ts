import { describe, expect, it, vi } from "vitest";
import { BgmPlayer, type BgmStatus } from "../../src/client/archive/bgm-player.ts";

class Media extends EventTarget {
	muted = false;
	paused = true;
	currentTime = 0;
	play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
	pause = vi.fn(() => {
		const wasPlaying = !this.paused;
		this.paused = true;
		if (wasPlaying) this.dispatchEvent(new Event("pause"));
	});
	load = vi.fn();
}
function setup() {
	const media = new Media();
	let status: BgmStatus = { state: "muted", error: "" };
	const player = new BgmPlayer(media, (value) => { status = value; });
	return { media, player, status: () => status };
}
function deferred() { let resolve!: () => void; let reject!: () => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

describe("archive BGM", () => {
	it("starts muted and never attempts autoplay", () => {
		const { media, status } = setup();
		expect(media.muted).toBe(true); expect(status().state).toBe("muted"); expect(media.play).not.toHaveBeenCalled();
	});
	it("starts from the click action and pauses/resumes without resetting the position", async () => {
		const { media, player, status } = setup();
		const request = player.toggle();
		expect(media.play).toHaveBeenCalledOnce(); expect(status().state).toBe("starting");
		await request; expect(status().state).toBe("playing"); expect(media.muted).toBe(false);
		media.currentTime = 42;
		await player.toggle(); expect(status().state).toBe("muted"); expect(media.paused).toBe(true); expect(media.muted).toBe(true);
		await player.toggle(); expect(status().state).toBe("playing"); expect(media.currentTime).toBe(42);
	});
	it("can cancel a pending play request without a late resolution unmuting it", async () => {
		const { media, player, status } = setup(); const wait = deferred();
		media.play.mockImplementationOnce(() => { media.paused = false; return wait.promise; });
		const pending = player.toggle(); await player.toggle();
		wait.resolve(); await pending;
		expect(status().state).toBe("muted"); expect(media.muted).toBe(true); expect(media.paused).toBe(true);
	});
	it("does not let an old rejection stop a newer successful play request", async () => {
		const { media, player, status } = setup(); const wait = deferred();
		media.play.mockImplementationOnce(() => { media.paused = false; return wait.promise; });
		const old = player.toggle(); await player.toggle(); await player.toggle();
		wait.reject(); await old;
		expect(status().state).toBe("playing"); expect(media.muted).toBe(false); expect(media.paused).toBe(false);
	});
	it("shows a recoverable muted state on playback failure and reloads on retry", async () => {
		const { media, player, status } = setup();
		media.play.mockRejectedValueOnce(new Error("blocked"));
		await player.toggle(); expect(status().state).toBe("muted"); expect(status().error).not.toBe(""); expect(media.muted).toBe(true);
		await player.toggle(); expect(media.load).toHaveBeenCalledOnce(); expect(status()).toEqual({ state: "playing", error: "" });
	});
	it("reflects external interruptions and media errors in the button state", async () => {
		const { media, player, status } = setup();
		await player.toggle(); media.pause(); expect(status().state).toBe("muted");
		await player.toggle(); media.dispatchEvent(new Event("error"));
		expect(status().state).toBe("muted"); expect(status().error).not.toBe(""); expect(media.paused).toBe(true);
	});
	it("stops audio on disposal and ignores pending requests and future media events", async () => {
		const { media, player, status } = setup(); const wait = deferred();
		media.play.mockImplementationOnce(() => { media.paused = false; return wait.promise; });
		const pending = player.toggle(); player.dispose(); const previous = status();
		wait.resolve(); await pending; media.dispatchEvent(new Event("error")); await player.toggle();
		expect(status()).toBe(previous); expect(media.muted).toBe(true); expect(media.paused).toBe(true);
	});
});
