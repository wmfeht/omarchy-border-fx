//! Fan-out: a resolved look → generated `~/.config/hypr/border-fx.lua` and an
//! optional `hyprctl eval` so a running compositor picks it up.

use serde_json::Value;

use crate::ctx::Ctx;
use crate::look::{self, Base, Look, Warnings};
use crate::lua::{self, LuaOpts};
use crate::session;

#[derive(Debug, Clone, Copy, Default)]
pub struct ApplyOpts {
    /// `hyprctl eval dofile()` the lua, only if the window plugin is loaded.
    pub eval: bool,
    /// `enabled = false` and skip `hl.plugin.load` (the Omarchy plugin is off).
    pub disabled: bool,
    /// Skip `hl.plugin.load` even when enabled.
    pub no_load: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyStatus {
    /// Lua written and eval'd by the compositor.
    Applied,
    /// Lua written; eval skipped (no hyprctl, not loaded, or not requested).
    Written,
}

impl ApplyStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ApplyStatus::Applied => "applied",
            ApplyStatus::Written => "written",
        }
    }
}

pub struct Applied {
    pub look: Look,
    pub warnings: Warnings,
    pub status: ApplyStatus,
}

/// Resolve `entry` and render the lua text without touching disk.
pub fn render(ctx: &Ctx, entry: &Value, base: &Base, o: ApplyOpts) -> (Look, Warnings, String) {
    let (look, warnings) = look::resolve(entry, base);
    let p = ctx.paths;
    let text = lua::render(
        &look,
        &LuaOpts {
            plugin_id: &p.plugin_id,
            plugin_name: &p.plugin_name,
            session_so: &p.session_so.to_string_lossy(),
            load: !o.disabled && !o.no_load,
            enabled: !o.disabled,
        },
    );
    (look, warnings, text)
}

/// Write the lua and, when asked, eval it in the running compositor.
pub fn run(ctx: &Ctx, entry: &Value, base: &Base, o: ApplyOpts) -> std::io::Result<Applied> {
    let (look, warnings, text) = render(ctx, entry, base, o);
    for w in &warnings.0 {
        eprintln!("{w}");
    }
    let p = ctx.paths;
    session::write_atomic(&p.lua_file, text.as_bytes())?;
    let mut status = ApplyStatus::Written;
    if o.eval {
        if !ctx.hc.available() {
            eprintln!("apply: hyprctl not found; wrote {}", p.lua_file.display());
        } else if ctx.hc.plugin_listed(&p.plugin_name) {
            if ctx.hc.eval(&lua::dofile_expr(&p.lua_file.to_string_lossy())) {
                status = ApplyStatus::Applied;
            } else {
                eprintln!("apply: hyprctl eval failed; wrote {}", p.lua_file.display());
            }
        } else {
            eprintln!("apply: {} not loaded; skipped eval (wrote {})", p.plugin_name, p.lua_file.display());
        }
    }
    Ok(Applied { look, warnings, status })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hyprctl::fake::Fake;
    use crate::paths::Paths;
    use serde_json::json;
    use std::fs;
    use std::path::Path;

    fn paths_in(dir: &Path) -> Paths {
        let mut p = Paths::from_env(dir);
        p.lua_file = dir.join("hypr/border-fx.lua");
        p.session_so = dir.join("lib/hypr-shiny-border.so");
        p
    }

    #[test]
    fn writes_lua_and_evals_when_listed() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        let hc = Fake::up(true);
        let notify = |_: &str| {};
        let build = |_: &Paths| false;
        let ctx = Ctx { paths: &p, hc: &hc, notify: &notify, build: &build };
        let r =
            run(&ctx, &json!({"pinDeg": 77}), &Base::shared(), ApplyOpts { eval: true, ..Default::default() }).unwrap();
        assert_eq!(r.status, ApplyStatus::Applied);
        assert_eq!(r.look["pinDeg"], 77);
        let lua = fs::read_to_string(&p.lua_file).unwrap();
        assert!(lua.contains("pin_deg      = 77"));
        assert!(lua.contains("SHINY_LOAD = true"));
        let dofile = format!("eval dofile(\"{}\")", p.lua_file.display());
        assert!(hc.called(&dofile), "{:?}", hc.calls.borrow());
    }

    #[test]
    fn disabled_skips_load_and_eval_when_not_listed() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        let hc = Fake::up(false);
        let notify = |_: &str| {};
        let build = |_: &Paths| false;
        let ctx = Ctx { paths: &p, hc: &hc, notify: &notify, build: &build };
        let r =
            run(&ctx, &json!({}), &Base::shared(), ApplyOpts { eval: true, disabled: true, no_load: false }).unwrap();
        assert_eq!(r.status, ApplyStatus::Written);
        let lua = fs::read_to_string(&p.lua_file).unwrap();
        assert!(lua.contains("SHINY_LOAD = false"));
        assert!(lua.contains("enabled      = false"));
        assert!(!hc.called("eval"));
    }

    #[test]
    fn no_hyprctl_still_writes() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        let hc = Fake { available: false, ..Fake::up(true) };
        let notify = |_: &str| {};
        let build = |_: &Paths| false;
        let ctx = Ctx { paths: &p, hc: &hc, notify: &notify, build: &build };
        let r =
            run(&ctx, &json!({"effect": "ripple"}), &Base::shared(), ApplyOpts { eval: true, ..Default::default() })
                .unwrap();
        assert_eq!(r.status, ApplyStatus::Written);
        assert!(fs::read_to_string(&p.lua_file).unwrap().contains("effect       = \"ripple\""));
    }
}
