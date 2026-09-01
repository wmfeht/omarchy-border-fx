//! Developer install cycle. A dev copy is a file copy into the Omarchy plugin
//! directory, not git-managed and not updated by `omarchy plugin update`.
//! `reinstall` goes through `omarchy plugin remove` + `omarchy plugin add`
//! instead, keeping the `shell.json` look that disable / remove would drop.
//! Does not patch /usr/share/omarchy. No sudo.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::ctx::{self, Ctx};
use crate::paths::{self, Paths};
use crate::session;
use crate::shell_json;
use crate::teardown;
use crate::timing;

/// Files copied into a dev install, relative to the clone root. Directories
/// are copied recursively; globs are literal suffix filters.
const COPY_FILES: &[&str] = &[
    "manifest.json",
    "Service.qml",
    "shaders/shiny.frag",
    "shaders/shiny.frag.qsb",
    "shaders/ripple.frag",
    "shaders/ripple.frag.qsb",
    "scripts/border-fx",
    "cli/Cargo.toml",
    "cli/Cargo.lock",
    "hypr/Makefile",
];
const COPY_DIRS: &[(&str, &[&str])] =
    &[("qml", &[".qml", ".js"]), ("cli/src", &[".rs"]), ("hypr/src", &[".cpp", ".hpp"])];

fn have(cmd: &str) -> bool {
    paths::which(cmd).is_some()
}

fn same_path(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    canon(a) == canon(b)
}

fn copy_file(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    fs::copy(src, dest).map_err(|e| format!("copy {} → {}: {e}", src.display(), dest.display()))?;
    Ok(())
}

fn copy_dir_filtered(src: &Path, dest: &Path, suffixes: &[&str]) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| format!("{}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        if path.is_dir() {
            copy_dir_filtered(&path, &dest.join(&name), suffixes)?;
            continue;
        }
        let keep = name.to_str().is_some_and(|n| suffixes.iter().any(|s| n.ends_with(s)));
        if keep {
            copy_file(&path, &dest.join(&name))?;
        }
    }
    Ok(())
}

fn require_baked(root: &Path) -> Result<(), String> {
    for f in ["shaders/shiny.frag.qsb", "shaders/ripple.frag.qsb"] {
        if !root.join(f).is_file() {
            return Err(format!("missing {f} — run: mise run bake"));
        }
    }
    Ok(())
}

/// Copy the tree into `dest` and make the launcher executable.
pub fn copy_tree(root: &Path, dest: &Path) -> Result<(), String> {
    for rel in COPY_FILES {
        copy_file(&root.join(rel), &dest.join(rel))?;
    }
    for (dir, suffixes) in COPY_DIRS {
        copy_dir_filtered(&root.join(dir), &dest.join(dir), suffixes)?;
    }
    let launcher = dest.join("scripts/border-fx");
    fs::set_permissions(&launcher, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    Ok(())
}

fn validate(dir: &Path) -> Result<(), String> {
    if !have("omarchy") {
        return Ok(());
    }
    if ctx::run("omarchy", &["plugin", "validate", &dir.to_string_lossy()]) {
        Ok(())
    } else {
        Err(format!("omarchy plugin validate refused {}", dir.display()))
    }
}

fn cargo_available() -> bool {
    have("cargo")
        || std::env::var_os("CARGO_HOME")
            .map(|h| PathBuf::from(h).join("bin/cargo"))
            .is_some_and(|p| paths::is_executable(&p))
        || std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join(".cargo/bin/cargo"))
            .is_some_and(|p| paths::is_executable(&p))
}

/// Pre-build the CLI from the installed copy so the first enable is fast.
fn bootstrap(dest: &Path) {
    if !cargo_available() {
        eprintln!("dev install: cargo not found; the launcher will build on first use");
        return;
    }
    let launcher = dest.join("scripts/border-fx");
    if !ctx::run("bash", &[&launcher.to_string_lossy(), "--bootstrap"]) {
        eprintln!("dev install: warning: pre-building the CLI failed; the launcher will retry on first use");
    }
}

