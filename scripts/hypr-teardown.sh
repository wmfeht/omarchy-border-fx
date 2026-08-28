#!/usr/bin/env bash
# Unload the Omarchy-owned ~/.local/lib copy of hypr-shiny-border.so.
# Does not unload a hyprpm or nest copy. --purge also deletes the session
# .so and generated lua (run this after omarchy plugin remove if the shell
# was not running).
set -euo pipefail

_script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=paths.sh
source "$_script_dir/paths.sh"

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

hypr_pid() {
  hyprctl instances -j 2>/dev/null \
    | jq -r --argjson i "$HYPRCTL_INSTANCE" '.[$i].pid // .[0].pid // empty'
}

loaded_so() {
  local pid
  pid=$(hypr_pid || true)
  [[ -n ${pid:-} && -r /proc/$pid/maps ]] || return 0
  grep -aE -o '/[^ ]*hypr-shiny-border\.so' "/proc/$pid/maps" 2>/dev/null | head -1 || true
}

plugin_listed() {
  command -v hyprctl >/dev/null 2>&1 \
    && hyprctl -i "$HYPRCTL_INSTANCE" plugin list -j 2>/dev/null \
      | jq -e 'any(.[]; .name == "hypr-shiny-border")' >/dev/null 2>&1
}

disable_look() {
  "$_script_dir/look-apply.sh" --disabled --look-json "${LOOK_JSON:-{}}" "$@" || true
}

if command -v hyprctl >/dev/null 2>&1 && plugin_listed; then
  path=$(loaded_so)
  if [[ ${path:-} == "$SESSION_SO" ]]; then
    if hyprctl -i "$HYPRCTL_INSTANCE" plugin unload "$SESSION_SO"; then
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
  rm -f "$SESSION_SO" "$LUA_FILE"
  echo "hypr-teardown: purged $SESSION_SO and $LUA_FILE"
  echo "hypr-teardown: left hyprland.lua require in place (pcall) and did not edit looknfeel.lua"
else
  echo "hypr-teardown: kept $SESSION_SO (re-enable is fast)"
fi
