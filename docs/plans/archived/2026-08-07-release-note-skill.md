# Release Note Generation Skill Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** リリースノートを手書きせずに済むよう、コミットと archived plan からユーザー向けノートを生成して draft GitHub Release に反映するローカルスキル `release-note` を追加し、`release.yml` の無意味な自動生成を置き換える。

**Architecture:** LLM は手元の Claude Code で動かす。CI には API キーを追加せず、Apple 証明書を持つ `release` environment に外部 API 呼び出しを持ち込まない。スキルが手順と文体ガイドの正本になり、`docs/agents/release.md` はそこへのリンクだけを持つ。`release.yml` は「ノート未生成」であることが本文から分かるプレースホルダを入れるだけにする。

**Tech Stack:** Markdown（SKILL.md）、GitHub Actions（bash）、`gh` CLI、git

## Global Constraints

- スキルの実体は `.agents/skills/release-note/`、`.claude/skills/release-note` は `../../.agents/skills/release-note` へのシンボリックリンク（既存5スキルと同じ構造）
- リリースノートは英語で書く（`docs/agents/release.md` の既定、v1.0.0 / v1.1.0 の前例）
- 公開リポジトリのため、ドキュメント・コミットメッセージは英語。チャット応答は日本語
- `*.md` は `.prettierignore` 対象なので Prettier の整形制約はかからない
- `.github/workflows/*.yml` は CI の `verify` job で actionlint にかけられる
- 既存の「published なら差し替え拒否」方針（`release.yml` 245-249行）とスキルの挙動を揃える

## Current Context

確認済み:

- `.github/workflows/release.yml` 258-268行が `gh release create ... --draft --generate-notes` を呼んでいる
- `--generate-notes` は範囲内の PR マージコミットから "What's Changed" を作る。機能開発が `develop` へ直 push されているため、範囲内の PR は release PR 1件のみ。GitHub の generate-notes API で実測して確認済み
- `docs/agents/release.md:118` が手順8。「generated notes を編集し、日本語 PR タイトルを書き直す」とあるが、日本語 PR タイトルはもう出ない
- `docs/agents/README.md:24` の `release.md` 行、読むタイミングが「リリースworkflow・Apple証明書・GitHub Environment・cask変更時」となっており、リリース実行時が含まれていない
- `docs/plans/archived/` は機能単位で 1 plan。v1.2.0 では `2026-08-06-check-for-updates.md` と `2026-08-06-node-copy-paste-duplicate.md`（+ phase 子 plan 3件）
- コミット本文は詳細に書かれており、症状と影響がユーザー視点で読める
- `actions/checkout` は `fetch-depth` 未指定（＝1）なので、workflow 内で `git describe` による前タグ解決はできない

計画上の仮定:

- v1.2.0 の draft リリースは未公開のまま存在する。Task 4 の動作確認にこれを使う
- スキルインストーラは `skills-lock.json` 外のディレクトリを prune しない。仮に prune されても git 管理下なので復元可能

## File Structure

- Create: `.agents/skills/release-note/SKILL.md` — 手順と文体ガイドの正本
- Create: `.claude/skills/release-note` — `../../.agents/skills/release-note` へのシンボリックリンク
- Modify: `.github/workflows/release.yml:258-268` — `--generate-notes` をプレースホルダ本文に置換
- Modify: `docs/agents/release.md:118` — 手順8をスキル参照に置換
- Modify: `docs/agents/README.md:24` — `release.md` の読むタイミングに「リリース実行時」を追加

テストコードは無い。スキルと workflow はいずれも `docs/agents/workflow.md` の「テスト対象外（手動確認のみ）」に該当する。検証は actionlint と、v1.2.0 draft に対する実行で行う。

## Tasks

### Task 1: `release-note` スキルを追加する

**Objective:** コミットと archived plan からユーザー向けノートを書き、draft に反映するまでの手順を SKILL.md に定義する。

