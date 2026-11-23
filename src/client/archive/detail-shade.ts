const STOP_COUNT = 5;
const FADE_MS = 400;
const STAGGER_MS = 40;
export const SHADE_TRANSITION_MS = FADE_MS + (STOP_COUNT - 1) * STAGGER_MS;

export function logoHasExited(logoBottom: number, viewportTop: number): boolean {
	return logoBottom <= viewportTop;
}

/** Five smooth mask stops fade from top to bottom in either direction. */
export class DetailShadeTransition {
	private values = Array<number>(STOP_COUNT).fill(0);
	private from = [...this.values];
	private target = 0;
	private startedAt = 0;
	running = false;

	setColored(colored: boolean, now: number, immediate = false) {
		if (immediate) {
			this.target = Number(colored); this.values.fill(this.target); this.running = false;
			return;
		}
		if (Number(colored) === this.target) return;
		this.from = [...this.sample(now)];
		this.target = Number(colored); this.startedAt = now; this.running = true;
	}

	sample(now: number): readonly number[] {
		if (!this.running) return this.values;
		this.values = this.from.map((start, index) => {
			const t = Math.max(0, Math.min(1, (now - this.startedAt - index * STAGGER_MS) / FADE_MS));
			const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
			return start + (this.target - start) * eased;
		});
		if (now - this.startedAt >= SHADE_TRANSITION_MS) { this.values.fill(this.target); this.running = false; }
		return this.values;
	}
}

export function shadeMasks(values: readonly number[]) {
	const gradient = (inverse: boolean) => `linear-gradient(to bottom, ${values.map((value, index) => `rgba(0,0,0,${inverse ? 1 - value : value}) ${index * 25}%`).join(", ")})`;
	return { color: gradient(false), black: gradient(true) };
}
