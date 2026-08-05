# main 経由リリースフロー導入 Implementation Plan

> **For implementers:** Execute this plan task-by-task. Complete each checkbox step, run the listed validation, and commit after each task.

**Goal:** リリース時に develop→main の PR マージを挟むフローへ移行する。main 向け PR の検証 CI を新設し、main にブランチ保護を設定し、リリース手順書を更新し、develop→main の初回同期 PR をマージする。

**Architecture:** リリースビルドの起点は現行どおり `v*` タグ push（`release.yml` は変更しない）。その手前に「develop でバージョン bump → develop→main PR → merge commit でマージ → main のコミットにタグ」という運用を差し込む。PR 検証は JS 系チェックのみを ubuntu で回す新 workflow が担い、Rust の検証はタグ push 後のリリースビルド自体に委ねる。

**Tech Stack:** GitHub Actions（ubuntu-latest / Node.js 22 / npm）、GitHub Rulesets API（`gh api`）、既存の npm scripts（lint / format / typecheck / test）。

## Global Constraints

- `release.yml` のトリガー（`on: push: tags: v*`）と内容は変更しない。「タグは main のコミットに打つ」は CI で強制せず運用ルールとして文書化する（dig で決定済み）。
- PR 検証 CI は ubuntu-latest のみ。macOS ランナーは使わない（private リポジトリの分単価 10 倍を回避）。
- develop→main の PR は必ず **merge commit** でマージする。squash / rebase は main と develop の履歴を分岐させるため禁止。
- GitHub Actions の action は `release.yml` と同じ SHA ピン留めを使う: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7)、`actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38` (v6)。
- 進行中の v1.0.0 リリースは現行フローのまま完了させる。初回同期 PR のマージは v1.0.0 の draft release を publish した後に行う。
- コミットメッセージは既存の Conventional Commits 形式（`ci:` / `docs(agents):` など）。`docs/agents` の更新は対応する変更と同じコミットに含める（CLAUDE.md のドキュメント更新ルール）。

## Current Context

- default branch は `develop`。`origin/main` は Initial commit（`7dfc07b`）のまま 242 コミット遅れており、main を先行させるコミットは無い（fast-forward 可能な関係）。
- `.github/workflows/` には `release.yml` のみ。PR 向け CI は存在しない。
- リポジトリは private。merge 設定は merge commit / squash / rebase すべて許可済み（確認済み）。
- `docs/agents/release.md` の「Release procedure」は現在 7 ステップで、develop 上でタグを打つ前提の記述になっている。
- ブランチ保護 / Rulesets は未設定。**private リポジトリの Rulesets は有料プラン（GitHub Pro 以上）が必要な可能性があり、アカウントプランは未確認**（Task 3 で試行し、拒否されたらフォールバックする）。
- 検証コマンド: `npm run lint` / `npm run format` / `npm run typecheck` / `npm run test`（`package.json` で定義済み。Node.js は engines で 22.14.0）。

## File Structure

- Create: `.github/workflows/ci.yml` — main 向け PR の JS 系検証（job 名 `verify`。この名前がブランチ保護の required status check の context になる）
- Modify: `docs/agents/release.md` — 「Release procedure」を develop→main PR 経由の手順に書き換え、タグ位置の運用ルールを明記
- Test: なし（CI 設定と手順書のため、検証は PR 上での workflow 実行と `gh` コマンドの出力確認で行う）

## Tasks

### Task 1: PR 検証 CI の新設と release.md の手順更新

**Objective:** main 向け PR で JS 系チェックが自動実行されるようにし、リリース手順書を新フローに一致させる（1 コミット）。

**Files:**

- Create: `.github/workflows/ci.yml`
- Modify: `docs/agents/release.md`（「Release procedure」セクション）

**Interfaces:**

- Produces: status check context `verify`（Task 3 の required_status_checks が参照）、新リリース手順（Task 2 の PR 運用が従う）

- [ ] **Step 1: `.github/workflows/ci.yml` を作成する**

```yaml
name: CI

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Check out pull request
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false

      - name: Set up Node.js
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Check formatting
        run: npm run format

      - name: Type check
        run: npm run typecheck

      - name: Test
        run: npm run test
```

- [ ] **Step 2: `docs/agents/release.md` の「Release procedure」を次の内容に置き換える**

現在のステップ 3〜4（"Commit and push the release changes." / "Create and push the matching tag"）を、以下のステップ 3〜6 に置き換える（ステップ 1〜2 は変更なし。旧ステップ 5〜7 は 7〜9 に繰り下げ）:

````markdown
3. Commit and push the release changes to `develop`.
4. Open a pull request from `develop` into `main` titled `release: v<version>` and wait for the `CI` workflow to pass.
5. Merge the pull request with a **merge commit**. Never squash or rebase this pull request; both rewrite the commits and make `main` diverge from `develop`.
6. Tag the merge commit on `main` and push the tag:

```bash
VERSION='1.0.0'
git fetch origin main
git tag "v$VERSION" origin/main
git push origin "v$VERSION"
```

For version `1.0.0`, the tag is `v1.0.0`.

> Rule: release tags must point at commits on `main`. The release workflow does not enforce this; treat it as a hard operational rule.

