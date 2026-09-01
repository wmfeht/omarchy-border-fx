//! Read the user's current Omarchy theme. This is the input a theme-following
//! mode will turn into a look [`crate::look::Base`] layer (opinionated presets
//! for stock themes keyed by [`Theme::name`], derived colors for the rest).
//! Today the CLI only exposes it (`border-fx theme`); nothing in the look
//! pipeline consumes it yet.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::paths::Paths;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Theme {
    /// Directory name, e.g. `tokyo-night`.
    pub name: String,
    /// Where `colors.toml` was read from.
    pub dir: PathBuf,
    /// Flat `key = "#rrggbb"` map from `colors.toml` (only string values).
    pub colors: BTreeMap<String, String>,
    pub mode: Option<String>,
}

/// `~/.local/state/omarchy/current/theme.name`, trimmed. `None` if unset.
pub fn current_name(p: &Paths) -> Option<String> {
    let text = fs::read_to_string(p.state_home.join("omarchy/current/theme.name")).ok()?;
    let name = text.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// Candidate directories holding `<name>`'s files, most preferred first: the
/// staged copy Omarchy activates (only when `name` is the current theme), the
/// user's own theme, then the system one.
pub fn candidate_dirs(p: &Paths, name: &str) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if current_name(p).as_deref() == Some(name) {
        dirs.push(p.state_home.join("omarchy/current/theme"));
    }
    dirs.push(p.home.join(".config/omarchy/themes").join(name));
    if let Some(root) = std::env::var_os("OMARCHY_PATH").filter(|v| !v.is_empty()) {
        dirs.push(PathBuf::from(root).join("themes").join(name));
    }
    dirs.push(Path::new("/usr/share/omarchy/themes").join(name));
    dirs
}

pub fn parse_colors(toml_text: &str) -> Result<(BTreeMap<String, String>, Option<String>), String> {
    let table: toml::Table = toml_text.parse().map_err(|e| format!("colors.toml: {e}"))?;
    let mut colors = BTreeMap::new();
    let mut mode = None;
    for (k, v) in table {
        let Some(s) = v.as_str() else { continue };
        if k == "mode" {
            mode = Some(s.to_string());
        } else {
            colors.insert(k, s.to_string());
        }
    }
    Ok((colors, mode))
}

pub fn load(p: &Paths, name: &str) -> Result<Theme, String> {
    for dir in candidate_dirs(p, name) {
        let file = dir.join("colors.toml");
        if !file.is_file() {
            continue;
        }
        let text = fs::read_to_string(&file).map_err(|e| format!("{}: {e}", file.display()))?;
        let (colors, mode) = parse_colors(&text)?;
        return Ok(Theme { name: name.to_string(), dir, colors, mode });
    }
    Err(format!("no colors.toml found for theme '{name}'"))
}

pub fn current(p: &Paths) -> Result<Theme, String> {
    let name = current_name(p).ok_or_else(|| "no current theme (theme.name missing)".to_string())?;
    load(p, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKYO: &str = r##"
mode = "dark"

accent = "#7aa2f7"
background = "#1a1b26"
foreground = "#a9b1d6"
bright_blue = "#7da6ff"
"##;

    #[test]
    fn parses_colors_toml() {
        let (colors, mode) = parse_colors(TOKYO).unwrap();
        assert_eq!(mode.as_deref(), Some("dark"));
        assert_eq!(colors["accent"], "#7aa2f7");
        assert_eq!(colors["bright_blue"], "#7da6ff");
        assert!(!colors.contains_key("mode"));
        assert!(parse_colors("not = = toml").is_err());
    }

    #[test]
    fn loads_current_theme_from_state() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = Paths::from_env(dir.path());
        p.home = dir.path().join("home");
        p.state_home = dir.path().join("state");
        let state = p.state_home.join("omarchy/current");
        fs::create_dir_all(state.join("theme")).unwrap();
        fs::write(state.join("theme.name"), "tokyo-night\n").unwrap();
        fs::write(state.join("theme/colors.toml"), TOKYO).unwrap();

        assert_eq!(current_name(&p).as_deref(), Some("tokyo-night"));
        let t = current(&p).unwrap();
        assert_eq!(t.name, "tokyo-night");
        assert_eq!(t.colors["accent"], "#7aa2f7");
        assert_eq!(t.dir, state.join("theme"));

        // User theme dir is the fallback when the staged copy is gone.
        fs::remove_file(state.join("theme/colors.toml")).unwrap();
        let user = p.home.join(".config/omarchy/themes/tokyo-night");
        fs::create_dir_all(&user).unwrap();
        fs::write(user.join("colors.toml"), "accent = \"#000000\"\n").unwrap();
        let t = current(&p).unwrap();
        assert_eq!(t.dir, user);
        assert_eq!(t.colors["accent"], "#000000");

        fs::write(state.join("theme.name"), "\n").unwrap();
        assert!(current(&p).is_err());
    }

    #[test]
    fn missing_theme_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = Paths::from_env(dir.path());
        p.home = dir.path().to_path_buf();
        p.state_home = dir.path().join("state");
        assert!(load(&p, "nope-not-a-theme-xyz").is_err());
    }
}
