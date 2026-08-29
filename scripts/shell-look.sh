# Snapshot / restore the wmfeht.border-fx plugins[] look in shell.json.
# Sourced by reinstall. No sudo.
#
# omarchy plugin disable/remove splices the whole plugins[] entry (look keys
# included). enable then writes { "id": ... } only. Reinstall has to keep the
# look itself.

shell_json_path() {
  # Omarchy shell always reads ~/.config/omarchy/shell.json (not XDG_CONFIG_HOME).
  echo "${OMARCHY_SHELL_JSON:-$HOME/.config/omarchy/shell.json}"
}

# Prints one compact JSON object, or nothing.
shell_look_snapshot() {
  local f
  f=$(shell_json_path)
  [[ -f $f ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  jq -c --arg id "$PLUGIN_ID" --arg legacy "$LEGACY_PLUGIN_ID" --arg older "$OLDER_LEGACY_PLUGIN_ID" '
    (.plugins // []) as $p
    | ($p | map(select(type == "object" and .id == $id)) | first)
      // ($p | map(select(type == "object" and .id == $legacy)) | first)
      // ($p | map(select(type == "object" and .id == $older)) | first)
      // empty
  ' "$f"
}

# Merge $1 (a plugin-entry JSON object) onto shell.json plugins[].
# Rewrites id to PLUGIN_ID. Drops leftover legacy ids. No-op if $1 is empty
# or shell.json is missing (do not invent a whole shell.json).
shell_look_restore() {
  local saved="${1:-}"
  local f tmp
  [[ -n $saved && $saved != "null" && $saved != "{}" ]] || return 0
  command -v jq >/dev/null 2>&1 || {
    echo "reinstall: jq not found; not restoring look" >&2
    return 0
  }
  jq -e 'type == "object"' <<<"$saved" >/dev/null 2>&1 || {
    echo "reinstall: look snapshot is not an object; skipping restore" >&2
    return 0
  }
  f=$(shell_json_path)
  if [[ ! -f $f ]]; then
    echo "reinstall: shell.json missing; not restoring look" >&2
    return 0
  fi
  tmp="${f}.tmp.$$"
  if ! jq --argjson saved "$saved" \
      --arg id "$PLUGIN_ID" \
      --arg legacy "$LEGACY_PLUGIN_ID" \
      --arg older "$OLDER_LEGACY_PLUGIN_ID" \
      --indent 2 '
    ($saved + {id: $id}) as $entry
    | .plugins = (
        (.plugins | if type == "array" then . else [] end)
        | map(if type == "object" and .id == $id then $entry else . end)
        | map(select(type != "object" or (.id != $legacy and .id != $older)))
        | if any(.[]; type == "object" and .id == $id) then . else . + [$entry] end
      )
  ' "$f" > "$tmp"; then
    rm -f "$tmp"
    echo "reinstall: failed to restore look into shell.json" >&2
    return 1
  fi
  mv -f "$tmp" "$f"
}

shell_look_reload_shell() {
  if command -v omarchy-shell >/dev/null 2>&1; then
    omarchy-shell shell reloadConfig >/dev/null 2>&1 || true
  fi
}
