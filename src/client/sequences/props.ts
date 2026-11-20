/**
 * シーケンスのコンポーネントに渡す値。全画面の描画を同期させ、再接続しても同じ位置から続けられるよう、
 * 見た目は `t` などの値だけから決める（`Math.random()` や `Date.now()` を直接使わない。乱数が要るときは
 * `sessionId` から作る）。
 */
export interface SequenceProps {
	/** 再生位置（ミリ秒）。補正済みサーバー時刻から求めるので全画面で同じ値になる。0から `durationMs` まで。 */
	t: number;
	durationMs: number;
	sessionId: string | null;
	reducedMotion: boolean;
}

export interface DisplaySequenceProps extends SequenceProps {
	/** 展示ディスプレイの並び順（0から）。 */
	displayOrder: number;
}
