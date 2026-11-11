#!/bin/sh
# Compares the CLI's compile of Literature & Latte's user manual with Scrivener's own.
#
#   scripts/compare-ll-manual.sh <work folder>
#
# Downloads the manual's source project into the work folder, waits while you compile it in
# Scrivener, then compiles the same copy with the CLI and compares the two.  The manual's licence
# does not allow redistribution, so keep the work folder outside the repository: nothing from it
# is ever committed.
set -eu

SOURCE_URL='https://www.literatureandlatte.com/docs/scrivener_3-user_manual_source.zip'
PROJECT_NAME='Scrivener 3 - User Manual.scriv'
FORMAT='User Manual (Mac LaTeX)'

if [ $# -ne 1 ]; then
  echo "usage: $0 <work folder outside the repository>" >&2
  exit 2
fi
work=$(mkdir -p "$1" && cd "$1" && pwd -P)
package=$(cd "$(dirname "$0")/.." && pwd -P)
case "$work/" in
  "$(git -C "$package" rev-parse --show-toplevel)/"*)
    echo "The work folder must be outside the repository." >&2
    exit 2
    ;;
esac

rm -rf "$work/source" "$work/source.zip"
curl --fail --location --silent --show-error --output "$work/source.zip" "$SOURCE_URL"
mkdir "$work/source"
unzip -q "$work/source.zip" -d "$work/source"
project=$(find "$work/source" -type d -name "$PROJECT_NAME" | head -n 1)
if [ -z "$project" ]; then
  echo "The download has no \"$PROJECT_NAME\"." >&2
  exit 1
fi
expected="$work/scrivener.md"
actual="$work/scriv-tools.md"
rm -f "$expected" "$actual"

cat <<INSTRUCTIONS

Compile the manual in Scrivener:
  1. Open $project
  2. File > Compile, with the format "$FORMAT", compiling for MultiMarkdown.
  3. Save the output as $expected
  4. Close the project, then press Return here.
INSTRUCTIONS
read -r _
if [ ! -f "$expected" ]; then
  echo "No compile at $expected." >&2
  exit 1
fi

# Same copy Scrivener compiled (it saves the project when compiling), on the same day.
node "$package/src/cli.ts" compile "$project" --format "$FORMAT" --output "$actual"
if cmp -s "$expected" "$actual"; then
  echo "The CLI's compile matches Scrivener's byte for byte."
else
  echo "The compiles differ (first differences below; full diff: diff -u \"$expected\" \"$actual\")."
  diff -u "$expected" "$actual" | head -n 60
  exit 1
fi
