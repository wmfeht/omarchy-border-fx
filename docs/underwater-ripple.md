# Ripple lighting on the border ring

Feasibility note and a general implementation strategy. This is not a
shader and not a commitment to ship.

**Scope (corrected):** a **ripple of light** on a ring in the same
style as the current shiny border — coverage, directional light,
gradient, dual GLSL wrappers. The ripple is an illumination term:
bright crests traveling on the chrome. It is not a water surface, not
caustics-as-material, not refraction, not a thickness “swell.”

`effect` on the `qs.border-fx` `plugins[]` entry already selects a
renderer (`shiny` today). This note is about one candidate: `ripple`.

---

## Verdict

**Yes.** The current fragment is already a lighting model on a
rounded-rect ring (`cone`, `hot`, glow, ramp). A ripple is another
scalar in that model: expanding or circling wavefronts that lift
brightness and the white core where they cross the stroke.

Nothing in the draw path has to change. No window texture, no FBO, no
water palette. The interior stays discarded. Time already exists as a
uniform; pulse already damages the ring on a timer.

The earlier “underwater” reading overshot. Drop caustic webbing,
Gerstner swell, dual-scroll normals, and any UV warp. Those are water
shaders. This is a lit rim with rings of light on it.

---

## What stays from shiny

The shiny fragment is a **decoration ring**, not a screen filter:

| Piece | Keep |
|---|---|
| `sdRoundBox` + `roundingPower`, AA `1.25` | yes |
| Interior discard (`dIn < -AA`) | yes |
| Ring between inner/outer contours + outside glow | yes |
| Directional light: `u` along the heading, `cone` / `hot`, CW half | yes — ripple *modulates* this, it does not replace it |
| Gradient pack (8 stops, optional CW) | yes |
| Dual GLSL: `shaders/*.frag` (Qt 440 UBO) and `hypr/src/shaders.hpp` (GLES 3) | yes, same math |
| No textures | yes |
| CPU shimmer walk of heading / lobe | optional; independent of the ripple field |
| Damage = ring region, hole punched in the client | yes |
| Fallback = stock linear border / QML stroke | yes |

Hyprland’s decoration pass and Quickshell’s `ShaderEffect` still do
not sample window contents. That remains a non-goal (and is why
full-surface water ports — Ghostty `water_caustic`, Hypr-DarkWindow
`windowShader`, `decoration:screen_shader` — stay out).

---

## What “ripple as lighting” is

Web water-ripple writeups almost always **displace UVs** and resample
a photo (`sin(k (d − ct))` × decay, then `texture(uv + n * h)`).
Flutter, Nowwin/Water-Ripple-Shader, and the usual Shadertoy click
demos are that family. The **scalar** `h` is the only part we need.
Use it as light, not as a warp.

On a 2 px ring, a radial wave from the window center is already a
lighting pattern: the crest is a circle; it intersects the frame first
at the four mid-edges, then at the corners. That reads as a pulse of
highlight running around the chrome without any water cue.

Two other lighting-only patterns from the same sine:

1. **Radial wavefronts** (v1 default). `h = sin(k r − ω t)`, then
   `crest = pow(max(h, 0.0), n)` with `n` high (6–12) so bands stay
   thin. Add `crest` into `hot` and into glow energy. Optional
   exponential envelope if the origin is a click, not a continuous
   oscillator.
2. **Perimeter traveling band.** Unwrap the rounded rect to arc-length
   `s ∈ [0,1)` (four sides + four quarter-circles).
   `crest = pow(0.5 + 0.5 * sin(TAU * k * s − ω t), n)`. A highlight
   chasing the rim. Can coexist with (1); start with one.

Do **not** use `h` to:

- offset UVs or the SDF sample point
- grow/shrink `localT` as if the metal were a fluid (pulse already
  breathes thickness from a *global* sine; a spatial ripple in
  thickness looks like a wobbling window, not lighting)
- mix in a teal “deep water” palette unless the shared gradient
  already does that
- add a 3-iter caustic domain warp (filaments say “pool floor”)

Shiny already maps energy to color:

