//! Every path and id the control plane touches, resolved once from the
//! environment. The same variable names the bash scripts honored still work,
//! so a test harness can redirect everything into a temp tree.
//!
//! No sudo. User-level only.

use std::env;
use std::path::{Path, PathBuf};

pub const PLUGIN_ID: &str = "wmfeht.border-fx";
pub const LEGACY_PLUGIN_ID: &str = "qs.border-fx";
pub const OLDER_LEGACY_PLUGIN_ID: &str = "qs.shiny-border";
/// Compositor plugin that implements the shiny / ripple window ring. Not the
/// Omarchy config id.
pub const PLUGIN_NAME: &str = "hypr-shiny-border";
pub const SESSION_SO_NAME: &str = "hypr-shiny-border.so";

#[derive(Debug, Clone)]
pub struct Paths {
    pub plugin_id: String,
    pub legacy_plugin_id: String,
    pub older_legacy_plugin_id: String,
    pub plugin_name: String,
    pub home: PathBuf,
    pub config_home: PathBuf,
    pub cache_home: PathBuf,
    pub state_home: PathBuf,
    pub runtime_dir: PathBuf,
    /// Clone root of this plugin (what `omarchy plugin add` installs).
    pub plugin_root: PathBuf,
    pub hypr_src: PathBuf,
    pub session_so: PathBuf,
    pub lua_file: PathBuf,
    pub legacy_lua_file: PathBuf,
    pub lua_module: String,
    pub hyprland_lua: PathBuf,
    pub build_dir: PathBuf,
    pub abi_stamp: PathBuf,
    pub abi_hash_mismatch: PathBuf,
    pub hyprctl_instance: String,
    pub session_lock: PathBuf,
    pub session_gen: PathBuf,
    /// Omarchy shell always reads `~/.config/omarchy/shell.json` (not XDG_CONFIG_HOME).
    pub shell_json: PathBuf,
    pub plugins_home: PathBuf,
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn env_str(name: &str, default: &str) -> String {
    env::var(name).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}

fn uid() -> u32 {
    // /proc/self/status has "Uid:\t<real>\t<effective>..." on every Linux.
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("Uid:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(0)
}

impl Paths {
    /// Resolve from the environment. `plugin_root` is `BORDER_FX_ROOT` (set by
    /// the `scripts/border-fx` launcher), else `PLUGIN_ROOT`, else the given
    /// fallback (usually the current directory).
    pub fn from_env(root_fallback: &Path) -> Paths {
        let home = env_path("HOME").unwrap_or_else(|| PathBuf::from("/"));
        let config_home = env_path("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
        let cache_home = env_path("XDG_CACHE_HOME").unwrap_or_else(|| home.join(".cache"));
        let state_home = env_path("XDG_STATE_HOME").unwrap_or_else(|| home.join(".local/state"));
        let runtime_dir = env_path("XDG_RUNTIME_DIR").unwrap_or_else(|| PathBuf::from(format!("/run/user/{}", uid())));
        let plugin_root = env_path("BORDER_FX_ROOT")
            .or_else(|| env_path("PLUGIN_ROOT"))
            .unwrap_or_else(|| root_fallback.to_path_buf());
        let build_dir = env_path("BUILD_DIR").unwrap_or_else(|| cache_home.join("omarchy-border-fx"));
        let hypr_dir = config_home.join("hypr");
        Paths {
            plugin_id: env_str("PLUGIN_ID", PLUGIN_ID),
            legacy_plugin_id: env_str("LEGACY_PLUGIN_ID", LEGACY_PLUGIN_ID),
            older_legacy_plugin_id: env_str("OLDER_LEGACY_PLUGIN_ID", OLDER_LEGACY_PLUGIN_ID),
            plugin_name: env_str("PLUGIN_NAME", PLUGIN_NAME),
            hypr_src: env_path("HYPR_SRC").unwrap_or_else(|| plugin_root.join("hypr")),
            session_so: env_path("SESSION_SO").unwrap_or_else(|| home.join(".local/lib/hypr").join(SESSION_SO_NAME)),
            lua_file: env_path("LUA_FILE").unwrap_or_else(|| hypr_dir.join("border-fx.lua")),
            legacy_lua_file: env_path("LEGACY_LUA_FILE").unwrap_or_else(|| hypr_dir.join("shiny-border.lua")),
            lua_module: env_str("LUA_MODULE", "hypr.border-fx"),
            hyprland_lua: env_path("HYPRLAND_LUA").unwrap_or_else(|| hypr_dir.join("hyprland.lua")),
            abi_stamp: env_path("HYPR_ABI_STAMP").unwrap_or_else(|| build_dir.join("abi-identity")),
            abi_hash_mismatch: env_path("HYPR_ABI_HASH_MISMATCH").unwrap_or_else(|| build_dir.join("hash-mismatch")),
            hyprctl_instance: env_str("SHINY_INSTANCE", "0"),
            session_lock: env_path("HYPR_SESSION_LOCK")
                .unwrap_or_else(|| runtime_dir.join("omarchy-border-fx/hypr-session.lock")),
            session_gen: env_path("HYPR_SESSION_GEN")
                .unwrap_or_else(|| runtime_dir.join("omarchy-border-fx/hypr-ensure.gen")),
            shell_json: env_path("OMARCHY_SHELL_JSON").unwrap_or_else(|| home.join(".config/omarchy/shell.json")),
            plugins_home: home.join(".config/omarchy/plugins"),
            build_dir,
            plugin_root,
            home,
            config_home,
            cache_home,
            state_home,
            runtime_dir,
        }
    }

    /// Ids to look for in `shell.json`, most preferred first.
    pub fn plugin_ids(&self) -> [&str; 3] {
        [&self.plugin_id, &self.legacy_plugin_id, &self.older_legacy_plugin_id]
    }

    pub fn build_so(&self) -> PathBuf {
        self.build_dir.join(SESSION_SO_NAME)
    }

    pub fn tree_so(&self) -> PathBuf {
        self.hypr_src.join(SESSION_SO_NAME)
    }

    /// Where `omarchy plugin add` puts this plugin.
    pub fn installed_dir(&self, id: &str) -> PathBuf {
        self.plugins_home.join(id)
    }
}

/// First executable named `name` on `PATH`, like `command -v`.
pub fn which(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for dir in env::split_paths(&path) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let candidate = dir.join(name);
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

pub fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_finds_sh() {
        assert!(which("sh").is_some());
        assert!(which("definitely-not-a-binary-xyz").is_none());
    }

    #[test]
    fn defaults_derive_from_home() {
        // Only checks derivation logic; env is process-global so avoid mutating it.
        let p = Paths::from_env(Path::new("/tmp/root"));
        assert!(p.session_so.ends_with("hypr-shiny-border.so"));
        assert!(p.lua_file.ends_with("hypr/border-fx.lua"));
        assert_eq!(p.plugin_ids()[0], p.plugin_id);
        assert!(p.build_so().ends_with(SESSION_SO_NAME));
        assert!(p.installed_dir("x.y").ends_with(".config/omarchy/plugins/x.y"));
    }
}
