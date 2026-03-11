# フェーズ 6: クリーンアップ

## 目的

フェーズ 1〜5 で段階的に廃止してきた旧コードを完全に削除し、コードベースを整理する。

## 廃止対象ファイル一覧

フェーズ完了時点で参照箇所がゼロになっているはずのファイル:

| ファイル | 廃止フェーズ |
|---|---|
| `src/hooks/useSiteboardPan.ts` | フェーズ 1 |
| `src/hooks/useSiteboardZoom.ts` | フェーズ 1 |
| `src/hooks/siteboard/useSiteboardViewportEngine.ts` | フェーズ 1〜5 で段階的に空に |
| `src/hooks/usePageDrag.ts` | フェーズ 4 |
| `src/hooks/usePageResize.ts` | フェーズ 5 |
| `src/components/Node/NodeResizeHandle.tsx` | フェーズ 5 |
| `src/components/Siteboard/InteractionOverlay.tsx` | React Flow がカーソル管理を担う |
| `src/components/Node/WebPageNode.tsx`（旧版） | React Flow 版に完全移行済みの場合 |
| `src/components/Node/StickyNoteNode.tsx`（旧版） | React Flow 版に完全移行済みの場合 |

> **注意**: 旧 `WebPageNode.tsx` / `StickyNoteNode.tsx` は React Flow カスタムノードの内部から呼ばれている可能性がある。完全に独立したコンポーネントに再実装した場合のみ削除する。

## 作業内容

### 1. 廃止ファイルの削除前確認

各ファイルへの参照が残っていないことを確認:

```bash
grep -r "useSiteboardPan\|useSiteboardZoom\|usePageDrag\|usePageResize\|NodeResizeHandle\|InteractionOverlay" src/
```

### 2. useSiteboardViewportEngine の廃止または空化

フェーズ 1〜5 で段階的に内容が削除されて空になっているはず。残存コードがなければ削除する。`startDrag` / `startResize` / `startStickyNoteResize` の参照先を `useSiteboardNodeRuntime` 内に統合する。

### 3. Siteboard.tsx の最終整理

- 旧 `canvasRef` 関連のコード削除
- `panXRef` / `panYRef` を React Flow の `useViewport()` に完全移行
- `isPanMode` ref（Space キーのパン状態）を React Flow の `panActivationKeyCode` で代替
- `LOW_ZOOM_HIDE_THRESHOLD` の判定を `useViewport().zoom` ベースに

### 4. InteractionType の簡素化

`src/hooks/siteboard/types.ts` の `InteractionType` が `'pan' | 'zoom' | 'drag' | 'resize'` を全て持っているが、React Flow 移行後は判定方法が変わる。不要になったタイプを削除する。

### 5. ドキュメントの更新

以下のファイルを実装後の状態に合わせて更新する:

- `docs/agent/architecture.md`: React Flow ベースの新アーキテクチャを反映
- `docs/agent/siteboard-runtime.md`: Display Engine の接続方法を更新（React Flow イベントへの接続）
- `docs/agent/coding-rules.md`: React Flow カスタムノードの実装規約を追加

### 6. MEMORY.md の更新

`/Users/ryo.nakae/.claude/projects/.../memory/MEMORY.md` の「アーキテクチャ概要」「IPC チャネル」「Lessons Learned」を新しい実装に合わせて更新する。

## 最終検証チェックリスト

### 基本操作
- [ ] ホイール/ピンチでズームが動作する
- [ ] Space + ドラッグ/ミドルクリックでパンが動作する
- [ ] ズームリセット（100%）が動作する
- [ ] ビューポートが閉じて開いて復元される

### ノード操作
- [ ] WebPageNode が TopBar からドラッグできる
- [ ] 付箋が本体全体からドラッグできる
- [ ] WebPageNode の8方向リサイズが動作する
- [ ] 付箋のリサイズが動作する（最小サイズ制限あり）
- [ ] リサイズプリセット（モバイル/タブレット/PC）が動作する

### Webview 制御
- [ ] pan/zoom 中に Webview が適切なモード（native/screenshot/hidden）に切り替わる
- [ ] ドラッグ中に Webview が hide される
- [ ] リサイズ中に Webview が screenshot モードに切り替わる
- [ ] 操作終了後に Webview が native に復帰する
- [ ] macOS の白フラッシュ回避（opacity フェードイン）が動作する

### スクリーンショット
- [ ] スクリーンショットの撮影/キャッシュが動作する
- [ ] 起動時のスクリーンショット復元が動作する
- [ ] 定期リフレッシュ（2000ms）が動作する

### その他
- [ ] Undo/Redo が全操作（位置/サイズ変更）で動作する
- [ ] Delete キーでノード削除が動作する
- [ ] コンテキストメニュー（右クリック）が動作する
- [ ] ナビゲーション（戻る/進む/リロード/URL ピン）が動作する
- [ ] ノード追加（WebPage/付箋）が動作する
- [ ] ビューポート中央に新規ノードが配置される

### 品質
- [ ] `npm run typecheck` 通過
- [ ] `npm run lint` 通過
- [ ] `npm run format` 通過
- [ ] `npm run build` 成功
- [ ] 廃止ファイルへの参照が残っていない（`grep` で確認）
