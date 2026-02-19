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
    ├── App.tsx  # ルートコンポーネント（useReducer でタブ状態管理）
    ├── index.html
    ├── index.css
    ├── types/
    │   └── tab.ts # Tab 型、TabState、TabAction の定義
    ├── hooks/
    │   └── useTabReducer.ts # タブ状態管理ロジック
    └── components/
        ├── Canvas/
        │   ├── Canvas.tsx # キャンバス全体（サイドバー + メイン領域）
        │   ├── Sidebar.tsx # サイドバーコンポーネント
        │   └── ResizeHandle.tsx # サイドバーリサイズハンドル
        └── TabBar/
            ├── TabBar.tsx # タブバー全体（DnD, ホーム + タブ + 追加ボタン）
            └── TabItem.tsx # 個別タブ（ドラッグ可能）
```

### コンポーネント構成

**TabBar**: ホームボタン、動的タブ、追加ボタンを持つレイアウト
- `@dnd-kit/react` を使用したドラッグ&ドロップ並び替え対応
- 各タブはホバー時に閉じるボタン（×）を表示

**Canvas**: サイドバーとメイン領域を管理
- サイドバー幅はタブごとに保持（リサイズ中は DOM 直接操作でパフォーマンス最適化）
- ResizeHandle で幅調整可能

**状態管理**: `useReducer` + Context なし（シンプルな状態規模のため）
- アクション: `ADD_TAB`, `REMOVE_TAB`, `SWITCH_TAB`, `REORDER_TABS`, `SET_SIDEBAR_WIDTH`
- ホームタブは `HOME_ID = '__home__'` で特別管理（状態配列には含めない）

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
- **状態管理**: 複雑でない場合は `useReducer` で十分。グローバル状態が必要な場合のみ Context を検討
- **DOM 操作**: タブ幅調整のような高頻度アップデートはレンダリング外で行い、確定時のみ dispatch で同期


## 主要ライブラリ

| ライブラリ | 目的 |
|---|---|
| `@dnd-kit/react` | タブのドラッグ&ドロップ並び替え（React 19 対応） |
| `@gravity-ui/icons` | House, Plus, Xmark などのアイコン |
| `heroui-react` | UI コンポーネント（Button, Card など） |


## Claude Code on the Web

- **GitHub CLI (`gh`) の認証**: `GITHUB_TOKEN` 環境変数が利用可能。`gh` コマンド実行時はこのトークンで認証できる
  例: `$ GITHUB_TOKEN="ghp_xxxxx" gh pr create --title "PR Title" --body "PR Body"`
