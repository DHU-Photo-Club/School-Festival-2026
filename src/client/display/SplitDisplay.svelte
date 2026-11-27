<script lang="ts">
import { SPLIT_ASPECT, SPLIT_SCREENS } from "../../shared/screens.ts";
import Display from "./Display.svelte";

/** 画面分割の画面番号。左から1、2。 */
let { screen }: { screen: number } = $props();

// 二台を合わせた36:9の一つの画面（壁）を、どちらのタブも同じ大きさで描き、このタブのディスプレイが受け持つ部分だけを見せる。
// 破片や塵、波紋は補正済みサーバー時刻だけで決まるため、二つのタブの絵は継ぎ目でつながる。二色の割り当てと演出のずれも
// 一つの画面として揃えるため、どちらのタブも `displayOrder` 0 で描く。サーバーへは自分の画面番号で接続する。
// 一台分の枠（18:9）はディスプレイの中央に置き、縦横比が違うときは余りを黒で埋める。
const count = SPLIT_SCREENS.length;
// svelte-ignore state_referenced_locally
const index = SPLIT_SCREENS.indexOf(screen as (typeof SPLIT_SCREENS)[number]);
</script>

<div class="split" style:--part-aspect={SPLIT_ASPECT / count}>
	<div class="part">
		<div class="wall" style:width="{count * 100}%" style:left="{-index * 100}%">
			<Display {screen} order={0} />
		</div>
	</div>
</div>

<style>
.split {
	position: fixed;
	inset: 0;
	display: grid;
	place-items: center;
	overflow: hidden;
	background: #000000;
	cursor: none;
}
/* このタブのディスプレイが受け持つ一台分の枠。 */
.part {
	position: relative;
	overflow: hidden;
	width: min(100vw, calc(100vh * var(--part-aspect)));
	height: min(100vh, calc(100vw / var(--part-aspect)));
}
/* 二台を合わせた一つの画面。受け持つ部分が枠に来るよう左へずらす。 */
.wall {
	position: absolute;
	top: 0;
	height: 100%;
}
</style>
