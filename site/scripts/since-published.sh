#!/bin/sh
# What changed on main since the site and its video were published: each gh-pages commit says
# "The site, from <main's commit>", so the last one is when the page was published, and the last
# one that changed the video is when it was recorded.
#
#   ./scripts/since-published.sh            the two baselines, and main's commits since the older
#   ./scripts/since-published.sh --stat     with each commit's files
set -eu
cd "$(dirname "$0")/.."
repo="$(git rev-parse --show-toplevel)"
git -C "$repo" fetch -q origin gh-pages main 2>/dev/null || true

from() { git -C "$repo" log -1 --format=%s "$1" | sed -n 's/^The site, from \([0-9a-f]*\).*/\1/p'; }
page_commit="$(git -C "$repo" log -1 --format=%H origin/gh-pages)"
video_commit="$(git -C "$repo" log -1 --format=%H origin/gh-pages -- luminous-money.mp4)"
page="$(from "$page_commit")"
video="$(from "$video_commit")"

show() { echo "$1: published $(git -C "$repo" log -1 --format=%ad --date=short "$2"), from main's $3 ($(git -C "$repo" log -1 --format='%ad: %s' --date=short "$3"))"; }
show "The page " "$page_commit" "$page"
show "The video" "$video_commit" "$video"
echo

# The older baseline covers both
base="$page"
if git -C "$repo" merge-base --is-ancestor "$video" "$page" 2>/dev/null; then base="$video"; fi
echo "main since $base (newest first):"
if [ "${1:-}" = "--stat" ]; then
  git -C "$repo" log --format='%n%h %ad %s' --date=short --stat=100 "$base..origin/main"
else
  git -C "$repo" log --format='%h %ad %s' --date=short "$base..origin/main"
fi
echo
# The working tree, so what's being changed now counts too
echo "site/ changed since the page: $(git -C "$repo" diff --stat "$page" -- site | tail -1)"
echo "site/ changed since the video: $(git -C "$repo" diff --stat "$video" -- site | tail -1)"
