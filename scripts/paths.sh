# Shared paths for hypr-ensure / hypr-teardown / look-apply.
# Sourced, not executed. No sudo. User-level only.

PLUGIN_ID="${PLUGIN_ID:-qs.border-fx}"
LEGACY_PLUGIN_ID="${LEGACY_PLUGIN_ID:-qs.shiny-border}"
# Compositor plugin that implements the "shiny" effect. Other effects will
# get their own .so names; this is not the Omarchy config id.
PLUGIN_NAME="${PLUGIN_NAME:-hypr-shiny-border}"
SESSION_SO="${SESSION_SO:-$HOME/.local/lib/hypr/hypr-shiny-border.so}"
LUA_FILE="${LUA_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/hypr/border-fx.lua}"
LEGACY_LUA_FILE="${LEGACY_LUA_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/hypr/shiny-border.lua}"
LUA_MODULE="${LUA_MODULE:-hypr.border-fx}"
HYPRLAND_LUA="${HYPRLAND_LUA:-${XDG_CONFIG_HOME:-$HOME/.config}/hypr/hyprland.lua}"
BUILD_DIR="${BUILD_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/omarchy-border-fx}"
HYPRCTL_INSTANCE="${SHINY_INSTANCE:-0}"

_paths_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_ROOT=$(cd "$_paths_dir/.." && pwd)
HYPR_SRC="$PLUGIN_ROOT/hypr"
