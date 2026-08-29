#!/usr/bin/env bash
# Dev helper: disable wmfeht.border-fx, purge the login-session Hyprland copy,
# and remove the installed plugin copy. Never deletes this source tree.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=paths.sh
source "$root/scripts/paths.sh"
dest="${OMARCHY_PLUGIN_DIR:-$HOME/.config/omarchy/plugins/$PLUGIN_ID}"
plugins_home="$HOME/.config/omarchy/plugins"
root_abs=$(realpath "$root")

if command -v omarchy >/dev/null 2>&1; then
  omarchy plugin disable "$PLUGIN_ID" 2>/dev/null || true
  omarchy plugin disable "$LEGACY_PLUGIN_ID" 2>/dev/null || true
  omarchy plugin disable "$OLDER_LEGACY_PLUGIN_ID" 2>/dev/null || true
fi

# Disable already ran hypr-teardown via Service.onDestruction when the shell
# was up. --purge is the extra command Omarchy's no-hooks installer forces.
if [[ -x $root/scripts/hypr-teardown.sh ]]; then
  bash "$root/scripts/hypr-teardown.sh" --purge || true
elif [[ -x $dest/scripts/hypr-teardown.sh ]]; then
  bash "$dest/scripts/hypr-teardown.sh" --purge || true
fi

remove_plugin_dir() {
  local dir="$1"
  local dir_abs
  [[ -e "$dir" || -L "$dir" ]] || return 0
  dir_abs=$(realpath -m "$dir")
  if [[ "$dir_abs" == "$root_abs" ]]; then
    echo "plugin dir is the source tree; left $dir in place" >&2
    return 0
  fi
  rm -rf "$dir"
  echo "removed $dir"
}

remove_plugin_dir "$dest"
remove_plugin_dir "$plugins_home/$LEGACY_PLUGIN_ID"
remove_plugin_dir "$plugins_home/$OLDER_LEGACY_PLUGIN_ID"

if command -v omarchy-shell >/dev/null 2>&1; then
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
fi
