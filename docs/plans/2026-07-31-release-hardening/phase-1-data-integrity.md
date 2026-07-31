# Phase 1 — データ保全とドキュメント検証 Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** 破損・将来バージョン・悪意ある `.sheltie` を開いてもユーザーの元ファイルを失わない状態にし、レンダリング中のクラッシュ経路を閉じる。

**Architecture:** ドキュメント境界（`src/lib/project-document.ts` のパーサー）を唯一の検証点にし、失敗は例外として `src/store/tab-persistence.ts` の起動シーケンスで fail-closed に扱う。保存側は Rust の `save_project_file` を atomic rename に置き換える。既存の MCP 検証（`src/lib/mcp/board-operations.ts`）がすでに厳格なので、パーサーの検証はその規則に揃える。

**Tech Stack:** TypeScript / React 19 / Zustand / Vitest、Rust / Tauri v2 / cargo test

## Global Constraints

- 検証の厳格化は **必ず fail-closed の実装より後**に入れる。順序を逆にすると、新たに弾かれるファイルが「空文書 + 元 filePath 保持」で開かれ、上書き消失のリスクが一時的に増える。
- ファイルサイズ上限は exact value で `64 * 1024 * 1024`（64 MiB）。
- 配列添字の上限は定数の実長から導出し、リテラルをハードコードしない。実測値は `STICKY_NOTE_COLORS.length === 4`、`TEXT_NODE_COLORS.length === 6`、`TEXT_NODE_FONT_SIZE_PRESETS.length === 4`。付箋の `fontSizePreset` も `TEXT_NODE_FONT_SIZE_PRESETS` を参照する（`src/components/Node/StickyNoteNode.tsx:50`）。
- URL の許可は `http` / `https` / 空文字 `''` のみ。空文字は「URL 未入力の WebPage ノード」という正当な状態（`src/store/tab-store.ts:652,703`、`src/lib/mcp/board-operations.ts:170,224`）。
- `src/lib/url-utils.ts` の既存 `normalizeUrl()` は「ドットを含まないホスト名を拒否」という UI 専用ポリシーを含むため、**流用しない**。別関数として追加する。
- import は `@/` エイリアスを使う。`../` 相対パスは使わない。
- エラーメッセージは英語（既存の `showError` 呼び出しに合わせる）。

## Current Context

確認済みの既存実装:

- `src/store/tab-persistence.ts:16-29` — `context.filePath` があれば読み込み、`catch` で `document = undefined` にしたうえで **`filePath` を保持したまま** `initializeProject` を呼ぶ。これが上書き消失の起点。
- `src/store/tab-store.ts:140-158` — `createProject` は `document` が無ければ空の `nodes` / `edges` を作り、`lastSavedDocument` も空文書で初期化する（= dirty にならず、警告なしで閉じられる）。
- `src/lib/file-commands.ts:56-61` — `showError()` は `@tauri-apps/plugin-dialog` の `message()` を使う module-private helper。`capabilities/default.json` に `dialog:allow-message` があるため追加権限は不要。
- `src/lib/file-commands.ts:95-103` — 通常 Save は `project.filePath` をそのまま宛先にする。
- `src/lib/project-close.ts:40-68` — ウインドウクローズは `api.closeReady()` を呼ぶ。dirty でなければ確認ダイアログを出さない。
- `src-tauri/src/commands/store/file_io.rs:50-54` — `load_project_file` はサイズ確認なしで `read_to_string`。
- `src-tauri/src/commands/store/file_io.rs:56-84` — `save_project_file` は `normalize_project_file_path` → `ensure_window_can_use_file_path` の後、`std::fs::write` で直接上書き。
- `src/lib/project-document.ts:22-27` — `parseNumber` は型と `NaN` のみ検査。有限性・範囲は未検証。
- `src/lib/project-document.ts:49-67` — webpage 分岐は `url` / `addedUrl` を `parseString` のみで受理。
- `src/lib/project-document.ts:180-197` — `schemaVersion` が 1 なら v2 へ移行、1/2 以外は throw（将来バージョンのファイルもここで throw する）。
- `src/App.tsx:69` 付近および `src/screens/Project.tsx` に React Error Boundary は存在しない。

計画上の仮定:

- `close_ready` によるウインドウ破棄で、Rust の document manager が保持する `filePath` 登録も解放される。Task 2 の validation で実際に確認する（解放されない場合は同じファイルを再度開けなくなるため、追加対応が必要になる）。