```
rgb = mix(ramp * mix(0.22, 1.0, pow(cone, 0.9)), white, hot * 0.95)
a   = cov * mix(0.055, 1.0, mix(pow(cone, 1.15), hot, 0.45))
```

Ripple plugs in as:

```
float crest = …;                    // 0..1, sparse
float lit   = max(cone, crest);
float hotR  = max(hot, pow(crest, 1.2));
```

then the same mix. Crests can exceed the facing lobe, so a dim far
side still flashes when a ring passes — that is the point.

---

## Recommended v1 recipe

Keep shiny’s coverage and light axis. Add one continuous radial field.

Pixel space is unchanged: centered `p` in device pixels, `pUp.y = -p.y`.

### Coverage (unchanged)

`dOut` / `dIn`, discard interior, `ring`, `glow` from `cone` (and,
after the lighting term, from `crest` as well so a passing ring has a
halo). Wrap stroke (`baseColor`) stays as in the current shiny
fragment if that path is still wanted.

### Light axis (unchanged)

Heading → `light`, support extent, `u`, `cw`, `cone`, `hot`. Pulse may
still breathe `range` / `thick` globally. Shimmer may still walk
heading on the CPU. Neither is required for the ripple to read.

### Ripple scalar

Origin: window / panel center in v1 (`pUp`). Pin/mouse as origin is a
later uniform, not a new geometry path.

```
float r     = length(pUp);
float phase = r * freq - time * speed;   // freq in 1/px, speed in px/s
float wave  = sin(phase);
float crest = pow(max(wave, 0.0), 8.0);
```

Uniforms (names not frozen): `rippleFreq`, `rippleSpeed`,
`rippleGain` (multiplies `crest` before the mix). A second harmonic
(`0.35 * pow(max(sin(phase * 0.5 + φ), 0.0), 8.0)`) is enough if one
frequency looks mechanical; do not start with a spectrum.

Optional envelope, off by default: `exp(-mod(phase, TAU) * decay)`
turns the oscillator into repeating decaying drops. Continuous
`sin` is simpler and always-alive, which matches shimmer/pulse.

### Where it lands

```
cone' = max(cone, rippleGain * crest)
hot'  = max(hot,  rippleGain * pow(crest, 2.0))
glow  = outsideFalloff * cone'      // passing crest glows too
```

Ramp, far-side floor (~5.5% alpha), blow-to-white: unchanged
functions of `cone'` / `hot'`.

### What the shader does not do

- `texture()`
- SDF or UV displacement
- Per-pixel thickness from `crest`
- Caustic loops, simplex, Gerstner
- A mode flag inside the shiny program. Two fragments, or a tight
  additive block copied into a sibling file — not `if (ripple)`.

---

## Dual-runtime and control plane

Same layout as shiny, sibling files:

```
shaders/ripple.frag          # Qt 440; bake → .qsb
hypr/src/shaders.hpp         # RIPPLE_FRAG (vert can reuse SHINY_VERT)
qml/RippleBorder.qml         # or ShinyBorder with a different source
```

Keep math identical across wrappers. `scripts/bake.sh` should bake
every `shaders/*.frag`.

**Plugin:** one `.so`. Second `CShader`, pick at `draw()` from
`effect`. Do not merge both looks into one fragment. Teardown must
list the second program next to the first (`hypr/DEVELOPMENT.md`).

`look-apply.sh` currently loads the `.so` only when
`effect == "shiny"`. Ripple must still load it and fan out the extra
floats (plus nested `"ripple": { … }`). `Look.merge` already preserves
unknown `effect` values; tests should assert load stays true.

**Service:** attach the ripple overlay when `effect === "ripple"`,
same as `effectIsShiny()` today.

**Rename of `hypr-shiny-border`:** not in this turn.

---

## Animation, damage, cost

Shiny can be static (pin on, shimmer off, pulse off). Ripple cannot:
`crest` is a function of `time`.

Reuse the per-decoration `CEventLoopTimer` and `shinyPulseTickMs`
clamp (16–50 ms). Damage the ring only. Drive `time` from the
compositor `m_globalTimer` (Hypr) and a QML `FrameAnimation` / `Timer`
(chrome).

