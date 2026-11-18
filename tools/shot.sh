#!/usr/bin/env bash
# Screenshot a page of the local dev server: tools/shot.sh <path> <out.png> [width] [height] [dark]
set -euo pipefail
export FONTCONFIG_FILE="$(cd "$(dirname "$0")/.." && pwd)/.cache/fonts.conf"
url="http://127.0.0.1:8080$1"; out="$2"; w="${3:-1280}"; h="${4:-2400}"
extra=()
[[ "${5:-}" == dark ]] && extra+=(--force-dark-mode --blink-settings=preferredColorScheme=0)
chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=5000 \
  "${extra[@]}" --window-size="$w,$h" --screenshot="$out" "$url" 2>/dev/null
