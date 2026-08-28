#!/usr/bin/env bash
# Dev helper: disable qs.shiny-border, purge the login-session Hyprland copy,
# and remove the installed plugin copy. Never deletes this source tree.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
dest="${OMARCHY_PLUGIN_DIR:-$HOME/.config/omarchy/plugins/qs.shiny-border}"
dest_abs=$(realpath -m "$dest")
root_abs=$(realpath "$root")

if command -v omarchy >/dev/null 2>&1; then
  omarchy plugin disable qs.shiny-border 2>/dev/null || true
fi

# Disable already ran hypr-teardown via Service.onDestruction when the shell
# was up. --purge is the extra command Omarchy's no-hooks installer forces.
if [[ -x $root/scripts/hypr-teardown.sh ]]; then
  bash "$root/scripts/hypr-teardown.sh" --purge || true
elif [[ -x $dest/scripts/hypr-teardown.sh ]]; then
  bash "$dest/scripts/hypr-teardown.sh" --purge || true
fi

if [[ -e "$dest" ]]; then
  if [[ "$dest_abs" == "$root_abs" ]]; then
    echo "plugin dir is the source tree; left $dest in place" >&2
    exit 0
  fi
  rm -rf "$dest"
  echo "removed $dest"
fi

if command -v omarchy-shell >/dev/null 2>&1; then
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
fi
