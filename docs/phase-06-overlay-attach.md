# Phase 06: Event-driven overlay attach; stop rewriting borderSpec

- **Sequence:** 6 of 10
- **Depends on:** `docs/phase-05-typed-look-merge.md` (suggested order step 9 follows the look-merge sitting; findings 8 and 11 were pulled forward into phase 02)
- **Finding IDs:** 7
- **This phase:** Discover hosts from existing signals. Attach once, bind, detach on hide/destroy. Do not poll-assign `borderSpec`. Extract predicates for tests.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 7 | P2 | 200 ms sweep rewrites `borderSpec`; JS assign drops bindings | CONFIRMED / PARTIAL | production |

## Findings

### 7. `Service.qml` rewrites every showing card 5×/s and drops bindings

**ID:** 7  
**Severity:** P2  
**Path:** production

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

## Test gaps copied from finding 10

Finding 10 itself lives in phase 07 with finding 9. This uncovered-surface
bullet belongs to the overlay-attach sitting in this phase:

- `Service.qml` host/stock/sweep/ensure/teardown/`overlayRev` (finding 7)
