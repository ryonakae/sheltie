# 開発ガイドライン

## プロジェクト概要

Browser Artboard は Electron + React + TypeScript + Tailwind CSS v4 で構築されたデスクトップアプリケーションです。Electron Forge と Vite を使ったモダンなビルド構成を採用しています。


## 開発コマンド

```bash
npm start          # 開発モードで起動（Electron Forge + Vite HMR）
npm run lint       # ESLint によるコード検査
npm run lint:fix   # ESLint 自動修正
npm run format     # Prettier によるフォーマット
npm run typecheck  # TypeScript の型チェック
npm run package    # アプリをパッケージング
npm run make       # インストーラー生成
```

テストフレームワークは現在導入されていません。


## アーキテクチャ

Electron の 3 プロセス構造に沿って `src/` が分割されています：

```
src/
├── main/        # Electron メインプロセス (Node.js)
│   └── index.ts # ウィンドウ生成・アプリライフサイクル管理
├── preload/     # サンドボックス内のブリッジ
│   └── index.ts # Main ↔ Renderer 間のセキュアな IPC 設定
└── renderer/    # React レンダラープロセス (ブラウザ環境)
    ├── main.tsx # React エントリーポイント
    ├── App.tsx  # ルートコンポーネント
    ├── index.html
    └── index.css
```

### ビルドパイプライン

3 つの独立した Vite 設定がそれぞれのプロセスをビルドします：

| 設定ファイル | 対象 | 出力 |
|---|---|---|
| `vite.main.config.ts` | メインプロセス | `.vite/build/main.js` |
| `vite.preload.config.ts` | Preload スクリプト | `.vite/build/preload.js` |
| `vite.renderer.config.mts` | React SPA | `.vite/renderer/` |

### セキュリティ設定

メインプロセスでは Electron のセキュリティベストプラクティスを適用しています：Context Isolation 有効、Node.js 統合無効、Sandbox 有効。IPC は必ず Preload スクリプト経由で実装してください。


## コーディング規約

- **コンポーネント**: Hero UI v3 を優先使用し、不足時のみ独自実装。 `heroui-react` スキル、 `heroui-react` MCP を使用すること
- **スタイリング**: Tailwind CSS v4 を使用。クラス順序は `eslint-plugin-better-tailwindcss` が自動整列するため、lint に従うこと
- **TypeScript**: `strict: true`、未使用変数・パラメータはエラーになる
- **Lint, Format**: 実装完了時に `npm run lint`, `npm run format:check`, `npm run typecheck` を実行し、エラーが出ないようにすること


## Claude Code on the Web

- **GitHub CLI (`gh`) の認証**: `GITHUB_TOKEN` 環境変数が利用可能。`gh` コマンド実行時はこのトークンで認証できる
  例: `$ GITHUB_TOKEN="ghp_xxxxx" gh pr create --title "PR Title" --body "PR Body"`