**Files:**
- Create: `.agents/skills/release-note/SKILL.md`
- Create: `.claude/skills/release-note`（シンボリックリンク）

**Interfaces:**
- Produces: スキル名 `release-note`。Task 3 の `docs/agents/release.md` から参照される

- [ ] **Step 1: SKILL.md を作成する**

`.agents/skills/release-note/SKILL.md` を以下の内容で作成する。

````markdown
---
name: release-note
description: Sheltie のリリースノートを生成して draft GitHub Release に反映するスキル。「リリースノートを書いて」「release note を作って」「リリースノートを生成して」と言われたとき、または docs/agents/release.md の手順8を実行するときに使う。前タグからのコミットと docs/plans/archived/ の差分を読み、英語のユーザー向けノートを書いて gh release edit で draft に反映する。公開済みリリースには実行しない。
argument-hint: "[タグ名（省略時は最新タグ）]"
---

# release-note

Sheltie のリリースノートを生成して draft GitHub Release に反映する。

素材はコミットを基礎にする。`docs/plans/archived/` の差分は、見出しの粒度と機能の意図を補強する材料として追加で読む。plan 化されていない軽量な改修もコミット側で拾えるので、plan の有無に関わらず変更が落ちない。

## 手順

### 1. 対象範囲を決める

引数でタグが渡されていればそれを使う。無ければ最新タグを使う。

```bash
TAG="${1:-$(git describe --tags --abbrev=0)}"
PREVIOUS_TAG="$(git describe --tags --abbrev=0 "$TAG^")"
echo "range: $PREVIOUS_TAG..$TAG"
```

### 2. 公開済みなら中止する

```bash
gh release view "$TAG" --json isDraft,url --jq '{isDraft, url}'
```

`isDraft` が `false` なら、そこで止めてユーザーに伝える。公開済みリリースのノートは書き換えない。リリースが存在しない場合も止める（タグを push して workflow の完了を待つ必要がある）。

### 3. 素材を集める

コミットを本文まで読む。これが基礎になる。

```bash
git log "$PREVIOUS_TAG..$TAG" --no-merges --format='---%n%s%n%b'
```

archived plan の差分を見る。追加された plan があれば、その中身も読む。

```bash
git diff --name-only "$PREVIOUS_TAG..$TAG" -- docs/plans/archived/
```

plan は「何を作ったか」をユーザー視点で書いた資料なので、見出しの単位として使える。コミットは「どう作ったか」なので、詳細と修正項目の抽出に使う。

過去のノートを文体の基準として読む。

```bash
gh release view v1.1.0 --json body --jq '.body'
```

### 4. ノートを書く

英語で書く。下の「文体ガイド」に従う。

### 5. draft に反映する

現在の本文を取得する。

```bash
gh release view "$TAG" --json body --jq '.body'
```

本文が `release.yml` の入れたプレースホルダのまま（`Release notes pending.` で始まる）なら、確認せずそのまま反映する。

プレースホルダ以外に変わっている場合は、手で編集された可能性がある。生成したノートを提示し、上書きしてよいかユーザーに確認してから反映する。

```bash
gh release edit "$TAG" --notes-file <生成したノートのパス>
```

反映後、リリースの URL を提示する。

## 文体ガイド

### 構成

ユーザーから見た機能単位で `##` 見出しを立てる。コミット単位でも、内部モジュール単位でもない。v1.2.0 なら24コミットが「Check for Updates」と「Copy, paste, and duplicate」の2本に畳まれる。

末尾に定型を置く。

- インストール方法（DMG のファイル名と Homebrew コマンド）
- `**Full Changelog**: https://github.com/ryonakae/sheltie/compare/<前タグ>...<タグ>`

### 載せるもの

- ユーザーが操作・体験として気づく変更
- 挙動が変わる修正。症状を書く（「Cut がボードを不整合な状態にしなくなった」）
- ユーザー側の対応が要る事項。**これは必ず載せる**（例: v1.2.0 では、アップデーター自体が初出のため v1.1.0 のユーザーには通知が届かず手動更新が必要）

