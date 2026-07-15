# 開発ガイドライン（エージェント向け）

## プロジェクト概要

Sheltie は Web ページを並べてボード上で俯瞰・比較できるデスクトップアプリケーションです。
Tauri v2 + React + TypeScript + Tailwind CSS v4 で構築されています。

## このファイルの役割

この `AGENTS.md` は入口専用です。
実装詳細は `docs/agents/*.md` を正本として参照してください。

## IMPORTANT (MUST)

- 変更前に `docs/agents/README.md` を確認し、該当する詳細ドキュメントを読む。
- 既存コードの設計・記法・命名を優先し、不要な独自ルールを持ち込まない。
- UI コンポーネントは HeroUI v3 を優先し、不足時のみ独自実装する。
- ライブラリ/API の仕様確認は Context7 を使う。
- import は `@/` エイリアスを使用し、`../` 相対パスは使わない。
- 変更対象に応じて `docs/agents` の関連ドキュメントを同じコミットで更新する（詳細は `docs/agents/workflow.md` の「ドキュメント更新ルール」参照）。
- 実装完了時は `npm run lint` `npm run format` `npm run typecheck` `npm run test` を実行する。
- **TDD で進める**: テスト可能な層（Rust / `src/lib/*` / `src/store/*` / DOM 非依存の hook 内部ロジック）は「失敗テスト → 通す最小実装 → リファクタ」のサイクルを守る。バグ修正も先に再現テストを書く。詳細は `docs/agents/workflow.md` の「TDD ルール」参照。
- UI コンポーネント・Webview 挙動・`getBoundingClientRect` 等 DOM/ref に強く依存する hook はテスト対象外。最低限の動作確認手順を PR 説明に残す。
- 変わりやすい一時情報は書かず、恒久ルールだけを残す。

## 開発コマンド

```bash
npm run dev          # 開発モード起動（Tauri CLI + Vite HMR）
npm run build        # アプリをビルド
npm run lint         # ESLint
npm run lint:fix     # ESLint 自動修正
npm run format:fix     # Prettier 書き込み
npm run format         # Prettier 検査
npm run typecheck    # TypeScript 型チェック
npm run test         # Vitest（純ロジックの単体テスト）
```

## 詳細ドキュメント

- `docs/agents/README.md`: ガイド全体の目次と読み分け
- `docs/agents/workflow.md`: 開発フロー・検証手順・運用ルール
- `docs/agents/coding-rules.md`: 実装規約（UI/状態管理/命名/DOM 更新）
- `docs/agents/architecture.md`: 全体構成と責務分割
- `docs/agents/domain-models.md`: 主要型・定数・不変条件
- `docs/agents/tauri-ipc.md`: Tauri IPC コマンドとイベント契約
- `docs/agents/sheltie-runtime.md`: Sheltie の表示モードと Webview ランタイム仕様
- `docs/agents/sheltie-screenshots.md`: スクリーンショット撮影・永続化・ちらつき回避
- `docs/agents/wkwebview-internals.md`: WKWebView プラットフォーム固有のワークアラウンド

## 更新ポリシー

- 同種の指摘が 2 回以上発生したら、該当ルールを `docs/agents` に追加する。
- 実装と不一致になった記述は最優先で修正し、古い説明を残さない。
- ルート `AGENTS.md` には詳細実装を書かず、リンクだけを維持する。
