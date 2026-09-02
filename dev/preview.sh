#!/usr/bin/env bash
# Standalone Quickshell window with ShinyBorder on mock cards.
# Does not load into omarchy-shell and does not patch ~/.config.
#
#   mise run preview
#   SHINY_SMOKE=1 mise run smoke
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
entry="$root/preview.qml"

if [[ ! -f "$entry" ]]; then
  echo "missing $entry" >&2
  exit 1
fi

if [[ ! -f "$root/shaders/shiny.frag.qsb" ]]; then
  echo "missing shaders/shiny.frag.qsb — run: mise run bake" >&2
  exit 1
fi

if command -v qs >/dev/null 2>&1; then
  qsbin=$(command -v qs)
elif command -v quickshell >/dev/null 2>&1; then
  qsbin=$(command -v quickshell)
else
  echo "qs/quickshell not found" >&2
  exit 1
fi

smoke="${SHINY_SMOKE:-}"
case "${smoke,,}" in
  1|true|yes) smoke=1 ;;
  *) smoke= ;;
esac

# Same ShellId as preview.qml. Refuse a second copy so smoke does not
# stack on a live preview (and so mise run preview is idempotent).
if "$qsbin" list -p "$entry" --any-display -j 2>/dev/null | grep -q '"pid"'; then
  echo "qs-shiny-border preview is already running; close that window first." >&2
  exit 1
fi

if [[ -n "$smoke" ]]; then
  echo "qs-shiny-border smoke: short-lived qs window, fail if the shader errors"
else
  echo "qs-shiny-border preview: standalone qs window (not omarchy-shell)"
  echo "close the window, Esc/q, or Ctrl-C"
fi

args=(-p "$entry")
if [[ -n "$smoke" ]]; then
  args+=(-v)
else
  args+=(-n)
fi

exec "$qsbin" "${args[@]}"
