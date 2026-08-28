#!/usr/bin/env bash
# Bake shaders/shiny.frag → shaders/shiny.frag.qsb for Qt 6 ShaderEffect.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
src="$root/shaders/shiny.frag"
out="$root/shaders/shiny.frag.qsb"

if [[ -n "${QSB:-}" ]]; then
  qsb="$QSB"
elif command -v qsb >/dev/null 2>&1; then
  qsb=$(command -v qsb)
elif [[ -x /usr/lib/qt6/bin/qsb ]]; then
  qsb=/usr/lib/qt6/bin/qsb
else
  echo "qsb not found (qt6-shadertools). Set QSB= or put qsb on PATH." >&2
  exit 1
fi

if [[ ! -f "$src" ]]; then
  echo "missing $src" >&2
  exit 1
fi

"$qsb" --glsl "100es,120,150" --hlsl 50 --msl 12 -o "$out" "$src"
echo "baked $out"

if [[ "${1:-}" == "--dump" || "${1:-}" == "-d" ]]; then
  "$qsb" -d "$out"
fi
