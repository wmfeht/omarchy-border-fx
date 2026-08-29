# Phase 10: Leftover Low findings

- **Sequence:** 10 of 10
- **Depends on:** `docs/phase-08-script-hygiene.md` and `docs/phase-09-render-pass.md` (after the suggested-order backbone and leftover P2)
- **Finding IDs:** 20, 21, 22, 24, 25, 26, 27, 28, 29
- **This phase:** Schedule remaining Low items so they are not dropped: Lua start-symbol rename, fallback pass element, install copy of `shiny.frag`, `test_reload` abort, per-frame gradient parse, `runtime` grab-bag, `overlayRev` bump, audit cementing `qs-shiny-border`, and no CI config.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 20 | Low | Generated Lua still uses `_G.__qs_border_fx_start` | CONFIRMED | harmless |
| 21 | Low | Fallback `CBorderPassElement` is not the shared look | CONFIRMED | documented |
| 22 | Low | `install.sh` copies `.qsb` but not `shiny.frag` | CONFIRMED | `mise run install` |
| 24 | Low | `test_reload` aborts if the `.so` is missing | CONFIRMED | `make test-full` |
| 25 | Low | `draw()` re-parses gradient strings every frame | CONFIRMED | cheap |
| 26 | Low | `runtime.{hpp,cpp}` is a grab-bag vs JS split | CONFIRMED | structure |
| 27 | Low | `overlayRev: 12` is a manual bump | CONFIRMED | cache hazard |
| 28 | Low | `audit-unified-plan.js` cements `qs-shiny-border` | CONFIRMED | default test |
| 29 | Low | No CI config in the repo | CONFIRMED | process |

## Findings

### 20. Generated Lua still uses `_G.__qs_border_fx_start`

**ID:** 20  
**Severity:** Low  
**Path:** harmless

**Verdict: CONFIRMED** (harmless)
**Sources:** Review A Lower
**Files:** `scripts/look-apply.sh:249-251`, `tests/look.js` (still expects
the old name), `Service.qml` still matches `objectName === "qs-border-fx"`

Incomplete rename, not a functional bug.


### 21. Fallback `CBorderPassElement` is not the shared look

**ID:** 21  
**Severity:** Low  
**Path:** documented

**Verdict: CONFIRMED** (documented)
**Sources:** Review A Lower
**Files:** `hypr/src/deco.cpp:294-329`, `hypr/src/runtime.hpp:142-145`

Ignores wrap / `baseColor`, pulse, mirror two-head, and the clockwise half.
Shimmer *heading* can still reach fallback via `drawAngle`. Fine as
emergency paint.


### 22. `install.sh` copies `.qsb` + `hypr/src` but not `shiny.frag`

**ID:** 22  
**Severity:** Low  
**Path:** `mise run install`

**Verdict: CONFIRMED** (`mise run install` only)
**Sources:** Review A Lower
**Files:** `scripts/install.sh:24-36`

`omarchy plugin add` clones the git tree, which includes `shiny.frag`. Bake
from the install-copy tree is impossible. Window-ring GLSL is `shaders.hpp`,
not this frag.


### 24. `test_reload.cpp` aborts instead of failing when the `.so` is missing

**ID:** 24  
**Severity:** Low  
**Path:** `make test-full`

**Verdict: CONFIRMED**
**Sources:** Review B Low
**Files:** `hypr/tests/test_reload.cpp:16-23, 200-245`

`CHECK` increments `g_fails` and continues. Missing
`hypr/hypr-shiny-border.so` → stub load never records `plugin load ` →
`substr` on `npos` → `std::out_of_range` / SIGABRT. Default `make -C hypr
test` / `mise run test-full` do **not** run `test_reload` (`test-logic`
only). `make -C hypr test-full` builds the `.so` first, so the official
path usually has the file. Bail with a skip after that check.


### 25. `draw()` re-parses gradient strings every frame

**ID:** 25  
**Severity:** Low  
**Path:** cheap

**Verdict: CONFIRMED** (refactor, not a defect)
**Sources:** Review B Low
**Files:** `hypr/src/deco.cpp:236-258`

`strtof` loop + CW resolve per window per frame. Cheap for short strings.
QML rebuilds ramps on property change. Belongs in a config-reload hook.


### 26. `runtime.{hpp,cpp}` is a grab-bag

**ID:** 26  
**Severity:** Low  
**Path:** structure

**Verdict: CONFIRMED** (structure, not a bug)
**Sources:** Review B Low
**Files:** `hypr/src/runtime.hpp` (277 lines of contract comments)

Gradient + shimmer + pulse + geometry gates + VAO + backend mapping in one
module. JS splits `Gradient.js` / `Shimmer.js`. One Hyprland-free test
surface is an explicit design.


### 27. `overlayRev: 12` is a manual bump

**ID:** 27  
**Severity:** Low  
**Path:** cache hazard

**Verdict: CONFIRMED**; deriving from `manifest.version` is not a drop-in
**Sources:** Review B Low
**Files:** `Service.qml:31-35, 297-300`, `manifest.json` `"version": "1.1.0"`

Forget to bump after an overlay-look change with a cached service instance →
old `ShinyBorder` child kept. `Number("1.1.0")` is `1.1`, so patch versions
collide. Intent is overlay-look changes, not package version.


### 28. `audit-unified-plan.js` cements `qs-shiny-border`

**ID:** 28  
**Severity:** Low  
**Path:** default test

**Verdict: CONFIRMED**
**Sources:** Review A missing-tests
**Files:** `tests/audit-unified-plan.js:45-46`, `docs/unified-project.md`,
`manifest.json` id `wmfeht.border-fx`, `mise.toml` `tasks.test`

The design doc’s header already names `wmfeht.border-fx` and says historical
text still says `qs.shiny-border`. The test **fails if that historical name
is removed**, and it runs in the default test task. It does not require the
shipped id.


### 29. No CI config in the repo

**ID:** 29  
**Severity:** Low  
**Path:** process

**Verdict: CONFIRMED**
**Sources:** Review A missing-tests

No `.github/`, `.gitlab-ci.yml`, or similar. `mise run test` / `make -C hypr
test` are local only.
