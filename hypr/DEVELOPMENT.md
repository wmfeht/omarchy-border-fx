# Development

User install and config live in the [README](README.md).

A plugin crash is a compositor crash. Iterate in a nested Hyprland, not the
login session.

**Target:** Hyprland **v0.56.2**. Build with the same compiler that built the
compositor, against the headers in `/usr/include/hyprland`. `mise run headers`
must show the same git hash for `hyprctl version` and `version.h`.

## How it works

Hyprland already has gradient borders and `borderangle`. This plugin does
something else: a **directional light on a rounded-rect ring**. The heading
(`pin_deg` + `angle_offset`) is a light direction; the gradient is the pattern of
that light, projected along the axis using this window's width and height.

- `CShinyBorder` is a custom `IHyprWindowDecoration`, so the plugin owns the
  draw path instead of poking Hyprland’s border-color angle field
- a GLES 3 fragment shader draws the ring (`src/shaders.hpp`); if that
  program fails to compile, draw falls back to Hyprland’s linear
  `CBorderPassElement`
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
  `runtime.cpp` is the CPU reference for the shader's chain (including the
  1e-4 coincident-stop guard), so the logic tests cover the interpolation.
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
- `mirror_lobe` (default off): when set, both fragments fold `d0` to
  `min(u, 1-u) * 0.5` so the same lobe sits on the far support too.
  Cone, `uRamp`, glow, and local thickness share that distance. The CW
  split is unchanged. CPU twin is `shinyGradientLobeU(..., mirrorLobe)`.
  Uploaded as a raw `glUniform1i` of `mirrorLobe` (no CShader slot). The
  fallback cannot represent a two-headed comet.
- wrapping `baseColor` stroke: `plugin:shiny-border:base_color` (default
  `rgba(00687855)` / ARGB `0x55006878`) rides in `ShinyDrawShared::baseColor`
  and a raw `glUniform4f` of `baseColor` — CShader has no third color slot.
  Both fragments run `shinyWrapComposite` (premultiplied highlight over a
  border-thickness ring; glow excluded; `a <= 0` is off). The wrap does
  not use `decoration:shadow` and is not the last gradient stop. CPU twin
  is `shinyWrapComposite` in `runtime.cpp`.

`active_only` (default on) means only the focused window draws the ring and
pulses. Unfocused windows have **no** ring, but they still reserve the same
padding so focus does not reflow the client. There is no inactive shiny
border. `enabled = false` reserves 0 px.

## Build

Needs Hyprland headers, `pkg-config`, and the compositor’s `g++` (`gnu++26`,
`-fno-gnu-unique`). Logic tests do not: they compile `runtime.cpp` /
`teardown.cpp` only.

`hyprpm.toml` (clone **root**) runs `make -C hypr all` with `PKG_CONFIG_PATH`
pointing at hyprpm’s header tree, not necessarily `/usr`. User install is
the Omarchy plugin, not hyprpm.

```sh
mise run hypr-build  # make -C hypr → hypr/hypr-shiny-border.so
mise run hypr-test   # compositor-free logic tests (no headers, no .so)
mise run headers     # running compositor hash vs installed headers
```

## Nest loop

```text
mise run nest          # nested Hyprland, hypr/nest/hyprland.lua
                       # ALT+Return = foot, ALT+Q = close, ALT+M = kill nest

# outer terminal, nest already up:
mise run reload        # make + copy to a fresh /tmp path + unload/load
                       # last hyprctl instance; refuses the login session
```

`hypr/scripts/pluginctl.sh` copies the `.so` to a new `/tmp` path on every load so
`dlopen` cannot keep a stale mapping of the same filename. It refuses instance
0 (the login session) unless you set both `SHINY_INSTANCE=0` and `SHINY_LIVE=1`.

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

## Layout

```
src/main.cpp     PLUGIN_INIT / EXIT, listeners
src/deco.*       IHyprWindowDecoration, pulse timer
src/pass.*       CShinyPassElement, shader compile
src/teardown.*   teardown mark + shader lifecycle
src/runtime.*    mapped-window / VAO guards
src/shaders.hpp  vertex + directional-light fragment (GLES 3; same math as qml/ ShinyBorder)
tests/           compositor-free logic tests
nest/hyprland.lua
scripts/pluginctl.sh
```

## Notes

- **Same compiler as Hyprland.** Do not let mise hand you a different `g++`.
- **`-fno-gnu-unique`** (`--no-gnu-unique`) or unload does not actually unload.
- **Hash check** in `PLUGIN_INIT`. Skipping it is how plugins SIGSEGV after the
  next compositor update.
- **Lua key is `shiny_border`.** Hyphens become underscores.
- **`PLUGIN_EXIT`** must reset `Event::bus()` listeners, `m_renderPass.clear()`
  the leftover already-rendered pass, and destroy the shader *before*
  `dlclose`. Hyprland strips decorations; it does not flush plugin pass
  elements. Surgical `removeAllOfType("CShinyPassElement")` does not recurse
  into nested transformer passes. Do not `removeAllOfType("CBorderPassElement")`
  — that pass is also the stock border.
- Function hooks are a last resort. This plugin uses `Event::bus()`.
