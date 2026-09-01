//! Keep `~/.config/hypr/hyprland.lua` requiring the generated module once, and
//! neutralize a live legacy `hypr.shiny-border` require. Comments, other
//! requires, and user notes that merely mention the legacy module are left alone.

use std::fs;
use std::path::Path;

use crate::session;

pub const LEGACY_MODULE: &str = "hypr.shiny-border";

/// Code part of a line: leading whitespace stripped, trailing ` -- comment` removed.
fn code_of(line: &str) -> &str {
    let lead = line.trim_start();
    if lead.starts_with("--") {
        return "";
    }
    // `sub(/[ \t]+--.*$/, "", code)`: a comment must be preceded by whitespace.
    let mut code = line;
    let bytes = line.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'-' && bytes[i + 1] == b'-' && i > 0 && (bytes[i - 1] == b' ' || bytes[i - 1] == b'\t') {
            let mut j = i;
            while j > 0 && (bytes[j - 1] == b' ' || bytes[j - 1] == b'\t') {
                j -= 1;
            }
            code = &line[..j];
            break;
        }
        i += 1;
    }
    code.trim_end_matches('\r')
}

fn skip_ws(s: &str) -> &str {
    s.trim_start_matches([' ', '\t'])
}

fn strip_quoted<'a>(s: &'a str, want: &str) -> Option<&'a str> {
    for q in ['"', '\''] {
        if let Some(rest) = s.strip_prefix(q)
            && let Some(rest) = rest.strip_prefix(want)
            && let Some(rest) = rest.strip_prefix(q)
        {
            return Some(rest);
        }
    }
    None
}

fn only_ws(s: &str) -> bool {
    s.chars().all(|c| c == ' ' || c == '\t' || c == '\r')
}

/// A line whose code is exactly one of:
/// `pcall(require, "hypr.shiny-border")`, `require("hypr.shiny-border")`,
/// `require "hypr.shiny-border"` (either quote, any interior whitespace).
pub fn is_live_legacy_require(line: &str) -> bool {
    let code = skip_ws(code_of(line));
    if code.is_empty() {
        return false;
    }
    // pcall ( require , "mod" )
    if let Some(rest) = code.strip_prefix("pcall") {
        let rest = skip_ws(rest);
        let Some(rest) = rest.strip_prefix('(') else { return false };
        let rest = skip_ws(rest);
        let Some(rest) = rest.strip_prefix("require") else { return false };
        let rest = skip_ws(rest);
        let Some(rest) = rest.strip_prefix(',') else { return false };
        let rest = skip_ws(rest);
        let Some(rest) = strip_quoted(rest, LEGACY_MODULE) else { return false };
        let rest = skip_ws(rest);
        let Some(rest) = rest.strip_prefix(')') else { return false };
        return only_ws(rest);
    }
    if let Some(rest) = code.strip_prefix("require") {
        let after = skip_ws(rest);
        if let Some(inner) = after.strip_prefix('(') {
            let inner = skip_ws(inner);
            let Some(rest) = strip_quoted(inner, LEGACY_MODULE) else { return false };
            let rest = skip_ws(rest);
            let Some(rest) = rest.strip_prefix(')') else { return false };
            return only_ws(rest);
        }
        // `require "mod"` needs at least one space.
        if rest.starts_with([' ', '\t'])
            && let Some(rest) = strip_quoted(after, LEGACY_MODULE)
        {
            return only_ws(rest);
        }
    }
    false
}

/// Text to append when the module is not mentioned yet.
pub fn require_block(plugin_id: &str, module: &str) -> String {
    format!(
        "\n-- {plugin_id} (Omarchy plugin control plane; pcall if the file is missing)\npcall(require, \"{module}\")\n"
    )
}