pub fn install(p: &Paths) -> Result<(), String> {
    let root = &p.plugin_root;
    let dest = p.dev_copy_dir();
    require_baked(root)?;
    if same_path(&dest, root) {
        return Err(format!("refusing to install over the source tree ({})", dest.display()));
    }
    copy_tree(root, &dest)?;
    validate(&dest)?;
    println!("installed {}", dest.display());
    bootstrap(&dest);
    if have("omarchy") {
        ctx::run_quiet("omarchy", &["plugin", "disable", &p.legacy_plugin_id]);
        ctx::run_quiet("omarchy", &["plugin", "disable", &p.older_legacy_plugin_id]);
        if !ctx::run("omarchy", &["plugin", "enable", &p.plugin_id]) {
            return Err(format!("omarchy plugin enable {} failed", p.plugin_id));
        }
        if !ctx::run("omarchy", &["restart", "shell"]) {
            return Err("omarchy restart shell failed".into());
        }
    }
    Ok(())
}

fn remove_plugin_dir(dir: &Path, root: &Path) {
    if !(dir.exists() || dir.is_symlink()) {
        return;
    }
    if same_path(dir, root) {
        eprintln!("plugin dir is the source tree; left {} in place", dir.display());
        return;
    }
    if dir.is_symlink() || dir.is_file() {
        let _ = fs::remove_file(dir);
    } else {
        let _ = fs::remove_dir_all(dir);
    }
    println!("removed {}", dir.display());
}

pub fn uninstall(ctx: &Ctx) -> Result<(), String> {
    let p = ctx.paths;
    if have("omarchy") {
        for id in p.plugin_ids() {
            ctx::run_quiet("omarchy", &["plugin", "disable", id]);
        }
    }
    // Disable already ran teardown via Service.onDestruction when the shell was
    // up. --purge is the extra step Omarchy's no-hooks installer forces.
    teardown::run(ctx, &serde_json::Value::Object(Default::default()), true);
    remove_plugin_dir(&p.dev_copy_dir(), &p.plugin_root);
    remove_plugin_dir(&p.installed_dir(&p.legacy_plugin_id), &p.plugin_root);
    remove_plugin_dir(&p.installed_dir(&p.older_legacy_plugin_id), &p.plugin_root);
    if have("omarchy-shell") {
        ctx::run_quiet("omarchy-shell", &["shell", "rescanPlugins"]);
    }
    Ok(())
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let mut c = Command::new("git");
    c.arg("-C").arg(root).args(args);
    c.env_remove("GIT_DIR").env_remove("GIT_WORK_TREE").env_remove("GIT_INDEX_FILE");
    let out = c.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn git_ok(root: &Path, args: &[&str]) -> bool {
    git(root, args).is_some()
}

fn nul_list(text: &str) -> Vec<&str> {
    text.split('\0').filter(|s| !s.is_empty()).collect()
}

/// `omarchy plugin add` git-clones; HEAD would drop dirty files. Snapshot the
/// working tree into a throwaway repo so the clone matches this folder.
fn snapshot_working_tree(root: &Path, build_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(build_dir).map_err(|e| e.to_string())?;
    let snapshot = tempdir_in(build_dir, "reinstall")?;
    let snap = snapshot.to_string_lossy().into_owned();
    // Same filesystem as ~/.config so omarchy plugin add's clone can hardlink.
    if !git_ok(root, &["clone", "--quiet", "--no-hardlinks", "--", &root.to_string_lossy(), &snap]) {
        return Err("git clone of the working tree failed".into());
    }
    let deleted = git(root, &["diff", "--name-only", "-z", "--diff-filter=D", "HEAD"]).unwrap_or_default();
    for f in nul_list(&deleted) {
        let _ = fs::remove_file(snapshot.join(f));
    }
    let tracked = git(root, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).unwrap_or_default();
    for f in nul_list(&tracked) {
        let src = root.join(f);
        let meta = match fs::symlink_metadata(&src) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let dest = snapshot.join(f);
        if let Some(dir) = dest.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        if meta.file_type().is_symlink() {
            let target = fs::read_link(&src).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(&dest);
            std::os::unix::fs::symlink(target, &dest).map_err(|e| e.to_string())?;
        } else if meta.is_file() {
            fs::copy(&src, &dest).map_err(|e| e.to_string())?;
            fs::set_permissions(&dest, meta.permissions()).map_err(|e| e.to_string())?;
        }
    }
    let dirty = git(&snapshot, &["status", "--porcelain"]).map(|s| !s.trim().is_empty()).unwrap_or(false);
    if dirty {
        git_ok(&snapshot, &["add", "-A"]);
        if !git_ok(
            &snapshot,
            &[
                "-c",
                "user.name=mise",
                "-c",
                "user.email=mise@omarchy-border-fx.local",
                "commit",
                "--quiet",
                "-m",
                "mise reinstall: working tree snapshot",
            ],
        ) {
            return Err("could not commit the working tree snapshot".into());
        }
    }
    validate(&snapshot)?;
    Ok(snapshot)
}

fn tempdir_in(parent: &Path, prefix: &str) -> Result<PathBuf, String> {
    for _ in 0..64 {
        let f = session::create_sibling_temp(parent, prefix).map_err(|e| e.to_string())?;
        // Swap the placeholder file for a directory of the same name.
        let _ = fs::remove_file(&f);
        if fs::create_dir(&f).is_ok() {
            return Ok(f);
        }
    }
    Err("could not create a snapshot directory".into())
}

/// Restores the look and removes the snapshot on every exit path, like the
/// bash `trap cleanup EXIT`.
struct ReinstallGuard<'a> {
    p: &'a Paths,
    saved: Option<serde_json::Value>,
    snapshot: Option<PathBuf>,
    finished: bool,
}

