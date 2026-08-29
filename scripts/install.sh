#!/usr/bin/env bash
# Dev helper: copy this tree into ~/.config/omarchy/plugins/wmfeht.border-fx
# and enable it. User path is `omarchy plugin add <git-url> --enable`.
# Does not patch /usr/share/omarchy. Does not use sudo.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=paths.sh
source "$root/scripts/paths.sh"
dest="${OMARCHY_PLUGIN_DIR:-$HOME/.config/omarchy/plugins/$PLUGIN_ID}"

if [[ ! -f "$root/shaders/shiny.frag.qsb" ]]; then
  echo "missing shaders/shiny.frag.qsb — run: mise run bake" >&2
  exit 1
fi

dest_abs=$(realpath -m "$dest")
root_abs=$(realpath "$root")
if [[ "$dest_abs" == "$root_abs" ]]; then
  echo "refusing to install over the source tree ($dest)" >&2
  exit 1
fi

mkdir -p "$dest/qml" "$dest/shaders" "$dest/scripts" "$dest/hypr/src"
cp -f "$root/manifest.json" "$root/Service.qml" "$dest/"
cp -f "$root/qml/"*.qml "$root/qml/"*.js "$dest/qml/"
cp -f "$root/shaders/shiny.frag.qsb" "$dest/shaders/"
cp -f "$root/scripts/paths.sh" \
      "$root/scripts/hypr-session.sh" \
      "$root/scripts/look-apply.sh" \
      "$root/scripts/hypr-ensure.sh" \
      "$root/scripts/hypr-teardown.sh" \
      "$dest/scripts/"
chmod +x "$dest/scripts/"*.sh
cp -f "$root/hypr/Makefile" "$dest/hypr/"
cp -f "$root/hypr/src/"*.cpp "$root/hypr/src/"*.hpp "$dest/hypr/src/"

if command -v omarchy >/dev/null 2>&1; then
  omarchy plugin validate "$dest"
fi

echo "installed $dest"

if command -v omarchy >/dev/null 2>&1; then
  omarchy plugin disable "$LEGACY_PLUGIN_ID" 2>/dev/null || true
  omarchy plugin disable "$OLDER_LEGACY_PLUGIN_ID" 2>/dev/null || true
  omarchy plugin enable "$PLUGIN_ID"
  omarchy restart shell
fi
