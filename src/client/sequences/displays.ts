import type { Component } from "svelte";
import type { DisplaySequenceProps } from "./props.ts";

// `<id>/Display.svelte` をシーケンスIDで引けるように集める。iPad用のコンポーネントは読み込まない。
const displays = import.meta.glob<Component<DisplaySequenceProps>>("./*/Display.svelte", {
	eager: true,
	import: "default",
});

/** 展示ディスプレイに重ねるコンポーネント。なければ `null`（待機表示だけを行う）。 */
export function displaySequence(id: string | null): Component<DisplaySequenceProps> | null {
	return id === null ? null : (displays[`./${id}/Display.svelte`] ?? null);
}
