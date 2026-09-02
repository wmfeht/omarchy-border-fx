//! JSON input helpers. Look JSON arrives from QML (`JSON.stringify`) or from a
//! shell; both are strict, but hand-written fixtures have used Python-style
//! `NaN` / `Infinity`. Those are not valid JSON, so they are read as `null`
//! (which resolves to the default) instead of rejecting the whole document.

use serde_json::Value;

/// Replace bare `NaN`, `Infinity`, `-Infinity` tokens outside strings with `null`.
pub fn neutralize_non_finite(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    let mut in_str = false;
    let mut escaped = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_str {
            out.push(c as char);
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if c == b'"' {
            in_str = true;
            out.push('"');
            i += 1;
            continue;
        }
        let rest = &src[i..];
        let mut matched = None;
        for tok in ["-Infinity", "Infinity", "NaN"] {
            if rest.starts_with(tok) {
                let after = rest.as_bytes().get(tok.len()).copied();
                let boundary = after.is_none_or(|b| !(b.is_ascii_alphanumeric() || b == b'_'));
                if boundary {
                    matched = Some(tok.len());
                    break;
                }
            }
        }
        if let Some(len) = matched {
            out.push_str("null");
            i += len;
        } else {
            // Non-ASCII bytes are copied through as part of their char.
            let ch_len = src[i..].chars().next().map_or(1, char::len_utf8);
            out.push_str(&src[i..i + ch_len]);
            i += ch_len;
        }
    }
    out
}

/// Parse a look document. Empty input is `{}`.
pub fn parse_look(src: &str) -> Result<Value, String> {
    let trimmed = src.trim();
    if trimmed.is_empty() {
        return Ok(Value::Object(Default::default()));
    }
    serde_json::from_str(&neutralize_non_finite(trimmed)).map_err(|e| format!("invalid JSON: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn non_finite_tokens_become_null() {
        let v = parse_look(r#"{"borderSize": NaN, "shimmerHz": Infinity, "x": -Infinity}"#).unwrap();
        assert_eq!(v, json!({"borderSize": null, "shimmerHz": null, "x": null}));
    }

    #[test]
    fn strings_are_untouched() {
        let v = parse_look(r#"{"a": "NaN", "b": "say \"Infinity\"", "NaNKey": 1}"#).unwrap();
        assert_eq!(v["a"], "NaN");
        assert_eq!(v["b"], "say \"Infinity\"");
        assert_eq!(v["NaNKey"], 1);
    }

    #[test]
    fn identifiers_containing_tokens_are_untouched() {
        assert_eq!(neutralize_non_finite("NaNx"), "NaNx");
        assert_eq!(neutralize_non_finite("[NaN,NaN]"), "[null,null]");
        assert_eq!(neutralize_non_finite("é NaN"), "é null");
    }

    #[test]
    fn empty_and_errors() {
        assert_eq!(parse_look("").unwrap(), json!({}));
        assert_eq!(parse_look("  \n").unwrap(), json!({}));
        assert!(parse_look("{").is_err());
    }
}
