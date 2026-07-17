# Agent ガイド目次

`docs/agents` はエージェント向けの詳細仕様です。
ルート `AGENTS.md` は入口、ここが実装詳細の正本です。

## 読み方

- まず `workflow.md` と `coding-rules.md` を読む。
- 変更対象に応じて以下の詳細を追加で読む。

## ファイル一覧

| ファイル | 目的 | 読むタイミング |
|---|---|---|
| `workflow.md` | 実装〜検証の手順 | すべてのタスク開始時 |
| `coding-rules.md` | コーディング規約 | 実装時 |
| `architecture.md` | 全体構成と責務 | 設計変更・影響範囲確認時 |
| `domain-models.md` | 型・定数・不変条件 | 型変更・store変更時（Undo/Redo 履歴含む） |
| `tauri-ipc.md` | IPC 契約 | Rust/bridge/イベント変更時 |
| `sheltie-runtime.md` | Sheltie 表示・操作仕様 | Sheltie/Webview 変更時 |
| `sheltie-screenshots.md` | スクリーンショット撮影・永続化・ちらつき回避 | スクショ撮影タイミング・保存形式の変更時 |
| `wkwebview-internals.md` | WKWebView 固有のワークアラウンド | WKWebView private API・macOS 固有問題の変更時 |
| `mcp.md` | local MCP lifecycle・trust boundary・tool routing | MCP server・tool・renderer bridge変更時 |

## メンテナンス方針

- 同じテーマは 1 ファイルを正本にする（重複禁止）。
- 実装変更に追従して同じ PR で更新する。
- 一時メモや暫定事情は残さない。
