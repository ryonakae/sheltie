# release-sheltie Skill Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** リリース手順全体を担うローカルスキル `release-sheltie` を作り、人間の担当を DMG の受け入れ確認だけに絞る。`release-note` は吸収して削除する。

**Architecture:** スキルが実行手順の正本になり、`docs/agents/release.md` は契約・シークレット・環境といった前提知識の正本として残る。スキルは状態ファイルを持たず、起動時にリポジトリと GitHub の実際の状態から現在地を導出して、続きから実行する。不可逆な操作のうち、検出で守れないもの（DMG 受け入れ確認の完了可否）だけを公開直前に一度確認する。

**Tech Stack:** Markdown（SKILL.md + references/）、`gh` CLI、git

## Global Constraints

- スキル名は `release-sheltie`。実体は `.agents/skills/release-sheltie/`、`.claude/skills/release-sheltie` は `../../.agents/skills/release-sheltie` へのシンボリックリンク
- 文体ガイドは `.agents/skills/release-sheltie/references/release-notes.md` に分離する（同居する `natural-japanese` と同じ SKILL.md + references/ 構成）
- `release-note` スキル（`.agents/skills/release-note/` と `.claude/skills/release-note`）は削除する
- 状態を記録するファイルは作らない。現在地は毎回検出する
- 確認を取るのは2箇所のみ。バージョン番号の決定と、公開直前の受け入れ確認完了可否
- PR のマージとタグ push は確認を取らない。CI が pass しているかという検出可能な条件で守る
- リリースタグは `main` のコミットを指すこと。`release.md:115` のハードルールを維持する
- PR のマージは merge commit のみ。squash / rebase は `main` を `develop` から分岐させるため使わない
- リリースノートは英語
- ドキュメント・コミットメッセージは英語（公開リポジトリ）

## Current Context

確認済み:

- `docs/agents/release.md` は241行11セクション。うち実行手順は `## Release procedure`（88-119行）と `## Draft release acceptance`（121-143行）の2つ
- 残る9セクション（`Artifact contract` / `GitHub environment` / `Environment secrets` / `Environment variables` / `In-app updater` / `Homebrew tap` / `Workflow behavior` / `Tauri DMG notarization workaround` / `Credential handling`）は前提知識であり、手順ではない
- `docs/agents/README.md:24` の `release.md` 読むタイミングは「リリース実行時・リリースworkflow・Apple証明書・GitHub Environment・cask変更時」。手順が出ていってもスキルが artifact contract を参照するため、この列は変更しない
- `.agents/skills/release-note/SKILL.md` が存在し、`.claude/skills/release-note` からリンクされている。v1.2.0 で実行実績あり
- `release.yml` は draft 本文に `Release notes pending.` で始まるプレースホルダを入れる（`develop` にのみ存在。v1.2.0 のタグには含まれないため、次回リリースが初適用）
- `.github/workflows/ci.yml` は `main` 向け PR で `verify` と `rust` の2 job を実行する
- `.github/workflows/update-homebrew-cask.yml` は `release: published` で起動し、prerelease をスキップする
- v1.2.0 は公開済み。`package.json` の version は `1.2.0`、最新タグは `v1.2.0`

計画上の仮定:

- Task 3 実行時点でも「リリース進行中ではない」状態（`package.json` の version == 最新タグ）が維持されている

## File Structure

- Create: `.agents/skills/release-sheltie/SKILL.md` — 状態検出とリリース手順の正本
- Create: `.agents/skills/release-sheltie/references/release-notes.md` — リリースノートの文体ガイド（`release-note/SKILL.md` の文体ガイド節を移設し、追記済みの2項目を含む）
- Create: `.claude/skills/release-sheltie` — シンボリックリンク
- Delete: `.agents/skills/release-note/SKILL.md`
- Delete: `.claude/skills/release-note`
- Modify: `docs/agents/release.md:88-143` — 2セクションを削除し、スキルへのリンクに置換

