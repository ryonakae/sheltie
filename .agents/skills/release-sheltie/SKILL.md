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
