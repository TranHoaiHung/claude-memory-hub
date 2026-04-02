#!/bin/bash
# Run this script manually to push full source to private repo
# Usage: bash push-private.sh

set -euo pipefail
cd "$(dirname "$0")"

echo "Pushing full source to private (private remote)..."

VERSION=$(node -p "require('./package.json').version")

# Backup source directories (git checkout will delete untracked files)
BACKUP_DIR=$(mktemp -d)
echo "  Backing up source to $BACKUP_DIR..."
cp -R src/ "$BACKUP_DIR/src/" 2>/dev/null || true
cp -R hooks/ "$BACKUP_DIR/hooks/" 2>/dev/null || true
cp -R tests/ "$BACKUP_DIR/tests/" 2>/dev/null || true
cp -R plans/ "$BACKUP_DIR/plans/" 2>/dev/null || true
cp tsconfig.json "$BACKUP_DIR/" 2>/dev/null || true
cp install.sh "$BACKUP_DIR/" 2>/dev/null || true

# Create a temporary branch with ALL files
TEMP_BRANCH="private-sync-$(date +%s)"
git stash 2>/dev/null || true
git checkout -b "$TEMP_BRANCH"

# Force add source files
git add -f src/ hooks/ tests/ plans/ tsconfig.json install.sh 2>/dev/null || true
git add -f .claude/ 2>/dev/null || true
git add -f dist/ .github/ README.md CHANGELOG.md LICENSE package.json bun.lock .gitignore .npmignore assets/ push-private.sh push-public.sh

git commit -m "sync: full source v${VERSION}" || echo "Nothing to commit"

# Push temp branch as main to private
git push private "$TEMP_BRANCH":main --force

# Cleanup: go back to main
git checkout main
git branch -D "$TEMP_BRANCH"
git stash pop 2>/dev/null || true

# Restore source from backup
echo "  Restoring source..."
cp -R "$BACKUP_DIR/src/" src/ 2>/dev/null || true
cp -R "$BACKUP_DIR/hooks/" hooks/ 2>/dev/null || true
cp -R "$BACKUP_DIR/tests/" tests/ 2>/dev/null || true
cp -R "$BACKUP_DIR/plans/" plans/ 2>/dev/null || true
cp "$BACKUP_DIR/tsconfig.json" . 2>/dev/null || true
cp "$BACKUP_DIR/install.sh" . 2>/dev/null || true
rm -rf "$BACKUP_DIR"

echo ""
echo "Done! Private repo updated (full source). Source preserved locally."
