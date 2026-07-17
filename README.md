# Sheltie

Tauri v2 で構築されたデスクトップアプリケーション。複数の Web ページをキャンバス上に配置して、インタラクティブにデザイン・プレビューできるツールです。

## セットアップ

### 前提環件

- Node.js 18+
- Rust 1.93.1（`mise.toml` で固定）
- macOS / Windows / Linux

### インストール

```bash
git clone <repository>
cd sheltie
npm install
mise exec -- cargo fetch  # Rust 依存関係をダウンロード
```

## 開発

```bash
npm run dev        # 開発モードで起動（Tauri CLI + Vite HMR）
npm run lint       # ESLint によるコード検査
npm run lint:fix   # ESLint 自動修正
npm run format     # Prettier によるフォーマット
npm run typecheck  # TypeScript の型チェック
```

## ビルド

```bash
npm run build      # アプリをビルド・パッケージング
```

アプリケーションは Tauri v2 の統合ビルドシステムで構築されます。
- Rust バックエンド: `src-tauri/`
- React フロントエンド: `src/renderer/`
- Cargo バイナリターゲット: `Sheltie`（`src-tauri/src/main.rs`）
- 出力: プラットフォーム固有の `Sheltie` バイナリ + インストーラー（`src-tauri/target/release/bundle/` 配下）

## アーキテクチャ

### 全体構成

```
src-tauri/              # Rust バックエンド
  ├── src/
  │   ├── main.rs       # エントリーポイント
  │   ├── lib.rs        # Builder 設定・コマンド登録
  │   └── commands/     # Rust コマンド実装（IPC）
  ├── Cargo.toml        # Rust 依存関係
  └── tauri.conf.json   # Tauri 設定

src/renderer/           # React フロントエンド
  ├── components/       # React コンポーネント
  │   ├── Artboard/     # ページレンダリング・操作制御
  │   ├── Canvas/       # キャンバス・サイドバー管理
  │   ├── TabBar/       # プロジェクトタブバー
  │   └── HomeScreen/   # プロジェクト一覧
  ├── store/            # Zustand 状態管理
  ├── hooks/            # React カスタムフック
  ├── lib/
  │   └── tauri-bridge.ts  # IPC ブリッジ層
  ├── types/            # TypeScript 型定義
  └── main.tsx          # React エントリーポイント

shared/
  └── types.ts          # 共有型定義
```

### Webview ハイブリッド管理

- React DOM にプレースホルダー `<div data-webview-placeholder>` を配置
- Rust 側で Tauri native Webview を作成・管理
- JS から `Webview.getByLabel(label)` で操作（位置・サイズ・表示制御）
- ドラッグ・リサイズ・ズーム操作中は全 Webview を非表示 → 操作完了時に座標同期して表示

### 状態管理

**Zustand ストア** (`src/renderer/store/tab-store.ts`):
- プロジェクト・ページのライフサイクル管理
- ページ位置・サイズ・ビューポート状態
- タイトルバーのドラッグ領域制御

**永続化** (`src/renderer/store/tab-persistence.ts`):
- tauri-plugin-store で プロジェクト状態をファイルシステムに保存
- アプリ再起動時に自動復元

### セキュリティ

Tauri v2 のセキュリティベストプラクティスを適用：
- すべての IPC は Rust コマンド経由でサンドボックス化
- `src-tauri/capabilities/default.json` で権限を細密制御
- macOS の document window は native tabs を使い、OS 標準の title / tab bar を表示する

## 開発ガイド

詳細は **AGENTS.md** を参照してください。

### インポート規約

すべてのインポートで `@/` パスエイリアスを使用します（`tsconfig.json` + `vite.config.mts` で定義）。

```typescript
// OK
import { useProjectStore } from '@/store/tab-store';

// NG（相対パス使用禁止）
import { useProjectStore } from '../store/tab-store';
```

### コンポーネント

Hero UI v3 を優先的に使用します。不足時のみ独自実装してください。

### IPC ブリッジ

すべての IPC は `src/renderer/lib/tauri-bridge.ts` に集約されています。新しい IPC が必要な場合：

1. Rust 側で `src-tauri/src/commands/` にコマンドを実装
2. `src/renderer/lib/tauri-bridge.ts` でラッパー関数を追加
3. React から ブリッジ経由で呼び出し

## トラブルシューティング

### 型チェックエラー

```bash
npm run typecheck
```

TypeScript が strict mode で実行されます。未使用変数は禁止。

### ESLint エラー

```bash
npm run lint:fix
```

Tailwind CSS クラスの自動整列を含みます。

### Rust コンパイルエラー

```bash
mise exec -- cargo check
```

Rust 依存関係をチェック。mise で Rust 環境が管理されています。

## ライセンス

[LICENSE](LICENSE)
