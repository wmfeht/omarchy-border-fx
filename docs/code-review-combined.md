# Combined code review: `omarchy-border-fx` (initial commit)

Treated as a first-commit review of the whole tree. Two independent reviews
were merged, then each unique finding was checked against the current source
(control plane, both look adapters, both shaders, the Hyprland plugin, install
and session scripts, and the test suites). Nothing here was accepted on the
reviewer’s word alone.

**Inputs**

- **Review A** — first-commit pass over the control plane, adapters, shaders,
  plugin, and session scripts, plus a numbered P1/P2 list.
- **Review B** — first-commit pass focused on N-way duplication, grep tests,
  and chrome/C++ twins.

**Verification**

Each merged finding was verified independently against the tree as of this
document. Verdicts:

| Verdict | Meaning |
|---|---|
| **CONFIRMED** | The claim matches the source, and the stated consequence is reachable. |
| **PARTIAL** | The core fact is true, but severity, trigger, or consequence is overstated, or a mitigating path exists. |
| **REFUTED** | The claim is wrong, outdated, or not a production-path bug as stated. |

No finding was refuted in full. Several were narrowed.

The compositor-free JS suites (`tests/run.js`, `tests/look.js`,
`tests/hypr-session.js`, `tests/audit-unified-plan.js`) exist and are the
default `mise run test` task. C++ `test-logic` (`test_runtime`, `test_teardown`,
`test_visual`) does not need a live compositor; `hypr-shiny-border.so` and
`test_reload` do need Hyprland headers / a built `.so`. The repo pins
`-std=gnu++26`.

---

## Verdict

Do not treat this as ready to rubber-stamp.

The compositor-lifecycle engineering (mapped `.so` install via rename, unload
wait, teardown latch, refuse-to-double-load) is the strongest part of the tree
and both reviewers said so independently. The product promise — **one look, two
hosts, enable is the switch** — is undermined by forked defaults, untyped
fan-out, host-divergent clamps, a polling overlay manager with almost no tests,
and a disable path that does not persist-disable the window ring.

Highest-leverage change: **make C++ `PLUGIN_INIT` defaults equal
`Look.DEFAULTS`, and stop implementing merge twice.** That is a
behavior-preserving simplification that removes a whole category of “windows
don’t match chrome” failures. Pair it with teardown writing disabled Lua (and
`--eval` on the hyprpm path) so disable actually disables.

---

## How findings were merged

Review A and Review B overlap on the look schema, C++ defaults, the 200 ms
sweep, dual shaders, missing tests, `pluginRoot()`, and `lua_str` / junk
types. Those are one finding each below. Review A’s numbered P1/P2 items
(teardown persistence, ABI freshness, false `STATUS=ok`, binding destruction,
non-shiny still loads) were not in Review B’s high/medium list and are kept.
Review B’s `/tmp` pluginctl squat, chrome `dt` clamp, `test_reload` abort, and
dead `STATUS=` collector are not in Review A and are kept.

Review A’s “six sources of the look” is recorded as **three default tables
that can paint**, plus copies that do not independently paint (QML property
defaults matching JS, Service bindings, README tables).

---

