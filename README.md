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
| Omarchy id `qs.border-fx` | Source of truth in `shell.json`; `omarchy plugin enable` |
| `effect` (`shiny`) | Which renderer to drive; more types later |
| Hyprland plugin `hypr-shiny-border` | Shiny window adapter (`hyprctl plugin list`, hyprpm, `PLUGIN_INIT`) |
| Config keys `plugin:shiny-border:*` / Lua `shiny_border` | Shiny Hyprland adapter (hyphen → underscore) |

## Install

```sh
omarchy plugin add <git-url-of-this-repo> --enable --yes
```

`omarchy plugin add` alone clones files; nothing is loaded until enable.
`--enable` starts the service, which overlays chrome **and** ensures the
window ring.

The previous Omarchy id was `qs.shiny-border`. Look reading still falls back
to that entry if `qs.border-fx` is missing. Enable the new id (and disable
the old one) so `omarchy plugin` commands match the clone directory.

```sh
omarchy plugin enable qs.border-fx    # chrome + window ring on
omarchy plugin disable qs.border-fx   # both off; clone kept
omarchy plugin remove qs.border-fx --yes
omarchy plugin update qs.border-fx --yes
```

If the shell was not running during remove, also:

```sh
~/.config/omarchy/plugins/qs.border-fx/scripts/hypr-teardown.sh --purge
# or, from this tree:
bash scripts/hypr-teardown.sh --purge
```

That deletes `~/.local/lib/hypr/hypr-shiny-border.so` and
`~/.config/hypr/border-fx.lua`. It does **not** rewrite `looknfeel.lua`.

Dev copy (not git-managed, not `omarchy plugin update`):

```sh
mise run install     # copies into ~/.config/omarchy/plugins/qs.border-fx
mise run uninstall
mise run reinstall   # omarchy plugin remove, then add this folder
```

### Already using hyprpm?

Loading the plugin twice is a hard error. `hypr-ensure.sh` will reuse the
hyprpm copy and notify you instead of stacking a second `.so`.

```sh
hyprpm disable hypr-shiny-border
# drop `hyprpm reload -n` from ~/.config/hypr/autostart.lua if it exists
# only for this plugin, then:
omarchy plugin enable qs.border-fx
```

hyprpm remains the Hyprland **development** workflow (`mise run nest`).
`hyprpm.toml` is at this repo root so `hyprpm add <same-url>` still builds.

### Hyprland headers

The window ring is compiled against the running compositor. If `make` fails,
chrome still runs and you get a notification. Fix: matching Hyprland headers,
then re-enable (or `omarchy restart shell`). `PLUGIN_INIT` still refuses a
header-hash mismatch.

## Shared look

Source of truth: the `qs.border-fx` entry in
`~/.config/omarchy/shell.json` `plugins[]`. `effect` selects the renderer
(`shiny` is the only one today). Missing look keys mean the intended shared
look (pinned 120°, shimmer, 4-stop ramp) — **not** the C++ defaults.

Look keys may sit at the top level or under a nested object named after the
effect (`"shiny": { … }`). Nested keys win.

```json
{
  "id": "qs.border-fx",
  "effect": "shiny",
  "borderSize": 2,
  "shimmer": true,
  "shimmerHz": 0.3,
  "shimmerDeg": 20,
  "pinDeg": 120,
  "lobe": 0.18,
  "gradient": [
    "rgba(33ccffee)",
    "rgba(1ad4c0ee)",
    "rgba(007a48ee)",
    "rgba(004830aa)"
  ],
  "gradientPositions": "0 1 3 100",
  "gradientPositionsCw": "0 22 50 100",
  "baseColor": "rgba(00687855)",
  "activeOnly": true,
  "pulse": false
}
```

Canonical colors are Hyprland `rgba(RRGGBBAA)`. Save `shell.json`: chrome
hot-reloads; `look-apply.sh` writes `~/.config/hypr/border-fx.lua` and
`hyprctl eval`s it if the shiny `.so` is loaded.

`baseColor` is the wrapping ring stroke on both hosts (transparent = off).
It is not Hyprland `decoration:shadow`. `activeOnly` / `pulse` are
Hyprland-only. Heading is always `pinDeg` + `angleOffset` (plus shimmer
wander when shimmer is on). Leftover `pin: false` does not restore cursor
tracking.

A generated `~/.config/hypr/border-fx.lua` is an **output**, not an input.
`omarchy refresh hyprland` can drop the one-line
`pcall(require, "hypr.border-fx")` from `hyprland.lua`; the next service
start still `hyprctl plugin load`s (brief default-look flash).

Until you delete the gated `shiny_border` block from `looknfeel.lua`, that
file can fight plugin settings on `reloadConfig()`. Leave it until fan-out
looks right, then remove it.

## Tree

```
manifest.json                 # Omarchy id qs.border-fx (clone root)
Service.qml                   # chrome overlay + hypr-ensure + look fan-out
qml/                          # ShinyBorder, Shimmer, Gradient, Look
shaders/                      # shiny.frag + committed .qsb
hypr/                         # shiny compositor plugin (src, Makefile, nest, tests)
hyprpm.toml                   # clone root, so hyprpm add of this URL works
scripts/
  hypr-ensure.sh              # build/copy/load ~/.local/lib/hypr/… (no sudo)
  hypr-teardown.sh            # unload session copy; --purge deletes it
  look-apply.sh               # JSON look → border-fx.lua + hyprctl eval
  install.sh / uninstall.sh   # dev copy helpers
  reinstall.sh                # omarchy plugin remove + add this folder
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
mise run reinstall   # omarchy plugin remove + add this folder (live session)
```

Hyprland C++ iteration: [hypr/DEVELOPMENT.md](hypr/DEVELOPMENT.md). Chrome
shader/QML details: `qml/ShinyBorder.qml`. Design notes:
[docs/unified-project.md](docs/unified-project.md).

MIT. See [LICENSE](LICENSE).
