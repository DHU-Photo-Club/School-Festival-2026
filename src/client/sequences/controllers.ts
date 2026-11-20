import type { Component } from "svelte";
import type { SequenceProps } from "./props.ts";

// `<id>/Controller.svelte` をシーケンスIDで引けるように集める。展示ディスプレイ用のコンポーネントは読み込まない。
const controllers = import.meta.glob<Component<SequenceProps>>("./*/Controller.svelte", {
	eager: true,
	import: "default",
});

/** iPadに表示するコンポーネント。なければ `null`（何も表示しない）。 */
export function controllerSequence(id: string | null): Component<SequenceProps> | null {
	return id === null ? null : (controllers[`./${id}/Controller.svelte`] ?? null);
}
