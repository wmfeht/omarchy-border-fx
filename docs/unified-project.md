# Unified shiny-border project plan

This tree (`omarchy-border-fx`) is the unified repo: `hypr/` is the compositor
plugin, `manifest.json` stays at the clone root, and `scripts/hypr-ensure.sh` /
`look-apply.sh` / `hypr-teardown.sh` are the Omarchy control-plane plumbing.

The Omarchy plugin id (source of truth in `shell.json`) is **`qs.border-fx`**.
`effect` on that entry selects the renderer (`shiny` today). Hyprland adapter
keys for the shiny effect remain `plugin:shiny-border:*` / Lua `shiny_border`.
Historical text below still says `qs.shiny-border`.

The rest of this file is the design it was scaffolded from.

This was a **proposal for review**. Accepting it should
not require merging the two trees, changing the comet look, or shipping a
shared loader in this turn.

It covers both **qs-shiny-border** (Omarchy / Quickshell chrome) and
**hypr-shiny-border** (Hyprland window decorations): one project, two
runtimes, one Omarchy-plugin-controlled install, and one shared configuration
that updates both when it changes.

---

## Goal

Today the two plugins sit next to each other and try to look like they share a
light. They do **not** share an install or a live config:

| Surface | Process | Install | Config |
|---|---|---|---|
| Window ring | Hyprland | `hyprpm add` / `hyprctl plugin load` of a C++ `.so` | `plugin:shiny-border:*` in Lua (`shiny_border` after `-`→`_`), gated on `PLUGIN_INIT` |
| Shell chrome | `omarchy-shell` | copy or `omarchy plugin add` into `~/.config/omarchy/plugins/qs.shiny-border/` | look keys **hardcoded** on `ShinyBorder.qml` |

The unified project should:

1. Be one git tree that `omarchy plugin add <url>` can clone.
2. Treat that Omarchy plugin as the **control plane** for install and config:
   `omarchy plugin add` / `enable` / `disable` / `remove` (and `update`)
   decide whether **both** the Hyprland `.so` and the Quickshell overlay are
   present.
3. Store one look in Omarchy plugin settings. Changing it updates **both**
   Hyprland window decorations and Quickshell chrome.

The comet shader, shimmer walk, and gradient resolver stay as they are. This
plan does **not** invent a third renderer, patch Omarchy `BorderSurface` /
`Ui/`, or make the Hyprland `.so` itself an Omarchy QML plugin.

---

## Current inventory

### qs-shiny-border (this repo)

- **Kind:** Omarchy-shell `kind: "service"` plugin, id `qs.shiny-border`.
- **Entry:** `Service.qml` walks showing panel hosts and notification toasts
  and overlays `qml/ShinyBorder.qml` (`ShaderEffect` + baked `shaders/shiny.frag.qsb`).
- **Manifest** already lives at the git root, which is what
  `omarchy plugin add` requires.
- **Install today:** `scripts/install.sh` (`mise run install`) copies
  `manifest.json`, `Service.qml`, `qml/`, and the `.qsb` into
  `~/.config/omarchy/plugins/qs.shiny-border/`, then
  `omarchy plugin enable qs.shiny-border` and `omarchy restart shell`.
  That is a **dev copy**, not a git-managed plugin checkout.
- **Uninstall today:** `scripts/uninstall.sh` disables the id and deletes
  the copy. The source tree stays.
- **Config today:** none. `Service.qml` creates `ShinyBorder {}` with
  component defaults. Those defaults were copied from the live
  `~/.config/hypr/looknfeel.lua` block (pin 120, shimmer on, 4-stop ramp).
  Editing looknfeel does **not** move the chrome ring; editing
  `ShinyBorder.qml` does **not** move the window ring.
- **Enable bit:** third-party enabled ⇔ id present in
  `~/.config/omarchy/shell.json`. For this service that is `plugins[]`.
  Current entry is just `{ "id": "qs.shiny-border" }` — no inline settings.

### hypr-shiny-border (sibling `../hypr-shiny-border`)

- **Kind:** Hyprland compositor plugin. C++ `.so`, **not** a Quickshell
  plugin. Putting that tree under `~/.config/omarchy/plugins/` does nothing
  on its own.
- **Load:** `hyprpm add <url>` + `hyprpm enable hypr-shiny-border` +
  `hyprpm reload -n`, or `hyprctl plugin load /absolute/path/to/hypr-shiny-border.so`.
  Manual copies go to `~/.local/lib/hypr/hypr-shiny-border.so`.