## Summary table

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 1 | P1 | Look schema forked; C++ defaults win first paint | CONFIRMED | production |
| 2 | P1 | Disable does not persist-disable the window ring | CONFIRMED | production |
| 3 | P1 | Hyprland upgrades reuse a stale `.so` | CONFIRMED | production |
| 4 | P1 | Same look keys, different host policies | CONFIRMED | production |
| 5 | P2 | `look-apply.sh` untyped Lua emit | PARTIAL | mistyped JSON |
| 6 | P2 | Failed hot-reload reported as `STATUS=ok` | CONFIRMED | production reload |
| 7 | P2 | 200 ms sweep rewrites `borderSpec`; JS assign drops bindings | CONFIRMED / PARTIAL | production |
| 8 | P2 | Non-shiny configs still compile and `plugin load` | CONFIRMED | production |
| 9 | P2 | Dual shaders; tests are source greps | PARTIAL | both |
| 10 | P2 | Fragile surfaces untested; change-detectors in default suite | CONFIRMED | tests |
| 11 | P2 | Disable then enable races detached teardown vs ensure | CONFIRMED | production |
| 12 | P2 | `PLUGIN_EXIT` clears the whole render pass | CONFIRMED | production unload |
| 13 | P2 | Shiny pass can bail after mutating GL; no fallback | CONFIRMED | production draw |
| 14 | P2 | `hyprland.lua` rewritten with `grep -v` | CONFIRMED | production (legacy) |
| 15 | P2 | Chrome shimmer missing the C++ `dt` clamp | CONFIRMED | production chrome |
| 16 | P2 | Color parser accepts 7-digit `rgba()` | CONFIRMED | bad color strings |
| 17 | P2 | Dev `pluginctl` loads from world-writable `/tmp` | CONFIRMED | nest/dev only |
| 18 | Low | `pluginRoot()` `file://` strip, no percent-decode | CONFIRMED | fallback only |
| 19 | Low | `dofile([=[…]=])` breaks on `]=]` in the path | CONFIRMED | latent |
| 20 | Low | Generated Lua still uses `_G.__qs_border_fx_start` | CONFIRMED | harmless |
| 21 | Low | Fallback `CBorderPassElement` is not the shared look | CONFIRMED | documented |
| 22 | Low | `install.sh` copies `.qsb` but not `shiny.frag` | CONFIRMED | `mise run install` |
| 23 | Low | Dead `STATUS=` collector; `hyprReady` always true | CONFIRMED | production |
| 24 | Low | `test_reload` aborts if the `.so` is missing | CONFIRMED | `make test-full` |
| 25 | Low | `draw()` re-parses gradient strings every frame | CONFIRMED | cheap |
| 26 | Low | `runtime.{hpp,cpp}` is a grab-bag vs JS split | CONFIRMED | structure |
| 27 | Low | `overlayRev: 12` is a manual bump | CONFIRMED | cache hazard |
| 28 | Low | `audit-unified-plan.js` cements `qs-shiny-border` | CONFIRMED | default test |
| 29 | Low | No CI config in the repo | CONFIRMED | process |

---

## High (P1)

### 1. Three default tables; C++ defaults still win the first paint

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

---

### 2. Disabling does not reliably disable the window effect

**Verdict: CONFIRMED**
**Sources:** Review A Findings 1 (P1)
**Files:** `scripts/hypr-teardown.sh:30-48`, `scripts/look-apply.sh`

Successful owned-copy unload prints `unloaded $SESSION_SO` and **does not**
call `disable_look`. Non-purge keeps the session `.so`. `hyprland.lua` still
`pcall(require, "hypr.border-fx")`. Last ensure-written Lua still has
`SHINY_LOAD = true`, so next login `hl.plugin.load`s the ring with the
service gone.

Reused hyprpm / nest copies take the other branch: `disable_look` **without**
`--eval`. Disabled Lua is written; the live ring stays until something else
reloads config.

`--purge` (uninstall / reinstall) does delete the Lua. Chrome overlays are
detached in QML independently. The hole is the window ring across login, and
the current-session hyprpm path.

**Fix:** always write disabled Lua on teardown. `--eval` when the plugin is
still listed. Add teardown integration tests for both the session-copy and
hyprpm paths.

---

### 3. Hyprland upgrades reuse ABI-incompatible binaries

**Verdict: CONFIRMED**
**Sources:** Review A Findings 2 (P1)
**Files:** `scripts/hypr-ensure.sh:61-70,154-161`, `hypr/Makefile:37-43`,
`hypr/src/main.cpp:42-49`

`sources_newer_than` compares plugin `src/*.cpp` / `*.hpp` mtimes to the
`.so`. Makefile objects depend on those same sources only. Neither side
watches Hyprland headers, compiler, or compositor hash.

