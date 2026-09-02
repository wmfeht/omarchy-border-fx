//! Resolve a `plugins[]` entry into a complete look.
//!
//! Resolution order (see README "How settings resolve"):
//! 1. `effect` empty means `shiny`. Omitted `effect` uses the base layer
//!    (theme preset or shared default).
//! 2. Known look keys are picked from the entry; `id` and unknown keys are ignored.
//! 3. A nested object named after the effect overlays the top level.
//! 4. Still-missing keys come from the base layer: the shared defaults, or a
//!    caller-supplied override of them (this is where a theme preset plugs in).
//! 5. Every value is coerced and clamped; invalid values keep the base value
//!    and emit a warning.
//! 6. `gradient` / `gradientCw` are normalized to arrays, positions to strings.

pub mod color;
pub mod schema;

use serde_json::{Map, Value};

use schema::{DEFAULT_EFFECT, KEYS, Kind};

/// A resolved look: `effect` plus every key from [`schema::KEYS`].
///
/// JSON on the wire (`LOOK=`, `border-fx look`) is still a camelCase object
/// with schema-ordered keys and `schema::num` integers. That map is an
/// output of [`Look::to_map`], not the in-memory type.
#[derive(Debug, Clone, PartialEq)]
pub struct Look {
    pub effect: String,
    pub border_size: i64,
    pub shimmer: bool,
    pub shimmer_hz: f64,
    pub shimmer_deg: i64,
    pub shimmer_scale_min: f64,
    pub shimmer_scale_max: f64,
    pub pin_deg: i64,
    pub angle_offset: i64,
    pub lobe: f64,
    pub mirror: bool,
    pub gradient: Vec<Value>,
    pub gradient_positions: String,
    pub gradient_cw: Vec<Value>,
    pub gradient_positions_cw: String,
    pub col_a: Value,
    pub col_b: Value,
    pub base_color: Value,
    pub active_only: bool,
    pub pulse: bool,
    pub pulse_hz: f64,
    pub ripple_freq: f64,
    pub ripple_speed: f64,
    pub ripple_gain: f64,
    pub ripple_power: f64,
    pub ripple_origin_x: f64,
    pub ripple_origin_y: f64,
    pub ripple_fade: f64,
    pub specular_halo: bool,
}

impl Look {
    /// Chrome overlay + window plugin load.
    pub fn draws(&self) -> bool {
        effect_draws(&self.effect)
    }

    pub fn to_map(&self) -> Map<String, Value> {
        let mut out = Map::new();
        out.insert("effect".into(), Value::String(self.effect.clone()));
        out.insert("borderSize".into(), schema::num(self.border_size as f64));
        out.insert("shimmer".into(), Value::Bool(self.shimmer));
        out.insert("shimmerHz".into(), schema::num(self.shimmer_hz));
        out.insert("shimmerDeg".into(), schema::num(self.shimmer_deg as f64));
        out.insert("shimmerScaleMin".into(), schema::num(self.shimmer_scale_min));
        out.insert("shimmerScaleMax".into(), schema::num(self.shimmer_scale_max));
        out.insert("pinDeg".into(), schema::num(self.pin_deg as f64));
        out.insert("angleOffset".into(), schema::num(self.angle_offset as f64));
        out.insert("lobe".into(), schema::num(self.lobe));
        out.insert("mirror".into(), Value::Bool(self.mirror));
        out.insert("gradient".into(), Value::Array(self.gradient.clone()));
        out.insert("gradientPositions".into(), Value::String(self.gradient_positions.clone()));
        out.insert("gradientCw".into(), Value::Array(self.gradient_cw.clone()));
        out.insert("gradientPositionsCw".into(), Value::String(self.gradient_positions_cw.clone()));
        out.insert("colA".into(), self.col_a.clone());
        out.insert("colB".into(), self.col_b.clone());
        out.insert("baseColor".into(), self.base_color.clone());
        out.insert("activeOnly".into(), Value::Bool(self.active_only));
        out.insert("pulse".into(), Value::Bool(self.pulse));
        out.insert("pulseHz".into(), schema::num(self.pulse_hz));
        out.insert("rippleFreq".into(), schema::num(self.ripple_freq));
        out.insert("rippleSpeed".into(), schema::num(self.ripple_speed));
        out.insert("rippleGain".into(), schema::num(self.ripple_gain));
        out.insert("ripplePower".into(), schema::num(self.ripple_power));
        out.insert("rippleOriginX".into(), schema::num(self.ripple_origin_x));
        out.insert("rippleOriginY".into(), schema::num(self.ripple_origin_y));
        out.insert("rippleFade".into(), schema::num(self.ripple_fade));
        out.insert("specularHalo".into(), Value::Bool(self.specular_halo));
        out
    }

