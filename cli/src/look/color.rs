//! Color forms accepted in the look document and the two canonical outputs:
//! Hyprland `rgba(RRGGBBAA)` and Qt `#AARRGGBB`. Junk is transparent.

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

fn hex_pair(s: &str, at: usize) -> Option<f64> {
    let v = u8::from_str_radix(s.get(at..at + 2)?, 16).ok()?;
    Some(f64::from(v) / 255.0)
}

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn channel(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::Bool(true)) => 1.0,
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// `rgba(RRGGBBAA)`, `rgb(RRGGBB)`, `rgba(RRGGBB)`, `#AARRGGBB`, `#RRGGBB`,
/// or `{ r, g, b, a? }` with channels in 0..1.
pub fn parse(v: &Value) -> Option<Rgba> {
    match v {
        Value::Null => None,
        Value::Object(o) if o.contains_key("r") => Some(Rgba {
            r: channel(o.get("r")),
            g: channel(o.get("g")),
            b: channel(o.get("b")),
            a: match o.get("a") {
                None | Some(Value::Null) => 1.0,
                other => channel(other),
            },
        }),
        Value::String(s) => parse_str(s),
        other => parse_str(&other.to_string()),
    }
}

pub fn parse_str(text: &str) -> Option<Rgba> {
    let text = text.trim();
    let body = text
        .strip_prefix("rgba(")
        .or_else(|| text.strip_prefix("rgb("))
        .and_then(|rest| rest.strip_suffix(')'))
        .map(str::trim);
    if let Some(hex) = body {
        if !is_hex(hex) || !(hex.len() == 6 || hex.len() == 8) {
            return None;
        }
        return Some(Rgba {
            r: hex_pair(hex, 0)?,
            g: hex_pair(hex, 2)?,
            b: hex_pair(hex, 4)?,
            a: if hex.len() == 8 { hex_pair(hex, 6)? } else { 1.0 },
        });
    }
    if let Some(hex) = text.strip_prefix('#') {
        if !is_hex(hex) {
            return None;
        }
        return match hex.len() {
            8 => Some(Rgba { a: hex_pair(hex, 0)?, r: hex_pair(hex, 2)?, g: hex_pair(hex, 4)?, b: hex_pair(hex, 6)? }),
            6 => Some(Rgba { a: 1.0, r: hex_pair(hex, 0)?, g: hex_pair(hex, 2)?, b: hex_pair(hex, 4)? }),
            _ => None,
        };
    }
    None
}

fn hex2(unit: f64) -> String {
    let v = (unit * 255.0).round().clamp(0.0, 255.0) as u8;
    format!("{v:02x}")
}

/// Hyprland `rgba(RRGGBBAA)`; junk → `rgba(00000000)`.
pub fn to_hypr(v: &Value) -> String {
    match parse(v) {
        Some(c) => format!("rgba({}{}{}{})", hex2(c.r), hex2(c.g), hex2(c.b), hex2(c.a)),
        None => "rgba(00000000)".to_string(),
    }
}

/// Qt `#AARRGGBB`; junk → `#00000000`.
pub fn to_qt(v: &Value) -> String {
    match parse(v) {
        Some(c) => format!("#{}{}{}{}", hex2(c.a), hex2(c.r), hex2(c.g), hex2(c.b)),
        None => "#00000000".to_string(),
    }
}

/// Array of colors, or Hyprland-style `{ "colors": [...] }`. Anything else is empty.
pub fn as_list(v: &Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a.clone(),
        Value::Object(o) => match o.get("colors") {
            Some(Value::Array(a)) => a.clone(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(t: &str) -> Value {
        Value::String(t.to_string())
    }

    #[test]
    fn round_trips() {
        assert_eq!(to_qt(&s("rgba(33ccffee)")), "#ee33ccff");
        assert_eq!(to_hypr(&s("#ee33ccff")), "rgba(33ccffee)");
        assert_eq!(to_hypr(&s("rgba(33ccffee)")), "rgba(33ccffee)");
        assert_eq!(to_qt(&s("#ee33ccff")), "#ee33ccff");
        assert_eq!(to_qt(&s("rgb(007a48)")), "#ff007a48");
        assert_eq!(to_hypr(&s("#dd0a3f47")), "rgba(0a3f47dd)");
        assert_eq!(to_qt(&s("#33ccff")), "#ff33ccff");
    }

    #[test]
    fn junk_is_transparent() {
        assert_eq!(to_qt(&s("nope")), "#00000000");
        assert_eq!(to_qt(&s("rgba(33ccffe)")), "#00000000");
        assert_eq!(to_hypr(&s("rgba(33ccffe)")), "rgba(00000000)");
        assert_eq!(to_qt(&s("rgb(33ccffe)")), "#00000000");
        assert_eq!(to_qt(&s("rgba(33ccff)")), "#ff33ccff");
        assert_eq!(to_hypr(&s("rgba(33ccff)")), "rgba(33ccffff)");
        assert_eq!(to_hypr(&s("rgba(33ccffe0)")), "rgba(33ccffe0)");
        assert_eq!(to_qt(&s("rgba(33ccffee0)")), "#00000000");
        assert_eq!(to_qt(&Value::Null), "#00000000");
        assert_eq!(to_qt(&json!(12)), "#00000000");
    }

    #[test]
    fn object_form() {
        assert_eq!(to_hypr(&json!({"r": 0.2, "g": 0.8, "b": 1, "a": 0.9})), "rgba(33ccffe6)");
        assert_eq!(to_hypr(&json!({"r": 1, "g": 0, "b": 0})), "rgba(ff0000ff)");
        assert_eq!(to_hypr(&json!({"r": 1, "g": 0, "b": 0, "a": null})), "rgba(ff0000ff)");
        assert_eq!(to_hypr(&json!({"r": "0.5", "g": 0, "b": 0, "a": 0})), "rgba(80000000)");
    }

    #[test]
    fn lists() {
        assert_eq!(as_list(&json!(["a", "b"])).len(), 2);
        assert_eq!(as_list(&json!({"colors": ["a"]})).len(), 1);
        assert_eq!(as_list(&json!({"nope": ["a"]})).len(), 0);
        assert_eq!(as_list(&json!("rgba(ffffffff)")).len(), 0);
        assert_eq!(as_list(&Value::Null).len(), 0);
    }
}