`PLUGIN_INIT` throws on `__hyprland_api_get_hash()` vs
`__hyprland_api_get_client_hash()` mismatch. After a compositor upgrade,
plugin sources are typically not newer, so ensure reuses
`~/.local/lib/hypr/hypr-shiny-border.so`, load fails, chrome stays on,
re-enable repeats the same stale binary. `mise run headers` exists for
humans; the ensure path does not use it.

Cold-load failure correctly emits `STATUS=load-failed` (unlike finding 6).
`Service.qml` still sets `hyprReady = true` on any exit and does not retry.

**Fix:** include compositor hash / header mtime / compiler id in freshness
(or always rebuild when `PLUGIN_INIT` last failed hash-mismatch). Delete the
stale session `.so` on mismatch so the next ensure cannot reuse it.

---

### 4. Shared keys do not mean the same thing on both hosts

**Verdict: CONFIRMED** (the `pinDeg: 120.7` example is slightly wrong)
**Sources:** Review A High 3
**Files:** `qml/Look.js`, `qml/ShinyBorder.qml`, `qml/Shimmer.js`,
`hypr/src/main.cpp`, `hypr/src/runtime.cpp`

`Look.merge` does not clamp. Hyprland clamps in `CIntValue` / `CFloatValue`.
Chrome only clamps some paths.

**Lobe.** Shimmer clamps to `[0.04, 0.5]` on both hosts. Pulse / none on
chrome is `Math.max(lobe, 0.04)` only — no 0.5 cap. Hyprland’s `lobe`
`CFloatValue` is already `[0.04, 0.5]`. So `lobe: 1` with shimmer **off**
fills the chrome panel and stays 0.5 on windows. Default look has shimmer
on, so this split is hidden until pulse / frozen shimmer.

**`borderSize: -1`.** Chrome `visible: … && borderSize > 0` hides the ring.
Hyprland `shinyResolvedBorderSize` follows `general:border_size`. Same JSON,
opposite intent. README documents the Hyprland sentinel; it still breaks
“one look.” `borderSize: 100` similarly: chrome uses 100, Hyprland clamps to
20.

**Headings.** Hyprland `pin_deg` / `angle_offset` / `shimmer_deg` are ints.
Chrome: `property int pinDeg`, `property real angleOffset`, `property real
shimmerDeg`. `pinDeg: 120.7` snaps on **both** sides (`property int`).
Fractional drift is real for `angleOffset` / `shimmerDeg`.

This is not “host ignores unknown keys.” It is the same key with two
policies.

**Fix:** clamps in `Look.merge` (or `Look.clampForHost` that both adapters
must consume) so both hosts see the same numbers. Decide whether `-1` is a
shared “follow stock” sentinel or illegal in the look document.

---

## Medium (P2)

### 5. `look-apply.sh` can emit inverted or junk Lua from ordinary-looking JSON

**Verdict: PARTIAL**
**Sources:** Review A High 2, Review B Low (`lua_str` / junk types)
**Files:** `scripts/look-apply.sh:195-207`, `qml/Look.js` `merge`

`lua_bool` is Python truthiness. `lua_num` is `float()` + `repr()`.
`Look.merge` copies values with no type check. Tests only send real JSON
booleans and numbers.

Reachable if `shell.json` (or CLI `--look-json`) quotes types:

- `"shimmer": "false"` → Lua `shimmer = true` (non-empty string). Chrome
  `property bool shimmer` also coerces a non-empty string to true. Both hosts
  turn shimmer **on** when the user thought they turned it off.
- `"borderSize": "abc"` → `ValueError` in `float()`, `set -e` kills
  look-apply / ensure. Service only logs `hypr-ensure exited`.
- `"borderSize": "inf"` / `"nan"` → Python `repr` emits `inf` / `nan`. Those
  are Lua *identifiers*, not a parse error. Eval may set nil or fail at
  config apply — not “invalid Lua syntax” as Review A stated.
