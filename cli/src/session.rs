//! Login-session state of the compositor plugin: is it mapped, is it listed,
//! how do we install a new copy without truncating a mapped inode, and how do
//! a detached teardown and a fresh ensure avoid stepping on each other.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::hyprctl::Hyprctl;
use crate::paths::{Paths, SESSION_SO_NAME};
use crate::timing;

/// Path of the mapped `hypr-shiny-border.so` in `maps_text`, if any.
/// `/proc/pid/maps` may suffix ` (deleted)` after unlink; the path is still
/// the live mapping we must not truncate.
pub fn mapped_so_in(maps_text: &str) -> Option<String> {
    for line in maps_text.lines() {
        let Some(hit) = line.find(SESSION_SO_NAME) else { continue };
        let end = hit + SESSION_SO_NAME.len();
        // The path token starts at the last '/' run start before the hit that is
        // preceded by whitespace (or line start).
        let head = &line[..hit];
        let start = head
            .char_indices()
            .filter(|&(i, c)| c == '/' && head[..i].ends_with(|p: char| p.is_whitespace()))
            .map(|(i, _)| i)
            .next_back()
            .or_else(|| head.find('/'))?;
        return Some(line[start..end].to_string());
    }
    None
}

/// Mapped path in the target compositor process, or `None`.
pub fn loaded_so(hc: &dyn Hyprctl, instance: &str) -> Option<String> {
    let pid = hc.pid(instance)?;
    let maps = fs::read_to_string(format!("/proc/{pid}/maps")).ok()?;
    mapped_so_in(&maps)
}

pub fn plugin_mapped(hc: &dyn Hyprctl, instance: &str) -> bool {
    loaded_so(hc, instance).is_some()
}

/// Hyprland is neither listing nor mapping the plugin.
pub fn plugin_gone(hc: &dyn Hyprctl, p: &Paths) -> bool {
    !hc.plugin_listed(&p.plugin_name) && !plugin_mapped(hc, &p.hyprctl_instance)
}

pub fn wait_plugin_gone(hc: &dyn Hyprctl, p: &Paths, timeout: Duration) -> bool {
    timing::wait_until(timeout, timing::UNLOAD_POLL, || plugin_gone(hc, p))
}

