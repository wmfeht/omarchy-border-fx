#!/usr/bin/env bash
# Developer omarchy plugin cycle for this checkout.
# End-user enable/disable is still `omarchy plugin enable|disable`; this is
# checkout → ~/.config/omarchy/plugins. Does not patch /usr/share/omarchy.
#
#   mise run install|uninstall|reinstall
#   bash dev/plugin.sh install|uninstall|reinstall
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin_id=${PLUGIN_ID:-wmfeht.border-fx}
legacy_id=${LEGACY_PLUGIN_ID:-qs.border-fx}
older_id=${OLDER_LEGACY_PLUGIN_ID:-qs.shiny-border}
plugin_name=${PLUGIN_NAME:-hypr-shiny-border}
plugins_home="$HOME/.config/omarchy/plugins"
build_dir=${BUILD_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/omarchy-border-fx}
dest="$plugins_home/$plugin_id"
ids=("$plugin_id" "$legacy_id" "$older_id")
cli_launcher="$root/scripts/border-fx"

finished=0
saved=""
snapshot=""

die() {
  echo "dev/plugin.sh: $*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

need() {
  have "$1" || die "missing $1"
}

canon() {
  readlink -f "$1" 2>/dev/null || printf '%s' "$1"
}

same_path() {
  [[ $(canon "$1") == "$(canon "$2")" ]]
}

git_in() {
  local dir=$1
  shift
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git -C "$dir" "$@"
}

cli() {
  bash "$cli_launcher" "$@"
}

require_baked() {
  local f
  for f in shaders/shiny.frag.qsb shaders/ripple.frag.qsb; do
    [[ -f $root/$f ]] || die "missing $f — run: mise run bake"
  done
}

installed_dir() {
  printf '%s/%s' "$plugins_home" "$1"
}

plugin_gone() {
  local st
  st=$(cli status 2>/dev/null) || return 1
  grep -q '"listed": false' <<<"$st" && grep -q '"mappedSo": null' <<<"$st"
}

wait_plugin_gone() {
  local i
  for ((i = 0; i < 80; i++)); do
    if plugin_gone; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

# Hyprland lists the plugin, or maps the .so without listing it (reuse path).
# Status failure is "not loaded yet" — do not invert plugin_gone, which also
# returns 1 when `border-fx status` itself fails.
plugin_loaded() {
  local st
  st=$(cli status 2>/dev/null) || return 1
  grep -q '"listed": true' <<<"$st" && return 0
  grep -q '"mappedSo": null' <<<"$st" && return 1
  grep -q '"mappedSo":' <<<"$st"
}

# Enable returns as soon as shell.json flips; Service.qml then runs
# `border-fx ensure`, which may still be compiling. Wall-clock 60s so
# status-probe time does not stretch the cap, and slow machines fit.
wait_plugin_loaded() {
  local deadline=$((SECONDS + 60))
  while ((SECONDS < deadline)); do
    if plugin_loaded; then
      return 0
    fi
    sleep 0.1
  done
  plugin_loaded
}

plugin_known() {
  local js
  js=$(omarchy plugin list --json 2>/dev/null) || return 1
  [[ $js == *"\"id\":\"$plugin_id\""* || $js == *"\"id\": \"$plugin_id\""* ]]
}

wait_discovered() {
  local i
  for ((i = 0; i < 40; i++)); do
    if plugin_known; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

validate() {
  omarchy plugin validate "$1" >/dev/null
}

snapshot_working_tree() {
  mkdir -p "$build_dir"
  snapshot=$(mktemp -d "$build_dir/snapshot.XXXXXX")
  git_in "$root" clone --quiet --no-hardlinks -- "$root" "$snapshot" \
    || die "git clone of the working tree failed"

  local f
  while IFS= read -r -d '' f; do
    rm -f "$snapshot/$f"
  done < <(git_in "$root" diff --name-only -z --diff-filter=D HEAD || true)

  while IFS= read -r -d '' f; do
    [[ -e $root/$f || -L $root/$f ]] || continue
    mkdir -p "$snapshot/$(dirname "$f")"
    rm -f "$snapshot/$f"
    cp -a "$root/$f" "$snapshot/$f"
  done < <(git_in "$root" ls-files -z --cached --others --exclude-standard)

  if [[ -n $(git_in "$snapshot" status --porcelain) ]]; then
    git_in "$snapshot" add -A
    git_in "$snapshot" -c user.name=mise -c user.email=mise@omarchy-border-fx.local \
      commit --quiet -m "working tree snapshot" \
      || die "could not commit the working tree snapshot"
  fi
  validate "$snapshot" || die "omarchy plugin validate refused $snapshot"
}

cleanup() {
  if [[ ${finished:-0} -eq 0 && -n ${saved:-} ]]; then
    cli shell-look restore "$saved" >/dev/null || true
  fi
  if [[ -n ${snapshot:-} && -d $snapshot ]]; then
    rm -rf "$snapshot"
  fi
}

remove_plugin_dir() {
  local dir=$1
  if [[ ! -e $dir && ! -L $dir ]]; then
    return 0
  fi
  if same_path "$dir" "$root"; then
    echo "plugin dir is the source tree; left $dir in place" >&2
    return 0
  fi
  if [[ -L $dir || -f $dir ]]; then
    rm -f "$dir"
  else
    rm -rf "$dir"
  fi
  echo "removed $dir"
}

# Disable, purge the session .so, omarchy plugin remove. Aborts if Hyprland
# still has the plugin mapped — replacing that inode SIGBUS'es the compositor.
remove_installed() {
  local label=$1 id dir
  for id in "${ids[@]}"; do
    dir=$(installed_dir "$id")
    if [[ -e $dir || -L $dir ]]; then
      if same_path "$dir" "$root"; then
        die "refusing to $label: this tree is the installed plugin ($dir)"
      fi
      omarchy plugin disable "$id" >/dev/null 2>&1 || true
    fi
  done
  wait_plugin_gone || true

  echo "$label: purging login-session Hyprland copy"
  cli teardown --purge >/dev/null || true

  if ! wait_plugin_gone; then
    echo "$label: Hyprland still has $plugin_name mapped." >&2
    echo "$label: aborting before add so we do not replace a live .so." >&2
    echo "$label: retry, or iterate in a nest: mise run nest && mise run reload" >&2
    die "plugin still mapped"
  fi

  for id in "${ids[@]}"; do
    dir=$(installed_dir "$id")
    if [[ -e $dir || -L $dir ]]; then
      echo "$label: omarchy plugin remove $id"
      omarchy plugin remove "$id" --yes || die "omarchy plugin remove $id failed"
    fi
  done
  if have omarchy-shell; then
    omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
  fi
}

bootstrap() {
  local launcher=$dest/scripts/border-fx
  if [[ ! -f $launcher ]]; then
    echo "dev install: warning: installed launcher missing; the first enable will try to build" >&2
    return 0
  fi
  local out
  if ! out=$(bash "$launcher" --bootstrap); then
    echo "dev install: warning: pre-building the CLI failed; the launcher will retry on first use" >&2
    return 0
  fi
  if [[ $out == STATUS=no-cli || $out == STATUS=cli-build-failed || ! -x ${out%%$'\n'*} ]]; then
    echo "dev install: cargo not found; the launcher will build on first use" >&2
  fi
}

publish() {
  local label=$1 add_url
  need omarchy
  need git
  require_baked
  if same_path "$dest" "$root"; then
    die "refusing to $label: this tree is the installed plugin ($dest)"
  fi
  git_in "$root" rev-parse --is-inside-work-tree >/dev/null \
    || die "this folder is not a git repo; omarchy plugin add needs one"
  validate "$root" || die "omarchy plugin validate refused $root"

  trap cleanup EXIT

  add_url=$root
  if [[ -n $(git_in "$root" status --porcelain) ]]; then
    snapshot_working_tree
    add_url=$snapshot
  fi

  saved=$(cli shell-look snapshot || true)
  if [[ -n $saved ]]; then
    echo "$label: keeping existing look from shell.json"
  fi

  remove_installed "$label"

  # Restart *before* add. Restarting after enable races Service onDestruction
  # (teardown) with the new service's ensure, which used to replace a mapped
  # session .so and SIGBUS Hyprland.
  echo "$label: omarchy restart shell"
  omarchy restart shell || die "omarchy restart shell failed"

  # Add without --enable so the inotify reload storm does not start Service
  # (and cargo) while the clone is landing.
  echo "$label: omarchy plugin add $root --yes"
  omarchy plugin add "$add_url" --yes || die "omarchy plugin add failed"
  wait_discovered || die "plugin '$plugin_id' is not known after add"

  bootstrap

  if [[ -n $saved ]]; then
    echo "$label: restoring look into shell.json"
    cli shell-look restore "$saved"
    if have omarchy-shell; then
      omarchy-shell shell reloadConfig >/dev/null 2>&1 || true
    fi
  fi

  echo "$label: omarchy plugin enable $plugin_id"
  omarchy plugin enable "$plugin_id" || die "omarchy plugin enable $plugin_id failed"

  if [[ -n $saved ]]; then
    cli shell-look restore "$saved"
    if have omarchy-shell; then
      omarchy-shell shell reloadConfig >/dev/null 2>&1 || true
    fi
  fi

  if [[ -d $dest/.git ]]; then
    git_in "$dest" remote set-url origin "$root" >/dev/null || true
  fi

  echo "$label: waiting for $plugin_name to load (up to 60s)"
  if ! wait_plugin_loaded; then
    echo "$label: Hyprland did not list $plugin_name within 60s." >&2
    echo "$label: chrome may still be up; check: mise run status" >&2
    die "plugin did not load"
  fi

  finished=1
  echo "${label}ed $plugin_id from $root"
}

uninstall() {
  local id dir
  if have omarchy; then
    for id in "${ids[@]}"; do
      dir=$(installed_dir "$id")
      if [[ -e $dir || -L $dir ]]; then
        omarchy plugin disable "$id" >/dev/null 2>&1 || true
      fi
    done
  fi
  # Disable already ran teardown via Service.onDestruction when the shell was
  # up. --purge is the extra step Omarchy's no-hooks installer forces.
  if [[ -f $cli_launcher ]]; then
    cli teardown --purge >/dev/null || true
  fi
  if have omarchy; then
    for id in "${ids[@]}"; do
      dir=$(installed_dir "$id")
      if [[ -e $dir || -L $dir ]]; then
        if same_path "$dir" "$root"; then
          echo "plugin dir is the source tree; left $dir in place" >&2
          continue
        fi
        echo "uninstall: omarchy plugin remove $id"
        omarchy plugin remove "$id" --yes || die "omarchy plugin remove $id failed"
      fi
    done
  fi
  for id in "${ids[@]}"; do
    remove_plugin_dir "$(installed_dir "$id")"
  done
  if have omarchy-shell; then
    omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
  fi
}

usage() {
  echo "Usage: bash dev/plugin.sh install|uninstall|reinstall" >&2
  exit 2
}

case ${1:-} in
install | reinstall) publish "$1" ;;
uninstall) uninstall ;;
*) usage ;;
esac
