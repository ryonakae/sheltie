# Phase 3 — リファクタ・テスト・ドキュメント Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** レビューで挙がったバグ・デッドコード・規約違反を清算し、テストが必要な純ロジックを埋め、実装と食い違ったドキュメントを正す。あわせて重複コードと肥大化した Rust モジュールを整理する。

**Architecture:** リスクの低い順に進める。Task 1〜8（バグ・デッドコード・テスト・ドキュメント・依存整理）は影響範囲が閉じている。Task 9〜12（重複抽出・Rust 分割）は振る舞いを変えない構造変更で、自動テストで守れない DOM 依存コードを含むため最後に置く。

**Tech Stack:** TypeScript / React 19 / Zustand / Vitest、Rust / Tauri v2 / cargo test、ESLint / Prettier

## Global Constraints

- Phase 1 / 2 の完了が前提。
- **構造変更（Task 9〜12）は振る舞いを変えない。** 変更後に見た目・操作が変わってはいけない。ツールバーとリサイズハンドルは `CLAUDE.md` でテスト免除対象の DOM 依存コードなので、各タスクの手動確認を省略しない。
- Rust モジュール分割は**公開 API を変えない**。`pub(crate)` / `pub` の境界を維持し、呼び出し側の import だけを更新する。
- `npm audit fix --force` は使わない。Vite / Vitest のメジャー更新はこのフェーズの対象外。
- ドキュメントは `docs/agents/*.md` を正本とし、実装と一致しない記述を残さない。

## Current Context

確認済みの指摘箇所:

- `src/store/tab-store.ts:688-693`（`updateStickyNoteStyle`）、`:741-746`（`updateTextNodeStyle`）、`:734-739`（`updateTextNodeContent`）— いずれも常に新オブジェクトを返すため `patchNode`（`:168-182`）の no-op 契約（同一参照か `null` のときだけ履歴を積まない）を満たさず、無変更でも履歴が 1 件増える。比較している既存例は `updateStickyNoteContent`（`:680` 付近）。
- `src/hooks/sheltie/useSheltieDrag.ts:191-269` — `handleTitlePointerDown` が `window` に `pointermove` / `pointerup` を登録し、`pointerup` の中でしか解除しない。ドラッグ中にアンマウントされるとリスナーが残る。
- `src/components/ReactFlowNodes/StickyNoteToolbar.tsx:73` — `title={color.bgClass}` で Tailwind クラス名（`bg-yellow-100`）がネイティブツールチップに出る。`STICKY_NOTE_COLORS`（`src/constants/sheltie.ts:75-100`）に `label` は無い。同種の `TextNodeToolbar.tsx:133` は `color.label` を使っている（`TEXT_NODE_COLORS` は `label` を持つ）。
- `src-tauri/src/menus/mcp.rs:74-93` — `find_menu_item_in_items` が `#[cfg(test)] mod tests` より後にあり、clippy の `items_after_test_module` が出る唯一の警告。
- `src/components/ReactFlowNodes/WebPageFlowNode.tsx:81,87,93,99,103-118` と `StickyNoteFlowNode.tsx:54-55,61-76` — `sheltie-web-resize-line` / `sheltie-web-resize-handle` / `sheltie-sticky-resize-line` / `sheltie-sticky-resize-handle` を指定しているが、`index.css` に対応セレクタが無く、リポジトリ内の他の参照も無い。見た目は inline style で付与済み（`WebPageFlowNode.tsx:74,318`、`StickyNoteFlowNode.tsx:92`）なので、**機能バグではなく未使用の marker class**。`TextFlowNode.tsx` には同種の class が無く不整合。
- `src/hooks/sheltie/useScreenshotCaptureQueue.ts:18,246,268` — `SCREENSHOT_CLIPPING_ENABLED = true` がハードコードで、`false` 分岐は到達不能。
- `src/hooks/sheltie/display-engine/state-machine.ts:1` — `import type { InteractionType } from '../types';`。`src/**` 唯一の親相対 import。`eslint.config.mjs` に禁止ルールは無い。
- `src/lib/unsaved-changes-dialog-display.ts` — module スコープの `activeController` / `isDialogDisplayEntered` / `pendingExitTimer` を持つ状態機械。`setTimeout(…, 0)` による exit 遅延と enter による打ち消しがある。テストが無い。
- `src/lib/project-display-name.ts` — `getDisplayNameFromFilePath` / `getProjectDisplayName`。テストが無い。
- `src-tauri/src/menus/helpers.rs:3-5` — `normalize_menu_text`（`&` 除去 + trim + 小文字化）。テストが無い。
- `src/components/ReactFlowNodes/{StickyNoteToolbar,TextNodeToolbar,WebPageToolbar}.tsx` と `src/components/ReactFlowEdges/ArrowToolbar.tsx` — `buttonBase` / `activeClass` / 区切り線 / コンテナの Tailwind 文字列がほぼ一字一句重複。既存の共有スタイル方針は `selectionChromeStyles.ts` / `floatingControlStyles.ts`。
- `src/components/ReactFlowNodes/StickyNoteFlowNode.tsx:53-122` と `TextFlowNode.tsx:44-99` — `NodeResizeControl` の配列生成と JSX がほぼ同一（差分は `minWidth` とテキスト側のダブルクリック復帰ハンドラ）。`WebPageFlowNode.tsx:76-119` は 8 方向版で同型。
- `src-tauri/src/mcp/page_automation/actor.rs` — 2444 行（テスト 1136-2444）。`impl PageAutomationState`（100-1066）に「リクエスト直列化」「navigation epoch 管理」「スクリーンショット撮影」の 3 関心が同居。
- `src-tauri/src/mcp/tools/browser.rs` — 2066 行（テスト 1388-2066）。92-313 に `BrowserBackend` / `AppBrowserBackend`、313-670 に約 15 個の params/result 型と `validate_page_key` 等、672-1388 に `impl SheltieMcpService`。
- `src-tauri/src/mcp/page_automation/protocol.rs` — 1583 行。851-1032 に約 20 個の `ToolError` ファクトリ。
- `package.json:36` — `@tailwindcss/vite` が `dependencies` にある（ビルド時プラグインなので誤分類）。`@tauri-apps/plugin-store` も `dependencies` にあるが JS から未 import。
- ドキュメント誤記: `WEB_PAGE_FRAME_PADDING` の実装値は `16`（`src/constants/project.ts:18`）で `docs/agents/domain-models.md:117` は正しいが、`docs/agents/architecture.md:29,32`、`docs/agents/coding-rules.md:37,53,201`、`docs/agents/sheltie-runtime.md:122` が「24px world 固定」と誤記している（計 6 箇所）。