テストコードは無い。スキルとドキュメントは `docs/agents/workflow.md` の「テスト対象外（手動確認のみ）」に該当する。検証は状態検出コマンドの実行と、次回リリースでの実運用で行う。

## Tasks

### Task 1: `release-sheltie` スキルを作る

**Objective:** 状態検出と全手順を SKILL.md に、文体ガイドを references/ に定義する。

**Files:**
- Create: `.agents/skills/release-sheltie/SKILL.md`
- Create: `.agents/skills/release-sheltie/references/release-notes.md`
- Create: `.claude/skills/release-sheltie`（シンボリックリンク）

**Interfaces:**
- Produces: スキル名 `release-sheltie`。Task 2 の `docs/agents/release.md` から参照される

- [ ] **Step 1: 文体ガイドを references/ に作る**

`.agents/skills/release-sheltie/references/release-notes.md` を作成する。内容は現在の `.agents/skills/release-note/SKILL.md` の「## 文体ガイド」節（`### 構成` から末尾まで）をそのまま移し、見出しレベルを1つ上げる。移設元には後から追記した2項目（同一リリース内 fix の除外、小粒リリースでの Highlights 形式）が含まれているので、それも漏らさず移す。

```markdown
# リリースノートの文体ガイド

## 構成

ユーザーから見た機能単位で `##` 見出しを立てる。コミット単位でも、内部モジュール単位でもない。v1.2.0 なら24コミットが「Check for Updates」と「Copy, paste, and duplicate」の2本に畳まれる。

説明に段落が要らない小粒な変更ばかりのリリースでは、機能ごとに見出しを立てず `## Highlights` の下に太字リード付きの箇条書きを並べる（v1.0.0 / v1.1.0 がこの形）。判断基準は、各項目に添える説明が1文で足りるかどうか。

末尾に定型を置く。

- インストール方法（DMG のファイル名と Homebrew コマンド）
- `**Full Changelog**: https://github.com/ryonakae/sheltie/compare/<前タグ>...<タグ>`

## 載せるもの

- ユーザーが操作・体験として気づく変更
- 挙動が変わる修正。症状を書く（「Cut がボードを不整合な状態にしなくなった」）
- ユーザー側の対応が要る事項。**これは必ず載せる**（例: v1.2.0 では、アップデーター自体が初出のため v1.1.0 のユーザーには通知が届かず手動更新が必要）

## 載せないもの

- 内部リファクタ、モジュール分割、関数の抽出
- ドキュメント更新、plan のアーカイブ、テスト追加
- 機能の内部ステップにすぎない feat（`feat(store): add insertBoardContent action` は「ペースト」の部品であって独立項目ではない）
- **同じリリースで追加した機能に対する fix**。前のバージョンのユーザーはその不具合に遭遇していないので、「修正しました」と書くとミスリードになる。v1.2.0 では `fix(clipboard)` `fix(alt-drag)` の5件がこれに当たり、Fixes に載せたのは以前から壊れていた `fix(screenshots)` の1件だけだった

fix を Fixes に載せる前に、その機能が前のタグに存在したかを確認する。存在しなければ載せない。

依存更新は個別に列挙せず、1行にまとめる。セキュリティ上の意味がある場合だけ件数に触れる。

## 書き方

実装の言葉をユーザーの言葉に翻訳する。

- `fix(clipboard): harden cut, tiptap validation, ghost node ids, and async commands`
  → Cut no longer leaves the board in an inconsistent state, and malformed text content is rejected before it can break rendering
- `fix(alt-drag): keep the ghost clone at its source node's stacking position`
  → Option-drag ghosts keep their source node's stacking order

主語はユーザーかアプリにする。コミットの scope 名（`alt-drag`、`clipboard`）をそのまま見出しにしない。

## 素材の集め方

コミットを基礎にする。これで網羅性が担保される。

