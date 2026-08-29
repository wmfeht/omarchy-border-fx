# Phase 07: One fragment source and tests that are not change-detectors

- **Sequence:** 7 of 10
- **Depends on:** `docs/phase-06-overlay-attach.md` (suggested order step 10 after the overlay sitting)
- **Finding IDs:** 9, 10
- **This phase:** One fragment source compiled to `.qsb` and inlined into `shaders.hpp`. Delete the grep lock. Add a JS-vs-C++ shimmer step test and stub-hyprctl coverage for `hypr-ensure.sh`. Finding 10’s uncovered-surface bullets that belong to other sittings are copied into those phases; ID 10 lives here.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 9 | P2 | Dual shaders; tests are source greps | PARTIAL | both |
| 10 | P2 | Fragile surfaces untested; change-detectors in default suite | CONFIRMED | tests |

## Findings

### 9. Dual shaders; tests are change-detectors, not a shared core

**ID:** 9  
**Severity:** P2  
**Path:** both

**Verdict: PARTIAL** (duplication is real; “tests only lock the Qt file” is
false for `test_visual.cpp`)
**Sources:** Review A Medium 9, Review B High 2
**Files:** `shaders/shiny.frag`, `hypr/src/shaders.hpp`, `tests/run.js`
`checkWrapSource`, `hypr/tests/test_visual.cpp` `checkShaderSource` /
`checkLighting`

~130 lines of lighting math are hand-copied. Wrappers differ (Qt UBO vs
GLES `gl_FragCoord`). `scripts/bake.sh` only produces `.qsb`; it does not
generate `shaders.hpp`.

`tests/run.js` greps the Qt frag and QML only — a Hyprland-only edit will
not fail `mise run test`. `hypr/tests/test_visual.cpp` greps **both** files
for literals such as `float d0 = u * 0.5;`. That is a change-detector:
rename a local and the suite fails; a real math bug that keeps the strings
passes.

JS and C++ xorshift are twins, never stepped against each other (same seed,
same `dt`). First chrome tick uses a synthetic `dt`; Hyprland’s first tick
is `dt = 0` (no-op). Pulse chrome uses `Date.now()`; windows use
`g_pHyprRenderer->m_globalTimer`. The “same comet” claim is untested across
runtimes.

**Fix:** one fragment source compiled to `.qsb` and inlined into
`shaders.hpp` (or a shared `.frag` include). Extend bake. Delete the grep
lock. Add a JS-vs-C++ shimmer step test.


### 10. Fragile surfaces have no tests; change-detectors run in the default suite

**ID:** 10  
**Severity:** P2  
**Path:** tests

**Verdict: CONFIRMED** (tone “dominate” is overstated — there is a real
behavioral body)
**Sources:** Review A missing-tests, Review B High 3
**Files:** `tests/*`, `hypr/tests/*`, `mise.toml`

Covered well: shimmer/gradient math (each runtime separately), look merge
happy path, look-apply stdout shape, sibling-temp `.so` install (real inode
test), teardown *lifecycle* via spies. Teardown *function order* is source
grep.

Not covered:

- `Service.qml` host/stock/sweep/ensure/teardown/`overlayRev` (finding 7)
- look-apply / Look.js on `"false"`, `"inf"`, 7-digit hex, empty/invalid types
- chrome vs Hyprland clamp parity (`lobe`, `borderSize: -1`, int headings)
- JS vs C++ shimmer step
- Hyprland frag vs `shaders/shiny.frag` as a shared include (only greps)
- `hypr-ensure.sh` decision tree with a stub `hyprctl` (listed / hyprpm /
  mapped / build-fail) — the stub harness already exists in `test_reload.cpp`
  / `hypr-session.js` and is pointed at `pluginctl` / `wait_plugin_gone`, not
  ensure

`checkProductionWiring`, `checkTeardownOrdering`, `checkScriptShape`, and
`audit-unified-plan.js` all assert source or markdown text.
`audit-unified-plan.js` runs in default `mise run test`.
