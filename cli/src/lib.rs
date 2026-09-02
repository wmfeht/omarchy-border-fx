//! `border-fx`: control plane for the wmfeht.border-fx Omarchy plugin.
//!
//! One binary replaces the bash scripts that used to load the `plugins[]` look
//! from `shell.json`, apply defaults, merge per-effect overrides, coerce and
//! clamp, emit `~/.config/hypr/border-fx.lua`, and build / load / unload the
//! Hyprland window-ring plugin. `Service.qml` (the Quickshell side) calls it
//! through the build-once launcher `scripts/border-fx` and reads the resolved
//! look back off stdout.

pub mod abi;
pub mod apply;
pub mod ctx;
pub mod ensure;
pub mod hyprctl;
pub mod hyprland_lua;
pub mod json;
pub mod look;
pub mod lua;
pub mod paths;
pub mod session;
pub mod shell_json;
pub mod teardown;
pub mod theme;
pub mod timing;

/// The `KEY=value` lines `Service.qml` parses off stdout.
pub mod protocol {
    use serde_json::Value;

    pub fn look_line(look: &Value) -> String {
        format!("LOOK={}", serde_json::to_string(look).unwrap_or_else(|_| "{}".into()))
    }

    /// Empty-entry resolve against the current theme floor. Chrome re-merges
    /// the live `plugins[]` entry against this so a removed user key follows
    /// the preset again instead of sticking at the last LOOK=.
    pub fn base_line(look: &Value) -> String {
        format!("BASE={}", serde_json::to_string(look).unwrap_or_else(|_| "{}".into()))
    }

    pub fn status_line(status: &str) -> String {
        format!("STATUS={status}")
    }

    /// Last `STATUS=` value in `text`. The chrome keys off this, not a substring.
    pub fn parse_status(text: &str) -> Option<&str> {
        text.lines().rev().find_map(|l| l.strip_prefix("STATUS=")).map(|s| s.trim_end_matches('\r'))
    }

    pub const ENSURE_READY: &[&str] = &["ok", "reuse", "hyprpm"];

    pub fn ensure_ready(text: &str) -> bool {
        parse_status(text).is_some_and(|s| ENSURE_READY.contains(&s))
    }

    /// Parse a `LOOK=` line back (used by tests and `status`).
    pub fn parse_look(text: &str) -> Option<Value> {
        text.lines().find_map(|l| l.strip_prefix("LOOK=")).and_then(|j| serde_json::from_str(j).ok())
    }

    pub fn parse_base(text: &str) -> Option<Value> {
        text.lines().find_map(|l| l.strip_prefix("BASE=")).and_then(|j| serde_json::from_str(j).ok())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use serde_json::json;

        #[test]
        fn round_trip() {
            let l = json!({"effect": "shiny", "pinDeg": 120});
            let floor = json!({"effect": "shiny", "pinDeg": 110});
            let text = format!("ensure: log\n{}\n{}\n{}\n", look_line(&l), base_line(&floor), status_line("ok"));
            assert_eq!(parse_look(&text), Some(l));
            assert_eq!(parse_base(&text), Some(floor));
            assert!(text.contains("\nSTATUS=ok\n"));
            assert_eq!(parse_look("STATUS=ok"), None);
            assert_eq!(parse_base("LOOK={\"effect\":\"shiny\"}"), None);
            assert_eq!(parse_status(&text), Some("ok"));
            assert!(ensure_ready(&text));
            assert!(!ensure_ready("STATUS=ok\nSTATUS=load-failed\n"));
            assert!(!ensure_ready("STATUS=okay"));
            assert_eq!(parse_status("STATUS=no-cli"), Some("no-cli"));
        }
    }
}