```bash
git log "$PREVIOUS_TAG..$TAG" --no-merges --format='---%n%s%n%b'
```

`docs/plans/archived/` の差分は、見出しの粒度と機能の意図を補強する材料として追加で読む。追加された plan があれば中身も読む。

```bash
git diff --name-only "$PREVIOUS_TAG..$TAG" -- docs/plans/archived/
```

plan は「何を作ったか」をユーザー視点で書いた資料なので見出しの単位に使える。コミットは「どう作ったか」なので詳細と修正項目の抽出に使う。plan 化されていない軽量な改修もコミット側で拾えるので、plan の有無に関わらず変更が落ちない。

過去のノートを文体の基準として読む。

```bash
gh release view v1.2.0 --json body --jq '.body'
```
```

- [ ] **Step 2: SKILL.md を作る**

`.agents/skills/release-sheltie/SKILL.md` を作成する。

````markdown
---
name: release-sheltie
description: Sheltie のリリースを実行するスキル。「リリースして」「リリース作業を進めて」「バージョンを上げてリリース」「リリースノートを書いて」「リリースを公開して」と言われたときに使う。バージョン更新から PR 作成、マージ、タグ push、リリースノート生成、公開、公開後検証までを担当する。起動時に現在地を検出するので、途中から再開する場合も引数なしで呼べる。DMG の受け入れ確認だけは人間が行う。
argument-hint: "[バージョン番号（省略可）]"
---

# release-sheltie

Sheltie のリリースを実行する。

前提知識は `docs/agents/release.md` にある。artifact contract、シークレット、GitHub environment、Homebrew tap、公証ワークアラウンドが必要になったらそちらを読む。このスキルは手順だけを持つ。

## 担当の境界

**人間がやること**（代替不可）

- draft の DMG をブラウザからダウンロードする。ブラウザ経由でないと macOS の quarantine 属性が付かず、Gatekeeper の挙動を確認できない
- チェックサムを照合する
- Applications へインストールして起動し、Gatekeeper の表示を確認する
- 作成・保存・再オープン・Webview の主要フローを動かす

**それ以外はすべてこのスキルがやる。**

## 現在地の検出

引数なしで呼ばれたら、まず現在地を判定する。状態を記録したファイルは持たない。毎回リポジトリと GitHub から導出する。

```bash
PKG_VERSION="$(node -p "require('./package.json').version")"
TAG="v$PKG_VERSION"
LATEST_TAG="$(git describe --tags --abbrev=0)"
echo "package.json: $PKG_VERSION / latest tag: $LATEST_TAG"

git ls-remote --tags origin "refs/tags/$TAG" | head -1
gh pr list --base main --state open --json number,title,url --jq '.[]'
gh release view "$TAG" --json isDraft,url --jq '{isDraft, url}' 2>/dev/null || echo "no release for $TAG"
```

判定表。上から順に評価し、最初に一致した行の手順へ進む。

| 状態 | 次の手順 |
|---|---|
| `$TAG` のリリースが存在し `isDraft` が `false` | 手順8（公開後検証）。既に公開済みなら、検証結果を報告して終了 |
| `$TAG` の draft が存在し、本文が `Release notes pending.` 以外 | 手順7（公開） |
| `$TAG` の draft が存在し、本文が `Release notes pending.` で始まる | 手順6（ノート生成） |
| `$TAG` がリモートに存在し、リリースが無い | 手順5（Release workflow 待ち） |
| リリース PR が open | 手順4（CI 待ち → マージ → タグ） |
| `$PKG_VERSION` != `$LATEST_TAG` から `v` を除いた値 | 手順3（PR 作成）。ただし未 commit の変更があれば手順2から |
| `$PKG_VERSION` == `$LATEST_TAG` から `v` を除いた値 | 手順1（バージョン決定）。リリース対象が無ければその旨を伝えて終了 |

検出結果は必ずユーザーに伝えてから進む。「現在地: draft 作成済み・ノート未生成。手順6から再開します」のように。

## 手順

### 1. バージョンを決める

引数でバージョンが渡されていればそれを使う。無ければコミットから提案する。

```bash
git log "$LATEST_TAG..HEAD" --no-merges --format='%s' | sed 's/(.*)//' | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

