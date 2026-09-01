//! Build / install / load the login-session copy of `hypr-shiny-border.so`
//! and persist the look. Called from `Service.qml` after enable. No sudo.
//! Never loads a second copy if hyprpm (or a nest) already owns one.
//!
//! Fails closed: a refused load is `STATUS=load-failed` with exit 0 so the
//! chrome keeps running.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::abi::{self, Identity};
use crate::apply::{self, ApplyOpts};
use crate::ctx::Ctx;
use crate::hyprland_lua;
use crate::look::{self, Base, Look};
use crate::session::{self, SessionLock};
use crate::timing;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Session copy built (or reused) and loaded; look applied.
    Ok,
    /// Something else already has the plugin loaded (unknown path, other path,
    /// mapped-but-not-listed, or a live copy we could not replace).
    Reuse,
    /// hyprpm owns the loaded copy.
    Hyprpm,
    LoadFailed,
    BuildFailed,
    /// Effect does not draw on windows; disabled lua written, nothing loaded.
    Skipped,
    NoHyprctl,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Ok => "ok",
            Status::Reuse => "reuse",
            Status::Hyprpm => "hyprpm",
            Status::LoadFailed => "load-failed",
            Status::BuildFailed => "build-failed",
            Status::Skipped => "skipped",
            Status::NoHyprctl => "no-hyprctl",
        }
    }

    /// The window ring is ready (mirrors `qml/EnsureStatus.js`).
    pub fn is_success(self) -> bool {
        matches!(self, Status::Ok | Status::Reuse | Status::Hyprpm)
    }
}

pub struct Outcome {
    pub status: Status,
    pub look: Look,
}

struct Ensure<'a> {
    ctx: &'a Ctx<'a>,
    entry: &'a Value,
    base: &'a Base,
    id: Identity,
    look: Look,
}

