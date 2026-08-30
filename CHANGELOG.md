# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
uses [Semantic Versioning](https://semver.org).

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
