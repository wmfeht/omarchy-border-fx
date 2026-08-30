# omarchy-border-fx

Animated border effects for [Omarchy](https://omarchy.org). The plugin
draws a rounded-rect ring around Hyprland windows and Omarchy shell chrome
(panels, notification toasts) and animates it with one of two renderers:
`shiny`, a directional comet highlight, or `ripple`, a traveling crest of
light. One configuration drives both surfaces: change the look once in
`shell.json` and windows and chrome update together.

> 0.1.0. Look keys and defaults may still change. After a Hyprland upgrade,
> re-enable so the window ring rebuilds against the new compositor. If you
> remove the plugin while the shell is down, leftover files stay; see
> [Remove](#remove).

## Install

```sh
omarchy plugin add https://github.com/wmfeht/omarchy-border-fx.git --enable --yes
```

`omarchy plugin add` on its own only clones the files; nothing draws until
the plugin is enabled. `--enable` starts the service, which overlays the
shell chrome and builds and loads the Hyprland window ring. Everything
runs at the user level; no sudo required. The baked shaders ship in the
repo, so the chrome effect needs no build tools; the window ring compiles
on your machine against the installed Hyprland headers.

Enable also writes `~/.config/hypr/border-fx.lua` and, if it isn't already
there, appends this to `~/.config/hypr/hyprland.lua`:

```lua
-- wmfeht.border-fx (Omarchy plugin control plane; pcall if the file is missing)
pcall(require, "hypr.border-fx")
```

The require is added once. `pcall` means a missing lua file is a no-op.

Manage the plugin with:

```sh
omarchy plugin enable wmfeht.border-fx    # chrome + window ring on
omarchy plugin disable wmfeht.border-fx   # both off; clone kept
omarchy plugin update wmfeht.border-fx --yes
```

### If the window ring fails to build

The window ring compiles on your machine, against the running compositor.
The build needs three packages, all in the Arch repos:

- `gcc`: the C++ compiler, same toolchain that builds Hyprland itself
- `pkgconf`: provides `pkg-config`, which locates the headers and libraries
- `hyprland`: ships its headers in `/usr/include/hyprland` and pulls in
  every library the plugin links against

```sh
sudo pacman -S --needed gcc pkgconf hyprland
```

The headers must match the running compositor. After a Hyprland upgrade,
re-enable the plugin or run `omarchy restart shell`: the build check
notices the version change and recompiles instead of loading a stale copy.

If the build still fails, the chrome effect keeps running and you get a
notification telling you what to do next.

## Configure

Settings live in `~/.config/omarchy/shell.json`, inline on the `plugins[]`
entry whose `id` is `wmfeht.border-fx`. There is no `config:` or
`settings:` wrapper and no separate JSON file:

```json
{
  "id": "wmfeht.border-fx",
  "effect": "shiny",
  "pinDeg": 90
}
```

There is no settings UI. Edit `shell.json` and save:

- Chrome (panels, toasts) picks up changes immediately.
- Windows follow a moment later: changes are debounced by about 150 ms,
  then fanned out to Hyprland.

The plugin is on if and only if that entry is present.
`omarchy plugin enable` and `disable` manage it.

`~/.config/hypr/border-fx.lua` is generated output, not an input. Don't
edit it. The `pcall(require, "hypr.border-fx")` line in `hyprland.lua` is
how Hyprland loads that file.

## Choose an effect

`effect` selects the renderer:

- `"shiny"` (default): a directional comet highlight on the ring.
- `"ripple"`: the same ring with crests of light traveling along it.
- Any other value turns both surfaces off. Look keys are kept, but nothing
  draws.

An empty or omitted `effect` means `"shiny"`.

## Recipes

Each snippet is a complete `plugins[]` entry. Add or change only the keys
you care about; everything else falls back to the defaults described
below.

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

Specular halo on bright border areas, bleeding outside the stroke (padding unchanged):

```json
{
  "id": "wmfeht.border-fx",
  "specularHalo": true
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

The rest of this file is reference: colors, defaults, every option, and
how the gradient maps onto the ring.

## Colors

Canonical strings are Hyprland `rgba(RRGGBBAA)` (hex, no commas). Accepted
on the way in:

| Form | Example | Notes |
|---|---|---|
| `rgba(RRGGBBAA)` | `"rgba(33ccffee)"` | Canonical. Write this. |
| `rgb(RRGGBB)` | `"rgb(007a48)"` | Alpha `ff`. |
| `#AARRGGBB` | `"#ee33ccff"` | Qt order (alpha first). |
| `#RRGGBB` | `"#33ccff"` | Alpha `ff`. |
| object | `{ "r": 0.2, "g": 0.8, "b": 1, "a": 0.9 }` | Channels in 0..1 (`a` optional, default 1). |

Junk / unparsable colors become transparent `rgba(00000000)`.

A color list (`gradient`, `gradientCw`) may be a JSON array of those
strings, or a Hyprland-style object `{ "colors": [ … ] }`. At most 8
stops are used; extra colors are dropped.

## Defaults

Missing or `null` keys give you the shared look: light pinned at 120°,
shimmer on, a 2-stop light glint, and a wrapping stroke. Windows and
chrome share these defaults, so first paint matches on both. An empty
`gradient` array is a real override: it falls back to the two-stop
`colA`/`colB` rather than the default ramp.

All keys at their shared defaults (equivalent to
`{ "id": "wmfeht.border-fx" }`):

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
  "rippleFade": 0,
  "specularHalo": false
}
```

### Per-effect overrides

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

Ripple works the same way: `"effect": "ripple"` plus an optional nested
`"ripple"` object. Nested keys win; missing ripple keys use dedicated
defaults (not the shiny defaults).

```json
{
  "id": "wmfeht.border-fx",
  "effect": "ripple",
  "ripple": { "rippleFreq": 0.02, "rippleGain": 0.7, "rippleOriginX": 0.5, "rippleFade": 0 }
}
```

## How settings resolve

1. The plugin reads the `plugins[]` entry whose `id` is
   `wmfeht.border-fx`.
2. `effect` empty or omitted means `"shiny"`.
3. Known look keys are picked from the entry; `id` and unknown fields are
   ignored.
4. If the entry has a nested object named after the effect, its look keys
   overlay the top level. Nested wins.
5. Any still-missing key gets the shared default above.
6. `gradient` and `gradientCw` are normalized to arrays.

`id` and `enabled` are not look keys. `omarchy plugin disable` is the only
off switch; it turns both surfaces off, and re-enabling brings them back.

## Option reference

In the Hosts column, *both* means windows and chrome; *windows* means the
Hyprland decoration only (chrome ignores the key).

| JSON key | Type | Default | Hosts | What it does |
|---|---|---|---|---|
| `effect` | string | `"shiny"` | both | Renderer. `"shiny"` or `"ripple"` draws on chrome and windows. Anything else: everything off. |
| `borderSize` | number (px) | `2` | both | Ring thickness. Chrome: overlay hidden when `≤ 0`. Hyprland clamps to `-1…20`; `-1` follows `general:border_size` on windows only. |
| `baseColor` | color | `"rgba(0a3f47dd)"` | both | Wrapping stroke **under** the directional highlight, same thickness as the ring. Transparent (`a = 0`) = off. Not a shadow, not a gradient stop. The wrap is what still paints on the far side when the highlight fades out. |
| `specularHalo` | bool | `false` | both | Specular halo on **bright** (lit) border regions — comet / ripple energy, not the wrapping stroke — that **bleeds outside** the ring's outer contour. Unlit / far regions stay hard-edged. Off (default) hides that outside halo. Does not change `borderSize` or reserved client padding. Hyprland and chrome both honor this. |
| `pinDeg` | number (°) | `120` | both | Light heading, degrees CCW. `0` = from the right, `90` = from above. Hyprland clamps `-360…360`. |
| `angleOffset` | number (°) | `0` | both | Added to `pinDeg` before drawing. Hyprland clamps `-180…180`. |
| `lobe` | number | `0.16` | both | Lit-band **half-width** along the light axis. `0.5` = the whole window. Hyprland clamps config to `0.04…0.5`. Chrome clamps a walking lobe to that range, and a static lobe to at least `0.04`. |
| `mirror` | bool | `true` | both | Mirror the same lobe onto the **far side** of the light axis (two comet heads). Off keeps the facing-only comet. |
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
| `pulse` | bool | `false` | both | Oscillate highlight **transparency**. Does not change lobe width or thickness. Ignored while shimmer is running. |
| `pulseHz` | number | `0.4` | both | Pulse rate. `0` disables. Hyprland clamps `0…4`. |
| `rippleFreq` | number | `0.025` | both | Ripple spatial frequency (1/px). Hyprland clamps `0.001…0.2`. |
| `rippleSpeed` | number | `2` | both | Ripple temporal speed. Hyprland clamps `0…40`. |
| `rippleGain` | number | `0.85` | both | Blend from the shiny comet (`0`) to crest-only lighting (`1`). `0` matches shiny. Hyprland clamps `0…2`. |
| `ripplePower` | number | `8` | both | Sharpens the crests; higher = thinner bands. Hyprland clamps `1…16`. |
| `rippleOriginX` | number | `0.5` | both | Ripple origin X (`0` = left, `1` = right of the decoration box). Default is the center. Hyprland clamps `0…1`. |
| `rippleOriginY` | number | `0.5` | both | Ripple origin Y (`0` = top, `1` = bottom). Hyprland clamps `0…1`. |
| `rippleFade` | number | `0` | both | Spatial fade as a **proportion of the decoration-box perimeter**. Full brightness at the origin, zero at/beyond `rippleFade × perimeter` pixels. `0` (or any non-positive value) is off. Hyprland clamps `0…1`. |

Not a look key (hardcoded or host-owned):

| Thing | Where it lives |
|---|---|
| `roundingPower` | Chrome shader default `2`. Windows use each window’s Hyprland rounding. |
| `enabled` | Omarchy plugin enable/disable. |

## The gradient

The ramp is a parallel projection onto the light axis, not a conic sweep
around the window center. A wide panel and a tall one with the same
heading share a direction. Iso-lines are perpendicular to the light.

Stops fill the lit band (`lobe`, including shimmer scale), not the full
window:

- `0` is the facing support of the rounded rect, where the comet sits.
- `100` is the edge of the comet. Past that, the last stop is held (RGB
  and alpha).
- Smaller lobes compress the same stop list into the comet so every stop
  stays visible in the highlight.
- With `mirror` on, the same 0…100 band is also measured from the far
  support, so both ends of the axis are comet heads.
- Each half of the light axis runs 0…100 independently. Primary
  colors/positions paint one half; clockwise colors/positions paint the
  other. Match first and last colors between the halves to avoid a seam.

`gradientPositions` / `gradientPositionsCw` are strings of one percentage
per color, separated by spaces, tabs, or commas. A trailing `%` is allowed
(`"0 70 100"` and `"0%, 70%, 100%"` are the same). Values are clamped to
0…100 and forced non-decreasing.

The spec is all-or-nothing: token count must equal the color count (2…8),
and every token must parse. Empty, junk, or a count mismatch falls back to
even spacing (`0 … 100` in equal steps). That is why a 4-stop ramp with
positions `"0 50"` silently even-spaces instead of stretching two numbers.

Default `"0 99"` puts the white head at the facing edge and the
transparent teal at the comet tail.

### Clockwise half

`gradientCw` / `gradientPositionsCw` never turn the ramp on by themselves.
If `gradient` has fewer than two colors, clockwise config is ignored.

| `gradientCw` | `gradientPositionsCw` | Clockwise half |
|---|---|---|
| ≥ 2 colors | valid spec matching that count | Own colors, own spacing. |
| ≥ 2 colors | empty / invalid | Own colors, **even** spacing (not the primary positions). |
| empty / fewer than 2 | valid spec matching primary count | Primary colors, reshaped. Default `"0 22 50 100"` is four tokens, so with the 2-stop ramp it mismatches and falls through to a mirror of the primary positions. |
| empty / fewer than 2 | empty / invalid | Exact **mirror** of the primary positions. |

## Heading and motion

The light heading is `pinDeg + angleOffset`. When shimmer is on, the
heading and the highlight size each drift on their own random walk (within
`±shimmerDeg` and `shimmerScaleMin…Max`), retargeting about `shimmerHz`
times per second. Windows are seeded individually so overlapping windows
do not walk in unison. When both shimmer and pulse could run, shimmer
wins; pulse stays off until shimmer is disabled or its Hz is `≤ 0`.

## Remove

```sh
omarchy plugin remove wmfeht.border-fx --yes
```

If the shell was not running during the remove, the Hyprland copy can stay.
Purge it:

```sh
~/.config/omarchy/plugins/wmfeht.border-fx/scripts/hypr-teardown.sh --purge
# or, from a checkout of this repo:
bash scripts/hypr-teardown.sh --purge
```

`--purge` deletes the session plugin
(`~/.local/lib/hypr/hypr-shiny-border.so`) and
`~/.config/hypr/border-fx.lua`. It does not delete the
`pcall(require, "hypr.border-fx")` line from `hyprland.lua`. That leftover
is harmless: `pcall` does nothing once the file is gone. Remove the
comment and the require yourself if you want `hyprland.lua` back to how it
was.

## Development

Architecture, build tasks, and the development workflow live in
[DEVELOPMENT.md](DEVELOPMENT.md). Before opening a change, read
[CONTRIBUTING.md](CONTRIBUTING.md), in particular the project's scope: a
small, well-documented set of effects, not a growing option surface.

MIT. See [LICENSE](LICENSE).