### 載せないもの

- 内部リファクタ、モジュール分割、関数の抽出
- ドキュメント更新、plan のアーカイブ、テスト追加
- 機能の内部ステップにすぎない feat（`feat(store): add insertBoardContent action` は「ペースト」の部品であって独立項目ではない）

依存更新は個別に列挙せず、1行にまとめる。セキュリティ上の意味がある場合だけ件数に触れる。

### 書き方

実装の言葉をユーザーの言葉に翻訳する。

- `fix(clipboard): harden cut, tiptap validation, ghost node ids, and async commands`
  → Cut no longer leaves the board in an inconsistent state, and malformed text content is rejected before it can break rendering
- `fix(alt-drag): keep the ghost clone at its source node's stacking position`
  → Option-drag ghosts keep their source node's stacking order

主語はユーザーかアプリにする。コミットの scope 名（`alt-drag`、`clipboard`）をそのまま見出しにしない。
````

- [ ] **Step 2: シンボリックリンクを作る**

```bash
cd /Users/ryo.nakae/Dev/private/sheltie
ln -s ../../.agents/skills/release-note .claude/skills/release-note
```

- [ ] **Step 3: 構造を検証する**

Run:
```bash
ls -la .claude/skills/release-note && cat .claude/skills/release-note/SKILL.md | head -5
```

Expected: `.claude/skills/release-note -> ../../.agents/skills/release-note` が表示され、リンク経由で SKILL.md の frontmatter（`---` と `name: release-note`）が読めること。

- [ ] **Step 4: Commit**

```bash
git add .agents/skills/release-note .claude/skills/release-note
git commit -m "feat(skills): add a release-note skill that drafts notes from commits"
```

---

### Task 2: `release.yml` の `--generate-notes` をプレースホルダに置き換える

**Objective:** 必ず上書きされる1行ノートの生成をやめ、ノート未生成であることが本文から分かる状態にする。

**Files:**
- Modify: `.github/workflows/release.yml:258-268`

**Interfaces:**
- Consumes: なし
- Produces: プレースホルダ本文の先頭文字列 `Release notes pending.`。Task 1 のスキルがこれを初回判定に使う

- [ ] **Step 1: プレースホルダ本文を組み立てる処理を追加する**

`release.yml` の `Create draft GitHub Release` ステップ、`set -euo pipefail` の直後（243行目の次）に以下を挿入する。

```bash
          PLACEHOLDER_NOTES="Release notes pending. Generate them with the \`/release-note\` skill before publishing."
          PREVIOUS_TAG="$(gh release list --exclude-drafts --limit 1 --json tagName --jq '.[0].tagName // empty')"
          if [[ -n "$PREVIOUS_TAG" ]]; then
            PLACEHOLDER_NOTES="$PLACEHOLDER_NOTES"$'\n\n'"**Full Changelog**: https://github.com/${GITHUB_REPOSITORY}/compare/${PREVIOUS_TAG}...${GITHUB_REF_NAME}"
          fi
```

`gh release list --exclude-drafts --limit 1` は、この時点でまだ今回の draft を作っていないため、前回リリースを返す。初回リリースでは空になるので、その場合は Full Changelog 行を省く。

- [ ] **Step 2: `--generate-notes` を置き換える**

265行目の

```yaml
              --generate-notes \
```

を

```yaml
              --notes "$PLACEHOLDER_NOTES" \
```

に置き換える。`--draft`、`--title`、`--verify-tag` は変更しない。

- [ ] **Step 3: actionlint で検証する**

Run:
```bash
cd /Users/ryo.nakae/Dev/private/sheltie && \
  ACTIONLINT_VERSION="$(grep -oE 'ACTIONLINT_VERSION: [0-9.]+' .github/workflows/ci.yml | head -1 | awk '{print $2}')" && \
  echo "CI uses actionlint $ACTIONLINT_VERSION" && \
  (command -v actionlint >/dev/null && actionlint -color .github/workflows/release.yml || echo "actionlint 未インストール: CI の verify job に委ねる")
```

