//! The shared look schema: every key, its kind, its clamp range, and its
//! shared default. `qml/Look.js` and `hypr/src/main.cpp` (`PLUGIN_INIT`)
//! carry the same numbers; `tests/look.js` checks all three agree.

use serde_json::{Map, Value};

pub const DEFAULT_EFFECT: &str = "shiny";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    /// JSON bool, or the numbers 0 / 1.
    Bool,
    /// Finite number, rounded (floor(n + 0.5)) then clamped.
    Int { min: i64, max: i64 },
    /// Finite number, clamped.
    Float { min: f64, max: f64 },
    /// Any color form accepted by `color::parse`. Not validated at merge time;
    /// junk becomes transparent when emitted.
    Color,
    /// Array of colors or a Hyprland-style `{ "colors": [...] }` object.
    ColorList,
    /// Free-form string (gradient position specs).
    Str,
}

#[derive(Debug, Clone, Copy)]
pub enum Default {
    Bool(bool),
    Num(f64),
    Str(&'static str),
    Colors(&'static [&'static str]),
}

#[derive(Debug, Clone, Copy)]
pub struct KeySpec {
    pub name: &'static str,
    pub kind: Kind,
    pub default: Default,
}

/// Ordered list of look keys. Order is the order keys appear in resolved
/// output; keep it in sync with `qml/Look.js` `DEFAULTS`.
pub const KEYS: &[KeySpec] = &[
    KeySpec { name: "borderSize", kind: Kind::Int { min: 0, max: 20 }, default: Default::Num(2.0) },
    KeySpec { name: "shimmer", kind: Kind::Bool, default: Default::Bool(true) },
    KeySpec { name: "shimmerHz", kind: Kind::Float { min: 0.0, max: 4.0 }, default: Default::Num(0.28) },
    KeySpec { name: "shimmerDeg", kind: Kind::Int { min: 0, max: 180 }, default: Default::Num(22.0) },
    KeySpec { name: "shimmerScaleMin", kind: Kind::Float { min: 0.2, max: 3.0 }, default: Default::Num(0.8) },
    KeySpec { name: "shimmerScaleMax", kind: Kind::Float { min: 0.2, max: 3.0 }, default: Default::Num(1.4) },
    KeySpec { name: "pinDeg", kind: Kind::Int { min: -360, max: 360 }, default: Default::Num(120.0) },
    KeySpec { name: "angleOffset", kind: Kind::Int { min: -180, max: 180 }, default: Default::Num(0.0) },
    KeySpec { name: "lobe", kind: Kind::Float { min: 0.04, max: 0.5 }, default: Default::Num(0.16) },
    KeySpec { name: "mirror", kind: Kind::Bool, default: Default::Bool(true) },
    KeySpec {
        name: "gradient",
        kind: Kind::ColorList,
        default: Default::Colors(&["rgba(f7ffffee)", "rgba(0a3f4700)"]),
    },
    KeySpec { name: "gradientPositions", kind: Kind::Str, default: Default::Str("0 99") },
    KeySpec { name: "gradientCw", kind: Kind::ColorList, default: Default::Colors(&[]) },
    KeySpec { name: "gradientPositionsCw", kind: Kind::Str, default: Default::Str("0 22 50 100") },
    KeySpec { name: "colA", kind: Kind::Color, default: Default::Str("rgba(f7ffffee)") },
    KeySpec { name: "colB", kind: Kind::Color, default: Default::Str("rgba(0a3f4700)") },
    KeySpec { name: "baseColor", kind: Kind::Color, default: Default::Str("rgba(0a3f47dd)") },
    KeySpec { name: "activeOnly", kind: Kind::Bool, default: Default::Bool(true) },
    KeySpec { name: "pulse", kind: Kind::Bool, default: Default::Bool(false) },
    KeySpec { name: "pulseHz", kind: Kind::Float { min: 0.0, max: 4.0 }, default: Default::Num(0.4) },
    KeySpec { name: "rippleFreq", kind: Kind::Float { min: 0.001, max: 0.2 }, default: Default::Num(0.025) },
    KeySpec { name: "rippleSpeed", kind: Kind::Float { min: 0.0, max: 40.0 }, default: Default::Num(2.0) },
    KeySpec { name: "rippleGain", kind: Kind::Float { min: 0.0, max: 2.0 }, default: Default::Num(0.85) },
    KeySpec { name: "ripplePower", kind: Kind::Float { min: 1.0, max: 16.0 }, default: Default::Num(8.0) },
    KeySpec { name: "rippleOriginX", kind: Kind::Float { min: 0.0, max: 1.0 }, default: Default::Num(0.5) },
    KeySpec { name: "rippleOriginY", kind: Kind::Float { min: 0.0, max: 1.0 }, default: Default::Num(0.5) },
    KeySpec { name: "rippleFade", kind: Kind::Float { min: 0.0, max: 1.0 }, default: Default::Num(0.0) },
    KeySpec { name: "specularHalo", kind: Kind::Bool, default: Default::Bool(false) },
];

pub fn spec(name: &str) -> Option<&'static KeySpec> {
    KEYS.iter().find(|k| k.name == name)
}

impl Default {
    pub fn to_value(self) -> Value {
        match self {
            Default::Bool(b) => Value::Bool(b),
            Default::Num(n) => num(n),
            Default::Str(s) => Value::String(s.to_string()),
            Default::Colors(list) => Value::Array(list.iter().map(|c| Value::String(c.to_string())).collect()),
        }
    }
}

/// Integral floats serialize as JSON integers so `2` stays `2`, not `2.0`.
pub fn num(n: f64) -> Value {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 9.0e15 {
        Value::from(n as i64)
    } else {
        serde_json::Number::from_f64(n).map(Value::Number).unwrap_or(Value::Null)
    }
}

/// `{ "effect": "shiny", ...every key at its shared default }`.
pub fn defaults() -> Map<String, Value> {
    let mut out = Map::new();
    out.insert("effect".into(), Value::String(DEFAULT_EFFECT.into()));
    for k in KEYS {
        out.insert(k.name.into(), k.default.to_value());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_documented_values() {
        let d = defaults();
        assert_eq!(d["effect"], "shiny");
        assert_eq!(d["borderSize"], 2);
        assert_eq!(d["pinDeg"], 120);
        assert_eq!(d["shimmerHz"], 0.28);
        assert_eq!(d["mirror"], true);
        assert_eq!(d["pulse"], false);
        assert_eq!(d["gradient"].as_array().unwrap().len(), 2);
        assert_eq!(d["gradientCw"].as_array().unwrap().len(), 0);
        assert_eq!(d["gradientPositions"], "0 99");
        assert_eq!(d["baseColor"], "rgba(0a3f47dd)");
        assert_eq!(d["rippleFade"], 0);
        assert_eq!(d["specularHalo"], false);
        assert!(!d.contains_key("pin"));
        assert!(!d.contains_key("quantizeDeg"));
    }

    #[test]
    fn num_prefers_integers() {
        assert_eq!(num(2.0).to_string(), "2");
        assert_eq!(num(0.28).to_string(), "0.28");
        assert_eq!(num(-1.0).to_string(), "-1");
        assert_eq!(num(f64::NAN), Value::Null);
    }
}
