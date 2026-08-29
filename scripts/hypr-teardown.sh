#!/usr/bin/env bash
# Unload the Omarchy-owned ~/.local/lib copy of hypr-shiny-border.so.
# Does not unload a hyprpm or nest copy. --purge also deletes the session
# .so and generated lua (run this after omarchy plugin remove if the shell
# was not running).
set -euo pipefail

_script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=paths.sh
source "$_script_dir/paths.sh"
# shellcheck source=hypr-session.sh
source "$_script_dir/hypr-session.sh"

purge=0
while (( $# > 0 )); do
  case "$1" in
    --purge) purge=1; shift ;;
    -h|--help)
      echo "Usage: hypr-teardown.sh [--purge]"
      exit 0
      ;;
    *) echo "hypr-teardown: unknown argument: $1" >&2; exit 2 ;;
  esac
done

disable_look() {
  "$_script_dir/look-apply.sh" --disabled --look-json "${LOOK_JSON:-{}}" "$@" || true
}

if command -v hyprctl >/dev/null 2>&1 && plugin_listed; then
  path=$(loaded_so)
  if [[ ${path:-} == "$SESSION_SO" ]]; then
    if hyprctl -i "$HYPRCTL_INSTANCE" plugin unload "$SESSION_SO" && wait_plugin_gone 8; then
      echo "hypr-teardown: unloaded $SESSION_SO"
    else
      echo "hypr-teardown: unload refused; setting enabled = false" >&2
      disable_look --eval
    fi
  elif [[ -n ${path:-} ]]; then
    echo "hypr-teardown: not unloading $path (not the Omarchy session copy)" >&2
    disable_look
  else
    echo "hypr-teardown: plugin listed but .so path unknown; setting enabled = false" >&2
    disable_look --eval
  fi
else
  disable_look
fi

if (( purge )); then
  rm -f "$SESSION_SO" "$LUA_FILE" "$LEGACY_LUA_FILE"
  echo "hypr-teardown: purged $SESSION_SO, $LUA_FILE, and leftover $LEGACY_LUA_FILE"
  echo "hypr-teardown: left hyprland.lua require in place (pcall) and did not edit looknfeel.lua"
else
  echo "hypr-teardown: kept $SESSION_SO (re-enable is fast)"
fi