/// Pure rewrite: returns the new contents, or `None` if nothing changes.
pub fn rewrite(contents: &str, plugin_id: &str, module: &str) -> Option<String> {
    let mut text = contents.to_string();
    if !text.contains(module) {
        text.push_str(&require_block(plugin_id, module));
    }
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let (body, nl) = match line.strip_suffix('\n') {
            Some(b) => (b, "\n"),
            None => (line, ""),
        };
        if is_live_legacy_require(body) {
            out.push_str("-- ");
        }
        out.push_str(body);
        out.push_str(nl);
    }
    if out == contents { None } else { Some(out) }
}

/// Apply [`rewrite`] to `hyprland_lua` if that file exists.
pub fn ensure_require(hyprland_lua: &Path, plugin_id: &str, module: &str) -> std::io::Result<()> {
    if !hyprland_lua.is_file() {
        return Ok(());
    }
    let contents = fs::read_to_string(hyprland_lua)?;
    if let Some(new) = rewrite(&contents, plugin_id, module) {
        session::write_atomic(hyprland_lua, new.as_bytes())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_detection() {
        assert!(is_live_legacy_require("pcall(require, \"hypr.shiny-border\")"));
        assert!(is_live_legacy_require("  pcall( require , 'hypr.shiny-border' )  -- trailing"));
        assert!(is_live_legacy_require("require(\"hypr.shiny-border\")\r"));
        assert!(is_live_legacy_require("require 'hypr.shiny-border'"));
        assert!(!is_live_legacy_require("-- pcall(require, \"hypr.shiny-border\")"));
        assert!(!is_live_legacy_require("  -- require(\"hypr.shiny-border\")"));
        assert!(!is_live_legacy_require("require(\"hypr.border-fx\")"));
        assert!(!is_live_legacy_require("pcall(require, \"hypr.shiny-border\").x"));
        assert!(!is_live_legacy_require("local x = require(\"hypr.shiny-border\")"));
        assert!(!is_live_legacy_require("-- note: we used to mention hypr.shiny-border in comments"));
        assert!(!is_live_legacy_require("require\"hypr.shiny-border\""));
    }

    #[test]
    fn rewrite_appends_and_comments() {
        let fixture = [
            "-- user hyprland.lua",
            "require(\"hypr.binds\")",
            "-- note: we used to mention hypr.shiny-border in comments; keep this",
            "pcall(require, \"hypr.shiny-border\")",
            "hl.bind({ mods = \"SUPER\", key = \"Q\", dispatcher = \"killactive\" })",
            "",
        ]
        .join("\n");
        let out = rewrite(&fixture, "wmfeht.border-fx", "hypr.border-fx").unwrap();
        assert!(out.contains("require(\"hypr.binds\")"));
        assert!(out.contains("-- note: we used to mention hypr.shiny-border in comments; keep this"));
        assert!(out.contains("-- pcall(require, \"hypr.shiny-border\")"));
        assert!(out.contains("pcall(require, \"hypr.border-fx\")"));
        assert!(!out.lines().any(is_live_legacy_require));
        assert!(out.contains("-- wmfeht.border-fx (Omarchy plugin control plane; pcall if the file is missing)"));
        assert_eq!(rewrite(&out, "wmfeht.border-fx", "hypr.border-fx"), None, "idempotent");
    }

    #[test]
    fn rewrite_without_trailing_newline() {
        let out = rewrite("require(\"x\")", "id", "hypr.border-fx").unwrap();
        assert!(out.starts_with("require(\"x\")\n-- id"));
        assert!(out.ends_with("pcall(require, \"hypr.border-fx\")\n"));
    }

    #[test]
    fn missing_file_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("hyprland.lua");
        ensure_require(&f, "id", "hypr.border-fx").unwrap();
        assert!(!f.exists());
        fs::write(&f, "a = 1\n").unwrap();
        ensure_require(&f, "id", "hypr.border-fx").unwrap();
        assert!(fs::read_to_string(&f).unwrap().contains("pcall(require, \"hypr.border-fx\")"));
    }
}
