# Development

This file covers the architecture and the development workflow. User-facing
install and configuration live in the [README](README.md). Scope and
contribution policy live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

One git tree, two renderers, one Omarchy plugin as the control plane.

The same conic comet on a rounded-rect ring is drawn by Hyprland window
decorations (`hypr-shiny-border.so`) and by Omarchy / Quickshell chrome
(panels, notification toasts). Changing the look in `shell.json` updates
both.

This tree is what `omarchy plugin add <url>` clones. The Hyprland `.so` is
a compositor plugin, not a Quickshell plugin; Omarchy never compiles it.
After enable, `Service.qml` runs `scripts/border-fx ensure` (user-level, no
sudo) to build/load `~/.local/lib/hypr/hypr-shiny-border.so`.

| Name | Role |
|---|---|
| Omarchy id `wmfeht.border-fx` | Source of truth in `shell.json`; `omarchy plugin enable` |
| `effect` (`shiny` / `ripple`) | Which renderer to drive |
| `border-fx` (Rust, `cli/`) | Control plane: resolve the look, fan out, build/load/unload the `.so` |
| `scripts/border-fx` | Build-once launcher for the CLI (Omarchy has no install hooks) |
| Hyprland plugin `hypr-shiny-border` | Shiny window adapter (`hyprctl plugin list`, `PLUGIN_INIT`) |
| Config keys `plugin:shiny-border:*` / Lua `shiny_border` | Shiny Hyprland adapter (hyphen → underscore) |

### Control plane

`cli/` is a single Rust crate, binary `border-fx`. It owns the end-user
control plane: paths and ids, the look schema (defaults, per-effect
overlay, coercion, clamps, colors), the `border-fx.lua` emitter, the
session `.so` lifecycle (mapped-inode detection, rename-install, flock +
generation counter, ABI identity stamp), the `hyprland.lua` require, and
the `shell.json` look snapshot. Checkout → Omarchy plugin install is
`dev/plugin.sh`, not this binary.

```
border-fx ensure     [--look-json J]           # after enable: build/load + apply; STATUS= + LOOK=
border-fx apply      [--eval] [--disabled] [--no-load] [--stdout] [--lua P] [--look-json J]
border-fx look       [--look-json J] [--pretty] # the resolved look as JSON
border-fx teardown   [--purge]                  # on disable / remove
border-fx status                                # diagnostics
border-fx theme                                 # current Omarchy theme (name, colors.toml)
border-fx shell-look snapshot | restore <json>
```

Every path is overridable through the same environment variables the bash
scripts honored (`SESSION_SO`, `LUA_FILE`, `BUILD_DIR`, `HYPR_SRC`,
`HYPRLAND_LUA`, `HYPR_ABI_*`, `XDG_*`, `OMARCHY_SHELL_JSON`, …), plus
`BORDER_FX_ROOT` for the clone root. `--look-json` / `LOOK_JSON` take the
raw `plugins[]` entry; without either, `ensure` / `apply` / `look` read the
entry out of `~/.config/omarchy/shell.json`.

Module map (`cli/src/`): `look/` (schema, resolve, colors), `lua.rs`,
`json.rs` (lenient input), `paths.rs`, `hyprctl.rs` (trait + real impl +
test fake), `session.rs`, `abi.rs`, `hyprland_lua.rs`, `ensure.rs`,
`apply.rs`, `teardown.rs`, `shell_json.rs`, `theme/` (current Omarchy theme + stock look presets),
`timing.rs` (every wait/poll constant), `ctx.rs` (injected side effects:
hyprctl, notifier, `make`).

**Build at install.** Omarchy has no install hooks, so `scripts/border-fx`
is a ~100-line bash launcher: it hashes `cli/`, runs
`cargo build --release --locked` into `$XDG_CACHE_HOME/omarchy-border-fx`
when the hash changed (never into the plugin folder, which omarchy-shell
rescans), and `exec`s the cached binary. Concurrent callers serialize on a
flock. Without a Rust toolchain it prints `STATUS=no-cli` and notifies; the
chrome keeps drawing from `qml/Look.js`. `mise run install` / `reinstall`
pre-build from the installed clone before enable, so omarchy-shell does
not compile on first load. `BORDER_FX_BIN=…` skips the build (tests,
`cargo run`).

**Theme following.** `look::Base` is the layer under the user's keys:
`Base::shared()` is the documented defaults; `Base::with(map)` swaps in
per-key overrides that user keys still win over. `theme::look_base()`
picks a stock preset from `theme::current_name()` (reads
`~/.local/state/omarchy/current/theme.name`). Tokyo Night and Osaka Jade
ship presets (`cli/src/theme/presets.rs`); other themes keep the shared
defaults. The chrome does not need its own copy: it first-paints from
`qml/Look.js`, then adopts the resolved look from the CLI's `LOOK=`
line. `Service.qml` watches `theme.name` so a theme switch re-applies
without an edit to `shell.json`.