- `feat` があれば minor
- `fix` と `chore` だけなら patch
- 破壊的変更（ドキュメント形式の非互換、ユーザー向け契約の変更）があれば major

ドキュメント形式が変わっていないかは、`src/lib/project-document.ts` の `schemaVersion` を前タグと比較して確認する。

```bash
git diff "$LATEST_TAG..HEAD" -- src/lib/project-document.ts | grep -E "^[+-].*schemaVersion" | head
```

提案したバージョンと根拠をユーザーに伝え、**同意を得てから進む**。semver の判断には「この feat は破壊的か」という文脈依存の判断が混じるため、ここは検出だけでは決められない。

リリース対象のコミットが無ければ、その旨を伝えて終了する。

### 2. バージョンを更新して push する

3ファイルを同じバージョンに更新する。`release.yml` はタグから `v` を除いた文字列が3つすべてと一致することを要求する。

- `package.json` の `version`
- `src-tauri/tauri.conf.json` の `version`
- `src-tauri/Cargo.toml` の `version`

ロックファイルも同期する。

```bash
(cd src-tauri && cargo update -p sheltie --precise "$PKG_VERSION")
npm install --package-lock-only
```

検証コマンドを全部通す。

```bash
npm run lint && npm run format && npm run typecheck && npm run test
(cd src-tauri && cargo test --lib)
```

