<script lang="ts">
  import { RESULT_COLORS } from '../../data/colors.ts';
  import { EXHIBIT } from '../../data/exhibit.ts';
  import { PHOTOS } from '../../data/photos.ts';
  import PhotoImage from '../common/PhotoImage.svelte';

  /** QRから開く公開結果ページ。リアルタイム状態へ接続しない（仕様書10.2節）。 */
  let { colorId }: { colorId: string } = $props();

  const color = RESULT_COLORS.find((candidate) => candidate.id === colorId) ?? null;
  const photo = color ? (PHOTOS.find((candidate) => candidate.id === color.representativePhotoId) ?? null) : null;
  let imageFailed = $state(false);
</script>

<svelte:head>
  <title>{color ? `${color.name} | ${EXHIBIT.title}` : EXHIBIT.title}</title>
</svelte:head>

{#if color}
  <main class="result" style:background={color.backgroundColor} style:color={color.foregroundColor}>
    <div class="disc" style:background={color.baseColor}></div>
    <p class="caption">あなたの色は</p>
    <h1>{color.name}</h1>
    <p class="message">{color.message}</p>
    {#if photo && !imageFailed}
      <figure>
        <div class="photo">
          <PhotoImage {photo} onstatus={(status) => (imageFailed = status === 'failed')} />
        </div>
        <figcaption>
          {#if photo.creditUrl}
            <a href={photo.creditUrl} rel="noopener noreferrer" style:color={color.foregroundColor}>© {photo.creditName}</a>
          {:else}
            © {photo.creditName}
          {/if}
        </figcaption>
      </figure>
    {/if}
    <footer>
      <p class="title">{EXHIBIT.title}</p>
      <p>{EXHIBIT.eventInfo}</p>
    </footer>
  </main>
{:else}
  <main class="result"><p>ページが見つかりません</p></main>
{/if}

<style>
  .result {
    min-height: 100vh;
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 16px;
    padding: 48px 20px;
    text-align: center;
  }
  .disc {
    width: min(48vw, 220px);
    aspect-ratio: 1;
    border-radius: 50%;
  }
  .caption {
    margin: 8px 0 0;
    opacity: 0.8;
  }
  h1 {
    margin: 0;
    font-size: 32px;
    letter-spacing: 0.06em;
  }
  .message {
    margin: 0;
    line-height: 1.7;
  }
  figure {
    margin: 16px 0 0;
    width: min(100%, 560px);
    display: grid;
    gap: 8px;
  }
  .photo {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
  }
  figcaption {
    font-size: 14px;
  }
  footer {
    margin-top: 24px;
    font-size: 14px;
    opacity: 0.85;
  }
  footer p {
    margin: 4px 0;
  }
  .title {
    font-weight: 600;
  }
</style>