### Config fan-out

The `wmfeht.border-fx` entry in `shell.json` `plugins[]` is the only input.
On save:

- **Chrome** first paints from `qml/Look.js` (same defaults/merge as the
  CLI; `tests/look.js` checks the two agree byte for byte), then adopts the
  `LOOK=` the CLI printed.
- **Windows** debounce ~150 ms on the entry (`Service.qml` `entryJson`),
  then `border-fx apply --eval` writes `~/.config/hypr/border-fx.lua` and
  `hyprctl eval`s it if `hypr-shiny-border` is loaded. If the `.so` is not
  loaded, the lua is still written and eval is skipped until the next
  ensure.

stdout protocol of `ensure` / `apply`: `KEY=value` lines. `LOOK=` is the
resolved look as compact JSON; `STATUS=` is `ok|reuse|hyprpm` (ring ready),
`load-failed|build-failed|skipped|no-hyprctl` (fail closed), `no-cli` (the
launcher had no toolchain), or `applied|written` for `apply`.

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
Service.qml                   # chrome overlay + border-fx ensure/apply/teardown
preview.qml                   # standalone qs entry point (preview / smoke)
qml/                          # ShinyBorder + Shimmer/Gradient/Ripple/Coverage/Look helpers
shaders/                      # Qt + GLES hosts, shared *-lighting.frag + coverage.frag, committed .qsb
hypr/                         # compositor plugin (src, Makefile, nest, tests)
mise.toml                     # all dev tasks
Makefile                      # clone-root convenience, forwards to hypr/
harness/                      # DemoCard.qml mock cards for preview / smoke
dev/
  bake.sh                     # .frag → .qsb + inline GLES into hypr/src/shaders.hpp
  preview.sh                  # launch preview.qml under qs
  plugin.sh                   # omarchy plugin add/remove this folder (mise install)
scripts/
  border-fx                   # build-once launcher for cli/ (what Service.qml execs)
cli/                          # Rust control plane: border-fx binary + unit tests
  Cargo.toml, Cargo.lock      # --locked builds; keep the lockfile committed
  src/                        # see "Control plane" above
tests/                        # compositor-free JS tests (run in CI)
  cli.js                      # locates/builds the debug border-fx for the suites
```

No symlinks inside the plugin folder (`omarchy plugin validate` refuses
them). Build artifacts are gitignored; user builds (the `.so` and the CLI)
write to `$XDG_CACHE_HOME/omarchy-border-fx`, not the checkout.

## Dev install

`mise run install` and `mise run reinstall` both run `dev/plugin.sh`,
which talks to Omarchy: `omarchy plugin remove` any current copy, then
`omarchy plugin add` this folder. A dirty working tree is snapshotted
first so the clone matches the folder, not HEAD. The `shell.json` look is
kept across remove. The CLI is pre-built from the clone before enable.
After enable, the script waits up to 30s for Hyprland to list
`hypr-shiny-border` (`border-fx status`: `listed` or a mapped `.so`).

```sh
mise run install     # omarchy plugin remove (if present), add this folder, enable
mise run uninstall   # disable, purge the login-session .so, omarchy plugin remove
mise run reinstall   # same as install; keeps the shell.json look
```

## Tasks

```sh
mise run bake        # shaders/*.frag → .qsb + inline GLES into hypr/src/shaders.hpp
mise run reflect     # bake, then dump qsb reflection (UBO layout)
mise run cli-build   # debug build of cli/ (border-fx)
mise run cli-test    # Rust unit tests: look schema, ensure/teardown flows, ABI, shell.json
mise run cli-lint    # rustfmt --check + clippy -D warnings
mise run test        # cli-test, then shimmer + gradient + look adapter + session tests (no compositor)
mise run lint        # qmllint ShinyBorder.qml + cli-lint
mise run check       # bake + lint + test
mise run status      # border-fx status: paths, compositor state, ABI identity, theme
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

Dev install tasks (`install` / `uninstall` / `reinstall`) are listed in the
previous section.

CI (`.github/workflows/test.yml`) runs `mise run test`: the Rust unit
tests, then the compositor-free JS suites (which build the debug CLI and
drive it against a stubbed `hyprctl` / `make`).

## Hyprland side

A plugin crash is a compositor crash. Iterate in a nested Hyprland, not the
login session.

**Target:** Hyprland **v0.56.2**. Build with the same compiler that built the
compositor, against the headers in `/usr/include/hyprland`. `mise run headers`
must show the same git hash for `hyprctl version` and `version.h`.

### How it works

Hyprland already has gradient borders and `borderangle`. This plugin does
something else: a **directional light on a rounded-rect ring**. The heading
(`pin_deg` + `angle_offset`) is a light direction; the gradient is the pattern of
that light, projected along the axis using this window's width and height.