- **Login:** this machine’s `~/.config/hypr/autostart.lua` allows hyprpm
  plugin loads and runs `hyprpm reload -n`. Do not also `hl.plugin.load`
  the same plugin.
- **Config:** C++ registers `plugin:shiny-border:…` in `PLUGIN_INIT`, then
  calls `reloadConfig()`. Until then the keys do not exist. Lua therefore
  uses the table name **`shiny_border`** (hyphens become underscores) and
  **must** gate on `hl.get_loaded_plugins()`. Live edits on a Lua Hyprland
  config go through **`hyprctl eval`**, not `hyprctl keyword`.
- **Defaults in C++** are not the live look: pulse on, pinDeg 90°,
  border 3, two-color `col.a`/`col.b`. The **intended shared look** lives
  in `looknfeel.lua` (and is what qs-shiny-border hardcoded).
- **Hyprland-only keys:** `active_only`. Heading is always `pin_deg` +
  `angle_offset` on both hosts. Pulse is driven on both hosts; chrome
  ignores `activeOnly`.
- **Wrapping stroke:** `baseColor`, a border-thickness ring under the
  directional highlight on both hosts. Transparent = off. Not Hyprland
  `decoration:shadow` (the shader crushes far-side highlight alpha to
  ~5.5%, so stuffing this hue into the last gradient stop never wrapped).

### Omarchy plugin contract (constraints)

These are facts of the current Omarchy CLI / shell, not wishes.

1. **A plugin is a git repo with `manifest.json` at the clone root.**
   `omarchy plugin add <git-url>` clones into
   `~/.config/omarchy/plugins/<id>/` named by that manifest id.
2. **No install hooks, no sudo.** The installer clones, validates, and
   optionally enables over shell IPC. It never compiles a `.so`, never
   runs `hyprpm`, never writes `~/.config/hypr/`.
   `omarchy plugin add` **alone does not load Hyprland.**
3. **No symlinks inside a plugin folder** (`.git` excluded).
   `omarchy plugin validate` refuses any symlink. A monorepo **cannot**
   be `ln -s`’d into `~/.config/omarchy/plugins/`, and `hypr/` cannot be
   a symlink back at `../hypr-shiny-border`.
4. **Enable ⇔ id present in `shell.json`.** Services go in `plugins[]`.
   Settings are **inline on that entry** — no `config:` sub-object, no
   separate per-plugin settings file, no merge layers.
5. **The shell injects `shell` / `manifest` into a service, not
   `settings`.** Bar widgets get inline settings; services do not.
   `qs.shiny-border` already receives `shell`, so it can read
   `shell.shellConfig.plugins[]` itself. `shell.json` already hot-reloads.
6. **`omarchy plugin update`** is a fast-forward pull of that checkout,
   then `rescanPlugins`. Still no hooks.
7. **`omarchy plugin disable`** clears the enabled bit (service instance
   is destroyed). **`omarchy plugin remove`** disables if needed, then
   deletes the git checkout (or backups a non-git copy).
8. Extra files in the clone are allowed. Installed plugins are whole
  git trees (other third-party plugins already ship helpers next to QML).
  Hyprland C++ source in the same checkout is valid as far as Omarchy is
  concerned; the shell simply never loads it.

---

## Proposed unified structure

Keep **two renderers, one project**. The Omarchy plugin is the control
plane. The Hyprland `.so` stays a compositor plugin.

```
qs-shiny-border/                  # surviving git repo (Omarchy-facing)
  manifest.json                   # MUST stay at clone root for `omarchy plugin add`
  Service.qml                     # control plane: chrome overlay + hypr ensure + config fan-out
  qml/                            # ShinyBorder.qml, Shimmer.js, Gradient.js
  shaders/                        # shiny.frag + committed .qsb
  hypr/                           # imported hypr-shiny-border tree
    src/ Makefile tests/ nest/ …
  hyprpm.toml                     # still at repo root so `hyprpm add` of the same URL works (dev)
  scripts/
    hypr-ensure.sh                # user-level: build/copy/load the .so (no sudo)
    hypr-teardown.sh              # unload + delete the login-session copy
    look-apply.sh                 # shell.json look → hyprctl eval (+ generated Lua)
    install.sh / uninstall.sh     # keep as *dev* helpers; Omarchy plugin is the user path
  docs/unified-project.md         # this file
```

