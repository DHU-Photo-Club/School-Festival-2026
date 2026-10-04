<script lang="ts">
  import type { QrModel } from '../lib/qr.ts';

  // 生成したモジュールをSVGのDOMとして描く。SVG文字列をHTMLとして挿入しない（仕様書10.3節）。
  let { model, label }: { model: QrModel; label: string } = $props();
</script>

<svg
  class="qr"
  viewBox="0 0 {model.size} {model.size}"
  width="256"
  height="256"
  shape-rendering="crispEdges"
  role="img"
  aria-label={label}
>
  <rect width={model.size} height={model.size} fill="#FFFFFF" />
  <path d={model.path} fill="#000000" />
</svg>

<style>
  .qr {
    display: block;
    width: 256px;
    height: 256px;
    flex: none;
  }
</style>
