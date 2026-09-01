//! Is the built `.so` still safe to load? A Hyprland plugin is only valid for
//! the exact compositor hash, headers, and compiler it was built against, so
//! we stamp that identity next to the build and refuse to reuse an artifact
//! when any of it changed, or when the last `PLUGIN_INIT` reported a hash
//! mismatch.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use crate::hyprctl::{self, Hyprctl};
use crate::paths::Paths;
use crate::session;

/// The three identity inputs. Fixture env vars (`HYPR_ABI_COMPOSITOR_HASH`,
/// `HYPR_ABI_HEADER_MTIME`, `HYPR_ABI_COMPILER_ID`) skip the hyprctl /
/// pkg-config / compiler probes so tests stay compositor-free.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub hash: String,
    pub header_mtime: String,
    pub compiler: String,
}

impl Identity {
    pub fn text(&self) -> String {
        format!("hash={}\nheader_mtime={}\ncompiler={}\n", self.hash, self.header_mtime, self.compiler)
    }
}

fn env_fixture(name: &str) -> Option<String> {
    env::var(name).ok()
}

/// `version.h` the compiler will see: pkg-config -I dirs first, then /usr.
pub fn version_h() -> Option<PathBuf> {
    if let Some(v) = env_fixture("HYPR_ABI_VERSION_H") {
        return if v.is_empty() { None } else { Some(PathBuf::from(v)) };
    }
    let flags = Command::new("pkg-config")
        .args(["--cflags-only-I", "hyprland"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    for flag in flags.split_whitespace() {
        let Some(dir) = flag.strip_prefix("-I") else { continue };
        if dir.is_empty() {
            continue;
        }
        for rel in ["hyprland/src/version.h", "src/version.h", "version.h"] {
            let p = Path::new(dir).join(rel);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let fallback = Path::new("/usr/include/hyprland/src/version.h");
    fallback.is_file().then(|| fallback.to_path_buf())
}

pub fn compositor_hash(hc: &dyn Hyprctl) -> String {
    if let Some(v) = env_fixture("HYPR_ABI_COMPOSITOR_HASH") {
        return v;
    }
    hc.version().and_then(|t| hyprctl::abi_string(&t)).unwrap_or_default()
}

pub fn header_mtime() -> String {
    if let Some(v) = env_fixture("HYPR_ABI_HEADER_MTIME") {
        return v;
    }
    version_h()
        .and_then(|p| fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}

pub fn compiler_id() -> String {
    if let Some(v) = env_fixture("HYPR_ABI_COMPILER_ID") {
        return v;
    }
    let cxx = env::var("CXX").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "g++".to_string());
    let probe = |flag: &str| {
        Command::new(&cxx)
            .arg(flag)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    format!("{}-{}", probe("-dumpmachine"), probe("-dumpversion"))
}

pub fn identity(hc: &dyn Hyprctl) -> Identity {
    Identity { hash: compositor_hash(hc), header_mtime: header_mtime(), compiler: compiler_id() }
}

pub fn stamp_write(p: &Paths, id: &Identity) -> std::io::Result<()> {
    session::write_atomic(&p.abi_stamp, id.text().as_bytes())
}

pub fn identity_matches_stamp(p: &Paths, id: &Identity) -> bool {
    fs::read_to_string(&p.abi_stamp).map(|s| s == id.text()).unwrap_or(false)
}

pub fn hash_mismatch_recorded(p: &Paths) -> bool {
    p.abi_hash_mismatch.is_file()
}

pub fn record_hash_mismatch(p: &Paths) -> std::io::Result<()> {
    if let Some(dir) = p.abi_hash_mismatch.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&p.abi_hash_mismatch, "1\n")
}

pub fn clear_hash_mismatch(p: &Paths) {
    let _ = fs::remove_file(&p.abi_hash_mismatch);
}

fn newest_source_mtime(src_dir: &Path) -> Option<SystemTime> {
    let mut newest: Option<SystemTime> = None;
    let mut stack = vec![src_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let is_src = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e == "cpp" || e == "hpp");
            if !is_src {
                continue;
            }
            if let Ok(m) = entry.metadata().and_then(|m| m.modified()) {
                newest = Some(newest.map_or(m, |n| n.max(m)));
            }
        }
    }
    newest
}

/// Plugin sources are newer than `so` (needs a rebuild). A missing `so` is newer.
pub fn sources_newer_than(p: &Paths, so: &Path) -> bool {
    let Ok(so_meta) = fs::metadata(so) else { return true };
    let src = p.hypr_src.join("src");
    if !src.is_dir() {
        return false;
    }
    let (Some(newest), Ok(so_t)) = (newest_source_mtime(&src), so_meta.modified()) else { return false };
    newest > so_t
}

/// `so` must not be loaded as-is: missing, sources newer, identity stamp
/// mismatch, or a recorded hash mismatch.
pub fn artifact_fresh(p: &Paths, id: &Identity, so: &Path) -> bool {
    so.is_file() && !sources_newer_than(p, so) && !hash_mismatch_recorded(p) && identity_matches_stamp(p, id)
}

/// Identity changed (or no stamp / mismatch flag): `make` must not relink
/// objects produced against the previous compositor / headers / compiler.
pub fn need_force_rebuild(p: &Paths, id: &Identity) -> bool {
    hash_mismatch_recorded(p) || !identity_matches_stamp(p, id)
}

pub fn invalidate_objects(p: &Paths) {
    let _ = fs::remove_dir_all(p.build_dir.join("obj"));
    let _ = fs::remove_file(p.build_so());
}

/// Unlink the session `.so` (never O_TRUNC), only when that path is not mapped.
pub fn delete_session_so(hc: &dyn Hyprctl, p: &Paths) -> bool {
    if let Some(mapped) = session::loaded_so(hc, &p.hyprctl_instance)
        && Path::new(&mapped) == p.session_so
    {
        return false;
    }
    let _ = fs::remove_file(&p.session_so);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hyprctl::fake::Fake;
    use std::time::Duration;

    fn paths_in(dir: &Path) -> Paths {
        let mut p = Paths::from_env(dir);
        p.build_dir = dir.join("build");
        p.abi_stamp = p.build_dir.join("abi-identity");
        p.abi_hash_mismatch = p.build_dir.join("hash-mismatch");
        p.session_so = dir.join("hypr-shiny-border.so");
        p.hypr_src = dir.to_path_buf();
        p
    }

    fn set_mtime(path: &Path, t: SystemTime) {
        let f = fs::File::options().write(true).open(path).unwrap();
        f.set_modified(t).unwrap();
    }

    fn id() -> Identity {
        Identity { hash: "aaa".into(), header_mtime: "10".into(), compiler: "gcc-1".into() }
    }

    #[test]
    fn identity_text_is_stable() {
        assert_eq!(id().text(), "hash=aaa\nheader_mtime=10\ncompiler=gcc-1\n");
    }

    #[test]
    fn freshness_predicate() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        fs::create_dir_all(p.hypr_src.join("src")).unwrap();
        let main = p.hypr_src.join("src/main.cpp");
        fs::write(&main, "// old").unwrap();
        set_mtime(&main, SystemTime::now() - Duration::from_secs(86_400));
        fs::write(&p.session_so, "SO").unwrap();
        set_mtime(&p.session_so, SystemTime::now() + Duration::from_secs(86_400));
        stamp_write(&p, &id()).unwrap();

        assert!(artifact_fresh(&p, &id(), &p.session_so), "matching identity is fresh");
        assert!(!need_force_rebuild(&p, &id()));

        let other_hash = Identity { hash: "bbb".into(), ..id() };
        assert!(!artifact_fresh(&p, &other_hash, &p.session_so), "compositor hash mismatch is stale");
        assert!(need_force_rebuild(&p, &other_hash));
        let other_hdr = Identity { header_mtime: "99".into(), ..id() };
        assert!(!artifact_fresh(&p, &other_hdr, &p.session_so), "header mtime mismatch is stale");
        let other_cc = Identity { compiler: "gcc-2".into(), ..id() };
        assert!(!artifact_fresh(&p, &other_cc, &p.session_so), "compiler id mismatch is stale");

        record_hash_mismatch(&p).unwrap();
        assert!(!artifact_fresh(&p, &id(), &p.session_so), "recorded hash-mismatch flag is stale");
        assert!(need_force_rebuild(&p, &id()));
        clear_hash_mismatch(&p);
        assert!(artifact_fresh(&p, &id(), &p.session_so), "cleared flag is fresh again");

        set_mtime(&main, SystemTime::now() + Duration::from_secs(2 * 86_400));
        assert!(sources_newer_than(&p, &p.session_so));
        assert!(!artifact_fresh(&p, &id(), &p.session_so), "newer sources are stale");

        assert!(!artifact_fresh(&p, &id(), &dir.path().join("missing.so")));
        assert!(sources_newer_than(&p, &dir.path().join("missing.so")));
    }

    #[test]
    fn no_stamp_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        fs::write(&p.session_so, "SO").unwrap();
        assert!(!artifact_fresh(&p, &id(), &p.session_so));
        assert!(need_force_rebuild(&p, &id()));
    }

    #[test]
    fn invalidate_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths_in(dir.path());
        fs::create_dir_all(p.build_dir.join("obj")).unwrap();
        fs::write(p.build_dir.join("obj/main.o"), "o").unwrap();
        fs::write(p.build_so(), "so").unwrap();
        invalidate_objects(&p);
        assert!(!p.build_dir.join("obj").exists());
        assert!(!p.build_so().exists());

        fs::write(&p.session_so, "SO").unwrap();
        let hc = Fake::up(false);
        assert!(delete_session_so(&hc, &p));
        assert!(!p.session_so.exists());
    }

    #[test]
    fn fixture_env_overrides_probes() {
        // Set only when absent so parallel tests are not disturbed.
        let hc = Fake { version_text: "Version ABI string: live-hash\n".into(), ..Fake::up(false) };
        if env::var_os("HYPR_ABI_COMPOSITOR_HASH").is_none() {
            assert_eq!(compositor_hash(&hc), "live-hash");
        }
    }
}
