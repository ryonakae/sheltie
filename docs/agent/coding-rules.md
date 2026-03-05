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

## ノード操作 UI

- ノード右上の閉じるボタン（インライン Xmark）は設けない。削除は以下の 3 経路に統一する:
  1. Delete / Backspace キー（`useSiteboardKeyboard` で処理。テキスト入力フォーカス中はスキップ）
  2. メニューバー `Edit -> Delete`（Tauri メニューイベントを `edit-command` として受信）
  3. ノードまたはサイドバーアイテムの右クリック → コンテキストメニュー「ノードを削除」
- Undo/Redo は `CmdOrCtrl+Z` / `CmdOrCtrl+Shift+Z` とメニューバー `Edit -> Undo / Redo` を同じ `edit-command` 経路で処理する。
- キーボードショートカットとメニューイベントは `lib/edit-commands.ts` に集約し、各画面コンポーネントへ分散実装しない。
- コンテキストメニューは `components/Common/ContextMenu` を使い createPortal で body 直下に描画する。
- `removePage` の呼び出しは `screens/Project.tsx` に集約し、`Sidebar` と `Siteboard` には `onRemovePage` prop として渡す。

## リサイズハンドルとカーソル制御

- `NodeResizeHandle` のカーソルは Tailwind cursor クラスでなく **inline style** で設定する（CSS 優先度問題の回避）。
- e/w ハンドルはネイティブ Webview に覆われるため、ハンドル要素を **外側 -4px 拡張**（16px 幅）して Webview 外に突き出す。
- リサイズ中の `InteractionOverlay` カーソルは `useSiteboardViewportEngine` が `onInteractionChange(direction)` 経由で `RESIZE_CURSOR_MAP` から解決して渡す。
- `overflow-hidden` + `border-radius` をノード外側 div に設定するとコーナーハンドルがクリッピングされる。**`overflow-hidden` は TopBar/BottomBar などの子要素側に移動し、外側 div には設定しない。**
- `onMouseDown` で `e.stopPropagation()` を呼ぶハンドラーには **必ず `if (e.button !== 0) return;` を先頭に置く**。右クリック（button=2）時に伝播を止めると `contextmenu` イベントが親コンポーネントに届かなくなる。`startDrag` / `startResize` も同様。

## アニメーション

- `AnimatePresence mode="wait"` + `key={value}` パターンは高頻度更新（ズームレベル・カウンター等）に使わない。exit アニメーション（120ms）完了待ちにより中間値がすべてスキップされ表示がフリーズする。
- リアルタイム表示が必要な値は単一の `motion.*` 要素で直接レンダリングし、操作完了後（例: 200ms のデバウンス）にアニメーションを発火するパターンを使う。

## useEffect と setState

- `useEffect` 本体内での同期 `setState` は `react-hooks/set-state-in-effect` ESLint エラーになる。リセット処理はクリーンアップ関数（`return () => { setState(false) }`）に移動する。

## React 18 自動バッチングと requestAnimationFrame

- React 18 は Promise の `.then()` 内の `setState` を自動バッチングし、同一レンダーサイクルに合流させる。
- 「DOM 状態 A の React レンダー → ブラウザ描画 → DOM 状態 B の React レンダー」という順序が必要な場合は、A の `setState` の後に `requestAnimationFrame` を挟んでから B の `setState` を呼ぶ。
- 具体例: コンテキストメニュー表示フローで `setDisplayModes`（スクリーンショット差し替え）完了後に `requestAnimationFrame(() => setContextMenu(...))` でメニューを表示（`siteboard-runtime.md` 参照）。
