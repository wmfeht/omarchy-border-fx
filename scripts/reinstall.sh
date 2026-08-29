#!/usr/bin/env bash
# Completely remove wmfeht.border-fx from this system, then reload this folder
# through the Omarchy CLI (`omarchy plugin remove` + `omarchy plugin add`).
# Keeps the existing plugins[] look in shell.json (disable/remove would drop it).
# Includes uncommitted working-tree files. Does not use sudo.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=paths.sh
source "$root/scripts/paths.sh"
# shellcheck source=hypr-session.sh
source "$root/scripts/hypr-session.sh"
# shellcheck source=shell-look.sh
source "$root/scripts/shell-look.sh"
# omarchy plugin add/remove always use this directory, not OMARCHY_PLUGIN_DIR.
plugins_home="$HOME/.config/omarchy/plugins"
dest="$plugins_home/$PLUGIN_ID"
legacy_dest="$plugins_home/$LEGACY_PLUGIN_ID"
older_legacy_dest="$plugins_home/$OLDER_LEGACY_PLUGIN_ID"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing $1" >&2
    exit 1
  }
}

need omarchy
need git
need jq

if [[ ! -f "$root/shaders/shiny.frag.qsb" ]]; then
  echo "missing shaders/shiny.frag.qsb — run: mise run bake" >&2
  exit 1
fi

dest_abs=$(realpath -m "$dest")
root_abs=$(realpath "$root")
if [[ $dest_abs == "$root_abs" ]]; then
  echo "refusing to reinstall: this tree is the installed plugin ($dest)" >&2
  exit 1
fi

git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "this folder is not a git repo; omarchy plugin add needs one" >&2
  exit 1
}

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

omarchy plugin validate "$root"

snapshot=""
add_url=""
saved_look=""
reinstall_finished=0
cleanup() {
  # disable/remove drop the plugins[] look. Put it back if we abort before
  # add --enable, or if add failed after the entry was replaced with {id}.
  if (( reinstall_finished == 0 )) && [[ -n ${saved_look:-} ]]; then
    shell_look_restore "$saved_look" || true
  fi
  if [[ -n ${snapshot:-} && -d "$snapshot" ]]; then
    rm -rf "$snapshot"
  fi
}
trap cleanup EXIT

# omarchy plugin add git-clones; HEAD would drop dirty files. Snapshot the
# working tree into a throwaway repo so the clone matches this folder.
prepare_add_url() {
  if [[ -z $(git -C "$root" status --porcelain) ]]; then
    add_url="$root"
    return
  fi

  mkdir -p "$BUILD_DIR"
  snapshot=$(mktemp -d "$BUILD_DIR/reinstall.XXXXXX")
  # Same filesystem as ~/.config so omarchy plugin add's git clone can
  # hardlink. --no-hardlinks still copies if cache and the repo differ.
  git clone --quiet --no-hardlinks -- "$root" "$snapshot"

  local f
  while IFS= read -r -d '' f; do
    rm -f "$snapshot/$f"
  done < <(git -C "$root" diff --name-only -z --diff-filter=D HEAD)

  while IFS= read -r -d '' f; do
    if [[ -f "$root/$f" || -L "$root/$f" ]]; then
      mkdir -p "$snapshot/$(dirname "$f")"
      cp -a "$root/$f" "$snapshot/$f"
    fi
  done < <(git -C "$root" ls-files -z --cached --others --exclude-standard)

  if [[ -n $(git -C "$snapshot" status --porcelain) ]]; then
    git -C "$snapshot" add -A
    git -C "$snapshot" \
      -c user.name=mise \
      -c user.email=mise@omarchy-border-fx.local \
      commit --quiet -m "mise reinstall: working tree snapshot"
  fi

  omarchy plugin validate "$snapshot"
  add_url="$snapshot"
}

remove_if_installed() {
  local id="$1"
  local dir="$2"
  if [[ -e "$dir" || -L "$dir" ]]; then
    echo "reinstall: omarchy plugin remove $id"
    omarchy plugin remove "$id" --yes
  fi
}

prepare_add_url
[[ -n "$add_url" ]] || {
  echo "reinstall: no source for omarchy plugin add" >&2
  exit 1
}

# omarchy plugin disable/remove splice the whole plugins[] object. Snapshot
# the look before that so add --enable does not start from { "id": ... }.
saved_look=$(shell_look_snapshot)
if [[ -n $saved_look ]]; then
  echo "reinstall: keeping existing look from shell.json"
fi

# Disable first so Service.onDestruction can still exec the installed
# hypr-teardown.sh. Then purge the login-session copy from this tree.
if [[ -e "$dest" || -L "$dest" ]]; then
  omarchy plugin disable "$PLUGIN_ID" 2>/dev/null || true
fi
if [[ -e "$legacy_dest" || -L "$legacy_dest" ]]; then
  omarchy plugin disable "$LEGACY_PLUGIN_ID" 2>/dev/null || true
fi
if [[ -e "$older_legacy_dest" || -L "$older_legacy_dest" ]]; then
  omarchy plugin disable "$OLDER_LEGACY_PLUGIN_ID" 2>/dev/null || true
fi
wait_plugin_gone 8 || true

echo "reinstall: purging login-session Hyprland copy"
bash "$root/scripts/hypr-teardown.sh" --purge || true

if ! wait_plugin_gone 8; then
  echo "reinstall: Hyprland still has hypr-shiny-border mapped." >&2
  echo "reinstall: aborting before add --enable so we do not replace a live .so." >&2
  echo "reinstall: retry, or iterate in a nest: mise run nest && mise run reload" >&2
  exit 1
fi

remove_if_installed "$PLUGIN_ID" "$dest"
remove_if_installed "$LEGACY_PLUGIN_ID" "$legacy_dest"
remove_if_installed "$OLDER_LEGACY_PLUGIN_ID" "$older_legacy_dest"

if command -v omarchy-shell >/dev/null 2>&1; then
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
fi

# Restart *before* add --enable. Restarting after enable races Service
# onDestruction (hypr-teardown) with the new service's hypr-ensure, which
# used to cp -f over the mapped session .so and SIGBUS Hyprland.
echo "reinstall: omarchy restart shell"
omarchy restart shell

# Put the look back before enable so setEnabled sees an existing plugins[]
# entry (and does not replace it with {id}) and Service starts with it.
if [[ -n $saved_look ]]; then
  echo "reinstall: restoring look into shell.json"
  shell_look_restore "$saved_look"
  shell_look_reload_shell
fi

echo "reinstall: omarchy plugin add $root --enable --yes"
omarchy plugin add "$add_url" --enable --yes

# enable clones in-memory shellConfig. If reloadConfig had not landed, it
# still writes {id}; write the look again and reload.
if [[ -n $saved_look ]]; then
  shell_look_restore "$saved_look"
  shell_look_reload_shell
fi

installed="$HOME/.config/omarchy/plugins/$PLUGIN_ID"
if [[ -d "$installed/.git" ]]; then
  git -C "$installed" remote set-url origin "$root" 2>/dev/null || true
fi

reinstall_finished=1
echo "reinstalled $PLUGIN_ID from $root"
