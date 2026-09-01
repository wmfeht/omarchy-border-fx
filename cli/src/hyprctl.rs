//! Thin `hyprctl` wrapper. Everything the flows need from the compositor goes
//! through the [`Hyprctl`] trait so ensure / teardown can be driven by a fake
//! in unit tests, while integration tests stub the `hyprctl` binary on `PATH`.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

use crate::paths;

pub struct LoadError {
    pub code: i32,
    pub output: String,
}

pub trait Hyprctl {
    /// `hyprctl` is on PATH.
    fn available(&self) -> bool;
    /// Parsed `hyprctl instances -j`.
    fn instances(&self) -> Option<Value>;
    /// Parsed `hyprctl -i N plugin list -j`.
    fn plugin_list(&self) -> Option<Value>;
    fn plugin_load(&self, so: &Path) -> Result<String, LoadError>;
    fn plugin_unload(&self, so: &Path) -> bool;
    fn eval(&self, lua_src: &str) -> bool;
    /// Raw `hyprctl -i N version` text.
    fn version(&self) -> Option<String>;

    /// PID of the target compositor instance (`.[i].pid // .[0].pid`).
    fn pid(&self, instance: &str) -> Option<u32> {
        let list = self.instances()?;
        let arr = list.as_array()?;
        let idx: usize = instance.parse().unwrap_or(0);
        let entry = arr.get(idx).or_else(|| arr.first())?;
        entry.get("pid").and_then(Value::as_u64).map(|p| p as u32)
    }

    /// True when `plugin list -j` names `plugin_name`.
    fn plugin_listed(&self, plugin_name: &str) -> bool {
        if !self.available() {
            return false;
        }
        self.plugin_list()
            .and_then(|v| v.as_array().cloned())
            .map(|arr| arr.iter().any(|p| p.get("name").and_then(Value::as_str) == Some(plugin_name)))
            .unwrap_or(false)
    }
}

/// Real `hyprctl` against one compositor instance.
pub struct Cli {
    pub instance: String,
}

impl Cli {
    pub fn new(instance: &str) -> Self {
        Self { instance: instance.to_string() }
    }

    fn cmd(&self) -> Command {
        let mut c = Command::new("hyprctl");
        c.arg("-i").arg(&self.instance);
        c
    }

    fn run_json(&self, mut c: Command) -> Option<Value> {
        let out = c.output().ok()?;
        if !out.status.success() {
            return None;
        }
        serde_json::from_slice(&out.stdout).ok()
    }
}

impl Hyprctl for Cli {
    fn available(&self) -> bool {
        paths::which("hyprctl").is_some()
    }

    fn instances(&self) -> Option<Value> {
        if !self.available() {
            return None;
        }
        let mut c = Command::new("hyprctl");
        c.args(["instances", "-j"]);
        self.run_json(c)
    }

    fn plugin_list(&self) -> Option<Value> {
        let mut c = self.cmd();
        c.args(["plugin", "list", "-j"]);
        self.run_json(c)
    }

    fn plugin_load(&self, so: &Path) -> Result<String, LoadError> {
        let out = self
            .cmd()
            .args(["plugin", "load"])
            .arg(so)
            .output()
            .map_err(|e| LoadError { code: 127, output: e.to_string() })?;
        let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
        text.push_str(&String::from_utf8_lossy(&out.stderr));
        if out.status.success() {
            Ok(text)
        } else {
            Err(LoadError { code: out.status.code().unwrap_or(1), output: text })
        }
    }

    fn plugin_unload(&self, so: &Path) -> bool {
        self.cmd().args(["plugin", "unload"]).arg(so).status().map(|s| s.success()).unwrap_or(false)
    }

    fn eval(&self, lua_src: &str) -> bool {
        self.cmd().arg("eval").arg(lua_src).status().map(|s| s.success()).unwrap_or(false)
    }

    fn version(&self) -> Option<String> {
        let out = self.cmd().arg("version").output().ok()?;
        Some(String::from_utf8_lossy(&out.stdout).into_owned())
    }
}