すべて通ったらコミットして push する。

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore(release): bump version to $PKG_VERSION"
git push origin develop
```

### 3. リリース PR を作る

`develop` から `main` へ、タイトル `release: v<version>` で作る。base の指定を省くと `main` が既定なので問題ないが、明示する。

本文には、そのリリースの変更概要と検証結果を書く。リリースノートそのものではなく、レビュー用の要約でよい。

```bash
gh pr create --base main --head develop --title "release: v$PKG_VERSION" --body-file <本文のパス>
```

### 4. CI を待ってマージし、タグを打つ

```bash
gh pr checks <PR番号>
```

`verify` と `rust` の両方が pass するまで待つ。1つでも fail したら、そこで止めて内容を報告する。マージには進まない。

両方 pass したら **merge commit で**マージする。squash / rebase は `main` を `develop` から分岐させるため使わない。

```bash
gh pr merge <PR番号> --merge
```

タグは `main` のマージコミットに打つ。ローカルの `develop` に打ってはいけない。

```bash
git fetch origin main
git tag "$TAG" origin/main
git push origin "$TAG"
```

打った後、タグが `main` 上にあることを確認する。

```bash
git branch -r --contains "$TAG"
```

`origin/main` が出ること。出なければタグを削除してやり直す。

ここまで確認は取らない。CI の pass が前提条件として検出できるため。

### 5. Release workflow を待つ

タグ push で **Release macOS** workflow が起動する。前回実績で10分程度かかる。

```bash
gh run list --workflow=release.yml --limit 1
```

完了したら、失敗・スキップしたステップが無いことを確認する。

```bash
gh run view <run-id> --json jobs --jq '.jobs[].steps[] | select(.conclusion!="success") | "\(.name): \(.conclusion)"'
```

出力が空であること。

### 6. リリースノートを書く

文体ガイドは `references/release-notes.md` にある。**必ず読んでから書く。**

素材の集め方もそちらに書いてある。範囲は前タグから今回のタグまで。

```bash
PREVIOUS_TAG="$(git describe --tags --abbrev=0 "$TAG^")"
```

書いたら draft に反映する。

```bash
gh release edit "$TAG" --notes-file <ノートのパス>
```

本文が `Release notes pending.` で始まる場合は確認せず反映してよい。それ以外に変わっている場合は手で編集された可能性があるため、生成内容を提示して上書きの可否を確認する。

反映後、リリースの URL を提示して、**人間の受け入れ確認を依頼する**。依頼する内容は「担当の境界」の人間側4項目。チェックサム照合のコマンドを添える。

```bash
cd ~/Downloads && shasum -a 256 -c "Sheltie_${PKG_VERSION}_universal.dmg.sha256"
```

ここで一旦終了する。ユーザーが確認を終えて再度呼ぶまで待つ。

### 7. 公開する

まず機械的に確認できる点を検証する。

```bash
gh release view "$TAG" --json isDraft,isPrerelease,assets --jq '{isDraft, isPrerelease, assets: [.assets[].name]}'
```

- `isDraft` が `true`
- `isPrerelease` が `false`
- アセットが5点（`Sheltie_<version>_universal.dmg`、その `.sha256`、`Sheltie_<version>_universal.app.tar.gz`、その `.sig`、`latest.json`）

`latest.json` の整合も確認する。

```bash
gh release download "$TAG" --pattern "latest.json" --dir <一時ディレクトリ> --clobber
```

- `version` が今回のバージョンと一致する
- すべての `url` が `/download/$TAG/` を含む（`/latest/` ではない）
- `darwin-aarch64` と `darwin-x86_64` が同じ universal tarball を指す

いずれかを満たさなければ、公開せずに報告する。

すべて満たしたら、**ユーザーに一度だけ確認する**。

> DMG の受け入れ確認（ブラウザからのダウンロード、チェックサム照合、Applications へのインストール、Gatekeeper の確認、主要フローの動作確認）は完了していますか？

これは検出できない唯一の情報なので、必ず聞く。draft の存在とノートの有無だけでは、「確認済みで公開待ち」と「workflow が終わっただけ」が区別できない。

同意を得たら公開する。

```bash
gh release edit "$TAG" --draft=false
```

### 8. 公開後を検証する

公開により `update-homebrew-cask.yml` が起動し、`latest.json` が `releases/latest/download/` から解決可能になる。

```bash
gh run list --workflow=update-homebrew-cask.yml --limit 1
```

success であること。

```bash
curl -sL https://raw.githubusercontent.com/ryonakae/homebrew-tap/main/Casks/sheltie.rb | grep -E "version|sha256"
```

`version` が今回のバージョンで、`sha256` がリリースの `.sha256` の値と一致すること。

```bash
curl -sL https://github.com/ryonakae/sheltie/releases/latest/download/latest.json | head -5
```

今回のバージョンが返ること。**これが updater の配信経路そのものなので、失敗していれば既存ユーザーに更新が届かない。**

最後に、plan が `docs/plans/` に残っていれば `docs/plans/archived/` へ移してコミットする。

検証結果を表にまとめて報告する。
````

- [ ] **Step 3: シンボリックリンクを作る**

```bash
cd /Users/ryo.nakae/Dev/private/sheltie
ln -s ../../.agents/skills/release-sheltie .claude/skills/release-sheltie
```

- [ ] **Step 4: `release-note` を削除する**

```bash
cd /Users/ryo.nakae/Dev/private/sheltie
git rm -r .agents/skills/release-note .claude/skills/release-note
```

- [ ] **Step 5: 構造を検証する**

Run:
```bash
cd /Users/ryo.nakae/Dev/private/sheltie && \
  ls -la .claude/skills/ | grep release && \
  ls .agents/skills/release-sheltie/ .agents/skills/release-sheltie/references/ && \
  head -3 .claude/skills/release-sheltie/references/release-notes.md
