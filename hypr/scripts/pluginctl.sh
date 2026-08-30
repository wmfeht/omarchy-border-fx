#!/usr/bin/env bash
# Load/unload/reload hypr-shiny-border.so into a chosen Hyprland instance.
# Default target: last instance in `hyprctl instances` (the nest, if you have one).
#
# The live session is instance 0. Loading a half-baked plugin there takes down
# the compositor. That is refused unless you set both:
#   SHINY_INSTANCE=0 SHINY_LIVE=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# In-tree build (nest). User enable builds into XDG_CACHE_HOME.
SO="${SHINY_SO:-$ROOT/hypr-shiny-border.so}"

# Load copies and lastso live under $XDG_RUNTIME_DIR (0700), not a guessable
# world-writable /tmp/hypr-shiny-border-$$.so.
plugin_runtime_dir() {
  local runtime="${XDG_RUNTIME_DIR:-}"
  if [[ -z $runtime ]]; then
    runtime="/run/user/$(id -u)"
  fi
  mkdir -p "$runtime"
  chmod 0700 "$runtime"
  local dir="$runtime/hypr-shiny-border"
  mkdir -p "$dir"
  chmod 0700 "$dir"
  printf '%s' "$dir"
}

_plugin_run="$(plugin_runtime_dir)"
STATE="${SHINY_LASTSO:-$_plugin_run/lastso}"

die() { echo "pluginctl: $*" >&2; exit 1; }

instance_count() {
  hyprctl instances -j 2>/dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 1
}

# Instance 0 is the login session. Anything else is a nest.
refuse_live() {
  die "refusing to touch the live Hyprland session.

pluginctl: a plugin crash is a compositor crash (SIGSEGV in CRenderPass::clear
pluginctl: last time, 2026-08-24 20:59). Iterate in a nest:

pluginctl:   mise run nest          # nested Hyprland, ALT+M to kill it
pluginctl:   mise run reload        # from an outer terminal, while the nest is up

pluginctl: to override, and only if you mean it:
pluginctl:   SHINY_INSTANCE=0 SHINY_LIVE=1 mise run load"
}

instance() {
  if [[ -n "${SHINY_INSTANCE:-}" ]]; then
    if [[ "${SHINY_INSTANCE}" == "0" && "${SHINY_LIVE:-}" != "1" ]]; then
      refuse_live
    fi
    echo "$SHINY_INSTANCE"
    return
  fi
  local count
  count="$(instance_count)"
  if [[ "$count" -le 1 ]]; then
    refuse_live
  fi
  echo $((count - 1))
}

# Hyprland getPluginByPath only rejects the same path. We copy to a new
# mktemp name under $XDG_RUNTIME_DIR every load, so a second load without
# unload would be a second .so / RTTI domain. Refuse by plugin *name*
# regardless of path.
PLUGIN_NAME="hypr-shiny-border"

already_loaded_by_name() {
  local target="$1"
  local list
  list="$(hyprctl -i "$target" plugin list)" || die "could not list plugins on instance $target"
  grep -F -q -- "$PLUGIN_NAME" <<<"$list"
}

cmd="${1:-}"
case "$cmd" in
  load)
    [[ -f "$SO" ]] || die "no $SO — run: mise run build"
    # Resolve the target *before* copying, so a refuse doesn't leave a stray .so.
    target="$(instance)"
    if already_loaded_by_name "$target"; then
      die "$PLUGIN_NAME already loaded (refusing a second copy; unload first)"
    fi
    dest=$(mktemp "$_plugin_run/hypr-shiny-border.XXXXXX") || die "mktemp failed"
    # Drop the previous dest after the refuse and name check, immediately
    # before cp — a refused load must not delete a copy a retry still needs.
    if [[ -f $STATE ]]; then
      old=$(cat "$STATE" || true)
      if [[ -n ${old:-} && $old != "$dest" ]]; then
        rm -f -- "$old"
      fi
    fi
    cp -f "$SO" "$dest"
    echo "$dest" > "$STATE"
    hyprctl -i "$target" plugin load "$dest"
    hyprctl -i "$target" plugin list
    ;;
  unload)
    target="$(instance)"
    if [[ -f "$STATE" ]]; then
      so_path="$(cat "$STATE")"
      if hyprctl -i "$target" plugin unload "$so_path"; then
        rm -f "$STATE"
      elif list="$(hyprctl -i "$target" plugin list)" && ! grep -F -q -- "$PLUGIN_NAME" <<<"$list"; then
        rm -f "$STATE"
      else
        die "unload failed; keeping $STATE for retry"
      fi
    else
      echo "pluginctl: nothing recorded; trying the tree .so" >&2
      hyprctl -i "$target" plugin unload "$SO" || true
    fi
    ;;
  reload)
    # Unload then load. If unload fails and the name is still listed, load
    # refuses rather than stacking a second copy.
    "$0" unload || true
    "$0" load
    ;;
  *)
    die "usage: pluginctl.sh {load|unload|reload}"
    ;;
esac
