//! Generic look derivation for themes without a hand-tuned preset.
//!
//! [`super::presets`] covers the stock themes, where the light direction,
//! mirror, lobe and shimmer are chosen against each theme's own wallpapers.
//! A user theme gets none of that and falls through to the shared defaults,
//! so its ring is whatever the defaults happen to be — on an unrelated
//! palette, usually a colour the theme never mentions.
//!
//! This generalises the *colour* half of the preset recipe, and only that
//! half: five stops from the theme's own `colors.toml`, head first, fading to
//! a transparent theme colour, with the wrap stroke (`baseColor`) at `dd`.
//! Geometry — `pinDeg`, `lobe`, `mirror`, `specularHalo` — is deliberately
//! left on the shared defaults, because it is a judgement about a wallpaper
//! and cannot be read out of a palette.
//!
//! The head is `foreground`, as it is in every stock preset. The midpoint is
//! `accent`. Between them sits the bright twin of whichever ANSI colour the
//! theme set `accent` to, when it set one — many themes define `accent` as a
//! copy of `blue` or `cyan`, which makes `bright_blue` / `bright_cyan` the
//! theme's own idea of "the accent, lit". The tail fades to the wrap colour.

use serde_json::{Map, Value, json};

use super::Theme;

/// ANSI names a theme may alias `accent` to, and whose `bright_` twin is then
/// the theme's own brighter version of that colour.
const ANSI: &[&str] = &["blue", "cyan", "green", "magenta", "red", "yellow"];

/// Alpha ladder for the five stops, head first. Dark themes carry a slightly
/// heavier ring than light ones, matching the stock presets.
const ALPHA_DARK: [&str; 5] = ["f0", "d0", "a0", "50", "00"];
const ALPHA_LIGHT: [&str; 5] = ["ee", "c8", "80", "40", "00"];

/// Stop positions. The median of the stock presets, which range from
/// `0 10 28 60 100` to `0 18 44 72 100`.
const POSITIONS: &str = "0 16 42 72 100";

/// Wrap stroke alpha, as in every stock preset.
const WRAP_ALPHA: &str = "dd";

/// Six hex digits, lowercased, or `None`. Accepts `#rrggbb` and bare `rrggbb`;
/// an `#aarrggbb` or any other length is rejected rather than guessed at.
fn hex6(raw: &str) -> Option<String> {
    let s = raw.trim().trim_start_matches('#');
    (s.len() == 6 && s.chars().all(|c| c.is_ascii_hexdigit())).then(|| s.to_ascii_lowercase())
}

/// WCAG relative luminance, 0.0..1.0.
fn luminance(hex6: &str) -> Option<f64> {
    let chan = |at: usize| -> Option<f64> {
        let v = f64::from(u8::from_str_radix(hex6.get(at..at + 2)?, 16).ok()?) / 255.0;
        Some(if v <= 0.040_45 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) })
    };
    Some(0.2126 * chan(0)? + 0.7152 * chan(2)? + 0.0722 * chan(4)?)
}

/// First key present and parseable as six hex digits.
fn pick(t: &Theme, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| t.colors.get(*k).and_then(|v| hex6(v)))
}

/// Like [`pick`], skipping anything already used, so two ramp stops do not
/// land on the same colour.
fn pick_distinct(t: &Theme, keys: &[&str], used: &[&str]) -> Option<String> {
    keys.iter().filter_map(|k| t.colors.get(*k).and_then(|v| hex6(v))).find(|c| !used.contains(&c.as_str()))
}

/// `mode` when `colors.toml` states it, otherwise inferred from how light the
/// background is. User themes frequently omit `mode`.
fn is_light(t: &Theme) -> bool {
    match t.mode.as_deref().map(str::trim) {
        Some("light") => true,
        Some("dark") => false,
        _ => pick(t, &["background"]).and_then(|b| luminance(&b)).is_some_and(|l| l > 0.5),
    }
}

/// `bright_<name>` for the ANSI colour this theme aliased `accent` to.
fn bright_twin_of_accent(t: &Theme, accent: &str) -> Option<String> {
    let name = ANSI.iter().find(|n| t.colors.get(**n).and_then(|v| hex6(v)).as_deref() == Some(accent))?;
    pick(t, &[&format!("bright_{name}")])
}

