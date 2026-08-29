#!/usr/bin/env bash
# Fan-out: Omarchy plugin look (JSON, camelCase, rgba()) on wmfeht.border-fx
# → generated ~/.config/hypr/border-fx.lua and optional hyprctl eval.
# The shiny effect still writes plugin.shiny_border (Hyprland adapter keys).
# This is the only adapter that knows both schemas. No sudo.
set -euo pipefail

_script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=paths.sh
source "$_script_dir/paths.sh"

usage() {
  cat <<USAGE
Usage: look-apply.sh [--eval] [--disabled] [--no-load] [--stdout] [--lua PATH] [--look-json JSON]

Reads the shared look as JSON (LOOK_JSON, --look-json, or stdin).
Writes $LUA_FILE unless --stdout.
--eval      hyprctl eval dofile() of that lua, only if the shiny Hyprland plugin is loaded
--disabled  enabled=false and skip hl.plugin.load (Omarchy plugin is off)
--no-load   skip hl.plugin.load even when enabled
USAGE
}

do_eval=0
disabled=0
no_load=0
do_stdout=0
look_json="${LOOK_JSON:-}"

while (( $# > 0 )); do
  case "$1" in
    --eval) do_eval=1; shift ;;
    --no-eval) do_eval=0; shift ;;
    --disabled) disabled=1; shift ;;
    --no-load) no_load=1; shift ;;
    --stdout) do_stdout=1; shift ;;
    --lua)
      LUA_FILE="${2:-}"
      [[ -n $LUA_FILE ]] || { echo "look-apply: --lua requires a path" >&2; exit 2; }
      shift 2
      ;;
    --look-json)
      look_json="${2:-}"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "look-apply: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z $look_json && ! -t 0 ]]; then
  look_json=$(cat)
fi
if [[ -z $look_json ]]; then
  look_json='{}'
fi

load=1
(( disabled )) && load=0
(( no_load )) && load=0
enabled=1
(( disabled )) && enabled=0