```

Expected: `.claude/skills/release-sheltie -> ../../.agents/skills/release-sheltie` のみが表示され、`release-note` は出ないこと。`SKILL.md` と `references/release-notes.md` が存在し、リンク経由で references の中身が読めること。

- [ ] **Step 6: Commit**

```bash
git add .agents/skills/release-sheltie .claude/skills/release-sheltie
git commit -m "feat(skills): replace release-note with a full release-sheltie skill"
```

---

### Task 2: `release.md` から実行手順を移す

**Objective:** 手順の正本をスキルに一本化し、`release.md` を前提知識の正本として残す。

**Files:**
- Modify: `docs/agents/release.md:88-143`

**Interfaces:**
- Consumes: Task 1 のスキル名 `release-sheltie`

- [ ] **Step 1: 2セクションを置換する**

`docs/agents/release.md` の88行目 `## Release procedure` から143行目 `7. Publish the draft release only after these checks pass.` までを、以下に置き換える。144行目の空行と145行目 `## In-app updater` は残す。

```markdown
## Release procedure

Releases are executed with the `/release-sheltie` skill. It detects where the release currently stands and resumes from there, so it can be invoked again after an interruption.

The skill owns everything except the draft acceptance check, which needs a real browser download to exercise macOS quarantine and Gatekeeper:

1. Download the DMG and its checksum file from the draft through a browser.
2. Verify the checksum with `shasum -a 256 -c "Sheltie_<version>_universal.dmg.sha256"`. It must report `OK`.
3. Open the DMG, drag Sheltie to Applications, and launch it from there.
4. Confirm macOS shows the normal first-download confirmation, not an unidentified-developer or malicious-software rejection.
5. Exercise the primary create, save, reopen, and Webview flows.

Tell the skill once these pass; it asks before publishing and cannot detect the answer on its own.

Two rules the skill enforces, kept here because they are contracts rather than steps:

- Release tags must point at commits on `main`. The release workflow does not enforce this; treat it as a hard operational rule.
- The release pull request is merged with a **merge commit**. Squash and rebase both rewrite the commits and make `main` diverge from `develop`.
```

- [ ] **Step 2: 参照の整合性を確認する**

Run:
```bash
cd /Users/ryo.nakae/Dev/private/sheltie && \
  grep -n "release-sheltie" docs/agents/release.md && \
  grep -c "^## " docs/agents/release.md && \
  grep -n "Draft release acceptance\|release-note" docs/agents/release.md || echo "旧セクションと旧スキル参照は削除済み"
```

Expected: `release-sheltie` の参照が1件見つかり、`## ` 見出しが10個（元11個から `Draft release acceptance` が1つ減る）、`Draft release acceptance` と `release-note` は残っていないこと。

- [ ] **Step 3: 手順の重複が無いことを確認する**

Run:
```bash
cd /Users/ryo.nakae/Dev/private/sheltie && \
  grep -n "gh pr merge\|git tag\|npm run typecheck" docs/agents/release.md || echo "実行手順は残っていない"
```

Expected: `実行手順は残っていない` が出ること。これらのコマンドはスキル側にのみ存在する。

- [ ] **Step 4: Commit**

```bash
git add docs/agents/release.md
git commit -m "docs(agents): move the release procedure into the release-sheltie skill"
```

---

### Task 3: 状態検出を実際の状態で確かめる

**Objective:** 検出ロジックが現在の「リリース進行中ではない」状態を正しく判定できることを確認する。

**Files:** なし（動作確認のみ）

**Interfaces:**
- Consumes: Task 1 の判定表

- [ ] **Step 1: 検出コマンドを実行する**

Run:
```bash
cd /Users/ryo.nakae/Dev/private/sheltie && \
  PKG_VERSION="$(node -p "require('./package.json').version")" && \
  TAG="v$PKG_VERSION" && \
  LATEST_TAG="$(git describe --tags --abbrev=0)" && \
  echo "package.json: $PKG_VERSION / latest tag: $LATEST_TAG" && \
  echo "--- tag on remote ---" && \
  (git ls-remote --tags origin "refs/tags/$TAG" | head -1 || true) && \
  echo "--- open release PR ---" && \
  (gh pr list --base main --state open --json number,title --jq '.[]' || echo "none") && \
  echo "--- release ---" && \
  (gh release view "$TAG" --json isDraft --jq '.isDraft' 2>/dev/null || echo "no release")
```

