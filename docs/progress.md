# 実装の進捗

作業を再開するときは、この記録と `git log` を確認する。

## 完了したこと

- 仕様書 `docs/README.md` の全文確認
- `docs/visual-language.md` で演出のビジュアル言語を決定

## 次にやること

1. プロジェクトの土台（pnpm、Vite、Svelte、Cloudflare Vite plugin、Vitest、Playwright）
2. 共通モジュール（型、診断定義、色定義、写真定義、`displayManifest`、判定、状態遷移、メッセージ検証）
3. Durable ObjectとWorker（認証、ペアリング、WebSocket、alarm、冪等性）
4. iPad、展示ディスプレイ、管理画面、結果ページ
5. 仮写真とproduction buildの検証
6. 単体テストとE2Eテスト
7. ブラウザでの演出確認

## 判断に迷った点

（実装しながら追記する）
