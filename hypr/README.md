# hypr-shiny-border (compositor plugin)

This directory is the Hyprland C++ plugin from the unified **omarchy-border-fx**
tree. User install and shared look live in the [repo README](../README.md).

Do not put this folder under `~/.config/omarchy/plugins/` by itself. The
Omarchy plugin at the clone root (`qs.shiny-border`) builds and loads
`hypr-shiny-border.so` via `scripts/hypr-ensure.sh`.

**Development** (nested Hyprland, `pluginctl`, header pins) is in
[DEVELOPMENT.md](DEVELOPMENT.md). `hyprpm.toml` is at the **clone root** so
`hyprpm add <same-url>` still builds this `.so`.

```sh
mise run hypr-build   # make -C hypr
mise run hypr-test    # compositor-free logic tests
mise run nest         # nested Hyprland
mise run reload       # from an outer terminal, while the nest is up
```
