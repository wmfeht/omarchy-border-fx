# Phase 08: Script hygiene: hyprland.lua rewrite, pluginctl path, pluginRoot, dofile

- **Sequence:** 8 of 10
- **Depends on:** `docs/phase-07-shared-shader-and-tests.md` (suggested order steps 11–12 after the shader/test theme)
- **Finding IDs:** 14, 17, 18, 19
- **This phase:** Replace `grep -v` with an anchored rewrite or a commented tombstone. `pluginctl` `mktemp` under `$XDG_RUNTIME_DIR`. Percent-decode `pluginRoot()` `file://` fallback. Do not leave `hyprctl eval` as string concat around `dofile`.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 14 | P2 | `hyprland.lua` rewritten with `grep -v` | CONFIRMED | production (legacy) |
| 17 | P2 | Dev `pluginctl` loads from world-writable `/tmp` | CONFIRMED | nest/dev only |
| 18 | Low | `pluginRoot()` `file://` strip, no percent-decode | CONFIRMED | fallback only |
| 19 | Low | `dofile([=[…]=])` breaks on `]=]` in the path | CONFIRMED | latent |

## Findings

### 14. `ensure_hyprland_require` edits `hyprland.lua` with `grep -v`

**ID:** 14  
**Severity:** P2  
**Path:** production (legacy)

**Verdict: CONFIRMED**
**Sources:** Review A Medium 7
**Files:** `scripts/hypr-ensure.sh:47-58`

Any line containing `hypr.shiny-border` is deleted — comments, other
requires, user notes. No backup. `mktemp` + `mv -f` overwrites the user’s
file. Appending `pcall(require, "hypr.border-fx")` is fine; the `grep -v`
rewrite is not.

Only runs while a legacy line still exists. Fresh installs never hit it.


### 17. Dev tooling loads the plugin from a predictable path in `/tmp`

**ID:** 17  
**Severity:** P2  
**Path:** nest/dev only

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


### 18. `pluginRoot()` `file://` fallback

**ID:** 18  
**Severity:** Low  
**Path:** fallback only

**Verdict: CONFIRMED** (fallback only)
**Sources:** Review A Lower, Review B Low
**Files:** `Service.qml:243-252`

`substring(7)` does not percent-decode. `file://localhost/…` and `%20` break
script invocation when `manifest.__sourceDir` is absent. Happy path is
Omarchy-injected `__sourceDir`. Common `file:///` (three slashes) is fine.


### 19. `hyprctl eval "dofile([=[${LUA_FILE}]=])"`

**ID:** 19  
**Severity:** Low  
**Path:** latent

**Verdict: CONFIRMED** (latent)
**Sources:** Review A Lower
**Files:** `scripts/look-apply.sh:319`

Default `~/.config/hypr/border-fx.lua` does not contain `]=]`. `--lua` /
`LUA_FILE=` still concatenate. Don’t leave eval as string concat.
