# omarchy-border-fx

One git tree, two renderers, one Omarchy plugin as the control plane.

The same conic comet on a rounded-rect ring: **Hyprland window decorations**
(`hypr-shiny-border.so`) and **Omarchy / Quickshell chrome** (panels,
notification toasts). Changing the look in `shell.json` updates both.

This is what `omarchy plugin add <url>` clones. The Hyprland `.so` is a
compositor plugin, not a Quickshell plugin — Omarchy never compiles it. After
enable, `Service.qml` runs `scripts/hypr-ensure.sh` (user-level, no sudo) to
build/load `~/.local/lib/hypr/hypr-shiny-border.so`.

| Name | Role |
|---|---|
| Omarchy id `wmfeht.border-fx` | Source of truth in `shell.json`; `omarchy plugin enable` |
| `effect` (`shiny` / `ripple`) | Which renderer to drive |
| Hyprland plugin `hypr-shiny-border` | Shiny window adapter (`hyprctl plugin list`, hyprpm, `PLUGIN_INIT`) |
| Config keys `plugin:shiny-border:*` / Lua `shiny_border` | Shiny Hyprland adapter (hyphen → underscore) |

## Install

```sh
omarchy plugin add <git-url-of-this-repo> --enable --yes
```

`omarchy plugin add` alone clones files; nothing is loaded until enable.
`--enable` starts the service, which overlays chrome **and** ensures the
window ring.

The previous Omarchy id was `qs.border-fx` (and before that `qs.shiny-border`).
Look reading still falls back to those entries if `wmfeht.border-fx` is missing.
Enable the new id (and disable the old one) so `omarchy plugin` commands match
the clone directory.

```sh
omarchy plugin enable wmfeht.border-fx    # chrome + window ring on
omarchy plugin disable wmfeht.border-fx   # both off; clone kept
omarchy plugin remove wmfeht.border-fx --yes
omarchy plugin update wmfeht.border-fx --yes
```

If the shell was not running during remove, also:

```sh
~/.config/omarchy/plugins/wmfeht.border-fx/scripts/hypr-teardown.sh --purge
# or, from this tree:
bash scripts/hypr-teardown.sh --purge
```

That deletes `~/.local/lib/hypr/hypr-shiny-border.so` and
`~/.config/hypr/border-fx.lua`. It does **not** rewrite `looknfeel.lua`.

Dev copy (not git-managed, not `omarchy plugin update`):

```sh
mise run install     # copies into ~/.config/omarchy/plugins/wmfeht.border-fx
mise run uninstall
mise run reinstall   # purge the live .so, restart shell, add this folder; keeps shell.json look
```

### Already using hyprpm?

Loading the plugin twice is a hard error. `hypr-ensure.sh` will reuse the
hyprpm copy and notify you instead of stacking a second `.so`.

```sh
hyprpm disable hypr-shiny-border
# drop `hyprpm reload -n` from ~/.config/hypr/autostart.lua if it exists
# only for this plugin, then:
omarchy plugin enable wmfeht.border-fx
```

hyprpm remains the Hyprland **development** workflow (`mise run nest`).
`hyprpm.toml` is at this repo root so `hyprpm add <same-url>` still builds.

### Hyprland headers

The window ring is compiled against the running compositor. If `make` fails,
chrome still runs and you get a notification. Fix: matching Hyprland headers,
then re-enable (or `omarchy restart shell`). `PLUGIN_INIT` still refuses a
header-hash mismatch.

## Configuration

Source of truth: the `wmfeht.border-fx` entry in
`~/.config/omarchy/shell.json` `plugins[]`. Settings are **inline on that
object** — no `config:` / `settings:` wrapper, no extra JSON file. The
plugin is on if and only if that id is present (`omarchy plugin enable` /
`disable`). Look reading still falls back to leftover `qs.border-fx` or
`qs.shiny-border` entries if `wmfeht.border-fx` is missing.

`effect` selects the renderer (`shiny` or `ripple`). Chrome overlays
attach while `effect` is `shiny` or `ripple`. Any other value detaches
chrome and fans out `enabled = false` to the Hyprland adapter (look
keys still merge). Ripple is a lighting-only crest on the same ring:
empty/`omitted` `effect` stays `"shiny"`.