/// Install `src` onto `dest` without O_TRUNC of the live inode.
///
/// `cp -f` onto a Hyprland-mapped .so is SIGBUS (BUS_ADRERR) on the next
/// fetch of plugin text. Write a sibling temp and rename: mapped pages keep
/// the old inode.
pub fn install_session_so(src: &Path, dest: &Path) -> std::io::Result<()> {
    let dir = dest.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let stem = dest.file_name().and_then(|n| n.to_str()).unwrap_or(SESSION_SO_NAME);
    let stem = stem.strip_suffix(".so").unwrap_or(stem);
    let tmp = create_sibling_temp(dir, stem)?;
    let result = (|| {
        fs::copy(src, &tmp)?;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
        fs::rename(&tmp, dest)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// `mktemp dir/<stem>.XXXXXX`: a fresh, exclusively created sibling file.
pub fn create_sibling_temp(dir: &Path, stem: &str) -> std::io::Result<PathBuf> {
    for _ in 0..64 {
        let candidate = dir.join(format!("{stem}.{}", random_suffix()));
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(_) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other("could not create a unique temp file"))
}

fn random_suffix() -> String {
    use std::hash::{BuildHasher, Hasher, RandomState};
    let mut h = RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.write_u32(std::process::id());
    let v = h.finish();
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    (0..6).map(|i| ALPHA[((v >> (i * 6)) as usize) % ALPHA.len()] as char).collect()
}

/// Write `contents` to `path` atomically (temp sibling + rename).
pub fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    {
        let mut f = File::create(&tmp)?;
        f.write_all(contents)?;
    }
    fs::rename(&tmp, path)
}

/// Exclusive flock for the whole ensure / teardown critical section so a
/// detached disable teardown cannot unload after this ensure has loaded.
pub struct SessionLock {
    _file: File,
}

impl SessionLock {
    pub fn acquire(path: &Path) -> std::io::Result<SessionLock> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        file.lock()?;
        Ok(SessionLock { _file: file })
    }
}

/// Ensure generation counter: teardown reads it before taking the lock and
/// skips if an ensure bumped it in between (the enable won the race).
pub fn ensure_gen(path: &Path) -> u64 {
    fs::read_to_string(path).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

pub fn bump_ensure_gen(path: &Path) -> std::io::Result<()> {
    let n = ensure_gen(path);
    write_atomic(path, format!("{}\n", n + 1).as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hyprctl::fake::Fake;
    use std::io::{Read, Seek, SeekFrom};

    #[test]
    fn maps_parsing() {
        let maps = "7f00-7f01 r-xp 00000000 08:01 123 /home/u/.local/lib/hypr/hypr-shiny-border.so\n";
        assert_eq!(mapped_so_in(maps).as_deref(), Some("/home/u/.local/lib/hypr/hypr-shiny-border.so"));
        let deleted = "7f00-7f01 r-xp 00000000 08:01 123 /run/user/1000/x/hypr-shiny-border.so (deleted)\n";
        assert_eq!(mapped_so_in(deleted).as_deref(), Some("/run/user/1000/x/hypr-shiny-border.so"));
        let none = "7f00-7f01 r-xp 00000000 08:01 123 /usr/lib/libc.so.6\n";
        assert_eq!(mapped_so_in(none), None);
        let hyprpm = "7f00 r-xp 0 0 0 /home/u/.local/share/hyprpm/repo/hypr-shiny-border.so\n7f01 r-xp 0 0 0 /x/hypr-shiny-border.so\n";
        assert!(mapped_so_in(hyprpm).unwrap().contains("hyprpm"));
    }

    #[test]
    fn install_renames_a_new_inode() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("hypr-shiny-border.so");
        let src = dir.path().join("new.so");
        fs::write(&dest, "OLDINODE").unwrap();
        fs::write(&src, "NEWINODE-CONTENT").unwrap();
        let mut old = File::open(&dest).unwrap();
        let old_ino = std::os::unix::fs::MetadataExt::ino(&old.metadata().unwrap());

        install_session_so(&src, &dest).unwrap();

        let new_ino = std::os::unix::fs::MetadataExt::ino(&fs::metadata(&dest).unwrap());
        assert_ne!(old_ino, new_ino, "no O_TRUNC of the mapped inode");
        assert_eq!(fs::read_to_string(&dest).unwrap(), "NEWINODE-CONTENT");
        let mut buf = String::new();
        old.seek(SeekFrom::Start(0)).unwrap();
        old.read_to_string(&mut buf).unwrap();
        assert_eq!(buf, "OLDINODE", "open fd still sees the old inode");
        assert_eq!(fs::metadata(&dest).unwrap().permissions().mode() & 0o777, 0o755);
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n.starts_with("hypr-shiny-border.") && n != "hypr-shiny-border.so")
            .collect();
        assert!(leftovers.is_empty(), "no leftover temp installs: {leftovers:?}");
    }

    #[test]
    fn install_missing_source_cleans_temp() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("hypr-shiny-border.so");
        assert!(install_session_so(&dir.path().join("nope.so"), &dest).is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn gen_counter() {
        let dir = tempfile::tempdir().unwrap();
        let g = dir.path().join("sub/hypr-ensure.gen");
        assert_eq!(ensure_gen(&g), 0);
        bump_ensure_gen(&g).unwrap();
        bump_ensure_gen(&g).unwrap();
        assert_eq!(ensure_gen(&g), 2);
        fs::write(&g, "junk").unwrap();
        assert_eq!(ensure_gen(&g), 0);
    }

    #[test]
    fn lock_is_exclusive_across_handles() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hypr-session.lock");
        let held = SessionLock::acquire(&path).unwrap();
        let other = OpenOptions::new().create(true).append(true).open(&path).unwrap();
        assert!(matches!(other.try_lock(), Err(std::fs::TryLockError::WouldBlock)));
        drop(held);
        assert!(other.try_lock().is_ok());
    }

    #[test]
    fn wait_plugin_gone_with_fake() {
        let p = Paths::from_env(Path::new("."));
        let gone = Fake::up(false);
        assert!(wait_plugin_gone(&gone, &p, Duration::from_millis(300)));
        let stuck = Fake::up(true);
        assert!(!wait_plugin_gone(&stuck, &p, Duration::from_millis(300)));
        assert!(stuck.called("plugin list"));
    }

    #[test]
    fn write_atomic_creates_parents() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a/b/c.txt");
        write_atomic(&f, b"hi").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "hi");
        assert_eq!(fs::read_dir(dir.path().join("a/b")).unwrap().count(), 1);
    }
}