7. Wait for the **Release macOS** workflow to finish.
8. Open the generated draft GitHub Release and edit the generated notes as needed. Release notes are written in English. The generated "What's Changed" list may contain Japanese pull request titles; rewrite the entries that matter to release readers.
9. Complete the acceptance checks below before publishing.
````

- [ ] **Step 3: フォーマットを検証する**

Run: `npx prettier --check .github/workflows/ci.yml docs/agents/release.md`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/agents/release.md
git commit -m "ci: verify frontend checks on pull requests into main"
```

### Task 2: develop の push と初回同期 PR の作成・マージ

**Objective:** 新フローの構成物を develop に載せたうえで、main を develop に追いつかせる初回 PR をマージし、CI が main 向け PR で動くことを実地確認する。

**前提:** v1.0.0 の draft release が publish 済みであること（進行中のリリースを現行フローで完了させる決定のため）。

**Files:** なし（git / GitHub 操作のみ）

**Interfaces:**

- Consumes: Task 1 の `ci.yml`（PR 上で `verify` check が走る）
- Produces: develop と同期した `main`（Task 3 の保護対象）、check context `verify` の実行実績

- [ ] **Step 1: develop を push する**

```bash
git push origin develop
```

- [ ] **Step 2: 初回同期 PR を作成する**

```bash
gh pr create --base main --head develop \
  --title "release: sync main with develop (v1.0.0)" \
  --body "$(cat <<'EOF'
Initial synchronization of main with develop as part of the new release flow.
From the next release on, every release goes through a develop -> main pull request before tagging.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: CI の完走を確認する**

Run: `gh pr checks --watch`
Expected: `verify` が pass（4 チェックコマンドすべて成功）

- [ ] **Step 4: merge commit でマージする**

```bash
gh pr merge --merge
```

Expected: マージ成功。`git fetch origin && git rev-list --count origin/develop..origin/main` が `1`（マージコミット分だけ main が先行。develop に取り込む必要はなく、次回リリース PR で解消される）

### Task 3: main のブランチ保護（Ruleset）を設定する

**Objective:** main への直 push を禁止し、PR（承認 0 件・merge commit のみ）と `verify` check のパスをマージ条件にする。

**Files:** なし（GitHub API 操作のみ）

**Interfaces:**

- Consumes: Task 1 の check context `verify`、Task 2 で同期済みの `main`

- [ ] **Step 1: Ruleset を作成する**

```bash
gh api repos/ryonakae/sheltie/rulesets -X POST --input - <<'JSON'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "verify" }]
      }
    }
  ],
  "bypass_actors": []
}
JSON
```

Expected: HTTP 201 で ruleset の JSON が返る。

**フォールバック:** 402/403 で "Upgrade to GitHub Pro"（またはプラン起因のエラー）が返った場合、private リポジトリの Rulesets が現行プランで使えないことを意味する。その場合はこの Task をスキップし、保護なしの運用ルールのみで運用する（ユーザーへ報告し、`docs/agents/release.md` の Rule 表記がその代替であることを確認する）。

- [ ] **Step 2: 設定を確認する**

Run: `gh api repos/ryonakae/sheltie/rulesets --jq '.[] | {name, enforcement}'`
Expected: `{"name":"protect-main","enforcement":"active"}`

Run: `git push origin HEAD:main`（develop の先頭を直 push で送ろうとする）
Expected: `Ruleset violations` を含むエラーで拒否される（保護の実効性確認）。拒否されたことを確認したらそれ以上は何もしない。

## Validation

- `gh pr checks <初回同期PR>` — `verify` が success
- `gh api repos/ryonakae/sheltie/rulesets --jq 'length'` — `1`（フォールバック時は 0 で、その旨を報告済みであること）
- `git rev-list --count origin/main..origin/develop` — `0`（同期直後。以後 develop が先行していく）
- 手動確認: 次回リリース（v1.0.1 以降）を `docs/agents/release.md` の新手順どおりに実施し、develop→main PR → merge commit → main 上のタグ → draft release 作成まで通ること

## Risks, Tradeoffs, and Open Questions

- **Rulesets のプラン制約:** private リポジトリの Rulesets / ブランチ保護は無料プランでは使えない可能性がある。Task 3 のフォールバック（運用ルールのみ）で吸収する。リポジトリを public 化した時点で Task 3 を再実行すればよい。
- **タグ位置は非強制:** develop のコミットにタグを打ってもリリースビルドは走る（dig で「運用ルールのみ」と決定済み）。release.md の Rule 表記が唯一の歯止め。
- **PR CI は JS のみ:** Rust の壊れはタグ push 後のリリースビルドで初めて検出される。失敗した場合はタグを打ち直す手間が生じるが、macOS ランナーのコストとのトレードオフとして許容（dig で決定済み）。
- **main が常にマージコミット 1 個分先行する:** merge commit 運用の帰結。次回リリース PR に前回のマージコミットが含まれるだけで実害はない。develop への back-merge は行わない。
- **`ci.yml` の trigger は main 向け PR のみ:** develop への日常 push では CI が走らない（現行運用の維持）。将来 develop でも回したくなったら `on.pull_request.branches` に develop を足すだけでよい。
