import type { DeviceRole } from "../../shared/types.ts";

export interface DeviceSession {
	role: DeviceRole;
	screenId: string | null;
}

/**
 * 端末に共通する認証状態。端末セッションの照会結果と realtime 接続の `unauthenticated` 通知に基づく。
 * `unpaired` は、未登録・失効に加えて、コントローラー画面で端末セッションの役割が `controller` 以外の場合を含む。
 */
export type DeviceAuthStatus = "checking" | "unpaired" | "ok";

/**
 * ScreenRole 画面の認証状態。URL の `screenId` が画面IDの形式に一致しない場合、または端末セッションの
 * `role` もしくは `screenId` が画面と一致しない場合の `mismatch` を含む。
 */
export type ScreenAuthStatus = DeviceAuthStatus | "mismatch";

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
