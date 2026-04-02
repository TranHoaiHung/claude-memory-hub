#!/bin/bash
# Push to public repo (dist-only). If version changed, npm publish triggers automatically.
# Usage: bash push-public.sh

set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./package.json').version")

echo "=== claude-memory-hub v${VERSION} ==="
echo ""

echo "1. Building..."
bun run build:all

echo ""
echo "2. Running tests..."
bun test

echo ""
echo "3. Type checking..."
npx tsc --noEmit

echo ""
echo "4. Staging built files..."
git add -f dist/
git add .gitignore .npmignore .github/ README.md CHANGELOG.md LICENSE package.json bun.lock

echo ""
echo "5. Commit..."
git commit -m "chore: release v${VERSION}" || echo "Nothing to commit"

echo ""
echo "6. Pushing to public (origin)..."
git push origin main

echo ""
echo "========================================="
echo "Done! Pushed to origin/main."
echo ""
echo "If version changed in package.json:"
echo "  → GitHub Actions will auto-publish to npm"
echo "  → GitHub Release will be created automatically"
echo ""
echo "Monitor: https://github.com/TranHoaiHung/claude-memory-hub/actions"
echo "========================================="