## File Structure

- Create: `src/lib/unsaved-changes-dialog-display.test.ts`
- Create: `src/lib/project-display-name.test.ts`
- Create: `src/components/ReactFlowNodes/nodeToolbarStyles.ts` — ツールバー共通スタイル定数と `ToolbarDivider`
- Create: `src/components/ReactFlowNodes/NodeWidthResizeControls.tsx` — 付箋 / テキスト共通のリサイズハンドル
- Create: `src-tauri/src/mcp/page_automation/capture.rs`
- Create: `src-tauri/src/mcp/tools/browser/types.rs`
- Create: `src-tauri/src/mcp/tools/browser/backend.rs`
- Create: `src-tauri/src/mcp/page_automation/protocol/errors.rs`
- Modify: `src/store/tab-store.ts`, `src/store/tab-store.test.ts`
- Modify: `src/hooks/sheltie/useSheltieDrag.ts`
- Modify: `src/components/ReactFlowNodes/StickyNoteToolbar.tsx`
- Modify: `src/constants/sheltie.ts` — `STICKY_NOTE_COLORS` に `label` を追加
- Modify: `src-tauri/src/menus/mcp.rs`, `src-tauri/src/menus/helpers.rs`
- Modify: `src/components/ReactFlowNodes/{WebPageFlowNode,StickyNoteFlowNode,TextFlowNode}.tsx`
- Modify: `src/hooks/sheltie/useScreenshotCaptureQueue.ts`
- Modify: `src/hooks/sheltie/display-engine/state-machine.ts`, `eslint.config.mjs`
- Modify: `src-tauri/src/commands/dialog.rs`, `src-tauri/src/commands/store/macos_tabs.rs`
- Modify: `src/components/ReactFlowEdges/ArrowToolbar.tsx`, `src/components/ReactFlowNodes/{TextNodeToolbar,WebPageToolbar}.tsx`
- Modify: `docs/agents/{architecture,coding-rules,sheltie-runtime,sheltie-screenshots,mcp,tauri-ipc,domain-models,wkwebview-internals}.md`
- Modify: `package.json`, `package-lock.json`

## Tasks

### Task 1: no-op の Undo 履歴を積まないようにする

**Objective:** 同じスタイルを再適用したときや無変更で blur したときに、無意味な Undo エントリが増えないようにする。

**Files:**
- Modify: `src/store/tab-store.ts:688-693, 734-739, 741-746`
- Modify: `src/store/tab-store.test.ts`

- [ ] **Step 1: Write the failing test**

`src/store/tab-store.test.ts` に追加する。このファイルはテスト名が日本語、履歴長は `useProjectStore.getState().history.past` で確認する記法なので、それに合わせる。既存の `beforeEach` は `nodes: []` で初期化するため、このブロック用に付箋 / テキストノードを持つ document で上書きする。

```ts
describe('style / content actions の no-op 契約', () => {
  beforeEach(() => {
    useProjectStore.getState().initializeProject({
      untitledIndex: 1,
      document: {
        schemaVersion: 2,
        nodes: [
          {
            id: 's1',
            type: 'stickynote',
            title: 'S1',
            content: '',
            colorIndex: 0,
            fontSizePreset: 1,
            x: 0,
            y: 0,
            width: 200,
            height: 200,
          },
          {
            id: 't1',
            type: 'text',
            title: 'T1',
            tiptapContent: { type: 'doc', content: [] },
            fontSizePreset: 1,
            fontWeight: 'normal',
            italic: false,
            strikethrough: false,
            textColorIndex: 0,
            widthMode: 'auto',
            x: 0,
            y: 300,
            width: 100,
            height: 40,
          },
        ],
        edges: [],
      },
    });
  });

  it('同じ付箋スタイルの再適用では履歴を積まない', () => {
    useProjectStore.getState().updateStickyNoteStyle('s1', { colorIndex: 2 });
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().updateStickyNoteStyle('s1', { colorIndex: 2 });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it('同じテキストスタイルの再適用では履歴を積まない', () => {
    useProjectStore.getState().updateTextNodeStyle('t1', { fontWeight: 'bold' });
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().updateTextNodeStyle('t1', { fontWeight: 'bold' });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it('同じ tiptapContent の再適用では履歴を積まない', () => {
    const next = { type: 'doc', content: [{ type: 'paragraph' }] };

    useProjectStore.getState().updateTextNodeContent('t1', next);
    expect(useProjectStore.getState().history.past).toHaveLength(1);

    useProjectStore.getState().updateTextNodeContent('t1', { ...next });
    expect(useProjectStore.getState().history.past).toHaveLength(1);
  });

  it('値が変わる場合は履歴を積む', () => {
    useProjectStore.getState().updateStickyNoteStyle('s1', { colorIndex: 1 });
    useProjectStore.getState().updateStickyNoteStyle('s1', { colorIndex: 3 });

    expect(useProjectStore.getState().history.past).toHaveLength(2);
  });
});
```

> document node の必須フィールドは `src/types/index.ts` の `SheltieDocumentNode` 定義に合わせる。`tiptapContent` の型が `object` なので、上記のリテラルで通らない場合は既存の text ノードテストの作り方に揃える。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/tab-store.test.ts`
Expected: 履歴長が 1 増えていることで失敗する

- [ ] **Step 3: Write minimal implementation**

`src/store/tab-store.ts` の 3 箇所を差し替える。

```ts
  updateStickyNoteStyle: (nodeId, style) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          isSameStyle(node, style) ? null : { ...node, ...style },
        ),
      ),
    ),
```

```ts
  updateTextNodeContent: (nodeId, tiptapContent) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          JSON.stringify(node.tiptapContent) === JSON.stringify(tiptapContent)
            ? null
            : { ...node, tiptapContent },
        ),
      ),
    ),
