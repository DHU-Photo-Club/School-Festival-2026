<script lang="ts">
/**
 * 全画面表示の切り替え。展示ディスプレイと写真用で、`F` を押すか画面をダブルクリックすると、ページ全体を
 * 全画面にする（もう一度押すと戻す。`Esc` でもブラウザが戻す）。ブラウザは操作なしに全画面へ入れないので、
 * 開いた画面を会場のスタッフが一度操作して全画面にする。
 */

function toggle() {
	if (document.fullscreenElement) {
		void document.exitFullscreen().catch(() => {});
		return;
	}
	// 全画面にできないブラウザや、許可されなかったときは、そのままの表示で続ける。
	void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
}

function onKey(event: KeyboardEvent) {
	if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
	if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
	if (event.key.toLowerCase() !== "f") return;
	toggle();
	event.preventDefault();
}

function onDoubleClick(event: MouseEvent) {
	// 台形補正の角のボタンなど、操作の部品の上では切り替えない。
	if (event.target instanceof Element && event.target.closest("button, input, a")) return;
	toggle();
}
</script>

<svelte:window onkeydown={onKey} ondblclick={onDoubleClick} />
