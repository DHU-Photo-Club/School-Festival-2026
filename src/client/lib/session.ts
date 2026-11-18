import type { DeviceRole } from "../../shared/types.ts";

export interface DeviceSession {
	role: DeviceRole;
	screenId: string | null;
}

/** 端末セッションを確認する。未登録なら `null`。 */
export async function fetchDeviceSession(): Promise<DeviceSession | null> {
	const response = await fetch("/api/session", { cache: "no-store" });
	if (response.status === 401) return null;
	if (!response.ok) throw new Error(`session check failed: ${response.status}`);
	return (await response.json()) as DeviceSession;
}

/** `prefers-reduced-motion: reduce` を監視する。 */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
	const query = matchMedia("(prefers-reduced-motion: reduce)");
	onChange(query.matches);
	const listener = (event: MediaQueryListEvent) => onChange(event.matches);
	query.addEventListener("change", listener);
	return () => query.removeEventListener("change", listener);
}