Missing or `null` look keys mean the **shared look** (pinned 120°,
shimmer, 2-stop light glint, wrap stroke). Hyprland `PLUGIN_INIT` registers the
same numbers, so first paint matches chrome. An empty `gradient` array is
a real override (two-stop `colA`/`colB`), not “use the default ramp.”

There is no settings UI for this service. Edit `shell.json` and save:

- **Chrome** (panels, toasts) hot-reloads from the same process.
- **Windows** debounce ~150 ms, then `look-apply.sh` writes
  `~/.config/hypr/border-fx.lua` and `hyprctl eval`s it if
  `hypr-shiny-border` is loaded. If the `.so` is not loaded, the lua is
  still written and eval is skipped until the next ensure.

A generated `~/.config/hypr/border-fx.lua` is an **output**, not an
input. Do not edit it. `omarchy refresh hyprland` can drop the one-line
`pcall(require, "hypr.border-fx")` from `hyprland.lua`; the next service
start still `hyprctl plugin load`s.

Until you delete the gated `shiny_border` block from `looknfeel.lua`, that
file can fight plugin settings on `reloadConfig()`. Leave it until fan-out
looks right, then remove it.

### Example

All keys at their shared defaults (equivalent to `{ "id": "wmfeht.border-fx" }`):

```json
{
  "id": "wmfeht.border-fx",
  "effect": "shiny",
  "borderSize": 2,
  "shimmer": true,
  "shimmerHz": 0.28,
  "shimmerDeg": 22,
  "shimmerScaleMin": 0.8,
  "shimmerScaleMax": 1.4,
  "pinDeg": 120,
  "angleOffset": 0,
  "lobe": 0.16,
  "mirror": true,
  "gradient": [
    "rgba(f7ffffee)",
    "rgba(0a3f4700)"
  ],
  "gradientPositions": "0 99",
  "gradientCw": [],
  "gradientPositionsCw": "0 22 50 100",
  "colA": "rgba(f7ffffee)",
  "colB": "rgba(0a3f4700)",
  "baseColor": "rgba(0a3f47dd)",
  "activeOnly": true,
  "pulse": false,
  "pulseHz": 0.4,
  "rippleFreq": 0.025,
  "rippleSpeed": 2,
  "rippleGain": 0.85,
  "ripplePower": 8,
  "rippleOriginX": 0.5,
  "rippleOriginY": 0.5,
  "rippleFade": 0
}
```

Look keys may also sit under a nested object named after the effect.
Nested keys win over the same key at the top level:

```json
{
  "id": "wmfeht.border-fx",
  "effect": "shiny",
  "pinDeg": 0,
  "shiny": { "pinDeg": 45, "borderSize": 3 }
}
```

That look is `pinDeg` 45, `borderSize` 3, everything else default.

Ripple is the same swap: `"effect": "ripple"` plus an optional nested
`"ripple"` object. Nested keys win; missing ripple keys use dedicated
defaults (not the shiny C++ numbers).

```json
{
  "id": "wmfeht.border-fx",
  "effect": "ripple",
  "ripple": { "rippleFreq": 0.02, "rippleGain": 0.7, "rippleOriginX": 0.5, "rippleFade": 0 }
}
```

### Colors

Canonical strings are Hyprland `rgba(RRGGBBAA)` (hex, no commas). The
chrome adapter converts to Qt `#AARRGGBB`. Accepted on the way in:

| Form | Example | Notes |
|---|---|---|
| `rgba(RRGGBBAA)` | `"rgba(33ccffee)"` | Canonical. Write this. |
| `rgb(RRGGBB)` | `"rgb(007a48)"` | Alpha `ff`. |
| `#AARRGGBB` | `"#ee33ccff"` | Qt order (alpha first). |
| `#RRGGBB` | `"#33ccff"` | Alpha `ff`. |
| object | `{ "r": 0.2, "g": 0.8, "b": 1, "a": 0.9 }` | Channels in 0..1 (`a` optional, default 1). |

Junk / unparsable colors become transparent `rgba(00000000)`.

A color list (`gradient`, `gradientCw`) may be a JSON array of those
strings, or a Hyprland-style object `{ "colors": [ … ] }`. At most **8**
stops are used; extra colors are dropped.

### Merge rules

1. Read the `plugins[]` entry whose `id` is `wmfeht.border-fx` (else
   `qs.border-fx`, else `qs.shiny-border`).