```

```ts
  updateTextNodeStyle: (nodeId, style) =>
    set((state) =>
      replaceProjectNodes(state, (nodes) =>
        patchNode(nodes, nodeId, (node) =>
          isSameStyle(node, style) ? null : { ...node, ...style },
        ),
      ),
    ),
```

`patchNode` の近く（`src/store/tab-store.ts` の helper 群）に追加する。

```ts
/**
 * patch に含まれるキーだけを現在値と浅く比較する。
 * patchNode の no-op 契約（変更が無ければ null）を満たし、
 * 同じスタイルの再適用で履歴を増やさないために使う。
 */
function isSameStyle<T extends object>(node: T, style: Partial<T>): boolean {
  return (Object.keys(style) as (keyof T)[]).every((key) => node[key] === style[key]);
}
```

> `updateTextNodeContent` の `tiptapContent` は Tiptap の JSON なので浅い比較では判定できない。呼び出しは編集終了時（blur / Escape）に限られるため `JSON.stringify` 比較で十分。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/tab-store.test.ts && npm run typecheck`
Expected: 全ケース green

- [ ] **Step 5: Commit**

```bash
git add src/store/tab-store.ts src/store/tab-store.test.ts
git commit -m "fix(store): skip history entries for unchanged node styles and content"
```

---

### Task 2: タイトル段ドラッグの window リスナーを確実に解除する

**Objective:** ドラッグ中に呼び出し元がアンマウントされてもリスナーが残らないようにする。

**Files:**
- Modify: `src/hooks/sheltie/useSheltieDrag.ts:191-269`

- [ ] **Step 1: Write the implementation**

現在の `handleTitlePointerDown` は `pointermove` / `pointerup` を `window` に登録し、`handleUp` 内でのみ解除している。解除関数を ref に保持し、`useEffect` のクリーンアップでも解除する。

```ts
  const releaseTitleDragListenersRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      releaseTitleDragListenersRef.current?.();
      releaseTitleDragListenersRef.current = null;
    },
    [],
  );
```

`handleTitlePointerDown` 内でリスナーを登録している箇所（267-268 行付近）を差し替える。

```ts
      const release = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        releaseTitleDragListenersRef.current = null;
      };

      releaseTitleDragListenersRef.current?.();
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      releaseTitleDragListenersRef.current = release;
```

`handleUp` 内の `removeEventListener` 呼び出しを `release()` に置き換える。

- [ ] **Step 2: Run validation**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: いずれも成功

- [ ] **Step 3: 手動確認**

`npm run dev` で起動し、WebPage ノードのタイトル段をドラッグして移動できること、複数ノード選択時に一緒に動くこと、ドラッグ中に別ウインドウへ切り替えても状態が壊れないことを確認する。

- [ ] **Step 4: Commit**

```bash
git add src/hooks/sheltie/useSheltieDrag.ts
git commit -m "fix(sheltie): release title drag listeners on unmount"
```

---

### Task 3: 付箋カラースウォッチのツールチップを人間向けラベルにする

**Objective:** ツールチップに Tailwind クラス名（`bg-yellow-100`）が出ている状態を直し、テキストノード側の実装と揃える。

**Files:**
- Modify: `src/constants/sheltie.ts:75-100`
- Modify: `src/components/ReactFlowNodes/StickyNoteToolbar.tsx:73`

- [ ] **Step 1: Write the implementation**

`src/constants/sheltie.ts` の `STICKY_NOTE_COLORS` の各要素に `label` を追加する（既存コメントの色名に対応させる）。

```ts
export const STICKY_NOTE_COLORS = [
  {
    label: 'Yellow',
    bgClass: 'bg-yellow-100',
    borderClass: 'border-yellow-300',
    textClass: 'text-yellow-500',
    dividerColor: 'var(--color-yellow-300)',
  },
  {
    label: 'Pink',
    bgClass: 'bg-pink-100',
    borderClass: 'border-pink-300',
    textClass: 'text-pink-500',
    dividerColor: 'var(--color-pink-300)',
  },
  {
    label: 'Cyan',
    bgClass: 'bg-cyan-100',
    borderClass: 'border-cyan-300',
    textClass: 'text-cyan-500',
    dividerColor: 'var(--color-cyan-300)',
  },
  {
    label: 'Green',
    bgClass: 'bg-emerald-100',
    borderClass: 'border-emerald-300',
    textClass: 'text-emerald-500',
    dividerColor: 'var(--color-emerald-300)',
  },
] as const;
```

`src/components/ReactFlowNodes/StickyNoteToolbar.tsx:73` を差し替える。

```tsx
                title={color.label}
```

- [ ] **Step 2: Run validation**

Run: `npm run typecheck && npm run test`
Expected: 成功（`STICKY_NOTE_COLORS` の長さは変わらないため Phase 1 の検証も影響を受けない）

- [ ] **Step 3: 手動確認**

付箋ノードを選択し、色スウォッチにホバーして `Yellow` / `Pink` / `Cyan` / `Green` が出ることを確認する。

- [ ] **Step 4: Commit**

```bash
git add src/constants/sheltie.ts src/components/ReactFlowNodes/StickyNoteToolbar.tsx
git commit -m "fix(toolbar): show human readable sticky note color names"
```

---

### Task 4: デッドコードと規約違反を除去する

**Objective:** 未使用の marker class、到達不能な分岐、親相対 import を消し、再発を lint で止める。

**Files:**
- Modify: `src/components/ReactFlowNodes/WebPageFlowNode.tsx`, `StickyNoteFlowNode.tsx`
- Modify: `src/hooks/sheltie/useScreenshotCaptureQueue.ts:18, 246, 268`
- Modify: `src/hooks/sheltie/display-engine/state-machine.ts:1`
- Modify: `eslint.config.mjs`

- [ ] **Step 1: 未使用 marker class を削除する**

`WebPageFlowNode.tsx` の `sheltie-web-resize-line` / `sheltie-web-resize-handle`、`StickyNoteFlowNode.tsx` の `sheltie-sticky-resize-line` / `sheltie-sticky-resize-handle` を className から削除する。`index.css` に対応セレクタは無く、見た目は inline style で付与されているため CSS 追加は不要。`TextFlowNode.tsx` は元から持たない。

