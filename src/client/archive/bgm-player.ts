export type BgmStatus = { state: "muted" | "starting" | "playing"; error: string };
export interface BgmMedia {
	muted: boolean;
	readonly paused: boolean;
	play(): Promise<void>;
	pause(): void;
	load?(): void;
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
}

/** Starts only from a user action; a muted player pauses without losing its position. */
export class BgmPlayer {
	private status: BgmStatus = { state: "muted", error: "" };
	private attempt = 0;
	private disposed = false;
	private readonly onPause: EventListener = () => { if (this.media.paused && this.status.state !== "muted") this.mute(); };
	private readonly onError: EventListener = () => this.mute("BGMを再生できません。もう一度ボタンを押してください。");

	constructor(private readonly media: BgmMedia, private readonly notify: (status: BgmStatus) => void) {
		media.muted = true;
		media.addEventListener("pause", this.onPause);
		media.addEventListener("error", this.onError);
	}

	private update(status: BgmStatus) { this.status = status; if (!this.disposed) this.notify(status); }

	private mute(error = "") {
		++this.attempt;
		this.media.muted = true;
		this.update({ state: "muted", error });
		this.media.pause();
	}

	async toggle(): Promise<void> {
		if (this.disposed) return;
		if (this.status.state !== "muted") { this.mute(); return; }
		const request = ++this.attempt;
		if (this.status.error) this.media.load?.();
		this.update({ state: "starting", error: "" });
		this.media.muted = false;
		try {
			// Invoke play synchronously in the click handler for iPhone Safari.
			await this.media.play();
			if (this.disposed || request !== this.attempt) {
				if (this.disposed || this.status.state === "muted") { this.media.muted = true; this.media.pause(); }
				return;
			}
			this.update({ state: "playing", error: "" });
		} catch {
			if (!this.disposed && request === this.attempt) this.mute("BGMを再生できません。もう一度ボタンを押してください。");
		}
	}

	dispose() {
		this.disposed = true;
		++this.attempt;
		this.media.removeEventListener("pause", this.onPause);
		this.media.removeEventListener("error", this.onError);
		this.media.muted = true;
		this.media.pause();
	}
}
