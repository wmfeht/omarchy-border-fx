# Development

This file covers the architecture and the development workflow of the
unified tree. User-facing install and configuration live in the
[README](README.md). Scope and contribution policy live in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

One git tree, two renderers, one Omarchy plugin as the control plane.

The same conic comet on a rounded-rect ring is drawn by Hyprland window
decorations (`hypr-shiny-border.so`) and by Omarchy / Quickshell chrome
(panels, notification toasts). Changing the look in `shell.json` updates
both.

This tree is what `omarchy plugin add <url>` clones. The Hyprland `.so` is
a compositor plugin, not a Quickshell plugin; Omarchy never compiles it.
After enable, `Service.qml` runs `scripts/hypr-ensure.sh` (user-level, no
sudo) to build/load `~/.local/lib/hypr/hypr-shiny-border.so`.

| Name | Role |
|---|---|
| Omarchy id `wmfeht.border-fx` | Source of truth in `shell.json`; `omarchy plugin enable` |
| `effect` (`shiny` / `ripple`) | Which renderer to drive |
| Hyprland plugin `hypr-shiny-border` | Shiny window adapter (`hyprctl plugin list`, hyprpm, `PLUGIN_INIT`) |
| Config keys `plugin:shiny-border:*` / Lua `shiny_border` | Shiny Hyprland adapter (hyphen → underscore) |

### Config fan-out

The `wmfeht.border-fx` entry in `shell.json` `plugins[]` is the only input.
On save:

- **Chrome** hot-reloads from the same process (`Service.qml` bindings).
- **Windows** debounce ~150 ms, then `look-apply.sh` writes
  `~/.config/hypr/border-fx.lua` and `hyprctl eval`s it if
  `hypr-shiny-border` is loaded. If the `.so` is not loaded, the lua is
  still written and eval is skipped until the next ensure.

A generated `~/.config/hypr/border-fx.lua` is an **output**, not an input.
`omarchy refresh hyprland` can drop the one-line
`pcall(require, "hypr.border-fx")` from `hyprland.lua`; the next service
start still `hyprctl plugin load`s.

Hyprland `PLUGIN_INIT` registers the same shared-look defaults as chrome,
so first paint matches before any fan-out has run.

Hyprland adapter keys (what you see in generated lua /
`plugin:shiny-border:*`) use snake_case: `border_size`, `pin_deg`,
`angle_offset`, `base_color`, `gradient_positions`, `gradient_cw`,
`gradient_positions_cw`, `col.a`, `col.b`, `active_only`, `pulse_hz`,
`shimmer_hz`, `shimmer_deg`, `shimmer_scale_min`, `shimmer_scale_max`,
`mirror`, `specular_halo`, `effect`, `ripple_freq`, `ripple_speed`, `ripple_gain`,
`ripple_power`, `ripple_origin_x`, `ripple_origin_y`, `ripple_fade`.
Hyphens in the Hyprland plugin prefix become underscores in Lua
(`shiny_border`).

Shimmer is two independent CPU walks (not GLSL): angle and size. Each
channel eases toward a random target, then picks a new target and duration
(0.6–1.4 of `1/shimmerHz`) so they drift out of lockstep. Windows seed per
decoration so overlapping windows do not walk in unison. When both shimmer
and pulse could run, shimmer wins: pulse uniforms are zeroed until shimmer
is off or its Hz is `≤ 0`.

## Tree

```
manifest.json                 # Omarchy id wmfeht.border-fx (clone root)
Service.qml                   # chrome overlay + hypr-ensure + look fan-out
preview.qml                   # standalone qs entry point (preview / smoke)
qml/                          # ShinyBorder + Shimmer/Gradient/Ripple/Coverage/Look helpers
shaders/                      # Qt + GLES hosts, shared *-lighting.frag + coverage.frag, committed .qsb
hypr/                         # compositor plugin (src, Makefile, nest, tests)
hyprpm.toml                   # clone root, so hyprpm add of this URL works
mise.toml                     # all dev tasks
Makefile                      # clone-root convenience, forwards to hypr/
harness/                      # DemoCard.qml mock cards for preview / smoke
scripts/
  bake.sh                     # .frag → .qsb + inline GLES into hypr/src/shaders.hpp
  paths.sh                    # shared ids/paths, sourced by the other scripts
  hypr-ensure.sh              # build/install/load ~/.local/lib/hypr/… (no sudo)
  hypr-session.sh             # mapped-.so helpers; install via rename, not cp -f
  hypr-teardown.sh            # unload session copy; --purge deletes it
  look-apply.sh               # JSON look → border-fx.lua + hyprctl eval
  shell-look.sh               # snapshot/restore the shell.json look across reinstall
  preview.sh                  # launch preview.qml under qs
  install.sh / uninstall.sh   # dev copy helpers
  reinstall.sh                # purge, restart shell, add --enable; keeps shell.json look
tests/                        # compositor-free JS tests (run in CI)
```

No symlinks inside the plugin folder (`omarchy plugin validate` refuses
them). Build artifacts are gitignored; user builds write to
`$XDG_CACHE_HOME/omarchy-border-fx`, not the checkout.

## Dev copy

A dev copy is a file copy into the Omarchy plugin directory, not
git-managed and not updated by `omarchy plugin update`:

```sh
mise run install     # copy into ~/.config/omarchy/plugins/wmfeht.border-fx, enable, restart shell
mise run uninstall   # disable, purge the login-session .so, remove the copy
mise run reinstall   # purge the live .so, restart shell, add this folder; keeps shell.json look
```

## Tasks

```sh
mise run bake        # shaders/*.frag → .qsb + inline GLES into hypr/src/shaders.hpp
mise run reflect     # bake, then dump qsb reflection (UBO layout)
mise run test        # shimmer + gradient + look adapter + session install (no compositor)
mise run lint        # qmllint ShinyBorder.qml
mise run check       # bake + lint + test
mise run preview     # standalone qs window; does not touch omarchy-shell
mise run smoke       # short-lived preview; fails only if the shader errors
mise run test-full   # check + Hyprland logic tests
mise run hypr-build  # hypr-shiny-border.so
mise run hypr-test   # C++ logic tests
mise run hypr-clean  # remove hypr objects and the .so
mise run headers     # running compositor hash vs installed headers
mise run nest        # nested Hyprland crash sandbox
mise run load        # load into the nest; refuses the login session
mise run unload      # unload from $SHINY_INSTANCE
mise run reload      # rebuild + load into the nest
```

Dev-copy tasks (`install` / `uninstall` / `reinstall`) are listed in the
previous section.

CI (`.github/workflows/test.yml`) runs `mise run test`, the
compositor-free JS suite.

## Hyprland side

hyprpm is the Hyprland **development** workflow (`mise run nest`), not the
user install path. `hyprpm.toml` is at this repo root so
`hyprpm add <same-url>` still builds.

Hyprland C++ iteration (nested compositor, `pluginctl`, header pins,
teardown rules): [hypr/DEVELOPMENT.md](hypr/DEVELOPMENT.md).

## Chrome side

Chrome shader/QML details: `qml/ShinyBorder.qml`.

Each effect has one shared lighting body (`shaders/*-lighting.frag`) that
is `#include`d by two hosts: a Qt ShaderEffect host (`shaders/*.frag`,
baked to `.qsb`) and a GLES 3 host (`shaders/*.gles.frag`, inlined into
the generated `hypr/src/shaders.hpp`). `mise run bake` regenerates both
outputs; never edit `shaders.hpp` by hand.