## File Structure

- Create: `src/lib/error-dialog.ts` — ネイティブエラーダイアログ表示の共通 helper
- Create: `src/lib/url-utils.test.ts` — `normalizeUrl` と `isAllowedPageUrl` の単体テスト
- Create: `src/components/Common/BoardErrorBoundary.tsx` — ボード描画の Error Boundary
- Modify: `src/lib/url-utils.ts` — `isAllowedPageUrl` を追加
- Modify: `src/lib/project-document.ts` — URL / 添字範囲 / 有限性の検証を追加
- Modify: `src/lib/project-document.test.ts` — 検証の失敗ケースを追加
- Modify: `src/lib/file-commands.ts` — `showError` を `error-dialog.ts` へ移して再利用
- Modify: `src/store/tab-persistence.ts` — 読み込み失敗を fail-closed に変更
- Modify: `src/screens/Project.tsx` — ボードを Error Boundary で包む
- Modify: `src-tauri/src/commands/store/file_io.rs` — atomic save とサイズ上限

## Tasks

### Task 1: `.sheltie` の保存を atomic rename にする

**Objective:** 保存中のクラッシュ・ディスクフルで元ファイルが破損しないようにし、上書き時は元の permissions を維持する。

**Files:**
- Modify: `src-tauri/src/commands/store/file_io.rs`

**Interfaces:**
- Produces: `write_atomically(path: &Path, contents: &str) -> Result<(), String>`（同ファイル内 private）

- [ ] **Step 1: Write the failing test**

`src-tauri/src/commands/store/file_io.rs` の末尾に追加する。

```rust
#[cfg(test)]
mod atomic_write_tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sheltie-atomic-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_a_new_file_and_leaves_no_temporary_file() {
        let dir = temp_dir("new-file");
        let path = dir.join("board.sheltie");

        write_atomically(&path, "{\"schemaVersion\":2}").unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"schemaVersion\":2}"
        );
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .filter(|name| name != "board.sheltie")
            .collect();
        assert!(leftovers.is_empty(), "unexpected leftovers: {leftovers:?}");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn overwriting_preserves_the_existing_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("permissions");
        let path = dir.join("board.sheltie");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        write_atomically(&path, "new").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "permissions must survive the atomic replace");

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib atomic_write_tests`
Expected: コンパイルエラー `cannot find function \`write_atomically\` in this scope`

- [ ] **Step 3: Write minimal implementation**

`src-tauri/src/commands/store/file_io.rs` の先頭 `use` を差し替える。

```rust
use std::io::Write;
use std::path::{Path, PathBuf};
```

`save_project_file` の直前に追加する。

```rust
/// 保存中の異常終了で元ファイルを壊さないため、同一ディレクトリの一時ファイルへ書いて
/// fsync 後に atomic rename する。rename は元ファイルのメタデータを引き継がないため、
/// 上書き時だけ permissions を明示的にコピーする（xattr / Finder タグは対象外）。
fn write_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "destination has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "destination has no file name".to_string())?;
    let temp_path = parent.join(format!(".{}.tmp", file_name.to_string_lossy()));

    let existing_permissions = std::fs::metadata(path).ok().map(|meta| meta.permissions());

    {
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|error| format!("failed to create a temporary file: {error}"))?;
        file.write_all(contents.as_bytes())
            .map_err(|error| format!("failed to write a temporary file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("failed to flush a temporary file: {error}"))?;
    }

    if let Some(permissions) = existing_permissions {
        std::fs::set_permissions(&temp_path, permissions)
            .map_err(|error| format!("failed to carry over file permissions: {error}"))?;
    }

    std::fs::rename(&temp_path, path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        format!("failed to replace the destination file: {error}")
    })
}
```

`save_project_file` 内の `std::fs::write` 呼び出しを差し替える。

```rust
    write_atomically(&normalized_path, &contents)?;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib atomic_write_tests`
Expected: `test result: ok. 2 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/store/file_io.rs
git commit -m "fix(store): save project files atomically"
```

---

### Task 2: 読み込み失敗を fail-closed にする

**Objective:** 破損・将来バージョンの `.sheltie` を開いたときにエラーダイアログを出し、`filePath` を編集対象に結び付けないままウインドウを閉じる。