### Why this repo survives

`manifest.json` is already at the root of **qs-shiny-border**. That is the
file `omarchy plugin add` validates. Import **hypr-shiny-border** as `hypr/`
(real files, not a symlink). Archive the sibling GitHub repo after a release
that points here. Optionally rename the GitHub remote to `shiny-border`
later; do **not** change the Omarchy id in the same step.

### Plugin identity (keep both names)

| Name | Stays | Why |
|---|---|---|
| Omarchy id `qs.shiny-border` | yes | already in `shell.json`; `omarchy.*` is reserved |
| Hyprland plugin name `hypr-shiny-border` | yes | `hyprctl plugin list`, hyprpm, `PLUGIN_INIT` |
| Config keys `plugin:shiny-border:*` / Lua `shiny_border` | yes | already in looknfeel; Lua hyphen→underscore |

One project, two public names. Users enable `qs.shiny-border`. Compositor
tools still see `hypr-shiny-border`.

### What `omarchy plugin add` clones

The **entire** git tree, including `hypr/`. That is intended: the clone
**is** the source for `scripts/hypr-ensure.sh`. Do not commit `hypr/*.so`,
`hypr/obj/`, or any symlink. `.gitignore` those build artifacts so a
user `make` inside the plugin dir cannot poison `omarchy plugin update`.

### Dev vs user checkouts

| Who | Tree | Load Hyprland |
|---|---|---|
| User | `~/.config/omarchy/plugins/qs.shiny-border/` (git clone from `omarchy plugin add`) | post-enable `hypr-ensure.sh` → `~/.local/lib/hypr/hypr-shiny-border.so` |
| C++ / nest iteration | this working tree, or a second clone | existing `hyprpm` + `scripts/pluginctl.sh` + nested Hyprland. **Unchanged.** |

`hyprpm` remains the Hyprland-side **development** workflow. It is not the
user install once the Omarchy plugin owns enable/disable.

---

## Shared installation

Control plane: the Omarchy plugin lifecycle. Hyprland and Quickshell are
payloads of that lifecycle, not two extra products the user installs.

### What `omarchy plugin add` actually does

```
omarchy plugin add <git-url-of-this-repo> [--enable] [--yes]
```

(`omarchy plugin install` is an alias.)

1. `git clone` into a staging dir under `~/.config/omarchy/plugins/`.
2. `omarchy plugin validate` (manifest, entry points, **no symlinks**).
3. Move to `~/.config/omarchy/plugins/qs.shiny-border/`.
4. `omarchy-shell shell rescanPlugins`.
5. Optionally `omarchy plugin enable qs.shiny-border`.

There is still **no hook**. After add-without-enable the files are on disk,
the service is **not** running, and the Hyprland `.so` is **not** loaded.
Document that `--enable` (or a later `omarchy plugin enable`) is the step
that brings the look up.

### Enable / load both sides

`omarchy plugin enable qs.shiny-border` writes `{ "id": "qs.shiny-border", … }`
into `shell.json` `plugins[]`. The running shell constructs `Service.qml`.

**Quickshell side** (already true today): `Service.qml` attaches
`ShinyBorder` to showing panels and toasts.

**Hyprland side** (the missing piece, because Omarchy never runs install
hooks): `Service.qml` `Component.onCompleted` starts a user-level
`Process` running `scripts/hypr-ensure.sh` from the plugin checkout.
That script, **no sudo**:

1. If `hyprctl plugin list` already shows `hypr-shiny-border` (e.g. a
   leftover hyprpm load), **do not load a second copy**. Reuse it and
   apply look. Notify that hyprpm and the Omarchy plugin should not both
   own the load.
2. Else if `~/.local/lib/hypr/hypr-shiny-border.so` exists, `hyprctl plugin load`
   that absolute path.
3. Else if a freshly built `hypr/hypr-shiny-border.so` exists in the
   checkout, copy it to `~/.local/lib/hypr/` and load that copy
   (never load from inside the plugin dir long-term: `omarchy plugin update`
   can replace the file under a live `dlopen`).
4. Else try `make -C hypr all` against the running compositor’s headers.
   On success, copy + load. On failure, **do not crash the shell**:
   leave chrome running and notify
   “window ring needs Hyprland headers; chrome is on. Fix: `…`”.
