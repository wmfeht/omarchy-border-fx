# Shared paths for hypr-ensure / hypr-teardown / look-apply.
# Sourced, not executed. No sudo. User-level only.

PLUGIN_ID="${PLUGIN_ID:-qs.shiny-border}"
PLUGIN_NAME="${PLUGIN_NAME:-hypr-shiny-border}"
SESSION_SO="${SESSION_SO:-$HOME/.local/lib/hypr/hypr-shiny-border.so}"
LUA_FILE="${LUA_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/hypr/shiny-border.lua}"
HYPRLAND_LUA="${HYPRLAND_LUA:-${XDG_CONFIG_HOME:-$HOME/.config}/hypr/hyprland.lua}"
BUILD_DIR="${BUILD_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/omarchy-border-fx}"
HYPRCTL_INSTANCE="${SHINY_INSTANCE:-0}"

_paths_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_ROOT=$(cd "$_paths_dir/.." && pwd)
HYPR_SRC="$PLUGIN_ROOT/hypr"
