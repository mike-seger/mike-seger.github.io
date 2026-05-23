#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/push-site-changes.sh [commit message]
#
# Default commit message matches the original one-liner.
commit_message="${1:-added screenshot}"

for d in sites/*; do
  [[ -d "$d" ]] || continue

  # Skip folders that are not Git work trees.
  git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue

  # Skip repositories with no tracked or untracked changes.
  if [[ -z "$(git -C "$d" status --porcelain)" ]]; then
    continue
  fi

  printf '\n=== %s ===\n' "$d"
  git -C "$d" status --short

  read -r -p "Run git add/commit/push here? (y/N) " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    git -C "$d" add --all
    git -C "$d" commit -m "$commit_message"
    git -C "$d" push
  fi
done
