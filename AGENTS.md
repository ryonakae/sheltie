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
    ├── App.tsx  # ルートコンポーネント（Zustand でプロジェクト状態管理）
    ├── index.html
    ├── index.css
    ├── types/
    │   └── tab.ts # Project 型、ProjectState の定義
    ├── store/
    │   ├── tab-store.ts # Zustand ストア（useProjectStore、アクション定義）
    │   └── tab-persistence.ts # プロジェクト状態の永続化ロジック
    └── components/
        ├── Canvas/
        │   ├── Canvas.tsx # キャンバス全体（サイドバー + メイン領域）
        │   ├── Sidebar.tsx # サイドバーコンポーネント
        │   └── ResizeHandle.tsx # サイドバーリサイズハンドル
        ├── TabBar/
        │   ├── TabBar.tsx # タブバー全体（openIds に基づく開いているプロジェクト表示）
        │   └── TabItem.tsx # 個別プロジェクトタブ（ドラッグ可能）
        └── HomeScreen/
            ├── HomeScreen.tsx # プロジェクト一覧画面（カードグリッド）
            ├── ProjectCard.tsx # プロジェクトカード（HeroUI Card）
            ├── RenameModal.tsx # プロジェクト名変更モーダル（HeroUI Modal）
            └── DeleteDialog.tsx # 削除確認ダイアログ（HeroUI AlertDialog）
```

### コンポーネント構成

**HomeScreen**: プロジェクト一覧画面（ホーム表示時）
- `HomeScreen.tsx`: プロジェクト一覧のカードグリッドレイアウト
- `ProjectCard.tsx`: 各プロジェクトをカード表示（Dropdown で操作メニュー提供）
- `RenameModal.tsx`: プロジェクト名変更用モーダル（HeroUI Modal）
- `DeleteDialog.tsx`: 削除確認用ダイアログ（HeroUI AlertDialog）

**TabBar**: 開いているプロジェクトのタブバー、ホームボタン、追加ボタン
- `openIds` に基づいて開いているプロジェクトのみ表示
- `@dnd-kit/react` を使用したドラッグ&ドロップ並び替え対応
- 各タブはホバー時に閉じるボタン（×）を表示

**Canvas**: サイドバーとメイン領域を管理
- サイドバー幅はプロジェクトごとに保持（リサイズ中は DOM 直接操作でパフォーマンス最適化）
- ResizeHandle で幅調整可能

**状態管理**: Zustand による共有状態管理（`useProjectStore` in `tab-store.ts`）
- ストア内アクション: `createProject`, `openProject`, `closeProject`, `deleteProject`, `renameProject`, `setActive`, `reorderOpenProjects`, `updateSidebarWidth`
- Selectors: `selectActiveProject`, `selectIsHome`
- 起動時に `tab-persistence.ts` で保存済み状態を復元（localStorage ベース）
- プロジェクトライフサイクル: `createProject` で新規作成、`openProject` で開く（既開いていれば activeId 更新）、`closeProject` でタブバーから閉じる（openIds から除去）、`deleteProject` で削除（projects + openIds 両方から除去）

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
- **状態管理**: グローバル共有状態は Zustand を使用。コンポーネントローカル状態は `useState` で十分
- **DOM 操作**: サイドバー幅調整のような高頻度アップデートはレンダリング外で行い、確定時のみ dispatch で同期


## 主要ライブラリ

| ライブラリ | 目的 |
|---|---|
| `zustand` | グローバル状態管理（プロジェクト状態、レイアウト設定） |
| `@dnd-kit/react` | 開いているプロジェクトのドラッグ&ドロップ並び替え（React 19 対応） |
| `@gravity-ui/icons` | House, Plus, Xmark などのアイコン |
| `heroui-react` | UI コンポーネント（Button, Card, Modal, AlertDialog など） |


## Claude Code on the Web

- **GitHub CLI (`gh`) の認証**: `GITHUB_TOKEN` 環境変数が利用可能。`gh` コマンド実行時はこのトークンで認証できる
  例: `$ GITHUB_TOKEN="ghp_xxxxx" gh pr create --title "PR Title" --body "PR Body"`
