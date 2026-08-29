#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for omarchy-border-fx.
#
# Covers the headless, compositor-free development experience: the JS logic
# suite (the CI contract, `mise run test`), shader baking (`mise run bake`,
# needs qsb from qt6-shadertools), the Hyprland C++ logic tests
# (`mise run hypr-test`, needs g++ >= 14 for -std=gnu++26), and a compile-only
# Hyprland plugin build (`mise run hypr-build`) against Hyprland v0.56.2 dev
# headers built from source (see .cursor/hypr-headers.sh).
#
# Not covered (they require the target Arch/Omarchy graphical stack — a running
# Wayland compositor, GPU, and the Quickshell `qs` binary): `mise run lint`
# (needs Qt >= 6.6; Ubuntu 24.04 ships 6.4.2), `mise run preview`/`smoke`, and
# loading/running the plugin (`mise run nest`/`reload`/`load`). The compiled
# .so cannot be loaded here: PLUGIN_INIT ABI-checks it against a live compositor.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# --- System packages (idempotent; no-op when already present) ------------
packages=(
  qt6-shadertools-dev        # provides /usr/lib/qt6/bin/qsb for shader baking
  qt6-declarative-dev-tools  # provides /usr/lib/qt6/bin/qmllint
  qml6-module-qtquick        # QtQuick QML type info for qmllint
  qml6-module-qtqml          # QtQml QML type info for qmllint
  g++-14                     # -std=gnu++26 for the Hyprland C++ logic tests
  python3                    # scripts/bake.sh shader include expansion
)

missing=()
for pkg in "${packages[@]}"; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    missing+=("$pkg")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "Installing system packages: ${missing[*]}"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
fi

# Make g++/gcc resolve to version 14 (the Makefile and tests default to plain
# `g++` with -std=gnu++26). update-alternatives --install is idempotent.
if [[ -x /usr/bin/g++-14 ]]; then
  sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-14 60 \
    --slave /usr/bin/g++ g++ /usr/bin/g++-14 >/dev/null 2>&1 || true
  if [[ -x /usr/bin/g++-13 ]]; then
    sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-13 40 \
      --slave /usr/bin/g++ g++ /usr/bin/g++-13 >/dev/null 2>&1 || true
  fi
  sudo update-alternatives --set gcc /usr/bin/gcc-14 >/dev/null 2>&1 || true
fi

# --- mise (pinned toolchain manager used by the repo and CI) -------------
if ! command -v mise >/dev/null 2>&1 && [[ ! -x "$HOME/.local/bin/mise" ]]; then
  echo "Installing mise"
  curl -fsSL https://mise.run | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# Activate mise for future interactive shells (idempotent append).
bashrc="$HOME/.bashrc"
marker='# >>> omarchy-border-fx mise >>>'
if [[ -f "$bashrc" ]] && ! grep -qF "$marker" "$bashrc"; then
  {
    echo ""
    echo "$marker"
    echo 'export PATH="$HOME/.local/bin:$PATH"'
    echo 'eval "$(mise activate bash)"'
    echo '# <<< omarchy-border-fx mise <<<'
  } >> "$bashrc"
fi

# --- Repo toolchain (node pinned in mise.toml) ---------------------------
echo "Installing pinned tools from mise.toml"
mise install
mise reshim >/dev/null 2>&1 || true

# Hyprland v0.56.2 dev headers + deps for compile-only `mise run hypr-build`.
# Idempotent and self-skipping once the headers are present.
echo "Provisioning Hyprland plugin build headers"
mise run hypr-headers

echo ""
echo "Toolchain ready:"
echo "  node    $(mise exec -- node --version 2>/dev/null || echo '?')"
echo "  g++     $(g++ -dumpversion 2>/dev/null || echo '?')"
echo "  qsb     $(/usr/lib/qt6/bin/qsb --version 2>/dev/null | head -1 || echo 'missing')"
echo "  qmllint $(/usr/lib/qt6/bin/qmllint --version 2>/dev/null | head -1 || echo 'missing')"
echo ""
echo "omarchy-border-fx bootstrap complete. Headless dev flows:"
echo "  cd $repo_root"
echo "  mise run test        # compositor-free JS suite (CI contract)"
echo "  mise run bake        # shaders/*.frag -> .qsb + inline GLES"
echo "  mise run hypr-test   # Hyprland C++ logic tests"
