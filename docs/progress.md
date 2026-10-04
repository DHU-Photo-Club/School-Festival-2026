# 実装の進捗

作業を再開するときは、この記録と `git log` を確認する。

## 完了したこと

- `docs/visual-language.md` で演出のビジュアル言語を決定
- 土台: pnpm、Vite 8、Svelte 5、Cloudflare Vite plugin、Vitest、Playwright、TypeScript 6（`svelte-check` が TypeScript 7 に未対応のため6系に固定）
- 共通モジュール（`src/shared/`）: 型、判定、状態遷移、メッセージ検証、写真割り当て、時刻補正、演出の純粋関数、データ検証、結果URL
- 仮データ（`src/data/`）: 色、質問と配点、写真40点（各色5点）、`displayManifest`（3画面）、開催情報
- Durable Object（`src/worker/`）: 認証、ペアリング、WebSocket Hibernation、alarm、冪等性、操作端末、同期計測、運用通知
- 画面（`src/client/`）: iPad、展示ディスプレイ、管理画面、管理ログイン、結果ページ
- production build時の検証（`build/`）: `PUBLIC_ORIGIN`、`RESULTS_PUBLISHED_UNTIL`、色・診断・写真定義、写真ファイル
- 単体テスト 132件、E2Eテスト（`tests/e2e/`）

## 次にやること

1. ブラウザで展示3画面とiPadを開き、各状態のスクリーンショットを `docs/visual-language.md` と見比べる
2. 1920×1080 と 3840×2160 でのフレーム時間の計測
3. 別の担当（レビュー）による確認

## 判断に迷った点

ユーザーの判断が必要な点。実装はそれぞれ下記の仮の判断で進めている。

1. **管理画面への先読み報告と時刻同期精度の送り方**（仕様書7.2.5節、8.6節）。仕様書は管理画面への報告を求めているが、8.5節のメッセージ表に該当する種類がない。`diagnostic` に `preloadReport` と `clockSync` を追加して送っている（`src/shared/protocol.ts`）。8.5節の表では `diagnostic` は診断用iPadから送るものになっている点も含めて決定が必要。
2. **管理画面とペアリングのHTTP API**。仕様書9.2節は `/api/pair` と `/api/realtime` だけを挙げるが、8.4節のログイン、ログアウト、コード発行、端末セッション一覧と失効、端末の初期画面での登録確認にはHTTPの入口が要る。`/api/admin/login`、`/api/admin/logout`、`/api/admin/pairing-codes`、`/api/admin/sessions`、`/api/admin/sessions/{id}`、`/api/session` を追加した。
3. **`releaseController` で `revision` を増やすか**。展示状態（8章）を変えないため増やしていない。15章「受理した各更新により1ずつ増え」の「更新」を展示状態の更新と解釈した。
4. **close code が決まっていない切断**。JSONでないメッセージとバイナリフレームは1007、15秒無通信は1001で閉じている（8.5節の表に定めがない）。
5. **`intro` 中に新しく接続した展示ディスプレイの待機巡回の基準時刻**。`cycleIndex` は `idle.phaseStartedAt` から求めるが、展示ディスプレイへ配信する状態には `idle` の開始時刻が残らない。`intro` の `phaseStartedAt` を基準にしている。
6. **結果開始後に接続した展示ディスプレイの写真**。7.2.5節「結果開始時刻までに読み込めなかった画面はタイポグラフィ」をそのまま当てはめると、結果表示中に再読み込みした画面は必ずタイポグラフィになる。演出を再生しない画面（7.2.4節）は、割り当て写真の読み込みが終わった時点で写真かタイポグラフィかを決め、以後は変えない。
7. **展示一画面構成のE2E**。9.5節の「展示一画面と展示三画面の二構成」は、仮の `displayManifest`（3画面）のうち1画面だけを接続して実行している。`displayManifest` を構成ごとに切り替える設定は仕様書にないため追加していない。
8. **WebSocket Upgradeの401/403のE2E**。ローカル開発サーバー（Cloudflare Vite plugin）はUpgrade要求へのWorkerの101以外の応答を中継せずソケットを閉じる。E2EではUpgradeで接続が成立しないことと、同じ要求をUpgradeなしで送ったときのWorkerの401/403を確かめ、役割別の判定は単体テストで確かめている。
9. **QRコード生成失敗のE2E**。生成処理を失敗させる手段が実装にないため、再試行と失敗時の流れは単体テストで、`diagnostic` から管理画面の `alert` までの流れはE2Eで確かめている。iPadの代替表示（結果URL）はE2Eで確かめていない。
10. **配点の偏り**。仮の配点で78,125通りの分布は最小10.85%（green）から最大14.43%（blue）。「極端な偏り」の基準が仕様書にないため、テストは全色が一度は出ることだけを確かめている（`pnpm distribution` で分布を表示）。