5. Register login persistence **without hyprpm**:
   write `~/.config/hypr/shiny-border.lua` (generated look + optional
   `hl.plugin.load` of the `~/.local/lib` copy, gated on
   `hl.get_loaded_plugins()`). Ask `hyprland.lua` to
   `pcall(require, "hypr.shiny-border")` **once** if that line is
   missing. `omarchy refresh hyprland` can wipe that require — the
   service’s next start still `hyprctl plugin load`s, so a wiped require
   is a brief default-look flash, not a dead install.
6. Hyprland plugin-load **permissions**: allow the loader
   (`hyprctl` or the ensure script) the way today’s autostart allows
   hyprpm, or the compositor will popup every start.

Building C++ inside `omarchy-shell` must be asynchronous. A sync `make`
on enable would stall the bar.

### Disable

`omarchy plugin disable qs.shiny-border` destroys the service.

`Component.onDestruction`:

1. Detach every `ShinyBorder` and restore stock `borderSpec` (already
   implemented).
2. Run `scripts/hypr-teardown.sh`:
   - `hyprctl plugin unload` the `~/.local/lib` copy (by the path we
     loaded, not by “any shiny .so” — do not unload a nest/hyprpm copy
     the user is iterating on).
   - set `plugin:shiny-border:enabled = false` via `hyprctl eval` if
     unload is refused (plugin still present, ring reserved to 0 px).
   - **keep** the `.so` on disk so re-enable is fast.
   - leave `shiny-border.lua` in place but with `enabled = false`, or
     skip `hl.plugin.load` so the next login does not bring the ring
     back while the Omarchy plugin is disabled.

Disable is **not** `omarchy plugin remove`. Source stays.

### Remove

`omarchy plugin remove qs.shiny-border [--yes]`:

1. Disable (above) if it was enabled.
2. Delete `~/.config/omarchy/plugins/qs.shiny-border/` (git checkout).
3. Because the service is already gone, remove cannot rely on QML
   `onDestruction` for the last mile. `hypr-teardown.sh` must also be
   documented as the extra command for a shell that is not running, and
   the disable path should have already unloaded Hyprland.
   A small `scripts/hypr-teardown.sh --purge` then:
   - deletes `~/.local/lib/hypr/hypr-shiny-border.so`
   - deletes `~/.config/hypr/shiny-border.lua`
   - does **not** rewrite `looknfeel.lua` (user file; migration leaves
     a stale `shiny_border` block that no-ops if the plugin is unloaded)

If the shell was not running, tell the user to run
`scripts/hypr-teardown.sh --purge` once. That is the honest extra
command the no-hooks installer forces.

### Update

`omarchy plugin update qs.shiny-border` fast-forwards the checkout and
rescans QML. It does **not** rebuild the `.so`. After a QML/shader-only
change, chrome hot-reloads. After a `hypr/` change, `Service.qml` should
compare the checkout revision / `.so` mtime and re-run `hypr-ensure.sh`
(rebuild + reload). A Hyprland bump still requires a rebuild against new
headers; `PLUGIN_INIT` still refuses a hash mismatch.

### Hyprland `.so` path given no install hooks

```
omarchy plugin add        →  files on disk, nothing loaded
omarchy plugin enable     →  Service.qml runs  →  hypr-ensure.sh  →  .so loaded
omarchy plugin disable    →  Service destroyed →  hypr-teardown.sh →  .so unloaded
omarchy plugin remove     →  disable + delete clone + purge login-session copy
```

The `.so` **install location** is `~/.local/lib/hypr/hypr-shiny-border.so`
(already documented in hypr-shiny-border’s README for the non-hyprpm
path). The Omarchy plugin directory is the **source**, not the
`dlopen` path.

### Remaining hyprpm role

Keep `hyprpm.toml` at the unified repo root so `hyprpm add <same-url>`
still builds in a nest. User-facing README leads with
`omarchy plugin add … --enable`, then says: if you already use hyprpm,
`hyprpm disable hypr-shiny-border` and drop `hyprpm reload` from
autostart so enable/disable of the Omarchy plugin is the only switch.
Loading the same plugin twice (hyprpm + `hyprctl plugin load`) is a
hard error; `hypr-ensure.sh` must detect it.

---

## Shared configuration

