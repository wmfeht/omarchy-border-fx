# Phase 09: Render pass: PLUGIN_EXIT must not clear the frame; draw must not bail dirty

- **Sequence:** 9 of 10
- **Depends on:** `docs/phase-07-shared-shader-and-tests.md` (after the suggested-order shader/test theme). Sequenced after `docs/phase-08-script-hygiene.md` so leftover P2 follows remaining suggested-order items 14 and 17.
- **Finding IDs:** 12, 13
- **This phase:** Stop `m_renderPass.clear()` on `PLUGIN_EXIT` (recurse-remove or a pass-element epoch). If `draw` mutates GL then bails, restore GL and keep the linear fallback ring.
- **Source:** extracted from `docs/code-review-combined.md` (finding text is not rewritten)

## Summary (from the combined review table)

| ID | Severity | Finding | Verdict | Path |
|---|---|---|---|---|
| 12 | P2 | `PLUGIN_EXIT` clears the whole render pass | CONFIRMED | production unload |
| 13 | P2 | Shiny pass can bail after mutating GL; no fallback | CONFIRMED | production draw |

## Findings

### 12. `PLUGIN_EXIT` clears the compositor’s entire render pass

**ID:** 12  
**Severity:** P2  
**Path:** production unload

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


### 13. `CShinyPassElement::draw` can leave GL bound and bail

**ID:** 13  
**Severity:** P2  
**Path:** production draw

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
