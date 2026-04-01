#!/bin/bash
# Run this script manually to push to public repo (dist-only)
# Usage: bash push-public.sh

set -euo pipefail
cd "$(dirname "$0")"

echo "Building..."
bun run build:all

echo ""
echo "Staging built files..."
git add -f dist/
git add .gitignore .npmignore .github/ README.md CHANGELOG.md LICENSE package.json bun.lock

echo ""
echo "Commit..."
git commit -m "chore: update build output v$(node -p 'require(\"./package.json\").version')" || echo "Nothing to commit"

echo ""
echo "Pushing to public (origin)..."
git push origin main

echo ""
echo "Done! Public repo updated (dist-only, no source code)."