**Files:**
- Create: `src/lib/error-dialog.ts`
- Modify: `src/lib/file-commands.ts`
- Modify: `src/store/tab-persistence.ts`

**Interfaces:**
- Produces: `showErrorDialog(messageText: string): Promise<void>`（`src/lib/error-dialog.ts`）
- Consumes: `api.closeReady()`（`src/lib/tauri-bridge`、`src/lib/project-close.ts:44` と同じ）

- [ ] **Step 1: 共通エラーダイアログ helper を作る**

`src/lib/error-dialog.ts` を新規作成する。

```ts
import { message } from '@tauri-apps/plugin-dialog';

/** ネイティブのエラーダイアログを表示する */
export async function showErrorDialog(messageText: string): Promise<void> {
  await message(messageText, {
    title: 'Sheltie',
    kind: 'error',
  });
}
```

`src/lib/file-commands.ts` の module-private `showError`（56-61 行）を削除し、`showErrorDialog` を import して呼び出し箇所（75, 83, 91, 135 行付近の 4 箇所）を置き換える。

```ts
import { showErrorDialog } from '@/lib/error-dialog';
```

`import { message, open, save } from '@tauri-apps/plugin-dialog';` から `message` を外す。

- [ ] **Step 2: fail-closed を実装する**

`src/store/tab-persistence.ts` を次の内容に差し替える。

```ts
import { showErrorDialog } from '@/lib/error-dialog';
import { requestCurrentWindowClose } from '@/lib/project-close';
import { parseProjectDocument } from '@/lib/project-document';
import { api } from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';

let initialized = false;

/**
 * 読み込み・パースに失敗したファイルは開かない。filePath を保持したまま空文書で開くと、
 * ユーザーが気付かず保存した時点で元ファイルを空文書で上書きしてしまう。
 */
const LOAD_FAILURE_MESSAGE =
  'The file could not be opened. It may be damaged or created by a newer version of Sheltie.';

export function setupProjectPersistence(): void {
  if (initialized) return;
  initialized = true;

  api
    .loadWindowContext()
    .then(async (context) => {
      if (context.filePath) {
        let contents: string;
        try {
          contents = await api.loadProjectFile(context.filePath);
        } catch {
          await showErrorDialog(LOAD_FAILURE_MESSAGE);
          await api.closeReady();
          return;
        }

        let document;
        try {
          document = parseProjectDocument(contents);
        } catch {
          await showErrorDialog(LOAD_FAILURE_MESSAGE);
          await api.closeReady();
          return;
        }

        useProjectStore.getState().initializeProject({
          filePath: context.filePath,
          untitledIndex: context.untitledIndex,
          document,
        });
      } else {
        useProjectStore.getState().initializeProject({
          untitledIndex: context.untitledIndex,
        });
      }

      useProjectStore.getState()._setLoaded();
    })
    .catch(() => {
      useProjectStore.getState().initializeProject({ untitledIndex: 1 });
      useProjectStore.getState()._setLoaded();
    });

  api.onSaveBeforeClose(async () => {
    await requestCurrentWindowClose();
  });
}
```

- [ ] **Step 3: Run automated validation**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: いずれも成功（`tab-persistence.ts` に既存テストは無いため、既存 271 件が引き続き通ること）

- [ ] **Step 4: 手動確認（このタスクの完了判定に必須）**

`npm run dev` で起動し、次を確認する。

1. 壊れた JSON を用意する: `printf 'not json' > /tmp/broken.sheltie`
2. Finder から `/tmp/broken.sheltie` をダブルクリック、または File > Open で開く → エラーダイアログが出て、閉じるとウインドウも閉じること（ボードが空で開いたままにならない）
3. 将来バージョンを用意する: `printf '{"schemaVersion":99,"nodes":[]}' > /tmp/future.sheltie` → 同じくエラー + クローズ
4. 正常なファイルを保存し直して同じパスを再度開く → **`filePath` 登録がリークしていないこと**（`ensure_window_can_use_file_path` に阻まれず開ける）。開けない場合は `close_ready` の後処理に document manager の登録解放を追加する必要がある
5. 正常なファイルが従来どおり開けること

- [ ] **Step 5: Commit**

```bash
git add src/lib/error-dialog.ts src/lib/file-commands.ts src/store/tab-persistence.ts
git commit -m "fix(store): fail closed when a project file cannot be loaded"
```

---

### Task 3: WebPage URL の許可判定関数を追加する

