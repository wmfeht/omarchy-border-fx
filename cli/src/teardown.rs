//! Unload the Omarchy-owned `~/.local/lib` copy of `hypr-shiny-border.so`.
//! Does not unload a hyprpm or nest copy. `purge` also deletes the session
//! `.so` and generated lua (run this after `omarchy plugin remove` if the
//! shell was not running).

use serde_json::Value;

use crate::apply::{self, ApplyOpts};
use crate::ctx::Ctx;
use crate::look::Base;
use crate::session::{self, SessionLock};
use crate::timing;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Session copy unloaded; disabled lua persisted.
    Unloaded,
    /// Nothing of ours was loaded (or unload was refused); disabled lua persisted.
    Disabled,
    /// An ensure claimed the session between our gen read and lock; nothing done.
    Skipped,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Unloaded => "unloaded",
            Status::Disabled => "disabled",
            Status::Skipped => "skipped",
        }
    }
}

fn log(msg: &str) {
    eprintln!("teardown: {msg}");
}

fn persist_disable(ctx: &Ctx, entry: &Value) {
    let p = ctx.paths;
    let eval = ctx.hc.available() && ctx.hc.plugin_listed(&p.plugin_name);
    if let Err(e) = apply::run(ctx, entry, &Base::shared(), ApplyOpts { eval, disabled: true, no_load: false }) {
        log(&format!("could not write {}: {e}", p.lua_file.display()));
    }
}

pub fn run(ctx: &Ctx, entry: &Value, purge: bool) -> Status {
    let p = ctx.paths;
    let gen_before = session::ensure_gen(&p.session_gen);
    let lock = SessionLock::acquire(&p.session_lock);
    if let Err(e) = &lock {
        log(&format!("could not take {}: {e}", p.session_lock.display()));
    }
    if session::ensure_gen(&p.session_gen) != gen_before {
        log("skipped; ensure already claimed this session");
        return Status::Skipped;
    }

    let mut status = Status::Disabled;
    if ctx.hc.available() && ctx.hc.plugin_listed(&p.plugin_name) {
        match session::loaded_so(ctx.hc, &p.hyprctl_instance) {
            Some(path) if std::path::Path::new(&path) == p.session_so => {
                if ctx.hc.plugin_unload(&p.session_so) && session::wait_plugin_gone(ctx.hc, p, timing::UNLOAD_TIMEOUT) {
                    println!("teardown: unloaded {}", p.session_so.display());
                    status = Status::Unloaded;
                } else {
                    log("unload refused; setting enabled = false");
                }
            }
            Some(path) => log(&format!("not unloading {path} (not the Omarchy session copy)")),
            None => log("plugin listed but .so path unknown; setting enabled = false"),
        }
    }

    persist_disable(ctx, entry);

    if purge {
        let _ = std::fs::remove_file(&p.session_so);
        let _ = std::fs::remove_file(&p.lua_file);
        let _ = std::fs::remove_file(&p.legacy_lua_file);
        println!(
            "teardown: purged {}, {}, and leftover {}",
            p.session_so.display(),
            p.lua_file.display(),
            p.legacy_lua_file.display()
        );
        println!("teardown: left hyprland.lua require in place (pcall) and did not edit looknfeel.lua");
    } else {
        println!("teardown: kept {} (re-enable is fast)", p.session_so.display());
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hyprctl::fake::Fake;
    use crate::paths::Paths;
    use serde_json::json;
    use std::fs;

    fn paths_in(dir: &std::path::Path) -> Paths {
        let mut p = Paths::from_env(dir);
        p.session_so = dir.join("lib/hypr-shiny-border.so");
        p.lua_file = dir.join("hypr/border-fx.lua");
        p.legacy_lua_file = dir.join("hypr/shiny-border.lua");
        p.session_lock = dir.join("run/lock");
        p.session_gen = dir.join("run/gen");
        p
    }

    fn ctx<'a>(p: &'a Paths, hc: &'a Fake, notify: &'a dyn Fn(&str), build: &'a dyn Fn(&Paths) -> bool) -> Ctx<'a> {
        Ctx { paths: p, hc, notify, build }
    }

    fn lua_disabled(p: &Paths) -> bool {
        let t = fs::read_to_string(&p.lua_file).unwrap_or_default();
        t.contains("SHINY_LOAD = false") && t.contains("enabled      = false")
    }

    #[test]
    fn not_listed_persists_disabled_without_eval() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        let hc = Fake::up(false);
        let n = |_: &str| {};
        let b = |_: &Paths| false;
        let s = run(&ctx(&p, &hc, &n, &b), &json!({}), false);
        assert_eq!(s, Status::Disabled);
        assert!(lua_disabled(&p));
        assert!(!hc.called("eval"));
        assert!(!hc.called("plugin unload"));
    }

    #[test]
    fn listed_unknown_path_evals_disabled() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        let hc = Fake::up(true);
        let n = |_: &str| {};
        let b = |_: &Paths| false;
        let s = run(&ctx(&p, &hc, &n, &b), &json!({}), false);
        assert_eq!(s, Status::Disabled);
        assert!(lua_disabled(&p));
        assert!(hc.called("eval"));
        assert!(!hc.called("plugin unload"));
    }

    #[test]
    fn purge_removes_artifacts() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        fs::create_dir_all(p.session_so.parent().unwrap()).unwrap();
        fs::write(&p.session_so, "so").unwrap();
        fs::create_dir_all(p.lua_file.parent().unwrap()).unwrap();
        fs::write(&p.legacy_lua_file, "old").unwrap();
        let hc = Fake::up(false);
        let n = |_: &str| {};
        let b = |_: &Paths| false;
        run(&ctx(&p, &hc, &n, &b), &json!({}), true);
        assert!(!p.session_so.exists());
        assert!(!p.lua_file.exists());
        assert!(!p.legacy_lua_file.exists());
    }

    #[test]
    fn skips_when_ensure_claimed_the_session() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        // Simulate: gen read → ensure bumps → we take the lock.
        // The flow reads gen twice around the lock; racing that from a test
        // needs a thread holding the lock while bumping.
        let lock = SessionLock::acquire(&p.session_lock).unwrap();
        let p2 = p.clone();
        let t = std::thread::spawn(move || {
            let hc = Fake::up(false);
            let n = |_: &str| {};
            let b = |_: &Paths| false;
            run(&ctx(&p2, &hc, &n, &b), &json!({}), false)
        });
        std::thread::sleep(std::time::Duration::from_millis(100));
        session::bump_ensure_gen(&p.session_gen).unwrap();
        drop(lock);
        assert_eq!(t.join().unwrap(), Status::Skipped);
        assert!(!p.lua_file.exists(), "skipped teardown writes nothing");
    }
}
