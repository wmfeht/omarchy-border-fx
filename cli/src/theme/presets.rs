//! Opinionated look presets for stock Omarchy themes, keyed by directory
//! name (`tokyo-night`, not "Tokyo Night"). Anything a preset does not name
//! stays on the shared defaults; user keys in `shell.json` still win.

use serde_json::{Map, Value, json};

fn object(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// Look-key overrides for `name`, or `None` to keep the shared defaults.
pub fn for_name(name: &str) -> Option<Map<String, Value>> {
    match name {
        "tokyo-night" => Some(tokyo_night()),
        "osaka-jade" => Some(osaka_jade()),
        _ => None,
    }
}

/// Tokyo Night stock look. Ramp colors are the theme palette: bright
/// foreground, bright blue, accent, bright magenta, fading to background;
/// wrap stroke is `selection`.
fn tokyo_night() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 110,
        "lobe": 0.08,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(c0caf5ff)",
            "rgba(7da6fff0)",
            "rgba(7aa2f7a0)",
            "rgba(bb9af740)",
            "rgba(1a1b2600)"
        ],
        "gradientPositions": "0 10 28 60 100",
        "baseColor": "rgba(292e42dd)",
        "shimmer": true,
        "shimmerHz": 0.35,
        "shimmerDeg": 12,
        "shimmerScaleMin": 0.9,
        "shimmerScaleMax": 1.15,
        "activeOnly": true
    }))
}

/// Osaka Jade stock look. Ramp colors are the theme palette: bright
/// foreground, bright cyan, cyan, accent, fading to selection; wrap
/// stroke is `selection`. Same shimmer walk as Tokyo Night.
fn osaka_jade() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 120,
        "lobe": 0.24,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(f7e8b2c8)",
            "rgba(8cd3cbc0)",
            "rgba(2dd5b788)",
            "rgba(50947560)",
            "rgba(32473b00)"
        ],
        "gradientPositions": "0 18 42 70 100",
        "baseColor": "rgba(32473bdd)",
        "shimmer": true,
        "shimmerHz": 0.35,
        "shimmerDeg": 12,
        "shimmerScaleMin": 0.9,
        "shimmerScaleMax": 1.15,
        "activeOnly": true
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::look::{self, color, schema};

    fn stock() -> [(&'static str, Map<String, Value>); 2] {
        [("tokyo-night", tokyo_night()), ("osaka-jade", osaka_jade())]
    }

    fn assert_valid(name: &str, preset: &Map<String, Value>) {
        assert!(!preset.is_empty(), "{name}: empty preset");
        for key in preset.keys() {
            assert!(key == "effect" || schema::spec(key).is_some(), "{name}: unknown look key {key:?}");
        }

        let (look, warn) = look::resolve_shared(&Value::Object(preset.clone()));
        assert!(warn.0.is_empty(), "{name}: {}", warn.0.join("; "));
        assert!(!look.is_empty(), "{name}: resolve produced an empty look");

        for (key, value) in preset {
            let Some(spec) = schema::spec(key) else { continue };
            match spec.kind {
                schema::Kind::Color => {
                    assert!(color::parse(value).is_some(), "{name}: {key} is not a color ({value})");
                }
                schema::Kind::ColorList => {
                    for (i, c) in color::as_list(value).iter().enumerate() {
                        assert!(color::parse(c).is_some(), "{name}: {key}[{i}] is not a color ({c})");
                    }
                }
                _ => {}
            }
        }
    }

    #[test]
    fn each_stock_preset_is_a_valid_look() {
        for (name, preset) in stock() {
            assert!(for_name(name).is_some(), "{name} is keyed in for_name");
            assert_valid(name, &preset);
        }
    }
}