- [ ] **Step 2: 到達不能な分岐を削除する**

`useScreenshotCaptureQueue.ts:18` の `SCREENSHOT_CLIPPING_ENABLED` 定数を削除し、`:246` と `:268` の条件分岐を「クリッピング有効」側の処理だけ残す形に単純化する。

- [ ] **Step 3: 親相対 import を直す**

`src/hooks/sheltie/display-engine/state-machine.ts:1` を差し替える。

```ts
import type { InteractionType } from '@/hooks/sheltie/types';
```

- [ ] **Step 4: lint で再発を止める**

`eslint.config.mjs` のルール定義に追加する（既存の rules オブジェクトへマージする）。

```js
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message: 'Use the @/ alias instead of parent-relative imports.',
            },
          ],
        },
      ],
```

- [ ] **Step 5: Run validation**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: lint がエラーなしで通り（新ルールで既存コードが引っかからないこと）、テストも green

- [ ] **Step 6: 手動確認**

WebPage / 付箋ノードのリサイズ（辺・四隅）とカーソル形状が従来どおりであること、スクロール後のスクリーンショット更新とクリッピングが従来どおりであることを確認する。

- [ ] **Step 7: Commit**

```bash
git add src/components/ReactFlowNodes/WebPageFlowNode.tsx src/components/ReactFlowNodes/StickyNoteFlowNode.tsx src/hooks/sheltie/useScreenshotCaptureQueue.ts src/hooks/sheltie/display-engine/state-machine.ts eslint.config.mjs
git commit -m "refactor: remove dead markers and forbid parent-relative imports"
```

---

### Task 5: clippy 警告を解消する

**Objective:** `cargo clippy --all-targets` の唯一の警告を消す。

**Files:**
- Modify: `src-tauri/src/menus/mcp.rs:74-93`

- [ ] **Step 1: Write the implementation**

`find_menu_item_in_items`（93 行以降）を `#[cfg(test)] mod tests`（74-91 行）より前へ移動する。実装は変えない。

- [ ] **Step 2: Run validation**

Run: `cd src-tauri && cargo clippy --all-targets 2>&1 | tail -5 && cargo test --lib`
Expected: `warning` が 0 件、全テスト green

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/menus/mcp.rs
git commit -m "style(menus): move helper before the test module"
```

---

### Task 6: 純ロジックのテストを追加する

**Objective:** `CLAUDE.md` がテスト必須とする層のうち、未テストのモジュールを埋める。

**Files:**
- Create: `src/lib/unsaved-changes-dialog-display.test.ts`
- Create: `src/lib/project-display-name.test.ts`
- Modify: `src-tauri/src/menus/helpers.rs`

- [ ] **Step 1: ダイアログ表示状態機械のテストを書く**

`src/lib/unsaved-changes-dialog-display.test.ts` を新規作成する。

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enterUnsavedChangesDialogDisplay,
  exitUnsavedChangesDialogDisplay,
  registerUnsavedChangesDialogDisplayController,
} from '@/lib/unsaved-changes-dialog-display';

describe('unsaved changes dialog display', () => {
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    unregister?.();
    unregister = null;
    vi.useRealTimers();
  });

  it('enters through the registered controller only once', async () => {
    const enter = vi.fn();
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await enterUnsavedChangesDialogDisplay();
    await enterUnsavedChangesDialogDisplay();

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('does nothing when no controller is registered', async () => {
    await expect(enterUnsavedChangesDialogDisplay()).resolves.toBeUndefined();
  });

  it('defers exit so a follow-up enter in the same tick cancels it', async () => {
    const enter = vi.fn();
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await enterUnsavedChangesDialogDisplay();
    exitUnsavedChangesDialogDisplay();
    await enterUnsavedChangesDialogDisplay();
    vi.runAllTimers();

    expect(exit).not.toHaveBeenCalled();
    // 打ち消されたので enter は最初の 1 回だけ
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('exits after the deferred timer when no enter follows', async () => {
    const enter = vi.fn();
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await enterUnsavedChangesDialogDisplay();
    exitUnsavedChangesDialogDisplay();
    vi.runAllTimers();

    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('ignores an exit that was never entered', () => {
    const enter = vi.fn();
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    exitUnsavedChangesDialogDisplay();
    vi.runAllTimers();

    expect(exit).not.toHaveBeenCalled();
  });

  it('exits on unregister when the display was entered', async () => {
    const enter = vi.fn();
    const exit = vi.fn();
    const release = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await enterUnsavedChangesDialogDisplay();
    release();

    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('swallows an error thrown by the controller enter', async () => {
    const enter = vi.fn(() => {
      throw new Error('enter failed');
    });
    const exit = vi.fn();
    unregister = registerUnsavedChangesDialogDisplayController({ enter, exit });

    await expect(enterUnsavedChangesDialogDisplay()).resolves.toBeUndefined();

    // enter が失敗した場合は entered 扱いにしないので exit も呼ばれない
    exitUnsavedChangesDialogDisplay();
    vi.runAllTimers();
    expect(exit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 表示名のテストを書く**

`src/lib/project-display-name.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest';

import {
  getDisplayNameFromFilePath,
  getProjectDisplayName,
  getUntitledDisplayName,
} from '@/lib/project-display-name';

describe('getUntitledDisplayName', () => {
  it('index が 1 以下なら連番を付けない', () => {
    expect(getUntitledDisplayName(1)).toBe('Untitled');
    expect(getUntitledDisplayName(0)).toBe('Untitled');
  });

  it('index が 2 以上なら連番を付ける', () => {
    expect(getUntitledDisplayName(2)).toBe('Untitled 2');
    expect(getUntitledDisplayName(10)).toBe('Untitled 10');
  });
});

