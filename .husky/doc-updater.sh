#!/bin/bash
# .husky/doc-updater.sh
# 人間の手動コミットやエージェント生成コードの修正後コミット時に
# ドキュメントの自動更新を行うgit hookスクリプト
#
# husky v9 環境での使い方:
#   .husky/pre-commit から `sh .husky/doc-updater.sh` で呼び出す

set -euo pipefail

# --- スキップ条件の確認 ---
# doc-updater の再帰防止 + commit-push スキル等で既に doc-updater 実行済みの場合のスキップ
if [ "${SKIP_DOC_UPDATER:-}" = "1" ]; then
  echo "[doc-updater] SKIP_DOC_UPDATER が設定済みのため、ドキュメント更新をスキップします。"
  exit 0
fi

# --- Claude CLI の存在確認 ---
if ! command -v claude &> /dev/null; then
  echo "[doc-updater] Claude CLI が見つかりません。ドキュメント更新をスキップします。"
  exit 0
fi

# --- ステージされたファイルの確認 ---
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMRD 2>/dev/null || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# --- doc-updater サブエージェントの実行 ---
echo "[doc-updater] コード変更を検出しました。ドキュメントの更新を確認中..."

STAGED_LIST=$(echo "$STAGED_FILES" | tr '\n' ', ' | sed 's/,$//')

# --- リネーム・削除されたファイルの情報収集 ---
RENAMED_FILES=$(git diff --cached --diff-filter=R --name-status 2>/dev/null || true)
DELETED_FILES=$(git diff --cached --diff-filter=D --name-only 2>/dev/null || true)

RENAME_CTX=""
if [ -n "$RENAMED_FILES" ]; then
  RENAME_CTX="リネームされたファイル: ${RENAMED_FILES}. "
fi
if [ -n "$DELETED_FILES" ]; then
  RENAME_CTX="${RENAME_CTX}削除されたファイル: $(echo "$DELETED_FILES" | tr '\n' ', ' | sed 's/,$//').  "
fi

export SKIP_DOC_UPDATER=1
claude --agent doc-updater --model haiku \
  -p "git pre-commitフックから呼び出されています。ステージされたファイル: ${STAGED_LIST}。${RENAME_CTX}git diff --cached の内容を確認し、必要に応じてドキュメントを更新してください。リネーム・削除がある場合はドキュメント内のパス参照も更新してください。更新した場合は git add で更新ファイルをステージしてください。" \
  --allowedTools 'Read,Write,Edit,Bash(git diff*),Bash(git add*),Bash(find *),Bash(head *),Bash(wc *),Bash(ls *),Grep,Glob' \
  2>&1 | tail -5

echo "[doc-updater] ドキュメント確認完了。"

exit 0
