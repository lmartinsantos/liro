#!/usr/bin/env bash
# Extract the Keep-a-Changelog section for a version (e.g. 0.1.0).
# Usage: ./scripts/changelog-section.sh 0.1.0
set -euo pipefail

ver="${1:?version required (e.g. 0.1.0)}"
file="${2:-CHANGELOG.md}"

awk -v ver="$ver" '
  BEGIN { p = 0 }
  $0 ~ ("^## \\[" ver "\\]") { p = 1; print; next }
  p && /^## \[/ { exit }
  p { print }
' "$file"