**Objective:** 文書パーサーと MCP が共有できる URL 許可判定を、UI 専用の `normalizeUrl` とは分けて用意する。

**Files:**
- Modify: `src/lib/url-utils.ts`
- Create: `src/lib/url-utils.test.ts`

**Interfaces:**
- Produces: `isAllowedPageUrl(value: string): boolean` — Task 4 と Phase 2 の MCP 検証が消費する

- [ ] **Step 1: Write the failing test**

`src/lib/url-utils.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest';

import { isAllowedPageUrl, normalizeUrl } from '@/lib/url-utils';

describe('normalizeUrl', () => {
  it('adds https when the scheme is missing', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
  });

  it('keeps an explicit http scheme', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com/');
  });

  it('allows localhost without a dot', () => {
    expect(normalizeUrl('localhost:5173')).toBe('https://localhost:5173/');
  });

  it('rejects a hostname without a dot', () => {
    expect(normalizeUrl('aaaaa')).toBeNull();
  });

  it('rejects non-http schemes', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
  });
});

describe('isAllowedPageUrl', () => {
  it('allows an empty string as a URL-less WebPage node', () => {
    expect(isAllowedPageUrl('')).toBe(true);
  });

  it('allows http and https', () => {
    expect(isAllowedPageUrl('https://example.com')).toBe(true);
    expect(isAllowedPageUrl('http://127.0.0.1:8080/path?q=1')).toBe(true);
  });

  it('allows a hostname without a dot, unlike the URL bar policy', () => {
    expect(isAllowedPageUrl('http://intranet/')).toBe(true);
  });

  it('rejects schemes that must never reach a native webview', () => {
    expect(isAllowedPageUrl('file:///Users/victim/.ssh/id_rsa')).toBe(false);
    expect(isAllowedPageUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedPageUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isAllowedPageUrl('tauri://localhost')).toBe(false);
    expect(isAllowedPageUrl('asset://localhost/x.png')).toBe(false);
  });

  it('rejects strings that are not URLs', () => {
    expect(isAllowedPageUrl('example.com')).toBe(false);
    expect(isAllowedPageUrl('   ')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/url-utils.test.ts`
Expected: `isAllowedPageUrl` が存在しないため import エラーで失敗する

- [ ] **Step 3: Write minimal implementation**

`src/lib/url-utils.ts` の末尾に追加する。

```ts
/**
 * 文書ファイル・MCP 経由で受け取る WebPage URL の許可判定。
 * ネイティブ Webview へ渡る値なので http / https だけを許可する。
 * 空文字は URL 未入力の WebPage ノードという正当な状態なので許可する。
 * URL バー用の normalizeUrl とは違い、ドットを含まないホスト名は拒否しない。
 */
export function isAllowedPageUrl(value: string): boolean {
  if (value === '') return true;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/url-utils.test.ts`
Expected: `Test Files 1 passed`, 全ケース green

- [ ] **Step 5: Commit**

```bash
git add src/lib/url-utils.ts src/lib/url-utils.test.ts
git commit -m "feat(url): add a page URL scheme allowlist"
```

---

### Task 4: 文書パーサーに URL 検証を適用する

**Objective:** `.sheltie` 内の `url` / `addedUrl` が `http` / `https` / 空文字以外なら、文書全体を読み込み失敗にする。

**Files:**
- Modify: `src/lib/project-document.ts`
- Modify: `src/lib/project-document.test.ts`

**Interfaces:**
- Consumes: `isAllowedPageUrl`（Task 3）

- [ ] **Step 1: Write the failing test**

`src/lib/project-document.test.ts` の `describe('parseProjectDocument', ...)` 相当のブロックに追加する（既存の describe 名に合わせて配置する）。

```ts
  it('rejects a document whose webpage node uses a non-http scheme', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      nodes: [
        {
          id: 'w1',
          type: 'webpage',
          title: 'Local file',
          url: 'file:///Users/victim/.ssh/id_rsa',
          x: 0,
          y: 0,
          width: 800,
          height: 600,
        },
      ],
    });

    expect(() => parseProjectDocument(raw)).toThrow(/url/);
  });

  it('rejects a non-http scheme in addedUrl', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      nodes: [
        {
          id: 'w1',
          type: 'webpage',
          title: 'Example',
          url: 'https://example.com/',
          addedUrl: 'javascript:alert(1)',
          x: 0,
          y: 0,
          width: 800,
          height: 600,
        },
      ],
    });

    expect(() => parseProjectDocument(raw)).toThrow(/addedUrl/);
  });

  it('accepts an empty url as a URL-less webpage node', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      nodes: [
        {
          id: 'w1',
          type: 'webpage',
          title: 'Untitled',
          url: '',
          x: 0,
          y: 0,
          width: 800,
          height: 600,
        },
      ],
    });

    expect(parseProjectDocument(raw).nodes).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/project-document.test.ts`
