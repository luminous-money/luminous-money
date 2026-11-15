#!/bin/sh
# Publish the site to GitHub Pages: build it, then replace the gh-pages branch's contents with
# dist/ (in a throwaway worktree, so the working tree is untouched), commit and push.
#
#   ./scripts/publish.sh            build and publish
#   ./scripts/publish.sh --no-push  build and commit to gh-pages, without pushing
#
# The video (public/luminous-money.mp4) is recorded separately: node scripts/record.mjs, against
# `npm run build && npx vite preview`.
set -eu
cd "$(dirname "$0")/.."
repo="$(git rev-parse --show-toplevel)"
# The video and poster aren't kept on main: take the published ones unless new ones were recorded
for f in luminous-money.mp4 poster.jpg; do
  if [ ! -f "public/$f" ]; then
    git -C "$repo" fetch -q origin gh-pages 2>/dev/null || true
    git -C "$repo" show "origin/gh-pages:$f" > "public/$f" 2>/dev/null || { rm -f "public/$f"; echo "public/$f is missing: record it (node scripts/record.mjs)" >&2; exit 1; }
  fi
done
npm run build
tree="$(mktemp -d)"
trap 'git -C "$repo" worktree remove --force "$tree" 2>/dev/null || true' EXIT
if git -C "$repo" show-ref --verify --quiet refs/heads/gh-pages; then
  git -C "$repo" worktree add "$tree" gh-pages
elif git -C "$repo" ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  git -C "$repo" fetch origin gh-pages:gh-pages
  git -C "$repo" worktree add "$tree" gh-pages
else
  git -C "$repo" worktree add --detach "$tree"
  git -C "$tree" checkout --orphan gh-pages
fi
git -C "$tree" rm -rfq . 2>/dev/null || true
cp -R dist/. "$tree/"
touch "$tree/.nojekyll"
git -C "$tree" add -A
if git -C "$tree" diff --cached --quiet; then
  echo "gh-pages is already up to date"
else
  git -C "$tree" commit -qm "The site, from $(git -C "$repo" rev-parse --short HEAD)"
  echo "Committed to gh-pages"
fi
if [ "${1:-}" != "--no-push" ]; then git -C "$tree" push origin gh-pages; fi
