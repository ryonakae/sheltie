#!/bin/bash
# .husky/doc-updater.sh
# 人間の手動コミットやエージェント生成コードの修正後コミット時に
# ドキュメントの自動更新を行うgit hookスクリプト
#
# husky v9 環境での使い方:
#   .husky/pre-commit から `sh .husky/doc-updater.sh` で呼び出す

set -euo pipefail

# doc-updaterが自身を再帰的に呼ばないためのガード
if [ "${DOC_UPDATER_RUNNING:-}" = "1" ]; then
  exit 0
fi

# --- ステージされたファイルの確認 ---
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMRD 2>/dev/null || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# --- claude CLIの存在確認 ---
if ! command -v claude &> /dev/null; then
  echo "[doc-updater] claude CLI が見つかりません。ドキュメント更新をスキップします。"
  exit 0
fi

# --- doc-updater サブエージェント実行 ---
echo "[doc-updater] コード変更を検出しました。ドキュメントの更新を確認中..."

STAGED_LIST=$(echo "$STAGED_FILES" | tr '\n' ', ' | sed 's/,$//')

# リネーム・削除されたファイルの情報を収集
RENAMED_FILES=$(git diff --cached --diff-filter=R --name-status 2>/dev/null || true)
DELETED_FILES=$(git diff --cached --diff-filter=D --name-only 2>/dev/null || true)

RENAME_CTX=""
if [ -n "$RENAMED_FILES" ]; then
  RENAME_CTX="リネームされたファイル: ${RENAMED_FILES}. "
fi
if [ -n "$DELETED_FILES" ]; then
  RENAME_CTX="${RENAME_CTX}削除されたファイル: $(echo "$DELETED_FILES" | tr '\n' ', ' | sed 's/,$//').  "
fi

export DOC_UPDATER_RUNNING=1
# Claude Code セッション内での実行（recursive）を避けるため、環境変数をチェック
if [ -z "${CLAUDECODE:-}" ]; then
  claude --agent doc-updater \
    -p "git pre-commitフックから呼び出されています。ステージされたファイル: ${STAGED_LIST}。${RENAME_CTX}git diff --cached の内容を確認し、必要に応じてドキュメントを更新してください。リネーム・削除がある場合はドキュメント内のパス参照も更新してください。更新した場合は git add で更新ファイルをステージしてください。" \
    --allowedTools 'Read,Write,Edit,Bash(git diff*),Bash(git add*),Grep,Glob' \
    2>&1 | tail -5
else
  echo "[doc-updater] Claude Code セッション内での実行のため、ドキュメント更新はスキップします。"
fi

echo "[doc-updater] ドキュメント確認完了。"

exit 0
