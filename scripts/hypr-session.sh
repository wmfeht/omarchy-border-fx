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

# True when plugin sources are newer than $1 (need a rebuild). Missing $1 is newer.
sources_newer_than() {
  local so="$1"
  [[ -f $so ]] || return 0
  [[ -d $HYPR_SRC/src ]] || return 1
  local newest so_t
  newest=$(find "$HYPR_SRC/src" -type f \( -name '*.cpp' -o -name '*.hpp' \) -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
  [[ -n $newest ]] || return 1
  so_t=$(stat -c '%Y' "$so")
  python3 -c "import sys; sys.exit(0 if float('$newest') > float('$so_t') else 1)"
}

# version.h the compiler will see (pkg-config -I, then /usr). Overridable.
hypr_abi_version_h() {
  if [[ ${HYPR_ABI_VERSION_H+set} == set ]]; then
    printf '%s' "$HYPR_ABI_VERSION_H"
    return 0
  fi
  local flags flag dir
  flags=$(pkg-config --cflags-only-I hyprland 2>/dev/null) || flags=""
  for flag in $flags; do
    [[ $flag == -I* ]] || continue
    dir="${flag#-I}"
    [[ -n $dir ]] || continue
    if [[ -f $dir/hyprland/src/version.h ]]; then
      printf '%s' "$dir/hyprland/src/version.h"
      return 0
    fi
    if [[ -f $dir/src/version.h ]]; then
      printf '%s' "$dir/src/version.h"
      return 0
    fi
    if [[ -f $dir/version.h ]]; then
      printf '%s' "$dir/version.h"
      return 0
    fi
  done
  if [[ -f /usr/include/hyprland/src/version.h ]]; then
    printf '%s' /usr/include/hyprland/src/version.h
    return 0
  fi
  return 0
}

# Running compositor ABI string (__hyprland_api_get_hash). Fixture: HYPR_ABI_COMPOSITOR_HASH.
hypr_abi_compositor_hash() {
  if [[ ${HYPR_ABI_COMPOSITOR_HASH+set} == set ]]; then
    printf '%s' "$HYPR_ABI_COMPOSITOR_HASH"
    return 0
  fi
  local ver abi
  ver=$(hyprctl -i "$HYPRCTL_INSTANCE" version 2>/dev/null) || true
  abi=$(sed -n 's/^Version ABI string: //p' <<<"$ver" | head -1 | tr -d '\r')
  printf '%s' "$abi"
}

# Hyprland header mtime (version.h). Fixture: HYPR_ABI_HEADER_MTIME.
hypr_abi_header_mtime() {
  if [[ ${HYPR_ABI_HEADER_MTIME+set} == set ]]; then
    printf '%s' "$HYPR_ABI_HEADER_MTIME"
    return 0
  fi
  local hdr
  hdr=$(hypr_abi_version_h) || true
  [[ -n $hdr && -f $hdr ]] || { printf ''; return 0; }
  stat -c '%Y' "$hdr"
}

# Compiler identity. Fixture: HYPR_ABI_COMPILER_ID.
hypr_abi_compiler_id() {
  if [[ ${HYPR_ABI_COMPILER_ID+set} == set ]]; then
    printf '%s' "$HYPR_ABI_COMPILER_ID"
    return 0
  fi
  local cxx machine ver
  cxx="${CXX:-g++}"
  machine=$("$cxx" -dumpmachine 2>/dev/null) || true
  ver=$("$cxx" -dumpversion 2>/dev/null) || true
  printf '%s-%s' "$machine" "$ver"
}

hypr_abi_identity_text() {
  printf 'hash=%s\nheader_mtime=%s\ncompiler=%s\n' \
    "$(hypr_abi_compositor_hash)" \
    "$(hypr_abi_header_mtime)" \
    "$(hypr_abi_compiler_id)"
}

hypr_abi_stamp_write() {
  local stamp dir tmp
  stamp="${HYPR_ABI_STAMP:-$BUILD_DIR/abi-identity}"
  dir=$(dirname "$stamp")
  mkdir -p "$dir"
  tmp="${stamp}.tmp.$$"
  hypr_abi_identity_text > "$tmp"
  mv -f "$tmp" "$stamp"
}

hypr_abi_identity_matches_stamp() {
  local stamp
  stamp="${HYPR_ABI_STAMP:-$BUILD_DIR/abi-identity}"
  [[ -f $stamp ]] || return 1
  cmp -s "$stamp" <(hypr_abi_identity_text)
}

hypr_abi_hash_mismatch_recorded() {
  local f="${HYPR_ABI_HASH_MISMATCH:-$BUILD_DIR/hash-mismatch}"
  [[ -f $f ]]
}

hypr_abi_record_hash_mismatch() {
  local f dir
  f="${HYPR_ABI_HASH_MISMATCH:-$BUILD_DIR/hash-mismatch}"
  dir=$(dirname "$f")
  mkdir -p "$dir"
  printf '1\n' > "$f"
}

hypr_abi_clear_hash_mismatch() {
  local f="${HYPR_ABI_HASH_MISMATCH:-$BUILD_DIR/hash-mismatch}"
  rm -f -- "$f"
}

# True when $1 must not be loaded as-is: missing, sources newer, ABI stamp
# mismatch (compositor hash / header mtime / compiler id), or last PLUGIN_INIT
# hash-mismatch is recorded. Fixture env skips hyprctl / pkg-config I/O.
hypr_abi_artifact_fresh() {
  local so="$1"
  [[ -f $so ]] || return 1
  if sources_newer_than "$so"; then
    return 1
  fi
  if hypr_abi_hash_mismatch_recorded; then
    return 1
  fi
  if ! hypr_abi_identity_matches_stamp; then
    return 1
  fi
  return 0
}

# Identity changed (or no stamp / hash-mismatch flag): make all must not relink
# objects produced against the previous compositor / headers / compiler.
hypr_abi_need_force_rebuild() {
  if hypr_abi_hash_mismatch_recorded; then
    return 0
  fi
  if hypr_abi_identity_matches_stamp; then
    return 1
  fi
  return 0
}

hypr_abi_invalidate_objects() {
  [[ -n ${BUILD_DIR:-} ]] || return 0
  rm -rf "$BUILD_DIR/obj"
  rm -f -- "$BUILD_DIR/hypr-shiny-border.so"
}

# Unlink SESSION_SO (not O_TRUNC). Only when that path is not mapped.
hypr_abi_delete_session_so() {
  local path
  if plugin_mapped; then
    path=$(loaded_so)
    if [[ ${path:-} == "$SESSION_SO" ]]; then
      return 1
    fi
  fi
  rm -f -- "$SESSION_SO"
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