impl Ensure<'_> {
    fn p(&self) -> &crate::paths::Paths {
        self.ctx.paths
    }

    fn log(&self, msg: &str) {
        eprintln!("ensure: {msg}");
    }

    fn notify(&self, msg: &str) {
        self.log(msg);
        (self.ctx.notify)(msg);
    }

    fn apply(&mut self, o: ApplyOpts) {
        match apply::run(self.ctx, self.entry, self.base, o) {
            Ok(a) => self.look = a.look,
            Err(e) => self.log(&format!("could not write {}: {e}", self.p().lua_file.display())),
        }
    }

    fn ensure_require(&self) {
        let p = self.p();
        if let Err(e) = hyprland_lua::ensure_require(&p.hyprland_lua, &p.plugin_id, &p.lua_module) {
            self.log(&format!("could not update {}: {e}", p.hyprland_lua.display()));
        }
    }

    fn listed(&self) -> bool {
        self.ctx.hc.plugin_listed(&self.p().plugin_name)
    }

    fn loaded_so(&self) -> Option<PathBuf> {
        session::loaded_so(self.ctx.hc, &self.p().hyprctl_instance).map(PathBuf::from)
    }

    fn fresh(&self, so: &Path) -> bool {
        abi::artifact_fresh(self.p(), &self.id, so)
    }

    fn build_so(&self) -> bool {
        let p = self.p();
        if !p.hypr_src.join("Makefile").is_file() {
            self.notify("Window borders can't be built here: this copy of the plugin has no Hyprland sources. Panel and notification effects still work.");
            return false;
        }
        let _ = std::fs::create_dir_all(&p.build_dir);
        if abi::need_force_rebuild(p, &self.id) {
            self.log("compositor/header/compiler identity changed; not relinking stale objects");
            abi::invalidate_objects(p);
        }
        if !(self.ctx.build)(p) {
            self.notify("Window borders failed to build. Panel and notification effects still work. Install the Hyprland headers that match your compositor, then re-enable the plugin.");
            return false;
        }
        if !p.build_so().is_file() {
            return false;
        }
        if let Err(e) = abi::stamp_write(p, &self.id) {
            self.log(&format!("could not write ABI stamp: {e}"));
        }
        true
    }

    fn copy_session_so(&self, src: &Path) -> bool {
        match session::install_session_so(src, &self.p().session_so) {
            Ok(()) => true,
            Err(e) => {
                self.log(&format!("could not install {}: {e}", self.p().session_so.display()));
                false
            }
        }
    }

    /// Load the session copy. On failure, record a hash mismatch when the
    /// compositor said so and drop the unusable `.so`.
    fn load_session_so(&self) -> bool {
        let p = self.p();
        match self.ctx.hc.plugin_load(&p.session_so) {
            Ok(out) => {
                if !out.trim().is_empty() {
                    eprintln!("{}", out.trim_end());
                }
                abi::clear_hash_mismatch(p);
                true
            }
            Err(err) => {
                if !err.output.trim().is_empty() {
                    eprintln!("{}", err.output.trim_end());
                }
                if crate::hyprctl::is_hash_mismatch(&err.output) {
                    let _ = abi::record_hash_mismatch(p);
                    abi::delete_session_so(self.ctx.hc, p);
                }
                false
            }
        }
    }

    fn load_or_fail(&self) -> Result<(), Status> {
        if self.load_session_so() {
            return Ok(());
        }
        self.notify("Hyprland refused to load the window borders. Panel and notification effects still work. Check that your Hyprland configuration allows plugin loads.");
        Err(Status::LoadFailed)
    }

    /// Unload the session copy. True only when Hyprland no longer lists or maps
    /// it — copy+load after a failed unload is how CRenderPass::clear SIGBUS'd.
    fn unload_session_so(&self) -> bool {
        let p = self.p();
        let _ = self.ctx.hc.plugin_unload(&p.session_so);
        session::wait_plugin_gone(self.ctx.hc, p, timing::UNLOAD_TIMEOUT)
    }

    fn run(mut self) -> Outcome {
        let status = self.run_inner();
        Outcome { status, look: self.look }
    }

    fn run_inner(&mut self) -> Status {
        let p = self.p().clone();
        if !self.ctx.hc.available() {
            self.log("hyprctl not found; chrome only");
            return Status::NoHyprctl;
        }

        let effect = look::entry_effect(self.entry);
        if !look::effect_draws(&effect) {
            self.log("effect does not load the window plugin; writing disabled Lua, skipping compile/load");
            self.ensure_require();
            self.apply(ApplyOpts { disabled: true, ..Default::default() });
            if self.loaded_so().as_deref() == Some(p.session_so.as_path()) {
                self.log("unloading leftover session plugin");
                let _ = self.unload_session_so();
            }
            if self.listed() {
                self.apply(ApplyOpts { disabled: true, eval: true, ..Default::default() });
            }
            return Status::Skipped;
        }

        self.ensure_require();
        self.apply(ApplyOpts::default());

        if self.listed() {
            let Some(path) = self.loaded_so() else {
                self.notify("Window borders are already active.");
                self.apply(ApplyOpts { eval: true, ..Default::default() });
                return Status::Reuse;
            };
            if path == p.session_so {
                if !self.fresh(&p.session_so) && self.build_so() {
                    if self.unload_session_so() {
                        abi::delete_session_so(self.ctx.hc, &p);
                        self.copy_session_so(&p.build_so());
                        if let Err(s) = self.load_or_fail() {
                            return s;
                        }
                    } else {
                        self.notify("Window borders couldn't be replaced while running, so the current version stays active. Log out and back in to finish the update.");
                        self.apply(ApplyOpts { eval: true, ..Default::default() });
                        return Status::Reuse;
                    }
                }
                self.apply(ApplyOpts { eval: true, ..Default::default() });
                return Status::Ok;
            }
            if path.to_string_lossy().contains("hyprpm") {
                self.notify("Window borders are already loaded by hyprpm. To let Border FX manage them instead, run: hyprpm disable hypr-shiny-border");
                self.apply(ApplyOpts { eval: true, ..Default::default() });
                return Status::Hyprpm;
            }
            self.notify(&format!("Window borders are already loaded from {}.", path.display()));
            self.apply(ApplyOpts { eval: true, ..Default::default() });
            return Status::Reuse;
        }

        if let Some(path) = self.loaded_so() {
            self.notify(&format!("Window borders are already loaded from {}.", path.display()));
            self.apply(ApplyOpts { eval: true, ..Default::default() });
            return Status::Reuse;
        }

        if p.session_so.is_file() && !self.fresh(&p.session_so) {
            abi::delete_session_so(self.ctx.hc, &p);
        }

        let candidates = [p.session_so.clone(), p.build_so(), p.tree_so()];
        let mut built = candidates.iter().find(|so| self.fresh(so)).cloned();
        if built.is_none() {
            if !self.build_so() {
                return Status::BuildFailed;
            }
            built = Some(p.build_so());
        }
        let built = built.expect("set above");
        if built != p.session_so {
            self.copy_session_so(&built);
        }
        if let Err(s) = self.load_or_fail() {
            return s;
        }
        self.apply(ApplyOpts { eval: true, ..Default::default() });
        Status::Ok
    }
}