`active_only` default **on**. Unfocused windows keep padding, no tick.
A thin quad per focused window is the same class of cost as pulse.

If shimmer and ripple both run, that is allowed: shimmer walks the
light heading, ripple walks the crests. Do not make ripple a CPU
random walk.

---

## Config sketch

`effect: "ripple"` on `qs.border-fx`. Nested `"ripple"` keys win.
Shared with shiny: `borderSize`, `gradient`, `pin` / `pinDeg`, `lobe`,
`shimmer*`, `baseColor`, `activeOnly`, `pulse`.

Ripple-specific (not frozen):

| JSON | Role |
|---|---|
| `rippleFreq` | spatial `k` (1/px), how many crests across the panel |
| `rippleSpeed` | how fast they expand |
| `rippleGain` | mix into `cone` / `hot` (0 = shiny-only lighting) |
| `ripplePower` | `pow` on the sine lobe; higher = thinner bands |

Missing keys: dedicated defaults (gain modest, power high, slow),
**not** the C++ shiny defaults.

Pin still aims the *light*. It does not move the ripple origin in v1.

---

## Tests and preview

- CPU reference `crest(r, t, freq, speed, power)` at a few samples
  (same role as `shinyGradientSample`).
- `Look.merge({ effect: "ripple", ripple: { … } })` and look-apply:
  plugin load true.
- `mise run bake` for `ripple.frag`.
- Nest + `mise run preview`. Judge at `borderSize` 2 and 4: too many
  crests look like noise on a thin stroke; too few look like pulse.

---

## Suggested build order

1. Copy shiny coverage + light axis into the sibling fragment. Flat
   extra uniform `rippleGain = 0` must match shiny.
2. Add `crest`, mix into `cone` / `hot` / glow. Clock + ring damage.
3. Tune `freq` / `power` so mid-edges flash then corners, on a 2 px
   stroke.
4. Control plane: `effect`, nested look, Service attach, look-apply,
   defaults, README one-liner.
5. Later, not v1: pin/mouse as origin; decaying drop envelope;
   perimeter-chasing band as an alternate `rippleMode`.

---

## Risks

- **Busy stroke.** High `rippleFreq` on a 2 px ring is sparkle, not a
  ripple. Default to one or two crests across the shorter side.
- **Looks like pulse.** A very low frequency with `pow` ~2 is a global
  breathe. Keep `power` high so energy is spatially sparse.
- **Fighting the lobe.** If `cone'` is `cone * (1 + crest)` instead of
  `max(cone, crest)`, the far side never flashes. Use `max` (or add
  `crest` after the far-side dim, not before).
- **qsb / GLES.** Same rules as shiny: constant-bounded math, no
  derivatives required (and `dFdx` on a 2 px ring is junk).
- **Two programs, one teardown.** Second `CShader` joins the existing
  lifecycle or unload crashes.
- **`effect` vs `ShinyEffect`.** `Look.js` `effect` is the renderer.
  `ShinyEffect` in `runtime.hpp` is pulse vs shimmer. Do not put
  `RIPPLE` on that enum.

---

## Non-goals

- Underwater / water-surface shading (caustics, Gerstner, dual-scroll
  normals, teal “depth”)
- Refraction or UV distortion of window / panel pixels
- Shallow-water FBO simulation
- Screen shaders, Hypr-DarkWindow injection
- Copying Shadertoy / NVIDIA source (even the lighting-only sine is
  reimplemented; the listings are usually not MIT)
- Renaming `hypr-shiny-border` in the same turn
- Per-pixel thickness ripple (wobble, not light)

---

## References

- Radial sine as a *height* that this plan uses as *light*: Flutter
  water-ripple; Nowwin/Water-Ripple-Shader; the usual
  `sin(k (d − ct))` notes. Ignore the texture-displace half.
- This tree: `shaders/shiny.frag` (`cone` / `hot` mix),
  `hypr/src/shaders.hpp`, `hypr/DEVELOPMENT.md`, `qml/Look.js`,
  `scripts/look-apply.sh` (`effect == "shiny"` load gate),
  `docs/unified-project.md`