- `lua_str` escapes `\` and `"` but not newlines; a string key with `\n`
  can stop the generated file from parsing.

Well-typed JSON from a normal Omarchy write is fine. After a *successful*
apply, a later failed apply leaves the last good Hyprland look, not C++
defaults. C++ defaults stick when eval never ran.

**Fix:** one typed coerce at the JSON boundary (`true`/`false`/`1`/`0` only;
numbers must be finite; on failure keep the default and warn). Do not let
look-apply crash or write non-config.

---

### 6. Failed reloads are reported as successful

**Verdict: CONFIRMED**
**Sources:** Review A Findings 3 (P2)
**Files:** `scripts/hypr-ensure.sh:117-133`, `Service.qml:431-448`

Hot-reload path (plugin already listed as the session copy, sources newer):

```text
unload_session_so → copy_session_so → load_session_so || true
apply_look --eval
STATUS=ok
```

The working plugin is already gone. `|| true` hides load failure. Service
sets `hyprReady = true` on **every** `onExited` anyway, and never retries
ensure.

Initial load correctly uses `STATUS=load-failed`. This finding is specifically
the already-loaded + rebuild path.

**Fix:** do not `|| true` that load. Emit `STATUS=load-failed` and leave
`hyprReady` false (or retry) so the service can recover.

---

### 7. `Service.qml` rewrites every showing card 5×/s and drops bindings

**Verdict: CONFIRMED** for the poll/assign; **PARTIAL** for “host chrome
becomes stale” (binding break is real; live Omarchy `borderSpec` bindings
are not in this repo)
**Sources:** Review A Medium 4, Review B Medium 6, Review A Findings 4 (P2)
**Files:** `Service.qml:203-227, 291-305, 378-387, 468-473`

`sweep()` runs on a 200 ms timer and calls `attach()` for every visible host.
`attach()` always calls `hideStock()`, which **always** assigns
`card.borderSpec` and `card.clip` — a new `Border.flat(...)` every tick, per
open panel/toast. The overlay child is not recreated (`existingShiny`
short-circuits); the churn is property writes plus a full tree walk /
`findCard` BFS, including hidden hosts.

QML: a JavaScript assignment replaces a binding. Restore writes the
*captured value*, not a binding. After detach, theme/state expressions that
used to flow through `borderSpec` / `clip` will not. This repo does not
contain Omarchy `BorderSurface` QML, so it is not proven those properties
are live bindings rather than static values. If they are bindings, restore
cannot put them back.

Duck-typing (`opened` + `cardWidth` + `borderSpec`) lives in the same
~500-line file as process orchestration. A leftover object with those
three properties gets a ring. When host detection fails, only toasts warn
(`warnedMissingToasts`); panels and overlays fail silently — the failure
mode a shell update will cause.

`Connections` for `onActivePopoutChanged` and the popup model already exist;
the timer still does the real work.

There are **no tests** for host discovery, `hideStock` / `restoreStock`,
leftover `overlayRev`, or disable teardown of chrome. `tests/run.js` only
greps three `Service.qml` binding strings.

**Fix:** discover hosts from the signals you already have. Attach once, bind,
detach on hide/destroy. Keep a set of attached cards. Do not poll-assign
`borderSpec`. Prefer overlaying without destroying host bindings (opacity /
z / extra child) if the host API allows it. Extract predicates into a
`.pragma library` so `tests/run.js` can drive them.

---

### 8. Non-shiny configurations still build and load the shiny plugin

**Verdict: CONFIRMED**
**Sources:** Review A Findings 5 (P2)
**Files:** `Service.qml:266-275, 385-386, 493-496`,
`scripts/hypr-ensure.sh:154-182`, `scripts/look-apply.sh:226-228`

README: `effect` selects the renderer. Chrome already gates attach on
`effectIsShiny()`. Generated Lua sets `SHINY_LOAD = false` and
`enabled = false` when `effect != "shiny"`.