fn stop(hex6: &str, alpha: &str) -> String {
    format!("rgba({hex6}{alpha})")
}

/// Look overrides for a theme with no stock preset, or `None` when the palette
/// is too sparse to derive anything honest from (no `foreground`, no `accent`,
/// or no colour to wrap with).
pub fn derive(t: &Theme) -> Option<Map<String, Value>> {
    let light = is_light(t);
    let alpha = if light { ALPHA_LIGHT } else { ALPHA_DARK };

    let head = pick(t, &["foreground", "bright_foreground"])?;
    let accent = pick(t, &["accent"])?;

    // The frame the ring sits in. Deliberately a tone close to the window
    // behind it, not a contrasting one -- the stock presets describe it as
    // "`selection` (`muted` on light themes, or a close background)", i.e. a
    // subtle lift off the background rather than an outline. Light themes
    // prefer `muted` so the stroke still reads on a near-white background.
    let wrap_keys: &[&str] = if light {
        &["muted", "darker_background", "dark_background", "selection", "background"]
    } else {
        &["selection", "dark_background", "darker_background", "muted", "background"]
    };
    let wrap = pick(t, wrap_keys)?;

    let lit = bright_twin_of_accent(t, &accent).unwrap_or_else(|| accent.clone());
    let shade = pick_distinct(
        t,
        &["muted", "selection", "dark_background", "darker_background"],
        &[&head, &accent, &wrap, &lit],
    )
    .unwrap_or_else(|| wrap.clone());

    Some(object(json!({
        "gradient": [
            stop(&head,   alpha[0]),
            stop(&lit,    alpha[1]),
            stop(&accent, alpha[2]),
            stop(&shade,  alpha[3]),
            stop(&wrap,   alpha[4]),
        ],
        "gradientPositions": POSITIONS,
        "colA": stop(&head, alpha[0]),
        "colB": stop(&wrap, alpha[4]),
        "baseColor": stop(&wrap, WRAP_ALPHA),
    })))
}