Expected: actionlint がインストールされていれば出力なし（＝指摘なし）。未インストールなら、その旨が出て CI に委ねる。いずれの場合も shellcheck 由来の SC2086 等が出ないこと。

- [ ] **Step 4: bash 構文を単体で確認する**

Run:
```bash
bash -n <(printf '%s\n' 'set -euo pipefail' \
  'PLACEHOLDER_NOTES="Release notes pending. Generate them with the \`/release-note\` skill before publishing."' \
  'PREVIOUS_TAG="v1.1.0"' \
  'if [[ -n "$PREVIOUS_TAG" ]]; then' \
  '  PLACEHOLDER_NOTES="$PLACEHOLDER_NOTES"$'"'"'\n\n'"'"'"**Full Changelog**: https://github.com/owner/repo/compare/${PREVIOUS_TAG}...v1.2.0"' \
  'fi' \
  'printf "%s\n" "$PLACEHOLDER_NOTES"') && echo "syntax OK"
```

Expected: `syntax OK` が出ること。構文エラーが出た場合は Step 1 のクォートを見直す。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): replace generated notes with a pending placeholder"
```

---

### Task 3: ドキュメントを更新する

**Objective:** リリース手順の正本からスキルを参照させ、リリース実行時に `release.md` が読まれるようにする。

**Files:**
- Modify: `docs/agents/release.md:118`
- Modify: `docs/agents/README.md:24`

**Interfaces:**
- Consumes: Task 1 のスキル名 `release-note`

- [ ] **Step 1: `release.md` の手順8を置き換える**

118行目の

```markdown
8. Open the generated draft GitHub Release and edit the generated notes as needed. Release notes are written in English. The generated "What's Changed" list may contain Japanese pull request titles; rewrite the entries that matter to release readers.
```

を以下に置き換える。

```markdown
8. Write the release notes with the `/release-note` skill, then read the result on GitHub and adjust it if needed. The workflow leaves a `Release notes pending.` placeholder in the draft, so an unwritten release is visible in the release body itself. Release notes are written in English.
```

- [ ] **Step 2: `README.md` の読むタイミングを直す**

24行目の

```markdown
| `release.md` | macOS署名・公証・GitHub Release・Homebrew tap運用 | リリースworkflow・Apple証明書・GitHub Environment・cask変更時 |
```

を以下に置き換える。

```markdown
| `release.md` | macOS署名・公証・GitHub Release・Homebrew tap運用 | リリース実行時・リリースworkflow・Apple証明書・GitHub Environment・cask変更時 |
```

- [ ] **Step 3: 参照の整合性を確認する**

Run:
```bash
cd /Users/ryo.nakae/Dev/private/sheltie && \
  grep -n "release-note" docs/agents/release.md && \
  grep -n "リリース実行時" docs/agents/README.md && \
  grep -n "Japanese pull request titles" docs/agents/release.md || echo "旧記述は削除済み"
```

Expected: `release.md` にスキル参照が1件、`README.md` に「リリース実行時」が1件見つかり、旧記述（`Japanese pull request titles`）は残っていないこと。

- [ ] **Step 4: Commit**

```bash
git add docs/agents/release.md docs/agents/README.md
git commit -m "docs(agents): point the release flow at the release-note skill"
```

---

### Task 4: v1.2.0 の draft で実際に動かす

**Objective:** スキルが実運用で機能することを、現存する v1.2.0 draft で確認する。

**Files:** なし（動作確認のみ）

**Interfaces:**
- Consumes: Task 1 のスキル、Task 2 のプレースホルダ判定

- [ ] **Step 1: v1.2.0 が draft のままであることを確認する**

Run:
```bash
gh release view v1.2.0 --json isDraft,body --jq '{isDraft, bodyHead: (.body | split("\n")[0])}'
```

Expected: `isDraft` が `true`。`bodyHead` は `## What's Changed`（v1.2.0 は Task 2 より前に作られたため、プレースホルダではない）。