`Component.onCompleted` always runs `hypr-ensure.sh`. Ensure never reads
`effect`. If the plugin is not already listed, it still compiles and
`hyprctl plugin load`s, bypassing Lua `SHINY_LOAD`. Then `--eval` may set
`enabled = false`. The `.so` is still mapped (PLUGIN_INIT, decorations,
reload-config). Combined with finding 1, a non-shiny enable can flash the
C++ look before disable lands.

**Fix:** if `effect != "shiny"`, write disabled Lua and skip compile/load.
Unload if a previous shiny session left the plugin mapped.

---

### 9. Dual shaders; tests are change-detectors, not a shared core

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

---

### 10. Fragile surfaces have no tests; change-detectors run in the default suite

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

---

### 11. Disable / enable race

**Verdict: CONFIRMED**
**Sources:** Review A Medium 10
**Files:** `Service.qml:286-288, 498-503`, `scripts/reinstall.sh:142-149`,
`scripts/hypr-session.sh` `wait_plugin_gone`

`Component.onDestruction` runs `Quickshell.execDetached(hypr-teardown.sh)`
because a child `Process` would die with the service. `reinstall.sh`
restarts the shell **before** add, because teardown-vs-ensure used to
`cp -f` a mapped `.so` and SIGBUS.

Plain `omarchy plugin disable` then `enable` has no such barrier. Teardown
can unload after the new ensure has loaded the same `$SESSION_SO`.
`wait_plugin_gone` is only on teardown / ensure-replace, not across two
detached scripts. `install_session_so` now rename-over, so the old SIGBUS is
less likely; the remaining failure is “effect vanishes / double load
refused.”

**Fix:** a lock file under `$XDG_RUNTIME_DIR`, or have ensure refuse to load
until teardown’s pid is gone.

---

### 12. `PLUGIN_EXIT` clears the compositor’s entire render pass

**Verdict: CONFIRMED** for `clear()`; **PARTIAL** for “every unload leaks”
**Sources:** Review A Medium 6
**Files:** `hypr/src/main.cpp:143-160`, `hypr/src/pass.cpp:86-90`,
`hypr/src/teardown.cpp:41-52`

```cpp
if (g_pHyprRenderer)
    g_pHyprRenderer->m_renderPass.clear();
```

Comments explain nested `CShinyPassElement` and UAF on `dlclose`.
`removeAllOfType("CShinyPassElement")` does not recurse. The cure still drops
every pass element in the current frame, including stock borders and windows.
Disable / remove can blank or flicker that frame, not just this ring.

`hyprAbandonShader` (`new SP<CShader>(std::move(…))`) is a **deliberate** leak
when there is no GL context, so `~CShader` does not `glDelete` at `dlclose`.
Repeat enable/disable **with a live context** uses `reset()`, not abandon.
Accumulation is the no-context path (shutdown / GL already gone), not every
hyprpm toggle. Testers encode the mark → clear → destroy order.

**Fix:** a Hyprland-side “recurse remove type” or a pass-element epoch so
leftover draws no-op without nuking the frame.

---

### 13. `CShinyPassElement::draw` can leave GL bound and bail

**Verdict: CONFIRMED** (GL inherit is plausible, not proven without Hyprland
`useShader` RAII)
**Sources:** Review A Medium 5
**Files:** `hypr/src/pass.cpp:146-203`, `hypr/src/deco.cpp:275-291`

`blend(true)` and `useShader` happen before `if (!shader) return {}`. The
VAO guard exists because binding `-1` / `0xFFFFFFFF` killed NVIDIA. The
early return after `useShader` does not unbind VAO, reset blend, or scissor.
The success path unbinds VAO and clears scissor, and also never resets blend
or the program — so inherit depends on whether `useShader` is RAII (headers
not in this repo).

If `useShader` succeeds and VAO is bad, deco has already queued
`CShinyPassElement` and skipped `CBorderPassElement`. Result is **no ring**
rather than the linear fallback.

---