Expected: 最初の 2 ケースが `expected [Function] to throw error matching /url/` で失敗する

- [ ] **Step 3: Write minimal implementation**

`src/lib/project-document.ts` の import に追加する。

```ts
import { isAllowedPageUrl } from '@/lib/url-utils';
```

`parseString` の直後に helper を追加する。

```ts
function parsePageUrl(value: unknown, field: string): string {
  const parsed = parseString(value, field);
  if (!isAllowedPageUrl(parsed)) {
    throw new Error(`${field} must be an http or https URL`);
  }
  return parsed;
}
```

webpage 分岐（49-54 行）を差し替える。

```ts
  if (type === 'webpage') {
    const url = parsePageUrl(rawNode.url, `nodes[${index}].url`);
    const addedUrl =
      rawNode.addedUrl === undefined
        ? undefined
        : parsePageUrl(rawNode.addedUrl, `nodes[${index}].addedUrl`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/project-document.test.ts`
Expected: 全ケース green

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-document.ts src/lib/project-document.test.ts
git commit -m "fix(document): reject non-http page URLs when parsing a project file"
```

---

### Task 5: 添字範囲・enum・有限性の検証を追加する

**Objective:** `colorIndex` / `textColorIndex` / `fontSizePreset` の範囲外値と、座標・寸法の `Infinity` を読み込み時に弾き、レンダリング中の `TypeError` を防ぐ。

**Files:**
- Modify: `src/lib/project-document.ts`
- Modify: `src/lib/project-document.test.ts`

**Interfaces:**
- Consumes: `STICKY_NOTE_COLORS`, `TEXT_NODE_COLORS`, `TEXT_NODE_FONT_SIZE_PRESETS`（`@/constants`）

- [ ] **Step 1: Write the failing test**

`src/lib/project-document.test.ts` に追加する。

```ts
  it('rejects a sticky note colorIndex outside the palette', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      nodes: [
        {
          id: 's1',
          type: 'stickynote',
          title: 'Note',
          content: 'hello',
          colorIndex: 999999,
          fontSizePreset: 1,
          x: 0,
          y: 0,
          width: 200,
          height: 200,
        },
      ],
    });

    expect(() => parseProjectDocument(raw)).toThrow(/colorIndex/);
  });

  it('rejects a fractional font size preset', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      nodes: [
        {
          id: 's1',
          type: 'stickynote',
          title: 'Note',
          content: 'hello',
          colorIndex: 0,
          fontSizePreset: 1.5,
          x: 0,
          y: 0,
          width: 200,
          height: 200,
        },
      ],
    });

    expect(() => parseProjectDocument(raw)).toThrow(/fontSizePreset/);
  });

  it('rejects a text node textColorIndex outside the palette', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      nodes: [
        {
          id: 't1',
          type: 'text',
          title: 'Text',
          textColorIndex: 42,
          x: 0,
          y: 0,
          width: 100,
          height: 40,
        },
      ],
    });

    expect(() => parseProjectDocument(raw)).toThrow(/textColorIndex/);
  });

  it('rejects a non-finite coordinate', () => {
    const raw = `{"schemaVersion":2,"nodes":[{"id":"w1","type":"webpage","title":"Example","url":"https://example.com/","x":1e400,"y":0,"width":800,"height":600}]}`;

    expect(() => parseProjectDocument(raw)).toThrow(/x must be a finite number/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/project-document.test.ts`
Expected: 追加した 4 ケースがすべて「throw しない」ことで失敗する

- [ ] **Step 3: Write minimal implementation**

`src/lib/project-document.ts` の import を差し替える。

```ts
import {
  EDGE_COLOR_PRESETS,
  STICKY_NOTE_COLORS,
  TEXT_NODE_COLORS,
  TEXT_NODE_FONT_SIZE_PRESETS,
} from '@/constants';
```

`parseNumber` の直後に helper を追加する。

```ts
function parseFiniteNumber(value: unknown, field: string): number {
  const parsed = parseNumber(value, field);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a finite number`);
  }
  return parsed;
}

/**
 * プリセット配列の添字として使う値を検証する。範囲外だと描画時に
 * `undefined` を参照して render が throw するため、読み込み時に弾く。
 */
function parsePresetIndex(value: unknown, field: string, presetCount: number): number {
  const parsed = parseNumber(value, field);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= presetCount) {
    throw new Error(`${field} must be an integer from 0 to ${presetCount - 1}`);
  }
  return parsed;
}
```

共通の座標・寸法（44-47 行）を差し替える。

```ts
  const x = parseFiniteNumber(rawNode.x, `nodes[${index}].x`);
  const y = parseFiniteNumber(rawNode.y, `nodes[${index}].y`);
  const width = parseFiniteNumber(rawNode.width, `nodes[${index}].width`);
  const height = parseFiniteNumber(rawNode.height, `nodes[${index}].height`);
```

stickynote 分岐（71-75 行）を差し替える。

```ts
    const colorIndex = parsePresetIndex(
      rawNode.colorIndex ?? 0,
      `nodes[${index}].colorIndex`,
      STICKY_NOTE_COLORS.length,
    );
    const fontSizePreset = parsePresetIndex(
      rawNode.fontSizePreset ?? 1,
      `nodes[${index}].fontSizePreset`,
      TEXT_NODE_FONT_SIZE_PRESETS.length,
    );
```

text 分岐（93-105 行）の 2 箇所を差し替える。

```ts
    const fontSizePreset = parsePresetIndex(
      rawNode.fontSizePreset ?? 1,
      `nodes[${index}].fontSizePreset`,
      TEXT_NODE_FONT_SIZE_PRESETS.length,
    );
```

```ts
    const textColorIndex = parsePresetIndex(
      rawNode.textColorIndex ?? 0,
      `nodes[${index}].textColorIndex`,
      TEXT_NODE_COLORS.length,
    );
```

> `fontSizePreset` / `textColorIndex` の戻り値型は `TextNodeFontSizePreset` 等の union が期待される箇所がある。型エラーが出る場合は既存のキャスト方針（`as` による narrowing）に合わせる。範囲は実行時に保証済み。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/project-document.test.ts && npm run typecheck`
Expected: 全ケース green、型エラーなし

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-document.ts src/lib/project-document.test.ts
git commit -m "fix(document): validate preset indices and finite geometry"
```

---

### Task 6: `.sheltie` の読み込みサイズ上限を設ける

**Objective:** パース前に 64 MiB を超えるファイルを拒否し、病的なファイルによるメモリ消費を防ぐ。

**Files:**
- Modify: `src-tauri/src/commands/store/file_io.rs`

- [ ] **Step 1: Write the failing test**

`src-tauri/src/commands/store/file_io.rs` の `atomic_write_tests` に追加する。

```rust
    #[test]
    fn rejects_a_file_larger_than_the_limit() {
        let dir = temp_dir("size-limit");
        let path = dir.join("huge.sheltie");
        std::fs::write(&path, "x").unwrap();

        assert!(ensure_project_file_size(&path, 0).is_err());
        assert!(ensure_project_file_size(&path, MAX_PROJECT_FILE_BYTES).is_ok());

        std::fs::remove_dir_all(&dir).unwrap();
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib atomic_write_tests`
Expected: `cannot find function \`ensure_project_file_size\``

- [ ] **Step 3: Write minimal implementation**

`src-tauri/src/commands/store/file_io.rs` に追加する。

```rust
/// `.sheltie` は nodes / edges の JSON のみでスクリーンショットを含まないため、
/// 1000 ノード規模でも数 MB に収まる。正当なファイルを弾かない寛容な上限を置く。
const MAX_PROJECT_FILE_BYTES: u64 = 64 * 1024 * 1024;

fn ensure_project_file_size(path: &Path, limit: u64) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("failed to read file: {error}"))?;
    if metadata.len() > limit {
        return Err("the file is too large to open".to_string());
    }
    Ok(())
}
```

`load_project_file` を差し替える。

```rust
#[tauri::command]
pub async fn load_project_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    ensure_project_file_size(path, MAX_PROJECT_FILE_BYTES)?;
    std::fs::read_to_string(path).map_err(|error| format!("failed to read file: {error}"))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib atomic_write_tests`
Expected: `test result: ok. 3 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/store/file_io.rs
git commit -m "fix(store): cap the project file size before reading it"
```

---

### Task 7: ボード描画に Error Boundary を追加する

**Objective:** 想定外の render 例外でウインドウ全体が白くなり、メモリ上の未保存ボードへ到達できなくなる状態を防ぐ。

**Files:**
- Create: `src/components/Common/BoardErrorBoundary.tsx`
- Modify: `src/screens/Project.tsx`

- [ ] **Step 1: Error Boundary を作る**

`src/components/Common/BoardErrorBoundary.tsx` を新規作成する。

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface BoardErrorBoundaryProps {
  children: ReactNode;
}

interface BoardErrorBoundaryState {
  hasError: boolean;
}

/**
 * ボード描画で例外が出ても document window 全体を白画面にしないための境界。
 * ツリーがアンマウントされると、Zustand 上に残っている未保存ボードへユーザーが
 * 到達できなくなるため、描画エラーは局所化する。
 */
export class BoardErrorBoundary extends Component<
  BoardErrorBoundaryProps,
  BoardErrorBoundaryState
> {
  state: BoardErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoardErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (!import.meta.env.DEV) return;
    console.error('[BoardErrorBoundary] board rendering failed', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <p className="text-muted text-center text-sm">
            The board could not be displayed because of an unexpected error.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 2: ボードを包む**

`src/screens/Project.tsx` で `<Sheltie ... />` のレンダリング箇所を `<BoardErrorBoundary>` で包む。import を追加する。

```tsx
import { BoardErrorBoundary } from '@/components/Common/BoardErrorBoundary';
```

- [ ] **Step 3: Run automated validation**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: いずれも成功

- [ ] **Step 4: 手動確認**

`npm run dev` で起動し、通常のボード操作（ノード追加、ドラッグ、リサイズ、テキスト編集）が従来どおり動くことを確認する。境界の表示自体は意図的に到達困難なため、一時的に `StickyNoteNode` で `throw new Error('boundary check')` を入れて表示を確認したあと、必ず元へ戻す。

- [ ] **Step 5: Commit**

```bash
git add src/components/Common/BoardErrorBoundary.tsx src/screens/Project.tsx
git commit -m "feat(project): contain board rendering errors"
```

## Validation

- `npm run lint` — エラーなし
- `npm run format` — 差分なし
- `npm run typecheck` — 型エラーなし
- `npm run test` — 既存 271 件 + 追加分がすべて green
- `cd src-tauri && cargo test --lib` — 既存 128 件 + 追加 3 件が green
- 手動: 破損ファイル・将来バージョンファイルを開く → エラーダイアログ + ウインドウクローズ。同じパスを修復後に再度開けること
- 手動: 正常ファイルの Open / Save / Save As / `Cmd+Q` が従来どおり動くこと
- 手動: 保存後に `ls -la` で `.sheltie.tmp` が残っていないこと、`stat -f '%Sp' <file>` で権限が保存前と一致すること

## Risks, Tradeoffs, and Open Questions

- **エラーメッセージを 1 種類に統一している。** 破損と「将来バージョン」を出し分けないという決定に従い、両方を含意する文面（damaged or created by a newer version）にしている。将来バージョンの判定は `schemaVersion` で可能なので、後から分岐を足す余地は残る。
- **`filePath` 登録のリーク可能性。** `close_ready` が document manager の登録を解放しない場合、破損ファイルを開いた後に同じパスを再度開けなくなる。Task 2 の手動確認 4 で必ず検証する。解放されていなければ、`close_ready` 側に登録解放を追加する（Phase 1 内で対応する）。
- **atomic rename は xattr / Finder タグを保持しない。** permissions のみ引き継ぐ決定。タグ運用の要望が出たら `renamex_np(RENAME_SWAP)` 相当の対応を別途検討する。
- **64 MiB は正当なファイルを弾かない前提の値。** スクリーンショットは別ディレクトリに保存されるため `.sheltie` 本体は小さい。前提が変わる仕様変更（画像の埋め込み等）があれば上限を見直す。
- **Error Boundary に Save ボタンは置かない。** 白画面を防いでエラーを表示するまでに留める決定。救出手段そのものを提供したい場合は追加実装になる。