/// Bumps the ensure generation when dropped, lock or not, like the bash
/// `trap ... EXIT`.
struct GenBump<'a>(&'a Path);

impl Drop for GenBump<'_> {
    fn drop(&mut self) {
        let _ = session::bump_ensure_gen(self.0);
    }
}

pub fn run(ctx: &Ctx, entry: &Value, base: &Base) -> Outcome {
    let p = ctx.paths;
    let lock = SessionLock::acquire(&p.session_lock);
    if let Err(e) = &lock {
        eprintln!("ensure: could not take {}: {e}", p.session_lock.display());
    }
    let _bump = GenBump(&p.session_gen);
    let (look, _) = look::resolve(entry, base);
    let id = abi::identity(ctx.hc);
    Ensure { ctx, entry, base, id, look }.run()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hyprctl::fake::Fake;
    use crate::paths::Paths;
    use serde_json::json;
    use std::cell::RefCell;
    use std::fs;
    use std::time::{Duration, SystemTime};

    struct Harness {
        _dir: tempfile::TempDir,
        paths: Paths,
        notes: RefCell<Vec<String>>,
        builds: RefCell<u32>,
        build_ok: bool,
    }

    impl Harness {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let d = dir.path();
            let mut paths = Paths::from_env(d);
            paths.build_dir = d.join("cache");
            paths.abi_stamp = paths.build_dir.join("abi-identity");
            paths.abi_hash_mismatch = paths.build_dir.join("hash-mismatch");
            paths.session_so = d.join("lib/hypr-shiny-border.so");
            paths.lua_file = d.join("config/hypr/border-fx.lua");
            paths.hyprland_lua = d.join("config/hypr/hyprland.lua");
            paths.session_lock = d.join("run/hypr-session.lock");
            paths.session_gen = d.join("run/hypr-ensure.gen");
            paths.hypr_src = d.join("src-tree");
            fs::create_dir_all(paths.hypr_src.join("src")).unwrap();
            fs::write(paths.hypr_src.join("Makefile"), "all:\n").unwrap();
            fs::create_dir_all(&paths.build_dir).unwrap();
            let id = Identity { hash: "test-hash".into(), header_mtime: "1".into(), compiler: "test-compiler".into() };
            abi::stamp_write(&paths, &id).unwrap();
            Harness { _dir: dir, paths, notes: RefCell::new(vec![]), builds: RefCell::new(0), build_ok: false }
        }

        fn fresh_session_so(&self) {
            fs::create_dir_all(self.paths.session_so.parent().unwrap()).unwrap();
            fs::write(&self.paths.session_so, "SESSION").unwrap();
            let f = fs::File::options().write(true).open(&self.paths.session_so).unwrap();
            f.set_modified(SystemTime::now() + Duration::from_secs(86_400)).unwrap();
        }

        fn run(&self, hc: &Fake, entry: Value) -> Outcome {
            let notify = |m: &str| self.notes.borrow_mut().push(m.to_string());
            let build = |p: &Paths| {
                *self.builds.borrow_mut() += 1;
                if self.build_ok {
                    fs::create_dir_all(&p.build_dir).unwrap();
                    fs::write(p.build_so(), "BUILT-SO").unwrap();
                }
                self.build_ok
            };
            let ctx = Ctx { paths: &self.paths, hc, notify: &notify, build: &build };
            // Identity probes would hit hyprctl/pkg-config; pin them via the fake's version text
            // and the env-free header/compiler paths by using the stamp values directly.
            run_with_identity(
                &ctx,
                &entry,
                &Base::shared(),
                Identity { hash: "test-hash".into(), header_mtime: "1".into(), compiler: "test-compiler".into() },
            )
        }

        fn lua(&self) -> String {
            fs::read_to_string(&self.paths.lua_file).unwrap_or_default()
        }
    }

    fn run_with_identity(ctx: &Ctx, entry: &Value, base: &Base, id: Identity) -> Outcome {
        let p = ctx.paths;
        let _lock = SessionLock::acquire(&p.session_lock).unwrap();
        let _bump = GenBump(&p.session_gen);
        let (look, _) = look::resolve(entry, base);
        Ensure { ctx, entry, base, id, look }.run()
    }

    fn lua_disabled(t: &str) -> bool {
        t.contains("SHINY_LOAD = false") && t.contains("enabled      = false")
    }
    fn lua_enabled(t: &str) -> bool {
        t.contains("SHINY_LOAD = true") && t.contains("enabled      = true")
    }

    #[test]
    fn no_hyprctl_is_chrome_only() {
        let h = Harness::new();
        let hc = Fake { available: false, ..Fake::up(false) };
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::NoHyprctl);
        assert!(!out.status.is_success());
        assert_eq!(out.look["pinDeg"], 120, "look is still resolved for chrome");
        assert!(!h.paths.lua_file.exists());
    }

    #[test]
    fn non_drawing_effect_is_skipped() {
        let h = Harness::new();
        let hc = Fake::up(false);
        let out = h.run(&hc, json!({"effect": "other"}));
        assert_eq!(out.status, Status::Skipped);
        assert!(lua_disabled(&h.lua()));
        assert!(!hc.called("plugin load"));
        assert_eq!(*h.builds.borrow(), 0);
        assert!(!hc.called("eval"), "not listed → no eval");

        let listed = Fake::up(true);
        let out = h.run(&listed, json!({"effect": "other"}));
        assert_eq!(out.status, Status::Skipped);
        assert!(listed.called("eval"), "listed → disabled lua is eval'd");
        assert!(!listed.called("plugin unload"), "unknown path is not our session copy");
    }

    #[test]
    fn fresh_session_so_loads() {
        let h = Harness::new();
        h.fresh_session_so();
        let hc = Fake::up(false);
        for entry in [json!({}), json!({"effect": "shiny"}), json!({"effect": "ripple"}), json!({"effect": ""})] {
            *hc.listed.borrow_mut() = false;
            hc.calls.borrow_mut().clear();
            let out = h.run(&hc, entry);
            assert_eq!(out.status, Status::Ok);
            assert!(hc.called("plugin load"));
            assert!(hc.called("eval"));
            assert!(lua_enabled(&h.lua()));
            assert_eq!(*h.builds.borrow(), 0);
        }
        assert_eq!(session::ensure_gen(&h.paths.session_gen), 4);
    }

    #[test]
    fn listed_without_path_is_reuse() {
        let h = Harness::new();
        let hc = Fake::up(true);
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::Reuse);
        assert!(!hc.called("plugin load"));
        assert_eq!(*h.builds.borrow(), 0);
        assert!(lua_enabled(&h.lua()));
        assert!(h.notes.borrow().iter().any(|n| n.contains("already active")));
    }

    #[test]
    fn build_failure_is_fail_closed() {
        let h = Harness::new();
        let hc = Fake::up(false);
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::BuildFailed);
        assert_eq!(*h.builds.borrow(), 1);
        assert!(!hc.called("plugin load"));
        assert!(h.notes.borrow().iter().any(|n| n.contains("failed to build")));
    }

    #[test]
    fn missing_sources_do_not_build() {
        let h = Harness::new();
        fs::remove_file(h.paths.hypr_src.join("Makefile")).unwrap();
        let hc = Fake::up(false);
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::BuildFailed);
        assert_eq!(*h.builds.borrow(), 0);
        assert!(h.notes.borrow().iter().any(|n| n.contains("no Hyprland sources")));
    }

    #[test]
    fn build_success_installs_and_loads() {
        let mut h = Harness::new();
        h.build_ok = true;
        let hc = Fake::up(false);
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::Ok);
        assert_eq!(fs::read_to_string(&h.paths.session_so).unwrap(), "BUILT-SO");
        assert_eq!(hc.loaded_paths.borrow()[0], h.paths.session_so);
        assert!(h.paths.abi_stamp.is_file());
    }

    #[test]
    fn cold_load_failure_keeps_session_so() {
        let h = Harness::new();
        h.fresh_session_so();
        let hc = Fake { load_ok: false, load_output: "load refused".into(), ..Fake::up(false) };
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::LoadFailed);
        assert!(hc.called("plugin load"));
        assert!(h.paths.session_so.exists(), "generic load failure keeps the .so");
        assert!(!h.paths.abi_hash_mismatch.exists());
    }

    #[test]
    fn hash_mismatch_load_failure_records_and_deletes() {
        let mut h = Harness::new();
        h.fresh_session_so();
        let hc = Fake { load_ok: false, load_output: "[shiny-border] version mismatch".into(), ..Fake::up(false) };
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::LoadFailed);
        assert!(!h.paths.session_so.exists(), "unusable .so is unlinked");
        assert!(h.paths.abi_hash_mismatch.is_file());
        assert_eq!(*h.builds.borrow(), 0);

        // Second ensure cannot reuse the deleted .so; it rebuilds, then fails again.
        h.build_ok = true;
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::LoadFailed);
        assert_eq!(*h.builds.borrow(), 1);
        assert!(!h.paths.session_so.exists());
    }

    #[test]
    fn stale_identity_forces_rebuild() {
        let mut h = Harness::new();
        h.build_ok = true;
        // Stale stamp + stale artifacts everywhere.
        fs::write(&h.paths.abi_stamp, "hash=old\nheader_mtime=0\ncompiler=old\n").unwrap();
        h.fresh_session_so();
        fs::create_dir_all(h.paths.build_dir.join("obj")).unwrap();
        fs::write(h.paths.build_dir.join("obj/main.o"), "OLD-OBJECT").unwrap();
        fs::write(h.paths.build_so(), "STALE-CACHE-SO").unwrap();
        let hc = Fake::up(false);
        let out = h.run(&hc, json!({}));
        assert_eq!(out.status, Status::Ok);
        assert_eq!(*h.builds.borrow(), 1);
        assert!(!h.paths.build_dir.join("obj/main.o").exists(), "old objects were not relinked");
        assert_eq!(fs::read_to_string(&h.paths.session_so).unwrap(), "BUILT-SO");
        assert!(abi::identity_matches_stamp(
            &h.paths,
            &Identity { hash: "test-hash".into(), header_mtime: "1".into(), compiler: "test-compiler".into() }
        ));
    }

    #[test]
    fn hyprland_lua_gets_the_require() {
        let h = Harness::new();
        fs::create_dir_all(h.paths.hyprland_lua.parent().unwrap()).unwrap();
        fs::write(&h.paths.hyprland_lua, "require(\"hypr.binds\")\npcall(require, \"hypr.shiny-border\")\n").unwrap();
        let hc = Fake::up(false);
        h.run(&hc, json!({"effect": "other"}));
        let t = fs::read_to_string(&h.paths.hyprland_lua).unwrap();
        assert!(t.contains("pcall(require, \"hypr.border-fx\")"));
        assert!(t.contains("-- pcall(require, \"hypr.shiny-border\")"));
        assert!(t.contains("require(\"hypr.binds\")"));
        drop(h);
    }

    #[test]
    fn status_strings() {
        assert_eq!(Status::Ok.as_str(), "ok");
        assert_eq!(Status::LoadFailed.as_str(), "load-failed");
        assert!(Status::Hyprpm.is_success());
        assert!(!Status::Skipped.is_success());
        assert!(!Status::NoHyprctl.is_success());
    }
}