### 14. `ensure_hyprland_require` edits `hyprland.lua` with `grep -v`

**Verdict: CONFIRMED**
**Sources:** Review A Medium 7
**Files:** `scripts/hypr-ensure.sh:47-58`

Any line containing `hypr.shiny-border` is deleted — comments, other
requires, user notes. No backup. `mktemp` + `mv -f` overwrites the user’s
file. Appending `pcall(require, "hypr.border-fx")` is fine; the `grep -v`
rewrite is not.

Only runs while a legacy line still exists. Fresh installs never hit it.

---

### 15. Chrome shimmer is missing the `dt` clamp its C++ twin has

**Verdict: CONFIRMED**
**Sources:** Review B Medium 7
**Files:** `hypr/src/deco.cpp:106-111`, `qml/ShinyBorder.qml:155-160, 229-233`

C++: `dt` clamped to `[0, 0.25]`. QML: `dt = (now - _lastTickMs) / 1000`
with no clamp. The timer resets `_lastTickMs` when it **stops**. A stall
while running (suspend/resume, busy event loop) feeds one giant step — both
channels snap and retarget instead of easing. If Qt stops the Timer,
`_lastTickMs` resets and the next tick uses a small synthetic `dt`.

One `Math.min(dt, 0.25)` restores parity.

---

### 16. Color parser accepts 7-digit `rgba()`

**Verdict: CONFIRMED**
**Sources:** Review A Medium 8
**Files:** `qml/Look.js:167-178`, `scripts/look-apply.sh` (same regex)

`/^rgba?\(\s*([0-9a-fA-F]{6,8})\s*\)$/` accepts length 7. Length 6 gets `ff`
appended; length 7 does not, so alpha is one nibble (`parseInt("e", 16) ===
14`). Junk is documented as transparent; this becomes a wrong dim/wrong-alpha
color, not full opaque. Both hosts share the bug, so this is not a
chrome-vs-window split. Restrict to `{6}` or `{8}` only.

---

### 17. Dev tooling loads the plugin from a predictable path in `/tmp`

**Verdict: CONFIRMED** for nest/dev; **not** the production session copy
**Sources:** Review B Medium 5
**Files:** `hypr/scripts/pluginctl.sh:72-78`, `scripts/hypr-session.sh`
`install_session_so`, `scripts/look-apply.sh` permission line

`dest="/tmp/hypr-shiny-border-$$.so"`, `rm -f /tmp/hypr-shiny-border-*.so`,
`STATE=/tmp/hypr-shiny-border.lastso`. Another local user can squat a
guessable pid path. `pluginctl` refuses instance 0 unless `SHINY_LIVE=1`.

Production `install_session_so` writes a sibling temp under
`~/.local/lib/hypr/` and `mv`s. That path is fine.

Related, production: generated Lua always emits

```lua
hl.permission({ binary = "/usr/(bin|local/bin)/hyprctl", type = "plugin", mode = "allow" })
```

even for `--disabled`. That permanently waives Hyprland’s plugin-load prompt
for `hyprctl` under those two prefixes. Worth a README sentence.

**Fix for pluginctl:** `mktemp` under `$XDG_RUNTIME_DIR` (0700).

---

## Low

### 18. `pluginRoot()` `file://` fallback

**Verdict: CONFIRMED** (fallback only)
**Sources:** Review A Lower, Review B Low
**Files:** `Service.qml:243-252`

`substring(7)` does not percent-decode. `file://localhost/…` and `%20` break
script invocation when `manifest.__sourceDir` is absent. Happy path is
Omarchy-injected `__sourceDir`. Common `file:///` (three slashes) is fine.

### 19. `hyprctl eval "dofile([=[${LUA_FILE}]=])"`

**Verdict: CONFIRMED** (latent)
**Sources:** Review A Lower
**Files:** `scripts/look-apply.sh:319`

Default `~/.config/hypr/border-fx.lua` does not contain `]=]`. `--lua` /
`LUA_FILE=` still concatenate. Don’t leave eval as string concat.

