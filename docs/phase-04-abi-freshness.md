# Phase 04: Do not reuse an ABI-incompatible session .so

- **Sequence:** 4 of 10
- **Depends on:** `docs/phase-03-reload-status.md` (suggested order: freshness after honest reload STATUS)
- **Finding IDs:** 3
- **This phase:** Include compositor hash / header mtime / compiler id in freshness (or rebuild after a hash-mismatch failure). Delete the stale session `.so` so the next ensure cannot reuse it.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 3 | P1 | Hyprland upgrades reuse a stale `.so` | CONFIRMED | production |

## Findings

### 3. Hyprland upgrades reuse ABI-incompatible binaries

**ID:** 3  
**Severity:** P1  
**Path:** production

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
