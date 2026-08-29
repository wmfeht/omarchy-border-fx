# Phase 03: Honest reload STATUS and hyprReady

- **Sequence:** 3 of 10
- **Depends on:** `docs/phase-02-disable-persist-and-load.md` (suggested order: stop `load_session_so || true` after the disable/load sitting)
- **Finding IDs:** 6, 23
- **This phase:** Do not `|| true` a failed hot-reload load. Emit `STATUS=load-failed` and leave `hyprReady` false (the `onExited` collector currently cannot fail closed).
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 6 | P2 | Failed hot-reload reported as `STATUS=ok` | CONFIRMED | production reload |
| 23 | Low | Dead `STATUS=` collector; `hyprReady` always true | CONFIRMED | production |

## Findings

### 6. Failed reloads are reported as successful

**ID:** 6  
**Severity:** P2  
**Path:** production reload

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


### 23. Dead `STATUS=` matching in `ensureProc`

**ID:** 23  
**Severity:** Low  
**Path:** production

**Verdict: CONFIRMED**
**Sources:** Review B Low
**Files:** `Service.qml:431-448`

`onExited` sets `hyprReady = true` unconditionally. The collector cannot fail
closed. Combined with finding 6, the service will not retry a failed window
ring.
