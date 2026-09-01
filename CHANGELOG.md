# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
uses [Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed

- The control plane is now a Rust CLI (`border-fx`, in `cli/`) instead of
  bash + inline Python. It resolves the `shell.json` look (defaults,
  per-effect overlay, coercion, clamps), writes `border-fx.lua`, and
  builds / loads / unloads the Hyprland plugin. `Service.qml` adopts the
  resolved look the CLI prints, so windows and chrome render the same
  numbers from one implementation.
- The CLI is built on first enable by `scripts/border-fx`, a small
  launcher that compiles into `~/.cache/omarchy-border-fx` and reuses the
  binary until `cli/` changes. `cargo` (the `rust` package) is now needed
  for the window ring; the chrome effect still works without it.
- Removal: `scripts/border-fx teardown --purge` replaces
  `scripts/hypr-teardown.sh --purge`.
- Developer tasks (`mise run install|uninstall|reinstall`) go through the
  CLI (`border-fx dev …`); `jq` and `python3` are no longer required.

### Added

- `border-fx look`, `status`, `theme`, and `shell-look` subcommands for
  inspecting the resolved look, the compositor/ABI state, the current
  Omarchy theme, and the saved `shell.json` entry.
- Rust unit tests for the look schema, ensure / teardown flows, ABI
  freshness, and `shell.json` handling; the JS suites drive the built CLI
  and check Rust and `qml/Look.js` resolve identically.

## [0.1.0] - 2026-08-30

Initial release.

### Added

- Animated border ring around Hyprland windows, drawn by a user-level
  plugin compiled against the running compositor.
- Two renderers: `shiny`, a directional comet highlight, and `ripple`,
  traveling crests of light. Gradient ramps, pulse, shimmer, mirror, and
  specular-halo controls work with both.
- Matching overlay for Omarchy shell chrome (panels and notification
  toasts), so windows and chrome share one look.
- One configuration in `~/.config/omarchy/shell.json`. Chrome picks up
  changes immediately; windows follow after a short debounce.
- Desktop notifications that say what happened and what to do when the
  window plugin cannot build or load.
- Install, update, and removal through `omarchy plugin` commands. Baked
  shaders ship in the repo, so no build tools are needed for the chrome
  effect.

[0.1.0]: https://github.com/wmfeht/omarchy-border-fx/releases/tag/0.1.0
