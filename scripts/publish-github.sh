#!/usr/bin/env bash
# Publish a lab-stripped tree to the github remote.
#
# Uses this worktree's .git → common object DB (safe with multiple locals).
# GitLab / origin is never touched.
#
# Usage:
#   ./scripts/publish-github.sh [rev]
#   FORCE=1 ./scripts/publish-github.sh   # allow non-fast-forward
#
# Env:
#   GITHUB_REMOTE  remote name (default: github)
#   GITHUB_BRANCH  branch on that remote (default: main)
#   FORCE          set to 1 to force-push
set -euo pipefail

REMOTE="${GITHUB_REMOTE:-github}"
BRANCH="${GITHUB_BRANCH:-main}"
SRC=$(git rev-parse "${1:-HEAD}")

EXCLUDE=(
	.gitlab-ci.yml
	security
	scripts/install-ca-certs.sh
)

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
	echo "Remote '$REMOTE' is not configured." >&2
	echo "From any liro worktree:" >&2
	echo "  git remote add $REMOTE git@github.com:<you>/liro.git" >&2
	exit 1
fi

# Scratch index only — objects/remotes stay in the shared .git
TMP_INDEX=$(mktemp)
trap 'rm -f "$TMP_INDEX"' EXIT
export GIT_INDEX_FILE="$TMP_INDEX"

git read-tree "$SRC"
for p in "${EXCLUDE[@]}"; do
	git rm -r --cached -q --ignore-unmatch -- "$p"
done
TREE=$(git write-tree)

git fetch "$REMOTE" "$BRANCH" 2>/dev/null || true
PARENT=$(git rev-parse -q --verify "refs/remotes/$REMOTE/$BRANCH" || true)

SHORT=$(git rev-parse --short "$SRC")
MSG="publish ${SHORT}

Source-Commit: ${SRC}"

if [ -n "${PARENT:-}" ]; then
	NEW=$(git commit-tree "$TREE" -p "$PARENT" -m "$MSG")
else
	NEW=$(git commit-tree "$TREE" -m "$MSG")
fi

git update-ref "refs/github/publish" "$NEW"

PUSH_ARGS=( "$REMOTE" "$NEW:refs/heads/$BRANCH" )
if [ "${FORCE:-0}" = "1" ]; then
	PUSH_ARGS=( --force "${PUSH_ARGS[@]}" )
fi

git push "${PUSH_ARGS[@]}"
echo "Pushed $(git rev-parse --short "$NEW") → $REMOTE/$BRANCH (source $SHORT)"