Two processes (Hyprland vs `omarchy-shell`) cannot share an in-memory
object. Shared config is a **document plus an explicit fan-out**.

### Source of truth

**`~/.config/omarchy/shell.json`, inline on the `qs.shiny-border`
`plugins[]` entry.** That is the Omarchy plugin contract (settings are
fields on the entry; the plugin is enabled iff the id is present).

Example after implementation:

```json
{
  "id": "qs.shiny-border",
  "borderSize": 2,
  "shimmer": true,
  "shimmerHz": 0.3,
  "shimmerDeg": 20,
  "shimmerScaleMin": 0.75,
  "shimmerScaleMax": 1.35,
  "pinDeg": 120,
  "angleOffset": 0,
  "lobe": 0.18,
  "gradient": [
    "rgba(33ccffee)",
    "rgba(1ad4c0ee)",
    "rgba(007a48ee)",
    "rgba(004830aa)"
  ],
  "gradientPositions": "0 1 3 100",
  "gradientCw": [],
  "gradientPositionsCw": "0 22 50 100",
  "baseColor": "rgba(00687855)",
  "activeOnly": true,
  "pulse": false,
  "pulseHz": 0.4
}
```

Canonical color strings are Hyprland `rgba(RRGGBBAA)` — the language
already in `looknfeel.lua`. The Quickshell adapter converts to Qt
`#AARRGGBB`. Missing keys mean the intended shared look (today’s
looknfeel + `ShinyBorder.qml` defaults), **not** the C++ plugin
defaults (pulse on, pinDeg 90, border 3).

Do **not** introduce a third file
(`~/.config/omarchy/shiny-border.json`) as another source of truth.
Omarchy will not show it, will not hot-reload it as plugin settings,
and it would drift from `shell.json`. A generated
`~/.config/hypr/shiny-border.lua` is an **output** of the fan-out, not
an input.

`looknfeel.lua`’s `shiny_border = { … }` block becomes redundant once
fan-out exists. Migration: leave it until the generated file is proven,
then delete the gated block so Hyprland does not fight the plugin
settings on `reloadConfig()`.

### Look-key set (shared vs host-only)

Small shared set, per-host adapters. No third renderer.

| JSON key (shell.json) | Hyprland `plugin:shiny-border:` | QML `ShinyBorder` | Who |
|---|---|---|---|
| `borderSize` | `border_size` | `borderSize` | both |
| `shimmer` | `shimmer` | `shimmer` | both |
| `shimmerHz` | `shimmer_hz` | `shimmerHz` | both |
| `shimmerDeg` | `shimmer_deg` | `shimmerDeg` | both |
| `shimmerScaleMin` / `Max` | `shimmer_scale_*` | `shimmerScale*` | both |
| `pinDeg` | `pin_deg` | `pinDeg` | both |
| `angleOffset` | `angle_offset` | `angleOffset` | both |
| `lobe` | `lobe` | `lobe` | both |
| `gradient` | `gradient` | `gradient` | both |
| `gradientPositions` | `gradient_positions` | `gradientPositions` | both |
| `gradientCw` | `gradient_cw` | `gradientCw` | both |
| `gradientPositionsCw` | `gradient_positions_cw` | `gradientPositionsCw` | both |
| `colA` / `colB` | `col.a` / `col.b` | `colA` / `colB` | both (used when gradient &lt; 2) |
| `baseColor` | `base_color` | `baseColor` | both (wrap under the highlight; transparent = off) |
| `activeOnly` | `active_only` | — | Hyprland only |
| `pulse` / `pulseHz` | `pulse` / `pulse_hz` | `pulse` / `pulseHz` | both (QS fragment brightness is pulse Hz; ≤ 0 is identity) |

A host that does not understand a key ignores it. That is the adapter
rule. Changing `pinDeg` in `shell.json` must move **both** the window
comet and the panel comet; changing `activeOnly` only affects windows.

### How the service reads settings

`ensureService` injects `shell` but not `settings`. The service looks up
its own `plugins[]` entry:

```
shell.shellConfig.plugins  →  entry whose id is qs.shiny-border
                           →  look object (every field except id)
```

`ShellRoot.onShellConfigChanged` already fires when `shell.json` is
saved. Bindings on that entry are the Quickshell live path. No extra
file watcher.

