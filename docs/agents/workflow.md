# 開発ワークフロー

## 基本フロー

1. 変更対象に対応する `docs/agents/*.md` を読む。
2. 既存コードの設計・記法に合わせて実装する。
3. 必要なら関連ドキュメントを同じコミットで更新する。
4. 検証コマンドを実行する。
5. 変更内容と確認結果を簡潔に共有する。

## 検証コマンド

```bash
npm run lint
npm run format
npm run typecheck
npm run test
```

- 可能な限り 4 つすべて実行する。
- 未実行がある場合は理由を明記する。

## 追加の確認

- 純ロジック（配置探索・履歴・表示モード判定など）は Vitest で単体テストする（`*.test.ts`）。
- UI / Webview 挙動はテスト対象外のため、UI 変更時は最低限、対象画面の手動確認を行う。
- Tauri Webview 変更時は macOS と非 macOS の差分挙動を意識する。

## ドキュメント更新ルール

- IPC 変更: `tauri-ipc.md` を更新する。
- Siteboard 表示ロジック変更: `siteboard-runtime.md` を更新する。
- 型や定数の変更: `domain-models.md` を更新する。
- `tab-store` の履歴管理（Undo/Redo・`nodeHistories`）変更: `domain-models.md` を更新する。
- Edit メニュー/ショートカット連携（`edit-command` 経路）変更: `coding-rules.md` と `tauri-ipc.md` を更新する。
- File メニュー/ショートカット連携（`file-command` 経路）変更: `coding-rules.md` と `tauri-ipc.md` を更新する。
- 規約変更: `coding-rules.md` を更新する。
