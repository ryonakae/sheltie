# 開発ワークフロー

## 基本フロー

1. 変更対象に対応する `docs/agent/*.md` を読む。
2. 既存コードの設計・記法に合わせて実装する。
3. 必要なら関連ドキュメントを同じコミットで更新する。
4. 検証コマンドを実行する。
5. 変更内容と確認結果を簡潔に共有する。

## 検証コマンド

```bash
npm run lint
npm run format:check
npm run typecheck
```

- 可能な限り 3 つすべて実行する。
- 未実行がある場合は理由を明記する。

## 追加の確認

- テストフレームワークは未導入。
- UI 変更時は最低限、対象画面の手動確認を行う。
- Tauri Webview 変更時は macOS と非 macOS の差分挙動を意識する。

## ドキュメント更新ルール

- IPC 変更: `tauri-ipc.md` を更新する。
- Siteboard 表示ロジック変更: `siteboard-runtime.md` を更新する。
- 型や定数の変更: `domain-models.md` を更新する。
- 規約変更: `coding-rules.md` を更新する。
