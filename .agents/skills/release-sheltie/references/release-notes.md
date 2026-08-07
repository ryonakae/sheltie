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