/// `Version ABI string: ...` line of `hyprctl version`.
pub fn abi_string(version_text: &str) -> Option<String> {
    version_text
        .lines()
        .find_map(|l| l.strip_prefix("Version ABI string: "))
        .map(|s| s.trim_end_matches('\r').to_string())
}

/// The load error texts PLUGIN_INIT / Hyprland print on a header/compositor mismatch.
pub fn is_hash_mismatch(output: &str) -> bool {
    let lower = output.to_ascii_lowercase();
    lower.contains("version mismatch") || lower.contains("hash mismatch") || lower.contains("header/compositor hash")
}

#[cfg(test)]
pub mod fake {
    //! Scriptable stand-in for unit tests.
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    #[derive(Default)]
    pub struct Fake {
        pub available: bool,
        pub pid: Option<u32>,
        pub listed: RefCell<bool>,
        pub load_ok: bool,
        pub load_output: String,
        pub unload_ok: bool,
        pub version_text: String,
        pub calls: RefCell<Vec<String>>,
        pub loaded_paths: RefCell<Vec<PathBuf>>,
    }

    impl Fake {
        pub fn up(listed: bool) -> Self {
            Fake {
                available: true,
                pid: None,
                listed: RefCell::new(listed),
                load_ok: true,
                unload_ok: true,
                ..Default::default()
            }
        }
        fn note(&self, s: &str) {
            self.calls.borrow_mut().push(s.to_string());
        }
        pub fn called(&self, needle: &str) -> bool {
            self.calls.borrow().iter().any(|c| c.contains(needle))
        }
    }

    impl Hyprctl for Fake {
        fn available(&self) -> bool {
            self.available
        }
        fn instances(&self) -> Option<Value> {
            self.note("instances");
            Some(match self.pid {
                Some(p) => serde_json::json!([{ "pid": p }]),
                None => serde_json::json!([]),
            })
        }
        fn plugin_list(&self) -> Option<Value> {
            self.note("plugin list");
            Some(if *self.listed.borrow() {
                serde_json::json!([{ "name": paths::PLUGIN_NAME }])
            } else {
                serde_json::json!([])
            })
        }
        fn plugin_load(&self, so: &Path) -> Result<String, LoadError> {
            self.note("plugin load");
            self.loaded_paths.borrow_mut().push(so.to_path_buf());
            if self.load_ok {
                *self.listed.borrow_mut() = true;
                Ok("loaded".into())
            } else {
                Err(LoadError { code: 1, output: self.load_output.clone() })
            }
        }
        fn plugin_unload(&self, _so: &Path) -> bool {
            self.note("plugin unload");
            if self.unload_ok {
                *self.listed.borrow_mut() = false;
            }
            self.unload_ok
        }
        fn eval(&self, src: &str) -> bool {
            self.note(&format!("eval {src}"));
            true
        }
        fn version(&self) -> Option<String> {
            Some(self.version_text.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_string_parses() {
        let v = "Hyprland 0.56.2 built from branch  at commit abc\nVersion ABI string: 0.56.2-abc\r\nTag: v0.56.2";
        assert_eq!(abi_string(v).as_deref(), Some("0.56.2-abc"));
        assert_eq!(abi_string("nothing"), None);
    }

    #[test]
    fn mismatch_detection() {
        assert!(is_hash_mismatch("[shiny-border] version mismatch"));
        assert!(is_hash_mismatch("Header/compositor hash differs"));
        assert!(is_hash_mismatch("HASH MISMATCH"));
        assert!(!is_hash_mismatch("load refused"));
    }

    #[test]
    fn pid_prefers_instance_index() {
        let f = fake::Fake { pid: Some(42), ..fake::Fake::up(false) };
        assert_eq!(f.pid("0"), Some(42));
        assert_eq!(f.pid("7"), Some(42), "falls back to .[0]");
        let none = fake::Fake::up(false);
        assert_eq!(none.pid("0"), None);
    }

    #[test]
    fn listed_requires_availability() {
        let mut f = fake::Fake::up(true);
        assert!(f.plugin_listed(paths::PLUGIN_NAME));
        f.available = false;
        assert!(!f.plugin_listed(paths::PLUGIN_NAME));
    }
}
