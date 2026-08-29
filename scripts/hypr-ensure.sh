#!/usr/bin/env bash
# User-level: build/copy/load ~/.local/lib/hypr/hypr-shiny-border.so and
# persist look via look-apply. Called from Service.qml after enable.
# No sudo. Never load a second copy if hyprpm (or a nest) already owns it.
set -euo pipefail

_script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=paths.sh
source "$_script_dir/paths.sh"
# shellcheck source=hypr-session.sh
source "$_script_dir/hypr-session.sh"

look_json="${LOOK_JSON:-}"
while (( $# > 0 )); do
  case "$1" in
    --look-json) look_json="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: hypr-ensure.sh [--look-json JSON]"
      exit 0
      ;;
    *) echo "hypr-ensure: unknown argument: $1" >&2; exit 2 ;;
  esac
done

status() { echo "STATUS=$1"; }

notify() {
  local msg="$1"
  echo "hypr-ensure: $msg" >&2
  if command -v omarchy-notification-send >/dev/null 2>&1; then
    omarchy-notification-send --app-name "$PLUGIN_ID" -u normal "Border FX" "$msg" || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send -a "$PLUGIN_ID" "Border FX" "$msg" || true
  fi
}

apply_look() {
  local extra=()
  (( $# > 0 )) && extra=("$@")
  if [[ -n $look_json ]]; then
    "$_script_dir/look-apply.sh" --look-json "$look_json" "${extra[@]}"
  else
    "$_script_dir/look-apply.sh" --look-json '{}' "${extra[@]}"
  fi
}

ensure_hyprland_require() {
  local f="$HYPRLAND_LUA"
  [[ -f $f ]] || return 0
  if ! grep -q "$LUA_MODULE" "$f"; then
    printf '\n-- %s (Omarchy plugin control plane; pcall if the file is missing)\npcall(require, "%s")\n' "$PLUGIN_ID" "$LUA_MODULE" >> "$f"
  fi
  if grep -q 'hypr.shiny-border' "$f"; then
    local tmp
    tmp=$(mktemp)
    grep -v 'hypr.shiny-border' "$f" > "$tmp"
    mv -f "$tmp" "$f"
  fi
}

build_so() {
  if [[ ! -f $HYPR_SRC/Makefile ]]; then
    notify "window ring needs Hyprland headers; chrome is on. This checkout has no hypr/ sources."
    return 1
  fi
  mkdir -p "$BUILD_DIR"
  if hypr_abi_need_force_rebuild; then
    echo "hypr-ensure: compositor/header/compiler identity changed; not relinking stale objects" >&2
    hypr_abi_invalidate_objects
  fi
  if ! make -C "$HYPR_SRC" all BUILD_DIR="$BUILD_DIR" >&2; then
    notify "window ring needs Hyprland headers; chrome is on. Fix: install matching Hyprland headers and re-enable, or: make -C hypr all"
    return 1
  fi
  [[ -f $BUILD_DIR/hypr-shiny-border.so ]] || return 1
  hypr_abi_stamp_write
}

copy_session_so() {
  install_session_so "$1"
}

load_session_so() {
  local out rc
  rc=0
  out=$(hyprctl -i "$HYPRCTL_INSTANCE" plugin load "$SESSION_SO" 2>&1) || rc=$?
  if [[ -n $out ]]; then
    printf '%s\n' "$out" >&2
  fi
  if (( rc != 0 )); then
    if grep -qiE 'version mismatch|hash mismatch|Header/compositor hash' <<<"$out"; then
      hypr_abi_record_hash_mismatch
      hypr_abi_delete_session_so || true
    fi
    return "$rc"
  fi
  hypr_abi_clear_hash_mismatch
  return 0
}

# Load the session copy. Fail closed: STATUS=load-failed, chrome stays on.
load_session_so_or_fail() {
  if load_session_so; then
    return 0
  fi
  notify "hyprctl plugin load failed. Chrome is on. Allow hyprctl plugin loads or check Hyprland permissions."
  status load-failed
  exit 0
}

# Unload the session copy. Returns 0 only when Hyprland no longer lists or
# maps it — copy+load after a failed unload is how CRenderPass::clear SIGBUS'd.
unload_session_so() {
  hyprctl -i "$HYPRCTL_INSTANCE" plugin unload "$SESSION_SO" || true
  wait_plugin_gone 8
}

hypr_session_lock
trap 'hypr_session_bump_ensure_gen || true; hypr_session_unlock' EXIT

if ! command -v hyprctl >/dev/null 2>&1; then
  echo "hypr-ensure: hyprctl not found; chrome only" >&2
  status no-hyprctl
  exit 0
fi

if ! look_effect_is_shiny "${look_json:-{}}"; then
  echo "hypr-ensure: effect is not shiny; writing disabled Lua, skipping compile/load" >&2
  ensure_hyprland_require
  apply_look --disabled
  path=$(loaded_so)
  if [[ ${path:-} == "$SESSION_SO" ]]; then
    echo "hypr-ensure: unloading leftover session plugin" >&2
    unload_session_so || true
  fi
  if plugin_listed; then
    apply_look --disabled --eval
  fi
  status skipped
  exit 0
fi

ensure_hyprland_require
apply_look

if plugin_listed; then
  path=$(loaded_so)
  if [[ -z ${path:-} ]]; then
    notify "hypr-shiny-border is already loaded; not loading a second copy."
    apply_look --eval
    status reuse
    exit 0
  fi
  if [[ $path == "$SESSION_SO" ]]; then
    if ! hypr_abi_artifact_fresh "$SESSION_SO"; then
      if build_so; then
        if unload_session_so; then
          hypr_abi_delete_session_so || true
          copy_session_so "$BUILD_DIR/hypr-shiny-border.so"
          load_session_so_or_fail
        else
          notify "hypr-shiny-border still mapped after unload; not replacing the live .so. Chrome is on."
          apply_look --eval
          status reuse
          exit 0
        fi
      fi
    fi
    apply_look --eval
    status ok
    exit 0
  fi
  if [[ $path == *hyprpm* ]]; then
    notify "hyprpm already loaded hypr-shiny-border; not loading a second copy. Disable it with: hyprpm disable hypr-shiny-border"
    apply_look --eval
    status hyprpm
    exit 0
  fi
  notify "hypr-shiny-border already loaded from $path; not loading a second copy."
  apply_look --eval
  status reuse
  exit 0
fi

if plugin_mapped; then
  notify "hypr-shiny-border is still mapped from $(loaded_so); not loading a second copy."
  apply_look --eval
  status reuse
  exit 0
fi

if [[ -f $SESSION_SO ]] && ! hypr_abi_artifact_fresh "$SESSION_SO"; then
  hypr_abi_delete_session_so || true
fi

built=""
if hypr_abi_artifact_fresh "$SESSION_SO"; then
  built="$SESSION_SO"
elif hypr_abi_artifact_fresh "$BUILD_DIR/hypr-shiny-border.so"; then
  built="$BUILD_DIR/hypr-shiny-border.so"
elif hypr_abi_artifact_fresh "$HYPR_SRC/hypr-shiny-border.so"; then
  built="$HYPR_SRC/hypr-shiny-border.so"
fi

if [[ -z $built ]]; then
  if ! build_so; then
    status build-failed
    exit 0
  fi
  built="$BUILD_DIR/hypr-shiny-border.so"
fi

if [[ $built != "$SESSION_SO" ]]; then
  copy_session_so "$built"
fi

load_session_so_or_fail

apply_look --eval
status ok
