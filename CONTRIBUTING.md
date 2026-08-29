# Contributing

Thanks for your interest. Before writing code, please read this page —
especially the scope section. It will save you (and the review) time.

## What this project is trying to be

A **small, well-documented set of border effects with a focused
configuration**. Two renderers (Hyprland windows, Omarchy/Quickshell
chrome), one config, and every option accounted for: documented, defaulted,
clamped, and behaving identically on both hosts.

**New shaders and expanded options are not the focus.** The main problem
this project faces is *controlling* the set of possible options, not adding
more. Every look key must be:

- documented in the README option reference,
- given a shared default that matches on windows and chrome,
- clamped and validated on the Hyprland side,
- wired through the JSON → QML and JSON → Lua adapters,
- covered by the compositor-free tests,
- and kept working through every future change.

That cost is permanent, and it compounds: options interact (gradient ×
mirror × shimmer × per-side positions already form a large matrix). A
proposal that shrinks, merges, or removes options is more valuable here
than one that adds them.

## Contributions that fit

- Bug fixes, especially cross-host parity bugs (windows and chrome
  rendering the same config differently).
- Documentation: corrections, clarifications, better recipes.
- Tests, and simplifications that keep behavior while shedding code.
- Removing or consolidating options whose effect can be expressed with the
  remaining ones.
- Install/teardown robustness (the unfinished parts — see the status note
  in the [README](README.md)).

## Contributions that likely will not fit

- A new effect or shader.
- New look keys, unless they fix a real expressiveness gap that recipes
  cannot cover — and come with docs, defaults, clamps, and tests for both
  hosts.
- Options that serve one specific configuration. Prefer a recipe in the
  README.

## Want a fully custom shader? Fork it

If you want your own effect, **forking this project is the supported
path** — that is what the MIT license is for, and the tree is small enough
to make it practical. The places to change:

- `shaders/*-lighting.frag` — the shared lighting bodies, `#include`d by
  both hosts. This is where the effect math lives.
- `shaders/*.frag` — the Qt/Quickshell host shaders (baked to `.qsb`).
- `shaders/*.gles.frag` — the GLES 3 host shaders for the Hyprland plugin.
  `mise run bake` inlines them into the generated `hypr/src/shaders.hpp`;
  do not edit that header directly.
- `qml/` and `hypr/src/` — the per-host adapters if your effect needs new
  uniforms.

Keep the two hosts mathematically identical (the shared lighting include
exists to make that easy), or windows and chrome will drift apart. Rename
the Omarchy plugin id in `manifest.json` so your fork does not collide with
an installed copy of this plugin.

Upstreaming a finished custom effect back into this repository is almost
always out of scope — see above.

## Practicalities

- Development setup, tasks, and architecture: [DEVELOPMENT.md](DEVELOPMENT.md).
  Hyprland C++ iteration: [hypr/DEVELOPMENT.md](hypr/DEVELOPMENT.md).
- Run `mise run check` (bake + lint + compositor-free tests) before
  submitting. `mise run hypr-test` covers the C++ logic without a
  compositor.
- If a change alters user-visible behavior, update the README option
  reference in the same change.
- Keep changes small and focused; use conventional commit messages
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