describe('getDisplayNameFromFilePath', () => {
  it('.sheltie 拡張子を除いた basename を返す', () => {
    expect(getDisplayNameFromFilePath('/Users/me/Documents/board.sheltie')).toBe('board');
  });

  it('拡張子が無ければそのまま basename を返す', () => {
    expect(getDisplayNameFromFilePath('/Users/me/board')).toBe('board');
  });

  it('ドットを含むファイル名では最後の .sheltie だけ除く', () => {
    expect(getDisplayNameFromFilePath('/Users/me/my.board.sheltie')).toBe('my.board');
  });

  it('Windows 形式の区切りも basename として扱う', () => {
    expect(getDisplayNameFromFilePath('C:\\Users\\me\\board.sheltie')).toBe('board');
  });

  it('区切りを含まないパスをそのまま扱う', () => {
    expect(getDisplayNameFromFilePath('board.sheltie')).toBe('board');
  });

  it('basename が空なら Untitled にフォールバックする', () => {
    expect(getDisplayNameFromFilePath('/Users/me/')).toBe('Untitled');
  });

  it('拡張子だけのファイル名は Untitled にフォールバックする', () => {
    expect(getDisplayNameFromFilePath('/Users/me/.sheltie')).toBe('Untitled');
  });
});

describe('getProjectDisplayName', () => {
  it('filePath があれば untitledIndex より優先する', () => {
    expect(
      getProjectDisplayName({ filePath: '/Users/me/board.sheltie', untitledIndex: 5 }),
    ).toBe('board');
  });

  it('filePath が無ければ untitledIndex から導出する', () => {
    expect(getProjectDisplayName({ filePath: undefined, untitledIndex: 3 })).toBe('Untitled 3');
  });
});
```

- [ ] **Step 3: Rust helper のテストを書く**

`src-tauri/src/menus/helpers.rs` の末尾に追加する。

```rust
#[cfg(test)]
mod tests {
    use super::normalize_menu_text;

    #[test]
    fn normalizes_menu_text() {
        assert_eq!(normalize_menu_text("Edit"), "edit");
        assert_eq!(normalize_menu_text("&Edit"), "edit");
        assert_eq!(normalize_menu_text("  Quit Sheltie  "), "quit sheltie");
        assert_eq!(normalize_menu_text("&Save &As..."), "save as...");
        assert_eq!(normalize_menu_text(""), "");
    }
}
```

- [ ] **Step 4: Run validation**

Run: `npx vitest run src/lib/unsaved-changes-dialog-display.test.ts src/lib/project-display-name.test.ts && (cd src-tauri && cargo test --lib normalizes_menu_text)`
Expected: すべて green

- [ ] **Step 5: Commit**

```bash
git add src/lib/unsaved-changes-dialog-display.test.ts src/lib/project-display-name.test.ts src-tauri/src/menus/helpers.rs
git commit -m "test: cover dialog display state, display names, and menu text normalization"
```

---

### Task 7: ドキュメントを実装と一致させる

**Objective:** 実装と食い違った記述を正し、Phase 1 / 2 で確定した契約と制約を正本へ反映する。

**Files:**
- Modify: `docs/agents/architecture.md`, `coding-rules.md`, `sheltie-runtime.md`, `sheltie-screenshots.md`, `mcp.md`, `tauri-ipc.md`, `domain-models.md`, `wkwebview-internals.md`

- [ ] **Step 1: `WEB_PAGE_FRAME_PADDING` の誤記を直す**

「24px world 固定」を「16px world 固定」へ修正する（実装は `src/constants/project.ts:18` の `16`）。対象は `architecture.md:29,32`、`coding-rules.md:37,53,201`、`sheltie-runtime.md:122` の 6 箇所。`domain-models.md:117` は既に正しいので変更しない。

- [ ] **Step 2: `.sheltie` の契約を反映する**

`architecture.md` の「`.sheltie` とローカル状態」節に追記する。

- 読み込み・パースに失敗したファイルは開かない。エラーダイアログを表示し、ウインドウを閉じる（空文書 + 元 `filePath` 保持で開くと上書き消失につながるため）
- `url` / `addedUrl` は `http` / `https` / 空文字のみ許可し、違反は読み込み失敗として扱う
- プリセット添字（`colorIndex` / `textColorIndex` / `fontSizePreset`）は範囲検証し、座標・寸法は有限数のみ許可する
- ファイルサイズ上限は 64 MiB
- 保存は同一ディレクトリの一時ファイル → `sync_all` → atomic rename。上書き時は元ファイルの permissions を引き継ぐ（xattr / Finder タグは非対象）
- `projectId` を optional フィールドとして保存し、スクリーンショットキャッシュのディレクトリキーにする

`domain-models.md` に `SheltieDocumentV2.projectId` と各検証の不変条件を追記する。

- [ ] **Step 3: URL scheme 契約を反映する**

`tauri-ipc.md` を修正する。`on_new_window` の記述（160 行付近）は「HTTP(S) URL を同じ page-* Webview で開く」と書かれているが実装に allowlist が無かった。Phase 2 で `normalize_navigation_url` が `http` / `https` のみを許可するようになったため、次を明記する。

- `create_page_webview` / `reload_page_webview` / `on_new_window` は `normalize_navigation_url` を通し、`http` / `https` 以外を拒否する
- `page-navigated-{pageId}` は **commit 後**（`on_page_load` の `Finished`）と SPA 通知の 2 経路で emit し、URL は常に native の webview から取得する。`document.title` の `\x01` は「URL を読み直す契機」であり、その文字列を URL として信頼しない

- [ ] **Step 4: MCP の露出範囲とブリッジの位置づけを正確化する**

`mcp.md` の Trust boundary 節を修正する。

- 現状の「同じ user 権限で動く local process 間の権限分離ではない」を、実際の露出範囲に合わせて書き直す。loopback は UID による分離が無いため、**同一マシンの別ログインユーザーのプロセスからも到達可能**である
- 認証を設けない判断は維持する（Figma のデスクトップ MCP と同じ「URL だけの設定」で使えることを優先する）
- page automation ブリッジはページと同一 JS realm に注入されるため、**password / OTP フィールドへの入力拒否は事故防止のガードレールであり、敵対的ページに対するセキュリティ境界ではない**。`Object.defineProperty` による硬化は単純な再代入を防ぐだけで、`Function.prototype` の差し替えや DOM prototype 汚染は防げない
- page automation の request ID は UUID であり、identity 不一致の completion では pending entry を消費しない

- [ ] **Step 5: 制約とガードレールを追記する**

`sheltie-runtime.md` に追記する。

- page webview では JS ダイアログ（`alert` / `confirm` / `prompt`）が非対応。Wry が `runJavaScriptAlertPanel` 系の UIDelegate を実装していないため、WKWebView 既定として無表示 / `false` / `null` になる。automation の dialog shim も同じ既定挙動を再現している

`wkwebview-internals.md` に追記する。

- Wry の UIDelegate は `requestMediaCapturePermissionForOrigin` で origin / frame / capture type を無視して `WKPermissionDecision::Grant` を返す。現状 `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` を持たないため OS 層で拒否され到達不能だが、**purpose string を追加する場合は先に Wry の無条件 Grant を潰すこと**

`sheltie-screenshots.md` を修正する。

- `projectId` は `.sheltie` に保存した安定 ID である（従来の「ローカルワークスペース上の `Project.id`」という記述は、開くたびに再生成されて lazy restore が機能しない状態だったため実装とともに改める）
- 起動時に、最終更新から 30 日を超えた project ディレクトリを削除する（TTL GC）

- [ ] **Step 6: Run validation**

Run: `npm run format && grep -rn "24px world" docs/agents/ | wc -l`
Expected: format で差分が出ないこと、grep の結果が `0`

- [ ] **Step 7: Commit**

```bash
git add docs/agents
git commit -m "docs(agents): align documents with the hardened document and trust contracts"
```

---

### Task 8: 依存パッケージの分類を是正する

**Objective:** ビルド専用パッケージを本番依存から外し、未使用パッケージを削除し、非破壊の transitive 更新を当てる。

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: 分類を直して未使用依存を削除する**

`@tailwindcss/vite` はビルド時の Vite プラグインなので `devDependencies` へ移す。`@tauri-apps/plugin-store` は JS から未 import（Rust は `StoreExt` を直接使う）で、Phase 2 Task 10 で capability からも外したため削除する。

```bash
npm pkg delete dependencies.@tailwindcss/vite
npm pkg set devDependencies.@tailwindcss/vite=4.2.0
npm uninstall @tauri-apps/plugin-store
npm install
```

- [ ] **Step 2: 非破壊の transitive 更新を当てる**

```bash
npm audit fix
```

`--force` は使わない。Vite / Vitest のメジャー更新はこのフェーズの対象外。

- [ ] **Step 3: Run validation**

Run: `npm run lint && npm run typecheck && npm run test && npm run build && npm audit --omit=dev`
Expected: lint / typecheck / test / build すべて成功。`npm audit --omit=dev` の残件が `@tiptap/pm` 経由の `prosemirror-markdown → markdown-it → linkify-it` のみであること（`@tiptap/pm/markdown` は import していないためバンドルには入らない）

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): fix dependency classification and apply non-breaking audit fixes"
```