impl Drop for ReinstallGuard<'_> {
    fn drop(&mut self) {
        if !self.finished
            && let Some(saved) = &self.saved
        {
            let ids = self.p.plugin_ids();
            let _ = shell_json::restore(&self.p.shell_json, Some(saved), &ids);
        }
        if let Some(snap) = &self.snapshot {
            let _ = fs::remove_dir_all(snap);
        }
    }
}

pub fn reinstall(ctx: &Ctx) -> Result<(), String> {
    let p = ctx.paths;
    let root = &p.plugin_root;
    for cmd in ["omarchy", "git"] {
        if !have(cmd) {
            return Err(format!("missing {cmd}"));
        }
    }
    require_baked(root)?;
    let dest = p.installed_dir(&p.plugin_id);
    if same_path(&dest, root) {
        return Err(format!("refusing to reinstall: this tree is the installed plugin ({})", dest.display()));
    }
    if !git_ok(root, &["rev-parse", "--is-inside-work-tree"]) {
        return Err("this folder is not a git repo; omarchy plugin add needs one".into());
    }
    validate(root)?;

    let mut guard = ReinstallGuard { p, saved: None, snapshot: None, finished: false };

    let dirty = git(root, &["status", "--porcelain"]).map(|s| !s.trim().is_empty()).unwrap_or(true);
    let add_url = if dirty {
        let snap = snapshot_working_tree(root, &p.build_dir)?;
        guard.snapshot = Some(snap.clone());
        snap
    } else {
        root.clone()
    };

    // disable/remove splice the whole plugins[] object. Snapshot the look
    // before that so add --enable does not start from { "id": ... }.
    let ids = p.plugin_ids();
    guard.saved = shell_json::snapshot(&p.shell_json, &ids);
    if guard.saved.is_some() {
        println!("reinstall: keeping existing look from shell.json");
    }

    // Disable first so Service.onDestruction can still exec the installed
    // teardown. Then purge the login-session copy from this tree.
    for id in ids {
        let dir = p.installed_dir(id);
        if dir.exists() || dir.is_symlink() {
            ctx::run_quiet("omarchy", &["plugin", "disable", id]);
        }
    }
    session::wait_plugin_gone(ctx.hc, p, timing::UNLOAD_TIMEOUT);

    println!("reinstall: purging login-session Hyprland copy");
    teardown::run(ctx, &serde_json::Value::Object(Default::default()), true);

    if !session::wait_plugin_gone(ctx.hc, p, timing::UNLOAD_TIMEOUT) {
        eprintln!("reinstall: Hyprland still has {} mapped.", p.plugin_name);
        eprintln!("reinstall: aborting before add --enable so we do not replace a live .so.");
        eprintln!("reinstall: retry, or iterate in a nest: mise run nest && mise run reload");
        return Err("plugin still mapped".into());
    }

    for id in ids {
        let dir = p.installed_dir(id);
        if dir.exists() || dir.is_symlink() {
            println!("reinstall: omarchy plugin remove {id}");
            if !ctx::run("omarchy", &["plugin", "remove", id, "--yes"]) {
                return Err(format!("omarchy plugin remove {id} failed"));
            }
        }
    }
    if have("omarchy-shell") {
        ctx::run_quiet("omarchy-shell", &["shell", "rescanPlugins"]);
    }

    // Restart *before* add --enable. Restarting after enable races Service
    // onDestruction (teardown) with the new service's ensure, which used to
    // cp -f over the mapped session .so and SIGBUS Hyprland.
    println!("reinstall: omarchy restart shell");
    if !ctx::run("omarchy", &["restart", "shell"]) {
        return Err("omarchy restart shell failed".into());
    }

    // Put the look back before enable so setEnabled sees an existing plugins[]
    // entry (and does not replace it with {id}) and Service starts with it.
    if guard.saved.is_some() {
        println!("reinstall: restoring look into shell.json");
        shell_json::restore(&p.shell_json, guard.saved.as_ref(), &ids)?;
        shell_json::reload_shell();
    }

    println!("reinstall: omarchy plugin add {} --enable --yes", root.display());
    if !ctx::run("omarchy", &["plugin", "add", &add_url.to_string_lossy(), "--enable", "--yes"]) {
        return Err("omarchy plugin add failed".into());
    }

    // enable clones in-memory shellConfig. If reloadConfig had not landed, it
    // still writes {id}; write the look again and reload.
    if guard.saved.is_some() {
        shell_json::restore(&p.shell_json, guard.saved.as_ref(), &ids)?;
        shell_json::reload_shell();
    }

    if dest.join(".git").is_dir() {
        git_ok(&dest, &["remote", "set-url", "origin", &root.to_string_lossy()]);
    }

    guard.finished = true;
    println!("reinstalled {} from {}", p.plugin_id, root.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
    }

    #[test]
    fn copy_tree_ships_the_control_plane() {
        let root = repo_root();
        if !root.join("shaders/shiny.frag.qsb").is_file() {
            eprintln!("skipping: shaders not baked");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("wmfeht.border-fx");
        copy_tree(&root, &dest).unwrap();
        for f in [
            "manifest.json",
            "Service.qml",
            "qml/Look.js",
            "qml/ShinyBorder.qml",
            "shaders/shiny.frag",
            "shaders/shiny.frag.qsb",
            "shaders/ripple.frag",
            "shaders/ripple.frag.qsb",
            "scripts/border-fx",
            "cli/Cargo.toml",
            "cli/Cargo.lock",
            "cli/src/main.rs",
            "cli/src/look/mod.rs",
            "hypr/Makefile",
            "hypr/src/main.cpp",
            "hypr/src/shaders.hpp",
        ] {
            assert!(dest.join(f).is_file(), "{f} copied");
        }
        assert!(!dest.join("dev").exists(), "dev tooling is not shipped");
        assert!(!dest.join("tests").exists());
        assert!(!dest.join("cli/target").exists());
        assert!(paths::is_executable(&dest.join("scripts/border-fx")));
        assert_eq!(
            fs::read(root.join("shaders/shiny.frag")).unwrap(),
            fs::read(dest.join("shaders/shiny.frag")).unwrap()
        );
    }

    #[test]
    fn refuses_unbaked_tree() {
        let dir = tempfile::tempdir().unwrap();
        assert!(require_baked(dir.path()).unwrap_err().contains("mise run bake"));
    }

    #[test]
    fn same_path_follows_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        fs::create_dir(&a).unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&a, &link).unwrap();
        assert!(same_path(&a, &link));
        assert!(!same_path(&a, dir.path()));
    }

    #[test]
    fn nul_lists() {
        assert_eq!(nul_list("a\0b\0\0"), vec!["a", "b"]);
        assert!(nul_list("").is_empty());
    }
}