Expected: `package.json: 1.2.0 / latest tag: v1.2.0`。タグはリモートに存在し、open な PR は無く、リリースは `false`（公開済み）。

- [ ] **Step 2: 判定表と突き合わせる**

判定表の最初の行「`$TAG` のリリースが存在し `isDraft` が `false`」に一致する。次の手順は「手順8（公開後検証）。既に公開済みなら、検証結果を報告して終了」。

Step 1 の出力がこの行に一致することを確認する。一致しない場合は判定表の順序を見直す。

- [ ] **Step 3: スキルを起動して検出結果を確認する**

Claude Code で `/release-sheltie` を引数なしで実行する。

Expected: 現在地として「v1.2.0 は公開済み」と報告し、公開後検証（cask workflow、tap の version/sha256、`latest.json` の疎通）を実行して結果を出すこと。バージョン更新や PR 作成に進もうとしないこと。

進もうとした場合は、判定表の順序か検出コマンドを直して再実行する。

- [ ] **Step 4: 修正した場合のみ Commit**

```bash
git add .agents/skills/release-sheltie/SKILL.md
git commit -m "fix(skills): correct the release-sheltie state detection order"
```

## Validation

- `npm run lint` — 指摘なし
- `npm run format` — `All matched files use Prettier code style!`（`*.md` は `.prettierignore` 対象なので今回の変更は対象外）
- Task 2 Step 3 で、`release.md` に実行コマンドが残っていないこと
- Task 3 で、状態検出が「公開済み」を正しく判定すること
- 次回リリースでの実運用。ここが本当の検証で、今回のサイクルでは確認できない。特に未検証なのは、手順1〜5（バージョン決定・更新・PR・マージ・タグ・workflow 待ち）と、draft 本文が `Release notes pending.` で始まる場合の無確認反映

## Risks, Tradeoffs, and Open Questions

- **確認が2回になる。** dig の Q3 では「公開直前の1回だけ」と決めたが、バージョン番号の決定にも同意が要る。semver は「この feat は破壊的か」という文脈依存の判断を含み、コミット種別だけでは決まらないため。Q3 は不可逆な操作へのゲートについての決定であり、バージョン決定は入力の取得なので矛盾はしないが、体感の手数は2回になる。
- **手順4がマージとタグ push を無確認で行う。** CI の pass を前提条件として検出できるため確認を省いたが、`main` の履歴とタグは事実上取り消しにくい。CI が pass していても内容が不適切なリリース PR は止められない。リリース PR の内容確認は手順3で人間の目に触れる想定だが、スキルは同意を求めない。
- **状態検出は判定表の順序に依存する。** 上から順に評価するため、行の順序を入れ替えると挙動が変わる。特に「draft が存在」の2行は本文の中身で分岐するので、順序と条件をセットで維持する必要がある。
- **`Release notes pending.` の文字列が3箇所に散る。** `release.yml`、SKILL.md の判定表、SKILL.md の手順6。CI と手元スキルという別プロセス間の契約であり共有できる定数の置き場所が無い。文言を変えるときは3箇所すべてを直す。
- **`release.md` の読むタイミング列は変更しない。** 手順が出ていっても、スキルが artifact contract を参照するため「リリース実行時」は正しいまま。ただし手順の大半がスキル側になったので、実際に読まれる頻度は下がる。
- **未解決:** 手順5の Release workflow 待ちは10分程度かかる。スキルが待つ間、セッションを占有するか一度終了して再開を促すかを決めていない。実運用では Monitor で待つのが自然だが、待機中に別セッションへ移ることもあり得る。状態検出があるので再開自体は可能であり、実際の運用で不便が出てから決めればよい。
