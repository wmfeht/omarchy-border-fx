# Shared Hyprland session helpers for hypr-ensure / hypr-teardown / reinstall.
# Sourced after paths.sh. No sudo. Does nothing on source.

hypr_pid() {
  command -v hyprctl >/dev/null 2>&1 || return 0
  hyprctl instances -j 2>/dev/null \
    | jq -r --argjson i "$HYPRCTL_INSTANCE" '.[$i].pid // .[0].pid // empty'
}

# Path of the mapped hypr-shiny-border.so, if any. Empty if not mapped.
# /proc/pid/maps may suffix " (deleted)" after unlink; the path is still the
# live mapping we must not truncate.
loaded_so() {
  local pid maps
  pid=$(hypr_pid || true)
  [[ -n ${pid:-} && -r /proc/$pid/maps ]] || return 0
  maps=$(grep -aE '/[^ ]*hypr-shiny-border\.so' "/proc/$pid/maps" 2>/dev/null | head -1 || true)
  [[ -n $maps ]] || return 0
  grep -aE -o '/[^ ]*hypr-shiny-border\.so' <<<"$maps" | head -1 || true
}

plugin_listed() {
  command -v hyprctl >/dev/null 2>&1 || return 1
  hyprctl -i "$HYPRCTL_INSTANCE" plugin list -j 2>/dev/null \
    | jq -e --arg n "$PLUGIN_NAME" 'any(.[]; .name == $n)' >/dev/null 2>&1
}

plugin_mapped() {
  [[ -n $(loaded_so) ]]
}

# True when Hyprland is not listing or mapping this plugin.
plugin_gone() {
  ! plugin_listed && ! plugin_mapped
}

# Poll until plugin_gone. Default 8s — PLUGIN_EXIT + dlclose is sync, but a
# just-issued hyprctl unload may still be in the compositor event loop.
wait_plugin_gone() {
  local timeout_s="${1:-8}"
  local steps i
  steps=$(python3 -c "print(max(1, int(float('$timeout_s') * 10)))")
  for ((i = 0; i < steps; i++)); do
    if plugin_gone; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

# Install $1 onto $SESSION_SO without O_TRUNC of the live inode.
# cp -f onto a Hyprland-mapped .so is SIGBUS (BUS_ADRERR) on the next fetch
# of plugin text (CShinyPassElement unique_ptr deleter in CRenderPass::clear).
# Write a sibling temp and rename: mapped pages keep the old inode.
install_session_so() {
  local src="$1"
  local dir tmp
  dir=$(dirname "$SESSION_SO")
  mkdir -p "$dir"
  tmp=$(mktemp "$dir/hypr-shiny-border.XXXXXX")
  if ! cp -f "$src" "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  chmod 755 "$tmp" || {
    rm -f "$tmp"
    return 1
  }
  if ! mv -f "$tmp" "$SESSION_SO"; then
    rm -f "$tmp"
    return 1
  fi
}

# Look JSON `effect`. Missing or empty is shiny (compile/load still allowed).
look_effect() {
  local json="${1-}"
  [[ -n $json ]] || json='{}'
  local effect
  effect=$(printf '%s' "$json" | jq -r '(.effect // "shiny") | if . == "" then "shiny" else . end' 2>/dev/null) || true
  if [[ -z $effect || $effect == null ]]; then
    effect=shiny
  fi
  printf '%s' "$effect"
}

look_effect_is_shiny() {
  [[ $(look_effect "${1-}") == shiny ]]
}

hypr_session_ensure_gen() {
  local n=0
  if [[ -n ${HYPR_SESSION_GEN:-} && -f $HYPR_SESSION_GEN ]]; then
    n=$(cat "$HYPR_SESSION_GEN" 2>/dev/null || true)
  fi
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  printf '%s' "$n"
}

hypr_session_bump_ensure_gen() {
  local dir n tmp
  [[ -n ${HYPR_SESSION_GEN:-} ]] || return 0
  dir=$(dirname "$HYPR_SESSION_GEN")
  mkdir -p "$dir"
  n=$(hypr_session_ensure_gen)
  tmp="${HYPR_SESSION_GEN}.tmp.$$"
  echo $((n + 1)) > "$tmp"
  mv -f "$tmp" "$HYPR_SESSION_GEN"
}

# Exclusive flock for the whole ensure/teardown critical section so a
# detached disable teardown cannot unload after this ensure has loaded.
hypr_session_lock() {
  local dir
  command -v flock >/dev/null 2>&1 || {
    echo "hypr-session: flock not found" >&2
    return 1
  }
  dir=$(dirname "$HYPR_SESSION_LOCK")
  mkdir -p "$dir"
  exec {HYPR_SESSION_LOCK_FD}>"$HYPR_SESSION_LOCK"
  flock "$HYPR_SESSION_LOCK_FD"
}

hypr_session_unlock() {
  if [[ -n ${HYPR_SESSION_LOCK_FD:-} ]]; then
    flock -u "$HYPR_SESSION_LOCK_FD" || true
    eval "exec ${HYPR_SESSION_LOCK_FD}>&-" || true
    unset HYPR_SESSION_LOCK_FD
  fi
}