---

### Task 9: ノードツールバーの重複スタイルを共通化する

**Objective:** 4 ファイルにコピーされている Tailwind 文字列と区切り線を 1 箇所へ集約する。振る舞いと見た目は変えない。

**Files:**
- Create: `src/components/ReactFlowNodes/nodeToolbarStyles.ts`
- Modify: `src/components/ReactFlowNodes/{StickyNoteToolbar,TextNodeToolbar,WebPageToolbar}.tsx`
- Modify: `src/components/ReactFlowEdges/ArrowToolbar.tsx`

- [ ] **Step 1: 共通モジュールを作る**

既存の `selectionChromeStyles.ts` / `floatingControlStyles.ts` と同じ方針で `src/components/ReactFlowNodes/nodeToolbarStyles.ts` を作る。**各ファイルの現在の文字列を正確にコピーする**（差異があれば統合前に差分を確認し、意図的な差異は共通化対象から外す）。

```ts
/** ノード / エッジのツールバー段で共有する外観。既存 4 ファイルの重複を集約したもの */
export const TOOLBAR_CONTAINER_CLASSNAME =
  'flex items-center gap-0.5 rounded-lg bg-zinc-800 px-1 py-0.5 shadow-lg';

export const TOOLBAR_BUTTON_CLASSNAME =
  'nodrag flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors hover:bg-white/20';

export const TOOLBAR_BUTTON_ACTIVE_CLASSNAME = 'bg-white/25 text-white';

export const TOOLBAR_DIVIDER_CLASSNAME = 'mx-0.5 h-4 w-px bg-white/20';

export const TOOLBAR_SWATCH_CLASSNAME = 'nodrag size-7 rounded-sm';
```

- [ ] **Step 2: 4 ファイルを置き換える**

各ファイルのローカル定数（`buttonBase` / `activeClass` 等）を削除し、共通定数を import して使う。**1 ファイルずつ置き換え、そのたびに見た目を確認する**。

- [ ] **Step 3: Run validation**

Run: `npm run lint && npm run typecheck && npm run test && npm run format`
Expected: すべて成功。`eslint-plugin-better-tailwindcss` の警告が増えないこと

- [ ] **Step 4: 手動確認（必須）**

DOM 依存でテスト免除の領域なので、次をすべて目視する。

1. WebPage ツールバー: 戻る / 進む / リロード、URL 入力モード、プリセット（Mobile / Tablet / PC）、サイズ表示、Pin
2. 付箋ツールバー: フォントサイズ、色スウォッチ（ホバー時のラベル含む）
3. テキストツールバー: フォントサイズ、Bold / Italic / 取り消し線、色
4. エッジツールバー: 太さ、実線 / 破線、方向反転、7 色
5. いずれもアクティブ状態のハイライト、区切り線の位置、hover の見た目が変更前と同じであること

- [ ] **Step 5: Commit**

```bash
git add src/components/ReactFlowNodes/nodeToolbarStyles.ts src/components/ReactFlowNodes/StickyNoteToolbar.tsx src/components/ReactFlowNodes/TextNodeToolbar.tsx src/components/ReactFlowNodes/WebPageToolbar.tsx src/components/ReactFlowEdges/ArrowToolbar.tsx
git commit -m "refactor(toolbar): share node toolbar styles"
```

---

### Task 10: 付箋 / テキストのリサイズハンドルを共通化する

**Objective:** `StickyNoteFlowNode` と `TextFlowNode` でほぼ同一の `NodeResizeControl` 構成を 1 コンポーネントにする。