    pub fn to_value(&self) -> Value {
        Value::Object(self.to_map())
    }

    fn from_map(m: Map<String, Value>) -> Self {
        fn b(m: &Map<String, Value>, k: &str, d: bool) -> bool {
            m.get(k).and_then(Value::as_bool).unwrap_or(d)
        }
        fn i(m: &Map<String, Value>, k: &str, d: i64) -> i64 {
            m.get(k).and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))).unwrap_or(d)
        }
        fn f(m: &Map<String, Value>, k: &str, d: f64) -> f64 {
            m.get(k).and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|n| n as f64))).unwrap_or(d)
        }
        fn s(m: &Map<String, Value>, k: &str, d: &str) -> String {
            match m.get(k) {
                Some(Value::String(v)) => v.clone(),
                _ => d.to_string(),
            }
        }
        fn list(m: &Map<String, Value>, k: &str) -> Vec<Value> {
            m.get(k).map(color::as_list).unwrap_or_default()
        }
        fn val(m: &Map<String, Value>, k: &str, d: &str) -> Value {
            m.get(k).cloned().unwrap_or_else(|| Value::String(d.into()))
        }
        Self {
            effect: s(&m, "effect", schema::DEFAULT_EFFECT),
            border_size: i(&m, "borderSize", 2),
            shimmer: b(&m, "shimmer", true),
            shimmer_hz: f(&m, "shimmerHz", 0.28),
            shimmer_deg: i(&m, "shimmerDeg", 22),
            shimmer_scale_min: f(&m, "shimmerScaleMin", 0.8),
            shimmer_scale_max: f(&m, "shimmerScaleMax", 1.4),
            pin_deg: i(&m, "pinDeg", 120),
            angle_offset: i(&m, "angleOffset", 0),
            lobe: f(&m, "lobe", 0.16),
            mirror: b(&m, "mirror", true),
            gradient: list(&m, "gradient"),
            gradient_positions: s(&m, "gradientPositions", "0 99"),
            gradient_cw: list(&m, "gradientCw"),
            gradient_positions_cw: s(&m, "gradientPositionsCw", "0 22 50 100"),
            col_a: val(&m, "colA", "rgba(f7ffffee)"),
            col_b: val(&m, "colB", "rgba(0a3f4700)"),
            base_color: val(&m, "baseColor", "rgba(0a3f47dd)"),
            active_only: b(&m, "activeOnly", true),
            pulse: b(&m, "pulse", false),
            pulse_hz: f(&m, "pulseHz", 0.4),
            ripple_freq: f(&m, "rippleFreq", 0.025),
            ripple_speed: f(&m, "rippleSpeed", 2.0),
            ripple_gain: f(&m, "rippleGain", 0.85),
            ripple_power: f(&m, "ripplePower", 8.0),
            ripple_origin_x: f(&m, "rippleOriginX", 0.5),
            ripple_origin_y: f(&m, "rippleOriginY", 0.5),
            ripple_fade: f(&m, "rippleFade", 0.0),
            specular_halo: b(&m, "specularHalo", false),
        }
    }
}

/// Warnings from coercion, in the same words `qml/Look.js` prints:
/// `look: <key>: <why>, keeping default`.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Warnings(pub Vec<String>);