There is no first-party settings schema for `kind: "service"` today
(the settings UI is `barWidget.schema`). v1 control is **edit the
inline `plugins[]` entry** (and later, optional
`omarchy-shell shell call qs.shiny-border …` if we register an
`IpcHandler`). A bar-widget just to get a form is extra chrome; do not
add one unless a settings panel is an explicit follow-up.

### Fan-out when configuration changes

```
shell.json saved
    │
    ├─ omarchy-shell hot-reload
    │     Service bindings update
    │     every live ShinyBorder overlay gets new uniforms   ← Quickshell
    │
    └─ Service (debounced) runs scripts/look-apply.sh
          1. write ~/.config/hypr/shiny-border.lua
          2. hyprctl eval 'hl.config({ plugin = { shiny_border = { … } } })'
             (only if hyprctl plugin list shows hypr-shiny-border)
                                                             ← Hyprland
```

Debounce (~100–200 ms) so a burst of `shell.json` writes does not flood
`hyprctl`. If the `.so` is not loaded, skip eval (keys do not exist)
and retry after `hypr-ensure.sh` succeeds.

`look-apply.sh` is the adapter: JSON `rgba(RRGGBBAA)` + camelCase → Lua
`shiny_border` table. It is the only place that knows both schemas.

### Hyprland live apply (`hyprctl eval`)

Omarchy’s Hyprland config is Lua. Plugin keys exist only after
`PLUGIN_INIT`. Therefore:

- **Do not** use `hyprctl keyword plugin:shiny-border:…` as the live
  path; that is the classic-config mechanism and is not how this
  machine’s `hyprland.lua` is driven.
- **Do** `hyprctl eval` a `hl.config({ plugin = { shiny_border = { … } } })`
  snippet. Gate the generated Lua the same way looknfeel does today
  (`hl.get_loaded_plugins()`), so a reload before the `.so` is loaded
  does not error on unknown keys.
- Persist the same table to `~/.config/hypr/shiny-border.lua` so a
  later `hyprctl reload` / login `reloadConfig()` from `PLUGIN_INIT`
  does not snap back to C++ defaults.

### Quickshell live apply

Same process as the settings. `Service.qml` passes the look into each
`ShinyBorder` it creates (today it passes nothing). Overlay properties
already have `onXChanged` rebuilds for the ramp. No shell restart.

### Control via the Omarchy plugin

Users change the look by editing the `qs.shiny-border` entry in
`shell.json` (or, later, IPC into the service which calls
`shell.updateEntryInline("qs.shiny-border", look)` — that helper
already writes `plugins[]`). Enable/disable of the plugin is still
presence of that entry. There is no parallel Hyprland-only switch in
the user path: `omarchy plugin disable qs.shiny-border` turns **both**
rings off.

---

## User-facing commands (after this is implemented)

```bash
# install both sides (clone + enable service + hypr-ensure)
omarchy plugin add https://github.com/wmfeht/qs-shiny-border.git --enable --yes

# chrome + window ring on
omarchy plugin enable qs.shiny-border

# both off (so unloaded, clone kept)
omarchy plugin disable qs.shiny-border

# both gone
omarchy plugin remove qs.shiny-border --yes

# pull QML/hypr source; service rebuilds .so if hypr/ changed
omarchy plugin update qs.shiny-border --yes

# shared look: edit the plugins[] entry, save; both processes update
# ~/.config/omarchy/shell.json
```

Until implementation, today’s split remains: `mise run install` for
chrome, `hyprpm` / `hyprctl plugin load` for windows, look duplicated
by hand.

---

## Migration from today’s two installs

1. Merge `../hypr-shiny-border` into `hypr/` of this repo (real copy).
   Keep git history if cheap (`git subtree` or a merge); not required
   for the design.
2. Ship `hypr-ensure.sh` / `hypr-teardown.sh` / `look-apply.sh` and
   teach `Service.qml` to run them. Still a later turn.
3. Users who already `mise run install`’d a **copy** (no `.git`):
   `omarchy plugin remove qs.shiny-border --yes` then
   `omarchy plugin add <url> --enable` so the checkout is git-managed
   and `omarchy plugin update` works.
4. Users who `hyprpm enable hypr-shiny-border`:
   `hyprpm disable hypr-shiny-border`, remove `hyprpm reload -n` from
   autostart if it exists only for this plugin, then enable the
   Omarchy plugin so **it** loads `~/.local/lib/hypr/hypr-shiny-border.so`.