**Files:**
- Create: `src/components/ReactFlowNodes/NodeWidthResizeControls.tsx`
- Modify: `src/components/ReactFlowNodes/StickyNoteFlowNode.tsx:53-122`
- Modify: `src/components/ReactFlowNodes/TextFlowNode.tsx:44-99`

- [ ] **Step 1: 共通コンポーネントを作る**

差分は `minWidth` とテキスト側のダブルクリック復帰ハンドラだけなので、それらを props にする。実装は現在の `StickyNoteFlowNode.tsx:53-122` の構成（左右辺 2 本の Line + 四隅 4 個の Handle）をそのまま移し、inline style も維持する。ハンドラの型は両ファイルが既に使っている React Flow の `ResizeDragEvent` / `ResizeParams` に合わせる。

```tsx
import type { ResizeDragEvent, ResizeParams } from '@xyflow/react';

interface NodeWidthResizeControlsProps {
  minWidth: number;
  onResize: (event: ResizeDragEvent, params: ResizeParams) => void;
  onResizeEnd: (event: ResizeDragEvent, params: ResizeParams) => void;
  /** テキストノードだけが使う、辺のダブルクリックで auto 幅へ戻す挙動 */
  onDoubleClickRevert?: () => void;
}
```

呼び出し側は現在と同じく `handleResize` / `handleResizeEnd`（`StickyNoteFlowNode.tsx:35-51`、`TextFlowNode.tsx:22-37`）を渡す。`minWidth` は付箋が `STICKY_NOTE_MIN_WIDTH`、テキストが `TEXT_NODE_MIN_WIDTH`。`onDoubleClickRevert` はテキスト側だけ `handleRevertToAutoWidth`（`TextFlowNode.tsx:40`）を渡す。`ResizeDragEvent` / `ResizeParams` の import 元は既存 2 ファイルの import 文をそのまま踏襲する。

`WebPageFlowNode.tsx:76-119` は 8 方向版で構成が異なるため、**このタスクでは統合しない**（無理に共通化すると分岐が増えて可読性が落ちる）。

- [ ] **Step 2: 2 ファイルを置き換える**

`StickyNoteFlowNode` → `TextFlowNode` の順に 1 ファイルずつ差し替え、そのたびに手動確認する。

- [ ] **Step 3: Run validation**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: すべて成功

- [ ] **Step 4: 手動確認（必須）**

1. 付箋: 左右辺と四隅からのリサイズ、`STICKY_NOTE_MIN_WIDTH` / `MIN_HEIGHT` の下限
2. テキスト: 左右辺と四隅からのリサイズ、`TEXT_NODE_MIN_WIDTH` の下限、**辺のダブルクリックで auto 幅へ戻る挙動**
3. ズーム率を変えてもハンドルの当たり判定と見た目が変わらないこと
4. リサイズが Undo / Redo で正しく戻ること

- [ ] **Step 5: Commit**

```bash
git add src/components/ReactFlowNodes/NodeWidthResizeControls.tsx src/components/ReactFlowNodes/StickyNoteFlowNode.tsx src/components/ReactFlowNodes/TextFlowNode.tsx
git commit -m "refactor(nodes): share width resize controls between sticky notes and text"
```

---

### Task 11: Rust の同期 `recv()` を `tokio::oneshot` にする

**Objective:** 非同期コマンドがユーザー操作の完了まで tokio ワーカーをブロックする状態を解消する。

**Files:**
- Modify: `src-tauri/src/commands/store/macos_tabs.rs:25-42`
- Modify: `src-tauri/src/commands/dialog.rs:130, 157-159`

**Interfaces:**
- Produces: `run_on_app_main_thread_async`（await 可能版）。既存の同期版は同期呼び出し元のために残す

- [ ] **Step 1: 現在の呼び出し元を洗い出す**

Run: `cd src-tauri && grep -rn "run_on_app_main_thread" src/`
`macos_tabs.rs` 内の各コマンド（`set_document_edited` / `new_document_tab` / `present_document_window` / `configure_macos_document_window` 等）と、同期の初期化経路（`setup.rs` など）を区別する。**同期呼び出し元が 1 つでもあるなら、同期版を消さずに async 版を追加する。**

- [ ] **Step 2: async 版を追加する**

`macos_tabs.rs` に、`std::sync::mpsc` ではなく `tokio::sync::oneshot` を使う版を追加する。参考実装は `src-tauri/src/commands/webview/navigation.rs:44-77`（`get_navigation_state_impl`）と `snapshot.rs:16-45`。

```rust
/// 非同期コマンドから main thread の処理結果を待つ版。
/// 同期版は setup など await できない経路のために残す。
async fn run_on_app_main_thread_async<F, T>(app: &AppHandle, task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(task());
    })
    .map_err(|error| format!("failed to dispatch to the main thread: {error}"))?;

    rx.await
        .map_err(|_| "the main thread task was dropped".to_string())?
}
```

> 実際のジェネリクス境界は既存の同期版のシグネチャに合わせる。`run_on_main_thread` のクロージャは `FnOnce() + Send + 'static`。

`macos_tabs.rs` の各非同期コマンドを `run_on_app_main_thread_async(...).await` へ切り替える。

- [ ] **Step 3: ダイアログを非ブロッキングにする**

`dialog.rs` の `show_unsaved_changes_dialog`（130, 157-159 行）で、`std::sync::mpsc` を `tokio::sync::oneshot` に置き換え、`receiver.recv()` を `rx.await` にする。`show_nsalert_sheet` 側の sender も oneshot に合わせる。

- [ ] **Step 4: Run validation**

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -5`
Expected: 全テスト green、警告 0 件

- [ ] **Step 5: 手動確認（必須）**

1. 未保存の状態でウインドウを閉じる → 確認シートが出て、保存 / 破棄 / キャンセルすべてが正しく動く
2. 複数ウインドウを未保存にして `Cmd+Q` → 各ウインドウの確認が順に出て、最後に終了する
3. ネイティブタブの新規作成、タブの edited インジケータ、ウインドウ生成が従来どおり動く
4. 確認シートを開いたまま数十秒放置しても、MCP のボード操作（別ウインドウ）が応答すること

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/store/macos_tabs.rs src-tauri/src/commands/dialog.rs
git commit -m "refactor(commands): await main thread results without blocking tokio workers"
```