fn object(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn theme(mode: Option<&str>, pairs: &[(&str, &str)]) -> Theme {
        Theme {
            name: "custom".into(),
            dir: PathBuf::from("/nowhere"),
            colors: pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect(),
            mode: mode.map(str::to_string),
        }
    }

    fn gradient(m: &Map<String, Value>) -> Vec<String> {
        m["gradient"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn hex6_accepts_both_spellings_and_rejects_the_rest() {
        assert_eq!(hex6("#725D3C").as_deref(), Some("725d3c"));
        assert_eq!(hex6("  725d3c ").as_deref(), Some("725d3c"));
        assert_eq!(hex6("#dd725d3c"), None); // 8 digits is not guessed at
        assert_eq!(hex6("#725d3"), None);
        assert_eq!(hex6("#725d3g"), None);
        assert_eq!(hex6(""), None);
    }

    #[test]
    fn luminance_orders_black_grey_white() {
        let (k, g, w) = (luminance("000000").unwrap(), luminance("808080").unwrap(), luminance("ffffff").unwrap());
        assert!(k < g && g < w);
        assert!(k.abs() < 1e-9 && (w - 1.0).abs() < 1e-9);
    }

    #[test]
    fn stated_mode_wins_over_inference() {
        // A light background with mode = "dark" stays dark: the file is the
        // authority, inference is only for themes that omit it.
        assert!(!is_light(&theme(Some("dark"), &[("background", "#ffffff")])));
        assert!(is_light(&theme(Some("light"), &[("background", "#000000")])));
    }

    #[test]
    fn absent_mode_is_inferred_from_the_background() {
        assert!(is_light(&theme(None, &[("background", "#d4f0ff")])));
        assert!(!is_light(&theme(None, &[("background", "#1a1b26")])));
        // Nothing to infer from is treated as dark, the common case.
        assert!(!is_light(&theme(None, &[])));
    }

    #[test]
    fn dark_theme_ramp_follows_the_preset_recipe() {
        let t = theme(
            Some("dark"),
            &[
                ("foreground", "#c0caf5"),
                ("accent", "#7aa2f7"),
                ("blue", "#7aa2f7"),
                ("bright_blue", "#7da6ff"),
                ("selection", "#292e42"),
                ("muted", "#565f89"),
                ("background", "#1a1b26"),
            ],
        );
        let m = derive(&t).unwrap();
        assert_eq!(
            gradient(&m),
            vec![
                "rgba(c0caf5f0)", // foreground, head
                "rgba(7da6ffd0)", // bright twin of accent (accent == blue)
                "rgba(7aa2f7a0)", // accent
                "rgba(565f8950)", // a distinct shade
                "rgba(292e4200)", // wrap (`selection`, as tokyo-night's own preset uses), transparent
            ]
        );
        assert_eq!(m["baseColor"], "rgba(292e42dd)");
        assert_eq!(m["colA"], "rgba(c0caf5f0)");
        assert_eq!(m["colB"], "rgba(292e4200)");
        assert_eq!(m["gradientPositions"], POSITIONS);
        // Geometry is a wallpaper judgement and is never derived.
        for k in ["pinDeg", "lobe", "mirror", "specularHalo", "borderSize", "effect"] {
            assert!(!m.contains_key(k), "{k} must stay on the shared defaults");
        }
    }

    #[test]
    fn light_theme_uses_the_lighter_alpha_ladder() {
        let m = derive(&theme(
            None, // no mode: inferred light from the background
            &[("foreground", "#04060A"), ("accent", "#725d3c"), ("background", "#d4f0ff"), ("muted", "#787e82")],
        ))
        .unwrap();
        let g = gradient(&m);
        assert!(g[0].ends_with("ee)"), "{}", g[0]);
        assert!(g[4].ends_with("00)"), "{}", g[4]);
        assert_eq!(g[0], "rgba(04060aee)");
    }

    #[test]
    fn accent_repeats_when_the_theme_names_no_bright_twin() {
        let m =
            derive(&theme(Some("dark"), &[("foreground", "#eeeeee"), ("accent", "#ff0000"), ("selection", "#222222")]))
                .unwrap();
        let g = gradient(&m);
        assert_eq!(g[1], "rgba(ff0000d0)");
        assert_eq!(g[2], "rgba(ff0000a0)");
    }

    #[test]
    fn wrap_follows_the_preference_order_not_contrast() {
        // The wrap stroke is a subtle lift off the window background, so a
        // light theme takes `muted` even though `background` would contrast
        // far harder against the dark-ink head. Maximising contrast here
        // produces a near-white stroke on a near-white window.
        let light = theme(
            None,
            &[
                ("foreground", "#04060a"),
                ("accent", "#725d3c"),
                ("muted", "#787e82"),
                ("selection", "#b4ccd9"),
                ("background", "#d4f0ff"),
            ],
        );
        assert_eq!(derive(&light).unwrap()["baseColor"], "rgba(787e82dd)");

        // A dark theme takes `selection`, as its stock presets do.
        let dark = theme(
            Some("dark"),
            &[("foreground", "#c0caf5"), ("accent", "#7aa2f7"), ("selection", "#292e42"), ("background", "#1a1b26")],
        );
        assert_eq!(derive(&dark).unwrap()["baseColor"], "rgba(292e42dd)");
    }

    #[test]
    fn a_palette_too_sparse_to_read_derives_nothing() {
        assert!(derive(&theme(Some("dark"), &[])).is_none());
        // foreground but no accent
        assert!(derive(&theme(Some("dark"), &[("foreground", "#ffffff")])).is_none());
        // accent but no foreground
        assert!(derive(&theme(Some("dark"), &[("accent", "#ff0000")])).is_none());
        // both, but nothing to wrap with
        assert!(derive(&theme(Some("dark"), &[("foreground", "#ffffff"), ("accent", "#ff0000")])).is_none());
    }

    #[test]
    fn unparseable_colors_are_skipped_not_emitted() {
        let m = derive(&theme(
            Some("dark"),
            &[
                ("foreground", "not-a-colour"),
                ("bright_foreground", "#dddddd"),
                ("accent", "#7aa2f7"),
                ("selection", "#222222"),
            ],
        ))
        .unwrap();
        assert_eq!(gradient(&m)[0], "rgba(ddddddf0)");
    }
}
