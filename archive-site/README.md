# アーカイブ専用の仮公開

展示用アプリとは別の、仮データを使う静的サイトです。管理画面・展示API・Durable Objectは含みません。

- ビルド: `pnpm build:archive`
- 公開: `pnpm deploy:archive`
- 公開用の設定: `wrangler.archive.jsonc`
- Worker名: `anatairo-archive-2026`
- 出力: `dist/archive`

公開前に `pnpm exec wrangler whoami` で写真部のCloudflareアカウントを確認してください。
既存の展示用 `wrangler.jsonc` を使うデプロイとは別の公開先です。

## ブランチ運用

- `feat/archive-site-mobile`: 日々の実装・確認用。ここへのpushでは本番を更新しません。
- `production`: 公開用。確認済みの変更を作業ブランチからPRでマージします。
- Cloudflare Workers Buildsの本番ブランチは `production` を指定します。
- ビルドコマンド: `pnpm build:archive`
- デプロイコマンド: `pnpm exec wrangler deploy --config wrangler.archive.jsonc`
- ルートディレクトリ: リポジトリ直下

CloudflareのGit連携はダッシュボードで別途接続します。このファイルだけでは自動デプロイは有効になりません。

### Cloudflareの接続済み設定

- アカウント: `syashinbu.at.dhu@gmail.com`
- 公開URL: https://anatairo-archive-2026.syashinbu-at-dhu.workers.dev/
- GitHub: `DHU-Photo-Club/School-Festival-2026`
- 本番ブランチ: `production`（自動ビルド有効）
- 本番以外の自動プレビュービルド: 無効。作業中はローカルプレビューで確認します。
- ビルド環境: `NODE_VERSION=26.13.0`、`PNPM_VERSION=12.18.0`

作業ブランチで確認後、`production`へのPRを作成し、マージすると本番が更新されます。
