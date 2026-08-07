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