- `CShinyBorder` is a custom `IHyprWindowDecoration`, so the plugin owns the
  draw path instead of poking Hyprland’s border-color angle field
- GLES 3 fragment shaders draw the ring (`hypr/src/shaders.hpp`: `SHINY_FRAG`
  and sibling `RIPPLE_FRAG`); `draw()` picks from `plugin:shiny-border:effect`.
  If compile fails, draw falls back to Hyprland’s linear `CBorderPassElement`.
  Both programs share `SHINY_VERT`. Teardown destroys both.
- optional pulse lives on the decoration (`CEventLoopTimer`), not a global
  `render.pre` scan
- optional shimmer reuses that timer, exclusive with pulse (shimmer wins):
  two CPU-side random walks (`shinyShimmerStep`, seeded per deco) modulate the
  heading and the highlight size, then the pass gets a final angle / lobe /
  thickness scale — the shader draws its nominal branch, no new uniforms
- heading is always `pin_deg` + `angle_offset` (`shinyPinnedHeading`);
  `draw` computes it live so pulse/shimmer still animate around it. There is
  no cursor-tracking mode and no `plugin:shiny-border:pin` switch
- optional multi-step gradient: one native `CGradientValue` key plus a
  `gradient_positions` string; the deco clamps the stop count
  (`shinyGradientStepCount`, cap 8), resolves per-stop positions CPU-side
  (`shinyGradientResolvePositions` — custom "%" spec or even spacing), and
  hands the same packed-ARGB stop list + positions to both backends. The
  shader gets `gradColors[8]` / `gradPos[8]` / `gradCount` — raw
  `glUniform*` uploads, since those names are not in `CShader`'s lookup
  table — and ramps piecewise-linearly from the facing support (stop 0) to
  the lobe edge (`uRamp = d0 / spread`). Highlight RGB/A is the sampled
  stop (two-stop `col.a`/`col.b` along `uRamp` when `gradCount < 2`).
  Pulse multiplies stop alpha (`shinyPulseAlphaMul`); it does not breathe
  spread or thickness. The fallback builds
  a multi-stop `CGradientValueData` from the same list; custom positions
  are baked in by resampling the ramp at 8 even points, because Hyprland's
  border gradient only spaces stops evenly. `shinyGradientSample` in
  `hypr/src/runtime.cpp` is the CPU reference for the shader's chain
  (including the 1e-4 coincident-stop guard), so the logic tests cover the
  interpolation.
- per-side gradient: `gradient_cw` / `gradient_positions_cw` override the
  clockwise half of the light axis (negative 2D cross of heading × point).
  `u` is the parallel projection onto that axis, 0 at the facing support
  and 1 at the far side. The color ramp uses `uRamp = d0 / spread` so 0…1
  is the lit band, not the full axis (`shinyGradientLobeU` is the CPU
  twin). `shinyGradientResolveCwSide` resolves the half CPU-side: own
  colors → own positions (empty spec = even); inherited colors → the spec
  alone can reshape, empty spec = exact mirror; primary ramp off = cw off.
  The result rides in `stopsCW` / `stopPosCW` / `stopCountCW` and a second
  uniform trio (`gradColorsCW` / `gradPosCW` / `gradCountCW`); the shared
  `shinyRampColor(bool cw, float u)` GLSL function picks the set per
  fragment. Endpoint-color equivalence between the halves is deliberately
  not enforced — mismatched first/last colors seam at the head / lobe edge
  (documented in the README). The fallback linear gradient cannot express
  asymmetry and keeps drawing the primary side.
- `mirror` (default off): when set, both fragments fold `d0` to
  `min(u, 1-u) * 0.5` so the same lobe sits on the far support too.
  Cone, `uRamp`, glow, and local thickness share that distance. The CW
  split is unchanged. CPU twin is `shinyGradientLobeU(..., mirror)`.
  Uploaded as a raw `glUniform1i` of `mirror` (no CShader slot). The
  fallback cannot represent a two-headed comet.
- wrapping `baseColor` stroke: `plugin:shiny-border:base_color` (default
  `rgba(0a3f47dd)` / ARGB `0xdd0a3f47`) rides in `ShinyDrawShared::baseColor`
  and a raw `glUniform4f` of `baseColor` — CShader has no third color slot.
  Both fragments run `shinyWrapComposite` (premultiplied highlight over a
  border-thickness ring; glow excluded; `a <= 0` is off). The wrap does
  not use `decoration:shadow` and is not the last gradient stop. CPU twin
  is `shinyWrapComposite` in `hypr/src/gradient.cpp`.
