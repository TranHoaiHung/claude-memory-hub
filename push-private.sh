#!/bin/bash
# Run this script manually to push full source to private repo
# Usage: bash push-private.sh

set -euo pipefail
cd "$(dirname "$0")"

echo "Pushing full source to private (private remote)..."

# Temporarily track source files for private push
git stash 2>/dev/null || true

# Create a temporary branch with ALL files
TEMP_BRANCH="private-sync-$(date +%s)"
git checkout -b "$TEMP_BRANCH"

# Force add source files
git add -f src/ hooks/ tsconfig.json install.sh .claude/
git add -f dist/ .github/ README.md CHANGELOG.md LICENSE package.json bun.lock .gitignore .npmignore

git commit -m "sync: full source v$(node -p 'require("./package.json").version')" || echo "Nothing to commit"

# Push temp branch as main to private
git push private "$TEMP_BRANCH":main --force

# Cleanup: go back to main
git checkout main
git branch -D "$TEMP_BRANCH"
git stash pop 2>/dev/null || true

echo ""
echo "Done! Private repo updated (full source)."
