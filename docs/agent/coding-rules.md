# コーディング規約

## MUST

- 既存コードの設計・記法・命名規則を優先する。
- コンポーネントは HeroUI v3 を優先し、不足時のみ独自実装する。
- ライブラリ/API 仕様の確認は Context7 を使う。
- import は `@/` エイリアスを使い、相対パス `../` は使わない。
- TypeScript の `strict` 前提で、未使用変数・引数を残さない。
- 実装完了時に `lint` / `format` / `typecheck` を実行する。

## SHOULD

- グローバル共有状態は Zustand、ローカル状態は `useState` を優先する。
- サイドバー幅変更のような高頻度更新は、レンダリング外の DOM 更新を使い確定時のみ store に反映する。
- Siteboard 内 UI のスケーリングは `--canvas-zoom` を使った CSS 計算で対応し、不要な再レンダーを避ける。
- コメントは「なぜ必要か」がコードだけで伝わらない箇所に限定する。

## Siteboard/Webview 変更時の必読

- 表示モード遷移・スクリーンショット切替・操作中の制約は `siteboard-runtime.md` を正本とする。
- IPC の追加・変更は `tauri-ipc.md` と実装を同時に更新する。

## UI/スタイル

- スタイルは Tailwind CSS v4 を利用する。
- クラス順序は ESLint/Prettier の整形結果に従う。

## タイトルバー制御

- Tauri v2 では `data-tauri-drag-region` を利用する。
- ドラッグ可能領域は要素ごとに明示する（暗黙継承を前提にしない）。
