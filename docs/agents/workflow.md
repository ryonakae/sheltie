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
# Rust を触った時のみ
(cd src-tauri && cargo test --lib)
```

- 可能な限り全部実行する。
- 未実行がある場合は理由を明記する。
- pre-commit hook（`.husky/pre-commit`）で `lint-staged` / `typecheck` / `vitest` は自動実行される。`src-tauri/` 配下の変更が staged されている時は `cargo test --lib` も自動で走る。

## 追加の確認

- 純ロジック（配置探索・履歴・表示モード判定など）は Vitest で単体テストする（`*.test.ts`）。
- UI / Webview 挙動はテスト対象外のため、UI 変更時は最低限、対象画面の手動確認を行う。
- Tauri Webview 変更時は macOS と非 macOS の差分挙動を意識する。

## TDD ルール

新規実装・バグ修正・リファクタ抽出はいずれも **テスト先行（red → green → refactor）** で進める。テストを後追いで書かない。

### テスト対象（TDD 必須）

- **Rust**: `cargo test` または Tauri 統合テスト。状態機械・純関数・コマンドハンドラの分岐。
- **`src/lib/*`**: 純関数（path 正規化・placement・edge 操作など）。
- **`src/store/*`**: Zustand store の reducer 相当ロジック・履歴・スライス内純関数。
- **hook 内部の純粋ロジック**: DOM/ref に触らない判定関数・整形関数。テストしたい関数は hook ファイルから独立した module（`src/lib/...` か `src/hooks/.../内部モジュール.ts`）に切り出してから export してテストする。

### テスト対象外（手動確認のみ）

- React コンポーネントの描画・イベントハンドリング。
- Webview の native レイアウト・スクリーンショット・ナビゲーション挙動。
- `getBoundingClientRect` / `requestAnimationFrame` / `ResizeObserver` 等の DOM API に強く依存する hook の外側（中の純粋判定は切り出してテストする）。
- Tauri IPC 経由の実機呼び出し。

### サイクル

1. **失敗テストを書く**: 期待する入出力・状態遷移を `*.test.ts` に書く。`npm run test` で red になることを確認。
2. **通す最小実装**: テストを green にする最短コードを書く。設計の整理は後回し。
3. **リファクタ**: green を保ったまま命名・抽出・重複除去を進める。テストが赤くなったら直す前に元の挙動と diff を確認する。

### 例外運用

- 既存実装にテストが無い場合、まず **characterization test**（今の挙動を固定するテスト）を 1〜2 件書いてから変更に入る。
- 「テストが書きづらい」と感じたら、それは設計のシグナル。DOM/ref 依存と純粋判定が同居しているなら、まず純粋判定を切り出すリファクタを先に行う（このリファクタ自体は挙動完全保存なのでテストは characterization で十分）。
- 一時的な探索コード・スパイク実装は除外して良いが、main branch に入る変更は必ずテスト先行に戻す。

### 実務上の方針

- **後追いテストの目的**: まず characterization（挙動固定）として書き、書く過程で違和感が出た箇所だけ「仕様テスト」へ昇格させる。最初から全部を仕様として書こうとしない。
- **粒度**: 1 関数あたりハッピーパス 1〜2 件 + 主要エッジ 1〜2 件の **広く浅く**。全分岐網羅はバグが見つかった時・リファクタ直前にスポット投入する。
- **Rust テスト**: `#[cfg(test)] mod tests {}` での **unit test を基本**とする。`tests/` ディレクトリの統合テストや `AppHandle` の mock は必要が出てから足す。状態機械は `Mutex` を持つ struct でも普通に unit test できる。
- **モック**: 純関数のみテストする方針を維持。`Date.now()` / `Math.random()` / `crypto.randomUUID()` 等の非決定値は **引数化して注入**（`now: () => number` のような style）。`vi.mock()` での IPC・API モックは原則使わない。
- **DOM API を引数に取る純関数**（`DOMRect` 等）: テスト時は plain object に `as DOMRect` でキャストして良い。jsdom 環境は `document` 自体を触るテストが必要になったときに導入を検討する。

## ドキュメント更新ルール

- IPC 変更: `tauri-ipc.md` を更新する。
- Sheltie 表示ロジック変更: `sheltie-runtime.md` を更新する。
- 型や定数の変更: `domain-models.md` を更新する。
- `tab-store` の履歴管理（Undo/Redo・`nodeHistories`）変更: `domain-models.md` を更新する。
- Edit メニュー/ショートカット連携（`edit-command` 経路）変更: `coding-rules.md` と `tauri-ipc.md` を更新する。
- File メニュー/ショートカット連携（`file-command` 経路）変更: `coding-rules.md` と `tauri-ipc.md` を更新する。
- 規約変更: `coding-rules.md` を更新する。