- `specular_halo` (default off): gates the outside-glow mix on lit/bright
  energy so the halo bleeds past the outer contour. Off keeps a hard ring.
  Draw/damage expand by `shinyHaloExpandPx` / `shinyDamageExpandPx`; reserved
  extents stay `shinyEffectiveBorderSize` (no extra client padding). CPU
  twin is `shinyHaloGlow` / `shinyCoverageCombine` in `hypr/src/runtime.cpp`.
  The fallback linear gradient does not paint the halo.

`active_only` (default on) means only the focused window draws the ring and
pulses. Unfocused windows have **no** ring, but they still reserve the same
padding so focus does not reflow the client. There is no inactive shiny
border. `enabled = false` reserves 0 px.

### Build

Needs Hyprland headers, `pkg-config`, and the compositor’s `g++` (`gnu++26`,
`-fno-gnu-unique`). Logic tests do not: they compile `hypr/src/runtime.cpp` /
`hypr/src/teardown.cpp` only.

```sh
mise run hypr-build  # make -C hypr → hypr/hypr-shiny-border.so
mise run hypr-test   # compositor-free logic tests (no headers, no .so)
mise run headers     # running compositor hash vs installed headers
```

### Nest loop

```text
mise run nest          # nested Hyprland, hypr/nest/hyprland.lua
                       # ALT+Return = foot, ALT+Q = close, ALT+M = kill nest

# outer terminal, nest already up:
mise run reload        # make + copy to a fresh $XDG_RUNTIME_DIR path + unload/load
                       # last hyprctl instance; refuses the login session
```

`hypr/scripts/pluginctl.sh` copies the `.so` to a new `mktemp` path under
`$XDG_RUNTIME_DIR` (mode 0700) on every load so `dlopen` cannot keep a stale
mapping of the same filename. It refuses instance 0 (the login session) unless
you set both `SHINY_INSTANCE=0` and `SHINY_LIVE=1`.

```
edit src/  →  mise run reload  →  watch the ring  →  repeat
```

If the nest dies, close the window and `mise run nest` again. `PLUGIN_EXIT` is
not called on a fault.

To load into the live session (only with a `.so` you already trust):

```
SHINY_INSTANCE=0 SHINY_LIVE=1 mise run load
```

gdb: `gdb --args Hyprland --config $PWD/hypr/nest/hyprland.lua`.

Manual hyprctl against a nest:

```sh
hyprctl plugin load /absolute/path/to/hypr-shiny-border.so
hyprctl plugin unload /absolute/path/to/hypr-shiny-border.so
hyprctl plugin list
```

Same-path reload can reuse the mapping; `pluginctl` avoids that by copying.

### Layout

```
hypr/src/main.cpp     PLUGIN_INIT / EXIT, listeners
hypr/src/deco.*       IHyprWindowDecoration, pulse timer
hypr/src/pass.*       CShinyPassElement, shader compile
hypr/src/teardown.*   teardown mark + shader lifecycle
hypr/src/runtime.*    mapped-window / VAO guards
hypr/src/shaders.hpp  vertex + directional-light fragment (GLES 3; same math as qml/ ShinyBorder)
hypr/tests/           compositor-free logic tests
hypr/nest/hyprland.lua
hypr/scripts/pluginctl.sh
```

### Notes

- **Same compiler as Hyprland.** Do not let mise hand you a different `g++`.
- **`-fno-gnu-unique`** (`--no-gnu-unique`) or unload does not actually unload.
- **Hash check** in `PLUGIN_INIT`. Skipping it is how plugins SIGSEGV after the
  next compositor update.
- **Lua key is `shiny_border`.** Hyphens become underscores.
- **`PLUGIN_EXIT`** must reset `Event::bus()` listeners, mark teardown (which
  bumps the pass-element epoch so leftover `CShinyPassElement::draw` no-ops),
  recurse-remove leftover `CShinyPassElement` from each owning pass (including
  nested transformer children recorded at construction), and destroy both
  shader programs *before* `dlclose`. Do **not** `m_renderPass.clear()` — that drops
  stock borders and windows already queued in the frame. Hyprland strips
  decorations; it does not flush plugin pass elements.
  `removeAllOfType("CShinyPassElement")` does not recurse, so unload walks the
  owner-pass registry instead. Do not `removeAllOfType("CBorderPassElement")`
  — that pass is also the stock border.
- Function hooks are a last resort. This plugin uses `Event::bus()`.

## Chrome side

Chrome shader/QML details: `qml/ShinyBorder.qml`.

Each effect has one shared lighting body (`shaders/*-lighting.frag`) that
is `#include`d by two hosts: a Qt ShaderEffect host (`shaders/*.frag`,
baked to `.qsb`) and a GLES 3 host (`shaders/*.gles.frag`, inlined into
the generated `hypr/src/shaders.hpp`). `mise run bake` regenerates both
outputs; never edit `shaders.hpp` by hand.
