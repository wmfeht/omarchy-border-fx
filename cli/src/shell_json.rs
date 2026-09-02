//! Snapshot / restore the plugin's `plugins[]` look in `shell.json`.
//!
//! `omarchy plugin disable` / `remove` splice the whole `plugins[]` entry (look
//! keys included), and `enable` then writes `{ "id": ... }` only. `dev/plugin.sh`
//! keeps the look itself via `shell-look snapshot` / `restore`.

use std::fs;
use std::path::Path;

use serde_json::{Map, Value};

use crate::ctx;
use crate::session;

/// The plugin's entry (preferring the current id over legacy ids), or `None`.
pub fn snapshot_from(config: &Value, ids: &[&str]) -> Option<Value> {
    let plugins = config.get("plugins")?.as_array()?;
    ids.iter().find_map(|id| {
        plugins.iter().find(|e| e.is_object() && e.get("id").and_then(Value::as_str) == Some(id)).cloned()
    })
}

pub fn snapshot(shell_json: &Path, ids: &[&str]) -> Option<Value> {
    let text = fs::read_to_string(shell_json).ok()?;
    let config: Value = serde_json::from_str(&text).ok()?;
    snapshot_from(&config, ids)
}

/// Merge `saved` (a plugin-entry object) onto `plugins[]`: rewrite `id` to
/// `ids[0]`, replace an existing entry or append, and drop leftover legacy ids.
pub fn restore_into(config: &mut Value, saved: &Value, ids: &[&str]) {
    let Some(saved_obj) = saved.as_object() else { return };
    let current = ids[0];
    let mut entry = saved_obj.clone();
    entry.insert("id".into(), Value::String(current.to_string()));
    let entry = Value::Object(entry);

    if !config.is_object() {
        *config = Value::Object(Map::new());
    }
    let root = config.as_object_mut().expect("object");
    let mut plugins = match root.remove("plugins") {
        Some(Value::Array(a)) => a,
        _ => Vec::new(),
    };
    let mut replaced = false;
    plugins = plugins
        .into_iter()
        .filter_map(|e| {
            let id = e.get("id").and_then(Value::as_str);
            match id {
                Some(i) if e.is_object() && i == current => {
                    replaced = true;
                    Some(entry.clone())
                }
                Some(i) if e.is_object() && ids[1..].contains(&i) => None,
                _ => Some(e),
            }
        })
        .collect();
    if !replaced {
        plugins.push(entry);
    }
    root.insert("plugins".into(), Value::Array(plugins));
}