- [ ] **Step 2: スキルを実行する**

Claude Code で `/release-note v1.2.0` を実行する。

Expected: 手順どおり `v1.1.0..v1.2.0` の範囲が解決され、コミットと2件の archived plan（`2026-08-06-check-for-updates.md`、`2026-08-06-node-copy-paste-duplicate.md`）が読まれること。本文がプレースホルダではないため、**上書き前に確認を求めてくること**。ここが Task 2 の判定ロジックの検証点になる。

- [ ] **Step 3: 生成内容を確認する**

生成されたノートが文体ガイドを満たしているか読む。特に次の3点。

1. 見出しが機能単位（アップデーター / コピー・ペースト・複製）で、コミット単位になっていない
2. `feat(store): add insertBoardContent action` のような内部ステップが独立項目になっていない
3. v1.1.0 ユーザーに自動更新が届かない旨が載っている

満たしていなければ、SKILL.md の文体ガイドを直して再実行する。

- [ ] **Step 4: 反映する**

確認に同意して draft へ反映し、GitHub 上で表示を確認する。

Run:
```bash
gh release view v1.2.0 --json body --jq '.body' | head -20
```

Expected: 生成したノートが反映されていること。

- [ ] **Step 5: 文体ガイドを修正した場合のみ Commit**

```bash
git add .agents/skills/release-note/SKILL.md
git commit -m "fix(skills): tighten the release-note style guide"
```

## Validation

- `npm run lint` — 指摘なし（変更対象に JS/TS は無いが、リポジトリ全体の健全性確認）
- `npm run format` — `All matched files use Prettier code style!`（`*.md` は `.prettierignore` 対象なので今回の変更は対象外）
- CI の `verify` job で actionlint が `release.yml` を検査する。PR 作成時に pass すること
- Task 4 で v1.2.0 draft に対してスキルを実行し、ノートが生成・反映されること
- 次回リリース時、タグ push 後の draft 本文が `Release notes pending.` で始まること。ここは今回のリリースサイクルでは確認できず、次回リリースまで持ち越しになる

## Risks, Tradeoffs, and Open Questions

- **`gh release list --exclude-drafts --limit 1` は「最新の公開済みリリース」を返す前提に依存する。** 過去のリリースを後から下書きに戻す、あるいは古いバージョンを新しく公開し直すと、Full Changelog の比較元がずれる。プレースホルダ内のリンクなので実害は小さく、スキルが正しい前タグでノートを書けば上書きされる。
- **プレースホルダ判定は本文の先頭文字列に依存する。** `release.yml` のプレースホルダ文言を変えるときは、SKILL.md の判定条件も同時に直す必要がある。両方に同じ文字列が書かれるという意味で DRY ではないが、CI と手元スキルという別プロセス間の契約であり、共有できる定数の置き場所が無い。
- **スキルの出力品質は毎回同じにはならない。** 文体ガイドは方向を与えるだけで、決定的な出力を保証しない。公開前に人が読む前提は変わらない。これは Q5 で確認済みの設計。
- **`.agents/skills/` は配布物5件と `skills-lock.json` で管理されている。** 自作スキルを同居させるため、インストーラが lock 外を prune する場合に消える可能性がある。git 管理下なので `git checkout` で復元でき、実害が確認されたら `.agents/skills-local/` へ移して `.claude` 側のリンクを張り替える。
- **未解決:** `docs/plans/` に置いたこの plan 自体は、完了後 `docs/plans/archived/` へ移す。移動が次回リリースの範囲に入ると、スキルが「plan が追加された＝ユーザー向け機能」と誤認する可能性がある。文体ガイドの「載せないもの」に plan のアーカイブを明記済みだが、実運用で誤検出が出たら plan 差分の扱いを「追加のみ、かつ `archived/` 直下の `.md` に限る」等へ絞る。