lua=$(LOOK_JSON="$look_json" SESSION_SO="$SESSION_SO" SHINY_LOAD="$load" SHINY_ENABLED="$enabled" PLUGIN_ID="$PLUGIN_ID" python3 - <<'PY'
import json, math, os, re, sys

DEFAULTS = {
    "effect": "shiny",
    "borderSize": 2,
    "shimmer": True,
    "shimmerHz": 0.3,
    "shimmerDeg": 20,
    "shimmerScaleMin": 0.75,
    "shimmerScaleMax": 1.35,
    "pinDeg": 120,
    "angleOffset": 0,
    "lobe": 0.18,
    "mirror": False,
    "gradient": [
        "rgba(33ccffee)",
        "rgba(1ad4c0ee)",
        "rgba(007a48ee)",
        "rgba(004830aa)",
    ],
    "gradientPositions": "0 1 3 100",
    "gradientCw": [],
    "gradientPositionsCw": "0 22 50 100",
    "colA": "rgba(33ccffee)",
    "colB": "rgba(00ff99ee)",
    "baseColor": "rgba(00687855)",
    "activeOnly": True,
    "pulse": False,
    "pulseHz": 0.4,
    "rippleFreq": 0.025,
    "rippleSpeed": 2,
    "rippleGain": 0.85,
    "ripplePower": 8,
    "rippleOriginX": 0.5,
    "rippleOriginY": 0.5,
    "rippleFade": 0,
}

raw = os.environ.get("LOOK_JSON") or "{}"
try:
    src = json.loads(raw)
except json.JSONDecodeError as e:
    print("look-apply: invalid JSON:", e, file=sys.stderr)
    sys.exit(2)
if not isinstance(src, dict):
    src = {}

def as_color_list(v):
    if not v:
        return []
    if isinstance(v, list):
        return v
    if isinstance(v, dict) and isinstance(v.get("colors"), list):
        return v["colors"]
    return []

effect = src.get("effect")
if effect is None or effect == "":
    effect = "shiny"
effect = str(effect)
merged_src = dict(src)
nested = src.get(effect)
if isinstance(nested, dict):
    for k, v in nested.items():
        if v is not None:
            merged_src[k] = v

BOOL_KEYS = ("shimmer", "mirror", "activeOnly", "pulse")
INT_RANGE = {
    "borderSize": (0, 20),
    "pinDeg": (-360, 360),
    "angleOffset": (-180, 180),
    "shimmerDeg": (0, 180),
}
FLOAT_RANGE = {
    "shimmerHz": (0.0, 4.0),
    "pulseHz": (0.0, 4.0),
    "shimmerScaleMin": (0.2, 3.0),
    "shimmerScaleMax": (0.2, 3.0),
    "lobe": (0.04, 0.5),
    "rippleFreq": (0.001, 0.2),
    "rippleSpeed": (0.0, 40.0),
    "rippleGain": (0.0, 2.0),
    "ripplePower": (1.0, 16.0),
    "rippleOriginX": (0.0, 1.0),
    "rippleOriginY": (0.0, 1.0),
    "rippleFade": (0.0, 1.0),
}

def warn_look(key, why):
    print(f"look: {key}: {why}, keeping default", file=sys.stderr)

def coerce_bool(v):
    if v is True or v is False:
        return v
    if type(v) is int and v in (0, 1):
        return bool(v)
    if type(v) is float and v in (0.0, 1.0):
        return bool(int(v))
    return None

def coerce_num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and math.isfinite(v):
        return float(v)
    return None

def js_round(n):
    return int(math.floor(n + 0.5))

def clamp_num(n, lo, hi):
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n

def coerce_key(key, value, default):
    if key in BOOL_KEYS:
        b = coerce_bool(value)
        if b is None:
            warn_look(key, "invalid bool")
            return default
        return b
    if key in INT_RANGE:
        n = coerce_num(value)
        if n is None:
            warn_look(key, "invalid number")
            return default
        i = js_round(n)
        if key == "borderSize" and i < 0:
            warn_look(key, "illegal negative")
            return default
        lo, hi = INT_RANGE[key]
        return clamp_num(i, lo, hi)
    if key in FLOAT_RANGE:
        n = coerce_num(value)
        if n is None:
            warn_look(key, "invalid number")
            return default
        lo, hi = FLOAT_RANGE[key]
        return clamp_num(n, lo, hi)
    return value

look = {"effect": effect}
for key, default in DEFAULTS.items():
    if key == "effect":
        continue
    if key in merged_src and merged_src[key] is not None:
        look[key] = coerce_key(key, merged_src[key], default)
    else:
        look[key] = default
look["gradient"] = as_color_list(look.get("gradient"))
look["gradientCw"] = as_color_list(look.get("gradientCw"))
look["gradientPositions"] = str(look.get("gradientPositions") or "")
look["gradientPositionsCw"] = str(look.get("gradientPositionsCw") or "")

def parse_color(s):
    if s is None:
        return None
    if isinstance(s, dict) and "r" in s:
        return {
            "r": float(s.get("r") or 0),
            "g": float(s.get("g") or 0),
            "b": float(s.get("b") or 0),
            "a": 1.0 if s.get("a") is None else float(s.get("a") or 0),
        }
    text = str(s).strip()
    m = re.match(r"^rgba?\(\s*([0-9a-fA-F]{6}|[0-9a-fA-F]{8})\s*\)$", text)
    if m:
        hexv = m.group(1)
        if len(hexv) == 6:
            hexv += "ff"
        return {
            "r": int(hexv[0:2], 16) / 255.0,
            "g": int(hexv[2:4], 16) / 255.0,
            "b": int(hexv[4:6], 16) / 255.0,
            "a": int(hexv[6:8], 16) / 255.0,
        }
    m = re.match(r"^#([0-9a-fA-F]{8})$", text)
    if m:
        hexv = m.group(1)
        return {
            "a": int(hexv[0:2], 16) / 255.0,
            "r": int(hexv[2:4], 16) / 255.0,
            "g": int(hexv[4:6], 16) / 255.0,
            "b": int(hexv[6:8], 16) / 255.0,
        }
    m = re.match(r"^#([0-9a-fA-F]{6})$", text)
    if m:
        hexv = m.group(1)
        return {
            "a": 1.0,
            "r": int(hexv[0:2], 16) / 255.0,
            "g": int(hexv[2:4], 16) / 255.0,
            "b": int(hexv[4:6], 16) / 255.0,
        }
    return None

def hex2(n):
    v = int(round(float(n)))
    v = 0 if v < 0 else 255 if v > 255 else v
    return f"{v:02x}"

def to_hypr(s):
    c = parse_color(s)
    if not c:
        return "rgba(00000000)"
    return "rgba(" + hex2(c["r"] * 255) + hex2(c["g"] * 255) + hex2(c["b"] * 255) + hex2(c["a"] * 255) + ")"

def lua_str(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'

def lua_bool(v):
    return "true" if v is True else "false"

def lua_num(v):
    if isinstance(v, bool):
        return lua_bool(v)
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "0"
    if not math.isfinite(n):
        return "0"
    if n.is_integer():
        return str(int(n))
    return repr(n)

def lua_colors(values):
    inner = ", ".join(lua_str(to_hypr(c)) for c in values)
    return "{ colors = { " + inner + " } }"

grad = [to_hypr(c) for c in look["gradient"]]
cw = [to_hypr(c) for c in look["gradientCw"]]
if len(grad) < 2:
    grad_lua = lua_colors([look["colA"]])
else:
    grad_lua = lua_colors(look["gradient"])
if len(cw) < 2:
    cw_lua = lua_colors([look["colA"]])
else:
    cw_lua = lua_colors(look["gradientCw"])

session_so = os.environ.get("SESSION_SO") or ""
plugin_id = os.environ.get("PLUGIN_ID") or "wmfeht.border-fx"
effect_draws = look.get("effect") in ("shiny", "ripple")
load = os.environ.get("SHINY_LOAD", "1") != "0" and effect_draws
enabled = os.environ.get("SHINY_ENABLED", "1") != "0" and effect_draws

lines = [
    "-- Generated by " + plugin_id + " (look-apply). Do not edit.",
    "-- Source of truth: ~/.config/omarchy/shell.json plugins[] entry id " + plugin_id + ".",
    "-- Effect " + lua_str(look["effect"]) + " fans out to the Hyprland adapter (plugin:shiny-border / shiny_border) when effect is shiny or ripple.",
    "",
    'hl.permission({ binary = "/usr/(bin|local/bin)/hyprctl", type = "plugin", mode = "allow" })',
    "",
    "local SHINY_SO = " + lua_str(session_so),
    "local SHINY_LOAD = " + lua_bool(load),
    "",
    "local function shinyLoaded()",
    "  for _, p in ipairs(hl.get_loaded_plugins()) do",
    '    if p.name == "hypr-shiny-border" then',
    "      return true",
    "    end",
    "  end",
    "  return false",
    "end",
    "",
    "-- Load on hyprland.start, not during parse: PLUGIN_INIT reloads config.",
    "if SHINY_LOAD and not _G.__wmfeht_border_fx_start then",
    "  _G.__wmfeht_border_fx_start = true",
    "  hl.on(\"hyprland.start\", function()",
    "    if shinyLoaded() then",
    "      return",
    "    end",
    "    local f = io.open(SHINY_SO, \"r\")",
    "    if not f then",
    "      return",
    "    end",
    "    f:close()",
    "    hl.plugin.load(SHINY_SO)",
    "  end)",
    "end",
    "",
    "if shinyLoaded() then",
    "  hl.config({",
    "    plugin = {",
    "      shiny_border = {",
    "        enabled      = " + lua_bool(enabled) + ",",
    "        effect       = " + lua_str(look["effect"]) + ",",
    "        active_only  = " + lua_bool(look["activeOnly"]) + ",",
    "        pulse        = " + lua_bool(look["pulse"]) + ",",
    "        pulse_hz     = " + lua_num(look["pulseHz"]) + ",",
    "        ripple_freq  = " + lua_num(look["rippleFreq"]) + ",",
    "        ripple_speed = " + lua_num(look["rippleSpeed"]) + ",",
    "        ripple_gain  = " + lua_num(look["rippleGain"]) + ",",
    "        ripple_power = " + lua_num(look["ripplePower"]) + ",",
    "        ripple_origin_x = " + lua_num(look["rippleOriginX"]) + ",",
    "        ripple_origin_y = " + lua_num(look["rippleOriginY"]) + ",",
    "        ripple_fade  = " + lua_num(look["rippleFade"]) + ",",
    "        shimmer      = " + lua_bool(look["shimmer"]) + ",",
    "        shimmer_hz   = " + lua_num(look["shimmerHz"]) + ",",
    "        shimmer_deg  = " + lua_num(look["shimmerDeg"]) + ",",
    "        shimmer_scale_min = " + lua_num(look["shimmerScaleMin"]) + ",",
    "        shimmer_scale_max = " + lua_num(look["shimmerScaleMax"]) + ",",
    "        pin_deg      = " + lua_num(look["pinDeg"]) + ",",
    "        angle_offset = " + lua_num(look["angleOffset"]) + ",",
    "        lobe         = " + lua_num(look["lobe"]) + ",",
    "        mirror       = " + lua_bool(look["mirror"]) + ",",
    "        border_size  = " + lua_num(look["borderSize"]) + ",",
    "        col = {",
    "          a = " + lua_str(to_hypr(look["colA"])) + ",",
    "          b = " + lua_str(to_hypr(look["colB"])) + ",",
    "        },",
    "        base_color            = " + lua_str(to_hypr(look["baseColor"])) + ",",
    "        gradient              = " + grad_lua + ",",
    "        gradient_positions    = " + lua_str(look["gradientPositions"]) + ",",
    "        gradient_cw           = " + cw_lua + ",",
    "        gradient_positions_cw = " + lua_str(look["gradientPositionsCw"]) + ",",
    "      },",
    "    },",
    "  })",
    "end",
    "",
]
sys.stdout.write("\n".join(lines))
PY
)

if (( do_stdout )); then
  printf '%s' "$lua"
  exit 0
fi

mkdir -p "$(dirname "$LUA_FILE")"
tmp="${LUA_FILE}.tmp.$$"
printf '%s' "$lua" > "$tmp"
mv -f "$tmp" "$LUA_FILE"

if (( do_eval )); then
  if ! command -v hyprctl >/dev/null 2>&1; then
    echo "look-apply: hyprctl not found; wrote $LUA_FILE" >&2
    exit 0
  fi
  if hyprctl -i "$HYPRCTL_INSTANCE" plugin list -j 2>/dev/null \
      | jq -e 'any(.[]; .name == "hypr-shiny-border")' >/dev/null 2>&1; then
    eval_src=$(LUA_FILE="$LUA_FILE" python3 - <<'PY'
import os
p = os.environ["LUA_FILE"]
print("dofile(\"" + p.replace("\\", "\\\\").replace("\"", "\\\"") + "\")")
PY
)
    hyprctl -i "$HYPRCTL_INSTANCE" eval "$eval_src"
  else
    echo "look-apply: hypr-shiny-border not loaded; skipped eval (wrote $LUA_FILE)" >&2
  fi
fi
