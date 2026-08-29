# Shared paths for hypr-ensure / hypr-teardown / look-apply / reinstall.
# Sourced, not executed. No sudo. User-level only.

PLUGIN_ID="${PLUGIN_ID:-wmfeht.border-fx}"
LEGACY_PLUGIN_ID="${LEGACY_PLUGIN_ID:-qs.border-fx}"
OLDER_LEGACY_PLUGIN_ID="${OLDER_LEGACY_PLUGIN_ID:-qs.shiny-border}"
# Compositor plugin that implements the "shiny" effect. Other effects will
# get their own .so names; this is not the Omarchy config id.
PLUGIN_NAME="${PLUGIN_NAME:-hypr-shiny-border}"
SESSION_SO="${SESSION_SO:-$HOME/.local/lib/hypr/hypr-shiny-border.so}"
LUA_FILE="${LUA_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/hypr/border-fx.lua}"
LEGACY_LUA_FILE="${LEGACY_LUA_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/hypr/shiny-border.lua}"
LUA_MODULE="${LUA_MODULE:-hypr.border-fx}"
HYPRLAND_LUA="${HYPRLAND_LUA:-${XDG_CONFIG_HOME:-$HOME/.config}/hypr/hyprland.lua}"
BUILD_DIR="${BUILD_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/omarchy-border-fx}"
# Identity the last session/cache .so was built against. Missing stamp is stale.
HYPR_ABI_STAMP="${HYPR_ABI_STAMP:-$BUILD_DIR/abi-identity}"
# Set when PLUGIN_INIT last failed compositor/client hash mismatch.
HYPR_ABI_HASH_MISMATCH="${HYPR_ABI_HASH_MISMATCH:-$BUILD_DIR/hash-mismatch}"
HYPRCTL_INSTANCE="${SHINY_INSTANCE:-0}"

_paths_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_ROOT=$(cd "$_paths_dir/.." && pwd)
HYPR_SRC="${HYPR_SRC:-$PLUGIN_ROOT/hypr}"
# Detached hypr-teardown vs hypr-ensure serialize on this lock.
_runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
HYPR_SESSION_LOCK="${HYPR_SESSION_LOCK:-$_runtime_dir/omarchy-border-fx/hypr-session.lock}"
HYPR_SESSION_GEN="${HYPR_SESSION_GEN:-$_runtime_dir/omarchy-border-fx/hypr-ensure.gen}"