### 20. Generated Lua still uses `_G.__qs_border_fx_start`

**Verdict: CONFIRMED** (harmless)
**Sources:** Review A Lower
**Files:** `scripts/look-apply.sh:249-251`, `tests/look.js` (still expects
the old name), `Service.qml` still matches `objectName === "qs-border-fx"`

Incomplete rename, not a functional bug.

### 21. Fallback `CBorderPassElement` is not the shared look

**Verdict: CONFIRMED** (documented)
**Sources:** Review A Lower
**Files:** `hypr/src/deco.cpp:294-329`, `hypr/src/runtime.hpp:142-145`

Ignores wrap / `baseColor`, pulse, mirror two-head, and the clockwise half.
Shimmer *heading* can still reach fallback via `drawAngle`. Fine as
emergency paint.

### 22. `install.sh` copies `.qsb` + `hypr/src` but not `shiny.frag`

**Verdict: CONFIRMED** (`mise run install` only)
**Sources:** Review A Lower
**Files:** `scripts/install.sh:24-36`

`omarchy plugin add` clones the git tree, which includes `shiny.frag`. Bake
from the install-copy tree is impossible. Window-ring GLSL is `shaders.hpp`,
not this frag.

### 23. Dead `STATUS=` matching in `ensureProc`

**Verdict: CONFIRMED**
**Sources:** Review B Low
**Files:** `Service.qml:431-448`

`onExited` sets `hyprReady = true` unconditionally. The collector cannot fail
closed. Combined with finding 6, the service will not retry a failed window
ring.

### 24. `test_reload.cpp` aborts instead of failing when the `.so` is missing

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

**Verdict: CONFIRMED** (refactor, not a defect)
**Sources:** Review B Low
**Files:** `hypr/src/deco.cpp:236-258`

`strtof` loop + CW resolve per window per frame. Cheap for short strings.
QML rebuilds ramps on property change. Belongs in a config-reload hook.

### 26. `runtime.{hpp,cpp}` is a grab-bag

**Verdict: CONFIRMED** (structure, not a bug)
**Sources:** Review B Low
**Files:** `hypr/src/runtime.hpp` (277 lines of contract comments)

Gradient + shimmer + pulse + geometry gates + VAO + backend mapping in one
module. JS splits `Gradient.js` / `Shimmer.js`. One Hyprland-free test
surface is an explicit design.

### 27. `overlayRev: 12` is a manual bump

**Verdict: CONFIRMED**; deriving from `manifest.version` is not a drop-in
**Sources:** Review B Low
**Files:** `Service.qml:31-35, 297-300`, `manifest.json` `"version": "1.1.0"`

Forget to bump after an overlay-look change with a cached service instance →
old `ShinyBorder` child kept. `Number("1.1.0")` is `1.1`, so patch versions
collide. Intent is overlay-look changes, not package version.

### 28. `audit-unified-plan.js` cements `qs-shiny-border`

**Verdict: CONFIRMED**
**Sources:** Review A missing-tests
**Files:** `tests/audit-unified-plan.js:45-46`, `docs/unified-project.md`,
`manifest.json` id `wmfeht.border-fx`, `mise.toml` `tasks.test`

The design doc’s header already names `wmfeht.border-fx` and says historical
text still says `qs.shiny-border`. The test **fails if that historical name
is removed**, and it runs in the default test task. It does not require the
shipped id.

### 29. No CI config in the repo

**Verdict: CONFIRMED**
**Sources:** Review A missing-tests

No `.github/`, `.gitlab-ci.yml`, or similar. `mise run test` / `make -C hypr
test` are local only.

---

## Structural bar (both reviewers)

The look is a document plus two adapters. The adapters are copies, not a
module. The C++ plugin still thinks it is a standalone hyprpm product (its
own defaults, `hyprpm.toml` `commit_pins = []`, nest workflow). Service is a
duck-typed tree walker plus a process supervisor.

