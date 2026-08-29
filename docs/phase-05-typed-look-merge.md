# Phase 05: One typed merge: coerce, clamps, chrome dt

- **Sequence:** 5 of 10
- **Depends on:** `docs/phase-01-align-cpp-defaults.md` (match the numbers before one merge). Sequenced after `docs/phase-04-abi-freshness.md` per suggested order steps 5–6.
- **Finding IDs:** 4, 5, 16, 15
- **This phase:** Clamps and typed coerce in one merge so both hosts see the same numbers. Restrict `rgba()` to 6 or 8 hex digits. Add chrome `Math.min(dt, 0.25)` to match C++.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 4 | P1 | Same look keys, different host policies | CONFIRMED | production |
| 5 | P2 | `look-apply.sh` untyped Lua emit | PARTIAL | mistyped JSON |
| 16 | P2 | Color parser accepts 7-digit `rgba()` | CONFIRMED | bad color strings |
| 15 | P2 | Chrome shimmer missing the C++ `dt` clamp | CONFIRMED | production chrome |

## Findings

### 4. Shared keys do not mean the same thing on both hosts

**ID:** 4  
**Severity:** P1  
**Path:** production

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


### 5. `look-apply.sh` can emit inverted or junk Lua from ordinary-looking JSON

**ID:** 5  
**Severity:** P2  
**Path:** mistyped JSON

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


### 16. Color parser accepts 7-digit `rgba()`

**ID:** 16  
**Severity:** P2  
**Path:** bad color strings

**Verdict: CONFIRMED**
**Sources:** Review A Medium 8
**Files:** `qml/Look.js:167-178`, `scripts/look-apply.sh` (same regex)

`/^rgba?\(\s*([0-9a-fA-F]{6,8})\s*\)$/` accepts length 7. Length 6 gets `ff`
appended; length 7 does not, so alpha is one nibble (`parseInt("e", 16) ===
14`). Junk is documented as transparent; this becomes a wrong dim/wrong-alpha
color, not full opaque. Both hosts share the bug, so this is not a
chrome-vs-window split. Restrict to `{6}` or `{8}` only.


### 15. Chrome shimmer is missing the `dt` clamp its C++ twin has

**ID:** 15  
**Severity:** P2  
**Path:** production chrome

**Verdict: CONFIRMED**
**Sources:** Review B Medium 7
**Files:** `hypr/src/deco.cpp:106-111`, `qml/ShinyBorder.qml:155-160, 229-233`

C++: `dt` clamped to `[0, 0.25]`. QML: `dt = (now - _lastTickMs) / 1000`
with no clamp. The timer resets `_lastTickMs` when it **stops**. A stall
while running (suspend/resume, busy event loop) feeds one giant step — both
channels snap and retarget instead of easing. If Qt stops the Timer,
`_lastTickMs` resets and the next tick uses a small synthetic `dt`.

One `Math.min(dt, 0.25)` restores parity.

## Test gaps copied from finding 10

Finding 10 itself lives in phase 07 with finding 9. These uncovered-surface
bullets belong to the typed-look sitting in this phase:

- look-apply / Look.js on `"false"`, `"inf"`, 7-digit hex, empty/invalid types
- chrome vs Hyprland clamp parity (`lobe`, `borderSize: -1`, int headings)
