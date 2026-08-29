# Phase 01: Align C++ PLUGIN_INIT defaults with Look.DEFAULTS

- **Sequence:** 1 of 10
- **Depends on:** none (first implementation phase)
- **Finding IDs:** 1
- **This phase:** Make `PLUGIN_INIT` defaults equal `Look.DEFAULTS` so first paint matches chrome. Matching the numbers is this phase; one shared merge is phase 05.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 1 | P1 | Look schema forked; C++ defaults win first paint | CONFIRMED | production |

## Findings

### 1. Three default tables; C++ defaults still win the first paint

**ID:** 1  
**Severity:** P1  
**Path:** production

**Verdict: CONFIRMED**
**Sources:** Review A High 1, Review B High 1 + Medium 4
**Files:** `qml/Look.js`, `scripts/look-apply.sh`, `hypr/src/main.cpp`,
`scripts/hypr-ensure.sh`, `Service.qml`

The product promise is one `shell.json` look on both hosts. Runtime default
*tables that can actually paint* are three independent contracts:

| Layer | pulse | shimmer | `pinDeg` | `borderSize` | ramp | `shimmerHz` / `shimmerDeg` |
|---|---|---|---|---|---|---|
| `Look.js` `DEFAULTS` | off | on | 120 | 2 | 4-stop | 0.3 / 20 |
| Python `DEFAULTS` in `look-apply.sh` | copy of the JS table | | | | | |
| `PLUGIN_INIT` in `hypr/src/main.cpp` | **on** | **off** | **90** | **3** | single-color | **0.6 / 25** |

`ShinyBorder.qml` property defaults match JS and are overridden by `shinyComp`
bindings. README tables are documentation, not a sixth painter. Review B’s
“six places” count is the copies you touch when adding a key; the paint fork
is C++ vs the shared look.

Production sequence (`hypr-ensure.sh`):

1. `ensure_hyprland_require`
2. `apply_look` (write Lua, **no** `--eval`)
3. `hyprctl plugin load` → `PLUGIN_INIT` registers C++ defaults, calls
   `reloadConfig()`, attaches decorations
4. `apply_look --eval`

Generated Lua only runs `hl.config` when `shinyLoaded()` is already true, so
it cannot pre-seed keys before `PLUGIN_INIT`. Until `--eval` lands, windows
paint the C++ look (breathing pulse, light from the right, thicker ring).
The README already calls this a “brief default-look flash.” It is still
user-visible on first enable, Hyprland upgrade, `omarchy refresh hyprland`
(dropped `require`, so a later compositor `reloadConfig()` snaps back to C++
defaults), and any look-apply failure.

`Service.qml` already serializes a fully merged look (`lookJson()`). On the
primary path the Python `DEFAULTS` / merge block is dead weight; it still
matters for CLI `{}` and `--disabled`.

**Fix:** make `PLUGIN_INIT` defaults the shared look. That deletes the flash,
the “not the C++ defaults” documentation, and a class of “why don’t my
windows match my bar?” bugs. One schema file consumed by Look.js, look-apply,
and C++ is the follow-up; matching the numbers is the cheap win.