---

### Task 12: 肥大化した Rust モジュールを分割する

**Objective:** 3 つの大きなファイルから、関心の異なる部分を切り出す。公開 API と振る舞いは変えない。

**Files:**
- Create: `src-tauri/src/mcp/page_automation/capture.rs`
- Create: `src-tauri/src/mcp/tools/browser/types.rs`, `src-tauri/src/mcp/tools/browser/backend.rs`
- Create: `src-tauri/src/mcp/page_automation/protocol/errors.rs`
- Modify: `src-tauri/src/mcp/page_automation/actor.rs`, `mod.rs`
- Modify: `src-tauri/src/mcp/tools/browser.rs`
- Modify: `src-tauri/src/mcp/page_automation/protocol.rs`

- [ ] **Step 1: `actor.rs` から撮影系を切り出す**

`capture.rs` へ移すのは `capture_element_with` / `capture_full_page_with` / `capture_full_page_tiles_locked_with` / `restore_scroll_locked_with` / `full_page_tile_positions` / `tile_axis_positions` / `css_offset_to_pixels`。`impl PageAutomationState` の分割になるため、`capture.rs` 側にも `impl PageAutomationState` ブロックを置く（同一 crate 内なら可）。`actor.rs` はリクエスト直列化と navigation epoch 管理に専念させる。移動した関数に紐づくテストも一緒に移す。

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -3`
Expected: 全テスト green、警告 0 件

```bash
git add src-tauri/src/mcp/page_automation/
git commit -m "refactor(automation): extract capture routines from the page actor"
```

- [ ] **Step 2: `browser.rs` から型と backend を切り出す**

`browser.rs` を `browser.rs` + `browser/` サブディレクトリ構成にする（Rust 2018 以降で可）。

- `browser/types.rs`: 313-670 行の params / result 型（約 15 個）と `validate_page_key` 等の検証ヘルパー
- `browser/backend.rs`: 92-313 行の `BrowserBackend` トレイトと `AppBrowserBackend`
- `browser.rs`: 672-1388 行の `impl SheltieMcpService`（ツール登録とハンドラ本体）のみ

テストは対象コードと同じファイルへ移す。

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -3`
Expected: 全テスト green、警告 0 件

```bash
git add src-tauri/src/mcp/tools/
git commit -m "refactor(mcp): split browser tool types and backend into modules"
```

- [ ] **Step 3: `protocol.rs` からエラーファクトリを切り出す**

`protocol.rs` を `protocol.rs` + `protocol/errors.rs` 構成にし、851-1032 行の `ToolError` ファクトリ（約 20 個）を移す。型契約（struct / enum / 定数）は `protocol.rs` に残す。`pub use` で既存の import パスを壊さないようにする。

Run: `cd src-tauri && cargo test --lib && cargo clippy --all-targets 2>&1 | tail -3`
Expected: 全テスト green、警告 0 件

```bash
git add src-tauri/src/mcp/page_automation/
git commit -m "refactor(automation): move protocol error factories into their own module"
```

- [ ] **Step 4: 手動確認（必須）**

分割は振る舞いを変えないが、MCP のツール面が広いので通しで確認する。MCP を有効にして次を実行する。

1. `list_documents` / `get_board` / `get_editor_state`
2. `batch_edit_board`（ノード作成・更新・削除が 1 履歴でまとまること）
3. `browser_navigate` / `browser_snapshot` / `browser_click` / `browser_fill`
4. `browser_screenshot`（element / fullPage 両方）
5. `get_webpage_screenshots` / `get_board_screenshot`

- [ ] **Step 5: ドキュメントの実装入口リストを更新する**

`docs/agents/mcp.md` の「実装の主入口」に、追加したモジュール（`capture.rs`、`tools/browser/{types,backend}.rs`、`protocol/errors.rs`）を反映する。

```bash
git add docs/agents/mcp.md
git commit -m "docs(mcp): list the new automation and browser tool modules"
```

## Validation

- `npm run lint` — エラーなし（新しい `no-restricted-imports` ルールを含む）
- `npm run format` — 差分なし
- `npm run typecheck` — 型エラーなし
- `npm run test` — 全テスト green（Phase 1 / 2 で追加したものを含む）
- `cd src-tauri && cargo test --lib` — 全テスト green
- `cd src-tauri && cargo clippy --all-targets` — 警告 0 件
- `npm run build` — 成功
- `npm audit --omit=dev` — 残件が `@tiptap/pm` 経由の markdown-it 系のみ
- `grep -rn "24px world" docs/agents/ | wc -l` — `0`
- 手動: Task 2 / 3 / 4 / 9 / 10 / 11 / 12 の確認項目をすべて実施

## Risks, Tradeoffs, and Open Questions

- **Task 9 / 10 / 12 は自動テストで守れない。** ツールバー・リサイズハンドルは `CLAUDE.md` がテスト免除としている DOM 依存コードで、Rust の分割は振る舞いを変えないぶん壊れても気付きにくい。1 ファイルずつ置き換えて都度確認する手順を崩さない。不安定化した場合は、このフェーズだけをリリース後へ倒す判断ができる（親 plan の Release Gate 参照）。
- **`WebPageFlowNode` の 8 方向リサイズは統合しない。** 付箋 / テキストの 4 方向版とは構成が異なり、共通化すると分岐が増えて可読性が落ちる。意図的に対象外とする。
- **`updateTextNodeContent` の比較は `JSON.stringify`。** 呼び出しが編集終了時に限られる前提のコスト評価。将来キーストロークごとに呼ぶ設計へ変えるなら比較方法を見直す。
- **`STICKY_NOTE_COLORS` に `label` を追加する。** 配列長は変わらないため Phase 1 の範囲検証に影響はないが、`as const` の型が変わるため参照箇所の型エラーを確認する。
- **`run_on_app_main_thread` の同期版を残す。** 同期の初期化経路から呼ばれているため、一括置換はできない。async 版の追加という形にする。
- **`npm audit fix` の結果は lock ファイルに依存する。** 実行時点で新しい勧告が出ていれば残件が変わる。`--omit=dev` の残件が markdown-it 系以外に増えていた場合は、バンドルへの混入有無を確認してから対応方針を決める。