/// No-op if `saved` is empty / not an object, or `shell.json` is missing (never
/// invent a whole shell.json).
pub fn restore(shell_json: &Path, saved: Option<&Value>, ids: &[&str]) -> Result<bool, String> {
    let Some(saved) = saved else { return Ok(false) };
    let Some(obj) = saved.as_object() else {
        eprintln!("look snapshot is not an object; skipping restore");
        return Ok(false);
    };
    if obj.is_empty() {
        return Ok(false);
    }
    if !shell_json.is_file() {
        eprintln!("shell.json missing; not restoring look");
        return Ok(false);
    }
    let text = fs::read_to_string(shell_json).map_err(|e| e.to_string())?;
    let mut config: Value = serde_json::from_str(&text).map_err(|e| format!("shell.json is not valid JSON: {e}"))?;
    restore_into(&mut config, saved, ids);
    let mut out = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    out.push('\n');
    session::write_atomic(shell_json, out.as_bytes()).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Parse a snapshot string as produced by `snapshot`; empty / `null` / `{}` is `None`.
pub fn parse_snapshot(text: &str) -> Result<Option<Value>, String> {
    let t = text.trim();
    if t.is_empty() || t == "null" || t == "{}" {
        return Ok(None);
    }
    let v: Value = serde_json::from_str(t).map_err(|e| format!("invalid snapshot JSON: {e}"))?;
    Ok(Some(v))
}

pub fn reload_shell() {
    if crate::paths::which("omarchy-shell").is_some() {
        ctx::run_quiet("omarchy-shell", &["shell", "reloadConfig"]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const IDS: [&str; 3] = ["wmfeht.border-fx", "qs.border-fx", "qs.shiny-border"];

    #[test]
    fn snapshot_prefers_current_then_legacy() {
        let cfg = json!({"plugins": [
            {"id": "qs.shiny-border", "pinDeg": 1},
            {"id": "qs.border-fx", "pinDeg": 30},
            {"id": "wmfeht.border-fx", "pinDeg": 105}
        ]});
        assert_eq!(snapshot_from(&cfg, &IDS).unwrap()["pinDeg"], 105);
        let legacy = json!({"plugins": [{"id": "qs.border-fx", "pinDeg": 30, "shimmer": false}]});
        assert_eq!(snapshot_from(&legacy, &IDS).unwrap()["pinDeg"], 30);
        assert!(snapshot_from(&json!({"plugins": []}), &IDS).is_none());
        assert!(snapshot_from(&json!({}), &IDS).is_none());
        assert!(snapshot_from(&json!({"plugins": ["junk"]}), &IDS).is_none());
    }

    #[test]
    fn restore_replaces_and_keeps_others() {
        let mut cfg = json!({
            "version": 1,
            "bar": {"layout": {"left": [{"id": "omarchy.menu"}]}},
            "plugins": [{"id": "other.plugin", "keep": true}, {"id": "wmfeht.border-fx"}]
        });
        let saved = json!({"id": "wmfeht.border-fx", "pinDeg": 105, "lobe": 0.1, "mirror": true,
            "gradient": ["rgba(ffffffff)", "rgba(ff0000ff)"], "gradientPositions": "0 10 99"});
        restore_into(&mut cfg, &saved, &IDS);
        let plugins = cfg["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[0]["keep"], true);
        assert_eq!(plugins[1]["pinDeg"], 105);
        assert_eq!(plugins[1]["mirror"], true);
        assert_eq!(plugins[1]["gradient"][0], "rgba(ffffffff)");
        assert_eq!(cfg["bar"]["layout"]["left"][0]["id"], "omarchy.menu");
    }

    #[test]
    fn restore_remaps_legacy_and_appends() {
        let mut cfg = json!({"version": 1, "plugins": []});
        let saved = json!({"id": "qs.border-fx", "pinDeg": 30, "shimmer": false});
        restore_into(&mut cfg, &saved, &IDS);
        let plugins = cfg["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0]["id"], "wmfeht.border-fx");
        assert_eq!(plugins[0]["pinDeg"], 30);
        assert_eq!(plugins[0]["shimmer"], false);

        let mut with_legacy = json!({"plugins": [{"id": "qs.shiny-border", "x": 1}, {"id": "qs.border-fx", "x": 2}]});
        restore_into(&mut with_legacy, &saved, &IDS);
        let plugins = with_legacy["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 1, "legacy ids are dropped");
        assert_eq!(plugins[0]["id"], "wmfeht.border-fx");

        let mut no_plugins = json!({"version": 1});
        restore_into(&mut no_plugins, &saved, &IDS);
        assert_eq!(no_plugins["plugins"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn restore_file_semantics() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("shell.json");
        // Missing shell.json: never invented.
        assert!(!restore(&f, Some(&json!({"id": "x", "pinDeg": 1})), &IDS).unwrap());
        assert!(!f.exists());

        fs::write(&f, "{\"version\":1,\"plugins\":[{\"id\":\"wmfeht.border-fx\"}]}\n").unwrap();
        assert!(!restore(&f, None, &IDS).unwrap());
        assert!(!restore(&f, Some(&json!({})), &IDS).unwrap());
        assert!(!restore(&f, Some(&json!("str")), &IDS).unwrap());
        let cfg: Value = serde_json::from_str(&fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(cfg["plugins"][0].as_object().unwrap().len(), 1, "empty restore does not invent look keys");

        assert!(restore(&f, Some(&json!({"id": "wmfeht.border-fx", "pinDeg": 9})), &IDS).unwrap());
        let cfg: Value = serde_json::from_str(&fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(cfg["plugins"][0]["pinDeg"], 9);
        assert!(fs::read_to_string(&f).unwrap().ends_with("}\n"));
        assert!(snapshot(&f, &IDS).is_some());
        assert!(snapshot(&dir.path().join("missing.json"), &IDS).is_none());
    }

    #[test]
    fn snapshot_parsing() {
        assert_eq!(parse_snapshot("").unwrap(), None);
        assert_eq!(parse_snapshot("null").unwrap(), None);
        assert_eq!(parse_snapshot(" {} ").unwrap(), None);
        assert_eq!(parse_snapshot("{\"a\":1}").unwrap(), Some(json!({"a": 1})));
        assert!(parse_snapshot("{").is_err());
    }
}