impl Warnings {
    fn push(&mut self, key: &str, why: &str) {
        self.0.push(format!("look: {key}: {why}, keeping default"));
    }
    pub fn mentions(&self, key: &str) -> bool {
        let needle = format!("look: {key}:");
        self.0.iter().any(|w| w.contains(&needle))
    }
}

/// Base values that sit under the user's keys. `None` means the shared
/// defaults. A theme preset is a `Some(map)` of look keys that replace the
/// corresponding defaults; anything the preset does not name stays shared.
#[derive(Debug, Default, Clone)]
pub struct Base {
    pub overrides: Option<Map<String, Value>>,
}

impl Base {
    pub fn shared() -> Self {
        Self { overrides: None }
    }

    pub fn with(overrides: Map<String, Value>) -> Self {
        Self { overrides: Some(overrides) }
    }

    fn value_for(&self, key: &str) -> Value {
        if let Some(o) = &self.overrides
            && let Some(v) = o.get(key)
            && !v.is_null()
        {
            return v.clone();
        }
        schema::spec(key).map(|s| s.default.to_value()).unwrap_or(Value::Null)
    }
}

pub fn normalize_effect(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => DEFAULT_EFFECT.to_string(),
        Some(Value::String(s)) if s.is_empty() => DEFAULT_EFFECT.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

/// Which effects draw anything (chrome overlay + window plugin load).
pub fn effect_draws(effect: &str) -> bool {
    effect == "shiny" || effect == "ripple"
}

/// Read the effect off a raw entry with the same defaulting as `resolve`.
pub fn entry_effect(entry: &Value) -> String {
    normalize_effect(entry.as_object().and_then(|o| o.get("effect")))
}

fn coerce_bool(v: &Value) -> Option<bool> {
    match v {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => match n.as_f64() {
            Some(1.0) => Some(true),
            Some(0.0) => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn coerce_num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64().filter(|f| f.is_finite()),
        _ => None,
    }
}

fn js_round(n: f64) -> f64 {
    (n + 0.5).floor()
}

fn coerce(key: &str, kind: Kind, value: &Value, fallback: Value, warn: &mut Warnings) -> Value {
    match kind {
        Kind::Bool => match coerce_bool(value) {
            Some(b) => Value::Bool(b),
            None => {
                warn.push(key, "invalid bool");
                fallback
            }
        },
        Kind::Int { min, max } => match coerce_num(value) {
            Some(n) => {
                let i = js_round(n);
                if key == "borderSize" && i < 0.0 {
                    warn.push(key, "illegal negative");
                    return fallback;
                }
                schema::num(i.clamp(min as f64, max as f64))
            }
            None => {
                warn.push(key, "invalid number");
                fallback
            }
        },
        Kind::Float { min, max } => match coerce_num(value) {
            Some(n) => schema::num(n.clamp(min, max)),
            None => {
                warn.push(key, "invalid number");
                fallback
            }
        },
        Kind::Color | Kind::ColorList | Kind::Str => value.clone(),
    }
}

fn as_position_string(v: &Value) -> Value {
    let s = match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => match n.as_f64() {
            Some(0.0) => String::new(),
            _ => n.to_string(),
        },
        _ => String::new(),
    };
    Value::String(s)
}

/// Resolve `entry` against `base`. Never fails: a non-object entry is `{}`.
pub fn resolve(entry: &Value, base: &Base) -> (Look, Warnings) {
    let mut warn = Warnings::default();
    let empty = Map::new();
    let src = entry.as_object().unwrap_or(&empty);
    let effect = normalize_effect(src.get("effect").or_else(|| base.overrides.as_ref().and_then(|o| o.get("effect"))));

    let mut merged: Map<String, Value> = src.clone();
    if let Some(Value::Object(nested)) = src.get(&effect) {
        for (k, v) in nested {
            if !v.is_null() {
                merged.insert(k.clone(), v.clone());
            }
        }
    }

    let mut out = Map::new();
    out.insert("effect".into(), Value::String(effect));
    for spec in KEYS {
        let fallback = base.value_for(spec.name);
        let v = match merged.get(spec.name) {
            Some(v) if !v.is_null() => coerce(spec.name, spec.kind, v, fallback, &mut warn),
            _ => fallback,
        };
        out.insert(spec.name.into(), v);
    }
    for key in ["gradient", "gradientCw"] {
        let list = color::as_list(&out[key]);
        out.insert(key.into(), Value::Array(list));
    }
    for key in ["gradientPositions", "gradientPositionsCw"] {
        let s = as_position_string(&out[key]);
        out.insert(key.into(), s);
    }
    (Look::from_map(out), warn)
}

/// Convenience: resolve against the shared defaults.
pub fn resolve_shared(entry: &Value) -> (Look, Warnings) {
    resolve(entry, &Base::shared())
}

/// Find the plugin's entry in a parsed `shell.json`, falling back to legacy ids.
pub fn entry_from_shell_config(config: &Value, ids: &[&str]) -> Value {
    let Some(plugins) = config.get("plugins").and_then(Value::as_array) else {
        return Value::Object(Map::new());
    };
    for id in ids {
        if let Some(e) = plugins.iter().find(|e| e.get("id").and_then(Value::as_str) == Some(id)) {
            return e.clone();
        }
    }
    Value::Object(Map::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn merge(v: Value) -> Map<String, Value> {
        resolve_shared(&v).0.to_map()
    }

    #[test]
    fn defaults_when_empty() {
        let d = merge(json!({}));
        assert_eq!(d["effect"], "shiny");
        assert_eq!(d["borderSize"], 2);
        assert_eq!(d["pinDeg"], 120);
        assert_eq!(d["mirror"], true);
        assert_eq!(d["gradient"].as_array().unwrap().len(), 2);
        assert_eq!(d, merge(Value::Null));
        assert_eq!(d, merge(json!([1, 2])));
        assert_eq!(d.len(), KEYS.len() + 1);
        assert_eq!(d.keys().next().unwrap(), "effect");
    }

    #[test]
    fn overrides_and_nested() {
        let e = merge(json!({"id": "wmfeht.border-fx", "pinDeg": 90, "borderSize": 1}));
        assert_eq!(e["pinDeg"], 90);
        assert_eq!(e["borderSize"], 1);
        assert_eq!(e["shimmer"], true);
        assert!(!e.contains_key("id"));

        let nested = merge(json!({"pinDeg": 0, "shiny": {"pinDeg": 45, "borderSize": 4}}));
        assert_eq!(nested["pinDeg"], 45);
        assert_eq!(nested["borderSize"], 4);

        let nested_mirror = merge(json!({"mirror": false, "shiny": {"mirror": true}}));
        assert_eq!(nested_mirror["mirror"], true);

        let ripple =
            merge(json!({"effect": "ripple", "rippleGain": 0.2, "ripple": {"rippleGain": 0.9, "rippleFreq": 0.04}}));
        assert_eq!(ripple["effect"], "ripple");
        assert_eq!(ripple["rippleGain"], 0.9);
        assert_eq!(ripple["rippleFreq"], 0.04);
        assert_eq!(ripple["rippleSpeed"], 2);
        assert_eq!(ripple["pinDeg"], 120);

        let other = merge(json!({"effect": "other", "pinDeg": 10}));
        assert_eq!(other["effect"], "other");
        assert_eq!(other["pinDeg"], 10);

        let nested_null = merge(json!({"pinDeg": 7, "shiny": {"pinDeg": null}}));
        assert_eq!(nested_null["pinDeg"], 7);

        let leftover = merge(json!({"pin": false, "pinDeg": 90, "quantizeDeg": 15}));
        assert!(!leftover.contains_key("pin"));
        assert!(!leftover.contains_key("quantizeDeg"));
        assert_eq!(leftover["pinDeg"], 90);
    }

    #[test]
    fn effect_normalization() {
        assert_eq!(merge(json!({"effect": ""}))["effect"], "shiny");
        assert_eq!(merge(json!({"effect": null}))["effect"], "shiny");
        assert!(effect_draws("shiny"));
        assert!(effect_draws("ripple"));
        assert!(!effect_draws("other"));
        assert_eq!(entry_effect(&json!({})), "shiny");
        assert_eq!(entry_effect(&json!({"effect": "ripple"})), "ripple");
        assert_eq!(entry_effect(&json!("junk")), "shiny");
    }

    #[test]
    fn gradients_normalize() {
        let empty = merge(json!({"gradient": []}));
        assert_eq!(empty["gradient"], json!([]));
        let obj = merge(json!({"gradient": {"colors": ["rgba(ff0000ff)", "rgba(00ff00ff)"]}}));
        assert_eq!(obj["gradient"].as_array().unwrap().len(), 2);
        let junk = merge(json!({"gradient": "rgba(ff0000ff)"}));
        assert_eq!(junk["gradient"], json!([]));
        let pos = merge(json!({"gradientPositions": 5, "gradientPositionsCw": 0}));
        assert_eq!(pos["gradientPositions"], "5");
        assert_eq!(pos["gradientPositionsCw"], "");
    }

    #[test]
    fn typed_coercion() {
        let (look, w) = resolve_shared(&json!({"pulse": "false"}));
        let l = look.to_map();
        assert_eq!(l["pulse"], false);
        assert!(w.mentions("pulse"));

        let (look, w) = resolve_shared(&json!({"mirror": "false", "shimmer": "false"}));
        let l = look.to_map();
        assert_eq!(l["mirror"], true);
        assert_eq!(l["shimmer"], true);
        assert!(w.mentions("mirror") && w.mentions("shimmer"));

        let (look, w) =
            resolve_shared(&json!({"shimmer": false, "pulse": false, "mirror": false, "specularHalo": false}));
        let l = look.to_map();
        assert_eq!(l["shimmer"], false);
        assert_eq!(l["mirror"], false);
        assert!(w.0.is_empty());

        let (look, _) = resolve_shared(&json!({"pulse": 1, "mirror": 0, "shimmer": 0.0, "specularHalo": 1.0}));
        let l = look.to_map();
        assert_eq!(l["pulse"], true);
        assert_eq!(l["mirror"], false);
        assert_eq!(l["shimmer"], false);
        assert_eq!(l["specularHalo"], true);

        let (look, w) = resolve_shared(&json!({"borderSize": "inf", "lobe": [], "shimmerHz": {}, "pulseHz": ""}));
        let l = look.to_map();
        assert_eq!(l["borderSize"], 2);
        assert_eq!(l["lobe"], 0.16);
        assert_eq!(l["shimmerHz"], 0.28);
        assert_eq!(l["pulseHz"], 0.4);
        assert!(w.mentions("borderSize") && w.mentions("lobe") && w.mentions("shimmerHz") && w.mentions("pulseHz"));

        let (look, w) = resolve_shared(&json!({"lobe": true, "pulseHz": false}));
        let l = look.to_map();
        assert_eq!(l["lobe"], 0.16);
        assert_eq!(l["pulseHz"], 0.4);
        assert!(w.mentions("lobe"));
        assert_eq!(w.0[0], "look: lobe: invalid number, keeping default");
    }

    #[test]
    fn clamps() {
        let l = merge(json!({"lobe": 1, "shimmer": false}));
        assert_eq!(l["lobe"], 0.5);
        assert_eq!(l["shimmer"], false);
        assert_eq!(merge(json!({"lobe": 0}))["lobe"], 0.04);
        assert_eq!(merge(json!({"borderSize": 100}))["borderSize"], 20);
        assert_eq!(merge(json!({"borderSize": 0}))["borderSize"], 0);

        let (neg, w) = resolve_shared(&json!({"borderSize": -1}));
        assert_eq!(neg.border_size, 2);
        assert!(w.mentions("borderSize"));

        let h = merge(json!({"pinDeg": 120.7, "angleOffset": 10.7, "shimmerDeg": 20.2}));
        assert_eq!(h["pinDeg"], 121);
        assert_eq!(h["angleOffset"], 11);
        assert_eq!(h["shimmerDeg"], 20);
        assert_eq!(merge(json!({"pinDeg": -1.5}))["pinDeg"], -1);

        let c = merge(json!({"pinDeg": 400, "angleOffset": -200, "shimmerDeg": 200}));
        assert_eq!(c["pinDeg"], 360);
        assert_eq!(c["angleOffset"], -180);
        assert_eq!(c["shimmerDeg"], 180);

        let hz = merge(json!({"shimmerHz": 10, "pulseHz": -1}));
        assert_eq!(hz["shimmerHz"], 4);
        assert_eq!(hz["pulseHz"], 0);

        let r = merge(json!({"rippleFreq": 1, "rippleGain": -1, "ripplePower": 0, "rippleSpeed": 100}));
        assert_eq!(r["rippleFreq"], 0.2);
        assert_eq!(r["rippleGain"], 0);
        assert_eq!(r["ripplePower"], 1);
        assert_eq!(r["rippleSpeed"], 40);

        let o = merge(json!({"rippleOriginX": -1, "rippleOriginY": 4, "rippleFade": 4}));
        assert_eq!(o["rippleOriginX"], 0);
        assert_eq!(o["rippleOriginY"], 1);
        assert_eq!(o["rippleFade"], 1);
    }

    #[test]
    fn base_layer_overrides_defaults_but_not_user_keys() {
        let mut preset = Map::new();
        preset.insert("baseColor".into(), json!("rgba(11223344)"));
        preset.insert("pinDeg".into(), json!(45));
        preset.insert("borderSize".into(), Value::Null);
        let base = Base::with(preset);

        let (l, _) = resolve(&json!({}), &base);
        assert_eq!(l.base_color, "rgba(11223344)");
        assert_eq!(l.pin_deg, 45);
        assert_eq!(l.border_size, 2, "null in the preset falls through to the shared default");
        assert!(l.mirror);

        let (l, w) = resolve(&json!({"pinDeg": 10, "baseColor": "junk", "lobe": "bad"}), &base);
        assert_eq!(l.pin_deg, 10, "user key wins over preset");
        assert_eq!(l.base_color, "junk", "colors are not validated at merge time");
        assert_eq!(l.lobe, 0.16, "invalid user value keeps the base value");
        assert!(w.mentions("lobe"));

        let mut fx = Map::new();
        fx.insert("effect".into(), json!("ripple"));
        fx.insert("rippleGain".into(), json!(0.5));
        let (l, _) = resolve(&json!({}), &Base::with(fx.clone()));
        assert_eq!(l.effect, "ripple", "omitted effect falls through to the preset");
        assert_eq!(l.ripple_gain, 0.5);
        let (l, _) = resolve(&json!({"effect": "shiny"}), &Base::with(fx));
        assert_eq!(l.effect, "shiny", "user effect wins over the preset");
    }

    #[test]
    fn entry_lookup_prefers_current_id() {
        let ids = ["wmfeht.border-fx", "qs.border-fx", "qs.shiny-border"];
        let cfg = json!({"plugins": [
            {"id": "qs.shiny-border", "pinDeg": 1},
            {"id": "qs.border-fx", "pinDeg": 2},
            {"id": "wmfeht.border-fx", "pinDeg": 3}
        ]});
        assert_eq!(entry_from_shell_config(&cfg, &ids)["pinDeg"], 3);
        let legacy = json!({"plugins": [{"id": "qs.shiny-border", "pinDeg": 1}, {"id": "qs.border-fx", "pinDeg": 2}]});
        assert_eq!(entry_from_shell_config(&legacy, &ids)["pinDeg"], 2);
        let older = json!({"plugins": [{"id": "qs.shiny-border", "pinDeg": 1}]});
        assert_eq!(entry_from_shell_config(&older, &ids)["pinDeg"], 1);
        assert_eq!(entry_from_shell_config(&json!({"plugins": []}), &ids), json!({}));
        assert_eq!(entry_from_shell_config(&json!(null), &ids), json!({}));
    }
}