2. `effect` empty / omitted → `"shiny"`.
3. Pick known look keys from the entry (not `id`, not unknown fields).
4. If `entry[effect]` is an object, overlay its look keys (nested wins).
5. Any still-missing key gets the shared default above.
6. `gradient` / `gradientCw` are normalized to arrays.

`id` is not a look key. Leftover `pin` and `quantizeDeg` are ignored —
heading is always `pinDeg` + `angleOffset`. `pin: false` does **not**
restore cursor tracking.

`enabled` is not a look key either. `omarchy plugin disable wmfeht.border-fx`
turns both rings off (`enabled = false` in the generated lua, chrome
overlays destroyed). Re-enable to bring them back.

### Look keys

**Hosts:** *both* = windows and chrome. *windows* = Hyprland decoration
only (chrome ignores the key).

| JSON key | Type | Default | Hosts | What it does |
|---|---|---|---|---|
| `effect` | string | `"shiny"` | both | Renderer. `"shiny"` or `"ripple"` draws on chrome and windows. Anything else: chrome off, `.so` not loaded / `enabled = false`. |
| `borderSize` | number (px) | `2` | both | Ring thickness. Chrome: overlay hidden when `≤ 0`. Hyprland clamps to `-1…20`; `-1` follows `general:border_size` on windows only. |
| `baseColor` | color | `"rgba(0a3f47dd)"` | both | Wrapping stroke **under** the directional highlight, same thickness as the ring. Transparent (`a = 0`) = off. Not Hyprland `decoration:shadow`, not a gradient stop. Far-side highlight uses the last stop’s alpha; the wrap is what still paints when that alpha is low. |
| `pinDeg` | number (°) | `120` | both | Light heading, degrees CCW. `0` = from the right, `90` = from above. Hyprland clamps `-360…360`. |
| `angleOffset` | number (°) | `0` | both | Added to `pinDeg` before drawing. Hyprland clamps `-180…180`. |
| `lobe` | number | `0.16` | both | Lit-band **half-width** along the light axis. `0.5` = the whole window. Hyprland clamps config to `0.04…0.5`. Chrome clamps a walking lobe to that range, and a static lobe to at least `0.04`. |
| `mirror` | bool | `true` | both | Mirror the same lobe onto the **far side** of the light axis (two comet heads). Off keeps a facing-only comet. Cone, ramp, glow, and local thickness all follow the nearer-end distance. The clockwise vs primary half split is unchanged. |
| `gradient` | color list | 2-stop light glint | both | Comet ramp, **facing support first**, last stop = edge of the lit band (`lobe`). Fewer than two colors turns the ramp off and uses `colA` / `colB`. |
| `gradientPositions` | string | `"0 99"` | both | Stop positions for `gradient`. See [Gradient](#gradient). |
| `gradientCw` | color list | `[]` | both | Optional colors for the **clockwise** half of the light axis. See [Clockwise half](#clockwise-half). |
| `gradientPositionsCw` | string | `"0 22 50 100"` | both | Stop positions for the clockwise half. |
| `colA` | color | `"rgba(f7ffffee)"` | both | Two-stop head. Used only when `gradient` has fewer than two colors. |
| `colB` | color | `"rgba(0a3f4700)"` | both | Two-stop shoulder. Same condition as `colA`. |
| `shimmer` | bool | `true` | both | Random walk of heading and highlight size. Exclusive with `pulse` (**shimmer wins** if both are on and their Hz `> 0`). |
| `shimmerHz` | number | `0.28` | both | Average retargets per second. `0` (or `shimmer: false`) freezes the walk. Hyprland clamps `0…4`. |
| `shimmerDeg` | number | `22` | both | Max wander **each side** of the heading, degrees. Hyprland clamps `0…180`. |
| `shimmerScaleMin` | number | `0.8` | both | Lower bound of the size walk. Swapped with max if inverted. Hyprland clamps `0.2…3`. |
| `shimmerScaleMax` | number | `1.4` | both | Upper bound of the size walk. Scale also fattens/thins the stroke (~35% of the deviation from 1). Hyprland clamps `0.2…3`. |
| `activeOnly` | bool | `true` | windows | Only the focused window draws / shimmers / pulses / ripples. Unfocused windows keep the reserved padding so layout does not jump. Chrome has no unfocused state, so it ignores this key. |
| `pulse` | bool | `false` | both | Oscillate highlight **transparency** in the shader (`0.5+0.5*sin`). Does not change lobe width or thickness. Ignored while shimmer is running. |
| `pulseHz` | number | `0.4` | both | Pulse rate. `0` disables. Hyprland clamps `0…4`. |
| `rippleFreq` | number | `0.025` | both | Ripple spatial `k` (1/px). Dedicated default (modest). Hyprland clamps `0.001…0.2`. |
| `rippleSpeed` | number | `2` | both | Ripple temporal speed. Dedicated default (slow). Hyprland clamps `0…40`. |
| `rippleGain` | number | `0.85` | both | Blend from the shiny comet (`0`) to crest-only lighting (`1`). `0` matches shiny. Hyprland clamps `0…2`. |
| `ripplePower` | number | `8` | both | `pow` on the sine lobe; higher = thinner bands. Hyprland clamps `1…16`. |
| `rippleOriginX` | number | `0.5` | both | Ripple origin X in decoration-box UV (`0` = left, `1` = right). Default is the box center (today’s `length(pUp)` origin). Hyprland clamps `0…1`. |
| `rippleOriginY` | number | `0.5` | both | Ripple origin Y in decoration-box UV (`0` = top, `1` = bottom). Hyprland clamps `0…1`. |
| `rippleFade` | number | `0` | both | Spatial fade as a **proportion of the decoration-box perimeter** (`2 × (width + height)`). Envelope is 1 at the origin and 0 at/beyond `rippleFade × perimeter` pixels. `0` (or any non-positive value) is off. Hyprland clamps `0…1`. |

Hyprland adapter keys (what you see in generated lua / `plugin:shiny-border:*`)
use snake_case: `border_size`, `pin_deg`, `angle_offset`, `base_color`,
`gradient_positions`, `gradient_cw`, `gradient_positions_cw`, `col.a`,
`col.b`, `active_only`, `pulse_hz`, `shimmer_hz`, `shimmer_deg`,
`shimmer_scale_min`, `shimmer_scale_max`, `mirror`, `effect`, `ripple_freq`,
`ripple_speed`, `ripple_gain`, `ripple_power`, `ripple_origin_x`,
`ripple_origin_y`, `ripple_fade`. Hyphens in the Hyprland plugin
prefix become underscores in Lua (`shiny_border`).

Not a look key (hardcoded or host-owned):

| Thing | Where it lives |
|---|---|
| `roundingPower` | Chrome shader default `2`. Windows use each window’s Hyprland rounding. |
| `enabled` | Omarchy plugin enable/disable, fanned out to `plugin:shiny-border:enabled`. |
| Cursor / mouse follow | Removed. Heading is pin + offset (+ shimmer). |

### Gradient

The ramp is a **parallel projection onto the light axis**, not a conic
sweep around the window center. A wide panel and a tall one with the same
heading share a direction. Iso-lines are perpendicular to the light.

Stops fill the **lit band** (`lobe`, including shimmer scale), not the
full window. Highlight RGB and alpha come from the sampled stop; a
specular/white core has to be a stop, not a shader mix toward white.

- **0** = facing support of this rounded rect (where the comet sits).
- **100** = edge of the comet (`d0 = lobe`). Past that the last stop is
  held (RGB and alpha).
- `lobe` 0.5 (the whole window) is the same mapping as stretching 0…100
  across the axis. Smaller lobes compress the same stop list into the
  comet so every stop stays visible in the highlight.
- With `mirror` on, the same 0…100 band is also measured from the far
  support, so both ends of the axis are comet heads. Mid-axis past both
  lobe edges still holds the last stop.
- Each half of the axis (facing → far, then the other flank) runs that
  0…100 independently. Primary colors/positions paint one half;
  clockwise colors/positions paint the other. Match first and last
  colors between the halves to avoid a seam.

`gradientPositions` / `gradientPositionsCw` are strings of one percentage
**per color**, separated by spaces, tabs, or commas. A trailing `%` is
allowed (`"0 70 100"` and `"0%, 70%, 100%"` are the same). Values are
clamped to 0…100 and forced non-decreasing (a stop cannot sit before its
predecessor).

The spec is all-or-nothing: token count must equal the color count (2…8),
and every token must parse. Empty, junk, or a count mismatch → **even
spacing** (`0 … 100` in equal steps). That is why a 4-stop ramp with
positions `"0 50"` silently even-spaces instead of stretching two numbers.

Default `"0 99"` puts the white head at the facing edge and the
transparent teal at the comet tail.

### Clockwise half

`gradientCw` / `gradientPositionsCw` never turn the ramp **on**. If
`gradient` has fewer than two colors, clockwise config is ignored.

| `gradientCw` | `gradientPositionsCw` | Clockwise half |
|---|---|---|
| ≥ 2 colors | valid spec matching that count | Own colors, own spacing. |
| ≥ 2 colors | empty / invalid | Own colors, **even** spacing (not the primary positions). |
| empty / fewer than 2 | valid spec matching primary count | Primary colors, reshaped. Default `"0 22 50 100"` is four tokens, so with the 2-stop ramp it mismatches and falls through to a mirror of the primary positions. |
| empty / fewer than 2 | empty / invalid | Exact **mirror** of the primary positions. |

### Heading and motion

Heading in radians is `wrap( (pinDeg + angleOffset) × π/180 )`, then
shimmer adds a wander in `±shimmerDeg` when shimmer is on.

Shimmer is two independent CPU walks (not GLSL): angle and size. Each
channel eases toward a random target, then picks a new target and
duration (0.6–1.4 of `1/shimmerHz`) so they drift out of lockstep.
Windows seed per decoration so overlapping windows do not walk in unison.

When both shimmer and pulse could run, **shimmer wins**. Pulse uniforms
are zeroed (`brightness` stays 0) until shimmer is off or its Hz is `≤ 0`.

### Recipes

Thinner wrap-free ring, light from above:

```json
{
  "id": "wmfeht.border-fx",
  "borderSize": 1,
  "pinDeg": 90,
  "baseColor": "rgba(00000000)"
}
```

Classic two-stop comet (`colA` / `colB`) instead of the default ramp:

```json
{
  "id": "wmfeht.border-fx",
  "gradient": [],
  "colA": "rgba(33ccffee)",
  "colB": "rgba(00ff99ee)"
}
```

Pulse instead of shimmer (windows and chrome both breathe highlight alpha):

```json
{
  "id": "wmfeht.border-fx",
  "shimmer": false,
  "pulse": true,
  "pulseHz": 0.4
}
```

Different clockwise-half colors (keep endpoints aligned to hide the seam):

```json
{
  "id": "wmfeht.border-fx",
  "gradientCw": [
    "rgba(f7ffffee)",
    "rgba(c084fcee)",
    "rgba(7c3aedee)",
    "rgba(0a3f4700)"
  ]
}
```

## Tree

```
manifest.json                 # Omarchy id wmfeht.border-fx (clone root)
Service.qml                   # chrome overlay + hypr-ensure + look fan-out
qml/                          # ShinyBorder, Shimmer, Gradient, Look
shaders/                      # shiny.frag + committed .qsb
hypr/                         # shiny compositor plugin (src, Makefile, nest, tests)
hyprpm.toml                   # clone root, so hyprpm add of this URL works
scripts/
  hypr-ensure.sh              # build/install/load ~/.local/lib/hypr/… (no sudo)
  hypr-session.sh             # mapped-.so helpers; install via rename, not cp -f
  hypr-teardown.sh            # unload session copy; --purge deletes it
  look-apply.sh               # JSON look → border-fx.lua + hyprctl eval
  install.sh / uninstall.sh   # dev copy helpers
  reinstall.sh                # purge, restart shell, add --enable; keeps shell.json look
```

No symlinks inside the plugin folder (`omarchy plugin validate` refuses them).
Build artifacts are gitignored; user builds write to
`$XDG_CACHE_HOME/omarchy-border-fx`, not the checkout.

## Dev

```sh
mise run bake        # shaders/shiny.frag → .qsb
mise run test        # shimmer + gradient + look adapter (no compositor)
mise run lint        # qmllint ShinyBorder.qml
mise run check       # bake + lint + test
mise run preview     # standalone qs window; does not touch omarchy-shell
mise run hypr-build  # hypr-shiny-border.so
mise run hypr-test   # C++ logic tests
mise run nest        # nested Hyprland crash sandbox
mise run reload      # rebuild + load into the nest
mise run reinstall   # purge live .so, restart shell, add this folder; keeps shell.json look
```

Hyprland C++ iteration: [hypr/DEVELOPMENT.md](hypr/DEVELOPMENT.md). Chrome
shader/QML details: `qml/ShinyBorder.qml`. Design notes:
[docs/unified-project.md](docs/unified-project.md).

MIT. See [LICENSE](LICENSE).