What to do instead of polishing in place:

1. **One `look.json` schema** (keys, types, clamps, defaults). Generate JS
   defaults, Python/Lua emit, and C++ `PLUGIN_INIT` from it — or have
   look-apply exec the JS library. Delete the second merge.
2. **C++ defaults = that schema.** First paint is the intended look even
   with no Lua.
3. **Service split:** host discovery / overlay attach / Hypr bridge.
   Event-driven attach. No 200 ms `borderSpec` rewrite.
4. **One fragment source** compiled to `.qsb` and inlined into
   `shaders.hpp`. Stop grepping one file and hoping the other matches.

`Service.qml` is ~500 lines (under a 1k-line smell). The problem is
coupling, not length. Findings 1 and 9 have deletion-shaped fixes, not
rearrangement-shaped ones.

---

## What is good

Worth saying plainly: the compositor-lifecycle engineering is excellent.
Both reviews agreed, and verification did not walk any of this back.

- Rename-not-truncate `.so` install with a real inode test
  (`tests/hypr-session.js` `checkInstallSessionSo`)
- Teardown ordering with spy-based tests (`test_teardown.cpp` lifecycle, not
  only the grep)
- Seed-0 xorshift guard, deterministic shimmer
- Hyprland-free extraction of decision logic into testable functions
- Atomic tmp+`mv` Lua writes
- Refuse-to-double-load by plugin name
- File sizes are healthy (largest source file well under 1k lines)
- Behavioral tests that do exist (gradient sampling, shimmer bounds,
  positions parsing) are thorough *within* each runtime

The SIGBUS-aware install, unload wait, and Hyprland-free runtime tests are
the parts that should survive a refactor of the look schema.

---

## Suggested order of work

1. Align `PLUGIN_INIT` defaults with `Look.DEFAULTS` (finding 1). Cheap, user-visible.
2. Teardown always writes disabled Lua and `--eval`s when listed (finding 2).
3. Stop `load_session_so || true`; don’t report failed reload as `ok` (finding 6).
4. Freshness includes compositor hash; don’t reuse a rejected `.so` (finding 3).
5. Typed coerce + clamps in one merge (findings 4, 5, 16).
6. `Math.min(dt, 0.25)` in chrome shimmer (finding 15). One line.
7. Skip compile/load when `effect != "shiny"` (finding 8).
8. Lock file for teardown vs ensure (finding 11).
9. Stop poll-assigning `borderSpec`; extract host predicates for tests (finding 7).
10. One fragment source; JS-vs-C++ shimmer step test; stub-hyprctl for
    `hypr-ensure.sh` (findings 9, 10).
11. Replace `grep -v` with an anchored rewrite or leave a commented tombstone
    (finding 14).
12. `pluginctl` `mktemp` under `$XDG_RUNTIME_DIR` (finding 17).

---

## Reviewer notes that were narrowed

| Original claim | After verification |
|---|---|
| Six independent look sources | Three default *tables*; QML defaults match JS; Service bindings are wiring; README is docs |
| `"inf"` / `"nan"` is invalid Lua | Valid Lua identifiers; config apply may still fail |
| Failed apply always snaps to C++ defaults | Only if eval never succeeded; later failure keeps last good Lua |
| `pinDeg: 120.7` moves chrome and snaps windows | Both sides snap (`property int` / `CIntValue`); drift is `angleOffset` / `shimmerDeg` |
| Tests only lock the Qt frag | JS suite does; `test_visual.cpp` greps both |
| Every unload leaks a GL program | Only the no-context `abandon` path |
| `/tmp` squat is the production load path | Dev `pluginctl` only; production is `~/.local/lib` |
| `overlayRev` should be `manifest.version` | Semver is not an `int`; patch versions collide |
| Change-detectors dominate the suite | They exist and run by default; a large behavioral body also exists |
| `Service.qml` untested “at all” | Three binding strings are grepped; host/stock/sweep are not |
