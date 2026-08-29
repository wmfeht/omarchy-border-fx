# Phase 02: Disable persists, skip non-shiny load, lock teardown vs ensure

- **Sequence:** 2 of 10
- **Depends on:** `docs/phase-01-align-cpp-defaults.md` (suggested order: teardown after aligning defaults; finding 8’s non-shiny flash is worse while C++ defaults still differ)
- **Finding IDs:** 2, 8, 11
- **This phase:** Always write disabled Lua on teardown (`--eval` when listed). If `effect != "shiny"`, write disabled Lua and skip compile/load. Lock teardown vs ensure so disable then enable cannot race.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 2 | P1 | Disable does not persist-disable the window ring | CONFIRMED | production |
| 8 | P2 | Non-shiny configs still compile and `plugin load` | CONFIRMED | production |
| 11 | P2 | Disable then enable races detached teardown vs ensure | CONFIRMED | production |

## Findings

### 2. Disabling does not reliably disable the window effect

**ID:** 2  
**Severity:** P1  
**Path:** production

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


### 8. Non-shiny configurations still build and load the shiny plugin

**ID:** 8  
**Severity:** P2  
**Path:** production

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


### 11. Disable / enable race

**ID:** 11  
**Severity:** P2  
**Path:** production

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

## Test gaps copied from finding 10

Finding 10 itself lives in phase 07 with finding 9. This uncovered-surface
bullet belongs to the ensure/teardown sitting in this phase:

- `hypr-ensure.sh` decision tree with a stub `hyprctl` (listed / hyprpm /
  mapped / build-fail) — the stub harness already exists in `test_reload.cpp`
  / `hypr-session.js` and is pointed at `pluginctl` / `wait_plugin_gone`, not
  ensure