5. Move look keys from `looknfeel.lua` into the `plugins[]` entry;
   keep the Lua block until fan-out is verified, then delete it.
6. Point the hypr-shiny-border README / GitHub at this repo.

---

## Non-goals (this proposal and the turn that implements it)

- Changing the comet look (shader, shimmer walk, gradient resolver).
- Patching Omarchy `BorderSurface` / `Ui/` or painting every panel row.
- Making the Hyprland `.so` an Omarchy QML plugin.
- Replacing hyprpm as a Hyprland **development** workflow (nest,
  `pluginctl`, header pins).
- Distro packaging, sudo, or a systemd unit.
- Cursor tracking on the Quickshell side.
- A third shared renderer.

---

## Risks

- **`omarchy plugin add` cannot compile or load the `.so`.** The plan
  uses post-enable plugin code (`Service.qml` → `hypr-ensure.sh`) plus
  a documented `hypr-teardown.sh --purge` when the shell is not
  running. If that helper is omitted, chrome installs and windows do
  not — the current split, with a prettier README.
- **Symlink refusal** kills any “monorepo as a plugin via `ln -s`”
  idea. Dev copy (`mise run install`) stays a file copy; user install
  is a real clone.
- **Double load.** hyprpm + ensure-script will crash or refuse. Detect
  `hypr-shiny-border` in `hyprctl plugin list` and do not load again.
- **`PLUGIN_INIT` race.** `hyprctl eval` before the plugin is loaded
  errors. Fan-out waits for `plugin list`. Generated Lua is gated.
- **`omarchy refresh hyprland`** rewrites `~/.config/hypr/*.lua` from
  packaged defaults and can drop a one-line `require`. Reloading the
  service still `hyprctl plugin load`s; document the flash.
- **Header hash mismatch** after a Hyprland upgrade. Chrome keeps
  working; the window ring stays down until `hypr-ensure.sh` rebuilds.
  Same failure mode as today’s hyprpm, just triggered from enable
  rather than `hyprpm update`.
- **Service settings are not injected.** If someone implements fan-out
  by waiting for a `settings` property, it will stay `{}`. Read
  `shell.shellConfig`.
- **Color and gradient encodings differ** (Hyprland packed ARGB /
  `CGradientValue` vs Qt `#AARRGGBB` / JS arrays). One adapter script,
  not two ad-hoc converters.
- **Compiling from the plugin dir** can leave `obj/` inside a folder
  Omarchy will try to rescan on any save. `.gitignore` and write
  objects to `XDG_CACHE_HOME`, not the plugin tree.

---

## Suggested implementation order (after this proposal is accepted)

1. Import `hypr/` into this tree; `hyprpm.toml` at root still builds.
2. Shared look object + adapters (JSON ↔ QML properties ↔ Lua table).
   Unit-test the converter compositor-free, same style as
   `tests/run.js` / `hypr/tests/test_runtime.cpp`.
3. `Service.qml` reads `shell.shellConfig` and applies look to overlays.
4. `look-apply.sh` + debounced `hyprctl eval` so a `shell.json` change
   updates Hyprland too.
5. `hypr-ensure.sh` / `hypr-teardown.sh` wired to service
   completed/destruction; README switches the user path to
   `omarchy plugin add … --enable`.
6. Migration notes for hyprpm users and the looknfeel block.

Steps 2–4 are the shared-configuration promise. Step 5 is the shared
installation promise. Neither is done in **this** turn.

---

## Appendix: current vs proposed config

**Current Hyprland** (`~/.config/hypr/looknfeel.lua`, after the plugin
is loaded):

```lua
shiny_border = {
  border_size = 2,
  shimmer     = true,
  shimmer_deg = 20,
  shimmer_hz  = 0.3,
  pulse       = false,
  pin_deg     = 120,
  gradient = { colors = { "rgba(33ccffee)", "rgba(1ad4c0ee)", "rgba(007a48ee)", "rgba(004830aa)" } },
  gradient_positions    = "0 1 3 100",
  gradient_positions_cw = "0 22 50 100",
}
```

**Current Quickshell:** the same numbers, hardcoded on
`qml/ShinyBorder.qml`. No `shell.json` fields.

**Proposed:** those numbers live once, on the Omarchy plugin’s
`plugins[]` entry. `Service.qml` paints chrome from them and fans the
same values out to Hyprland with `hyprctl eval` so a configuration
change updates both.
