//! Opinionated look presets for stock Omarchy themes, keyed by directory
//! name (`tokyo-night`, not "Tokyo Night"). Anything a preset does not name
//! stays on the shared defaults; user keys in `shell.json` still win.
//!
//! Every ramp is five stops from the theme's own `colors.toml`, head first,
//! fading to a transparent theme color; the wrap stroke (`baseColor`) is the
//! theme's `selection` (`muted` on light themes, or a close background) at
//! `dd`. Light direction,
//! mirror, lobe, shimmer, and halo follow the theme's stock wallpapers: where
//! the light comes from, whether it is one source or a symmetric scene, and
//! how much the picture moves.

use serde_json::{Map, Value, json};

fn object(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

type Preset = fn() -> Map<String, Value>;

/// Every stock theme with a preset, in Omarchy's directory order.
pub const STOCK: &[(&str, Preset)] = &[
    ("catppuccin", catppuccin),
    ("catppuccin-latte", catppuccin_latte),
    ("ethereal", ethereal),
    ("everforest", everforest),
    ("flexoki-light", flexoki_light),
    ("gruvbox", gruvbox),
    ("hackerman", hackerman),
    ("kanagawa", kanagawa),
    ("last-horizon", last_horizon),
    ("lumon", lumon),
    ("lupine", lupine),
    ("matte-black", matte_black),
    ("miasma", miasma),
    ("nord", nord),
    ("osaka-jade", osaka_jade),
    ("retro-82", retro_82),
    ("ristretto", ristretto),
    ("rose-pine", rose_pine),
    ("solitude", solitude),
    ("tokyo-night", tokyo_night),
    ("vantablack", vantablack),
    ("white", white),
];

/// Look-key overrides for `name`, or `None` to keep the shared defaults.
pub fn for_name(name: &str) -> Option<Map<String, Value>> {
    STOCK.iter().find(|(n, _)| *n == name).map(|(_, f)| f())
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

/// Catppuccin (Mocha). A pastel moon glows from the upper right, so the
/// light sits at 60°. Text, blue, pink, then the overlay grey fading to
/// base; wrap stroke is `selection` (surface1).
fn catppuccin() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 60,
        "lobe": 0.14,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(cdd6f4f0)",
            "rgba(89b4fad8)",
            "rgba(f5c2e7a0)",
            "rgba(585b7050)",
            "rgba(1e1e2e00)"
        ],
        "gradientPositions": "0 14 36 66 100",
        "baseColor": "rgba(45475add)",
        "shimmer": true,
        "shimmerHz": 0.3,
        "shimmerDeg": 16,
        "shimmerScaleMin": 0.85,
        "shimmerScaleMax": 1.25,
        "activeOnly": true
    }))
}

/// Catppuccin Latte. Light theme: the highlight is the saturated accent
/// blue and pink so it reads against pale windows. One warm source from the
/// upper left (the wallpaper's sunrise corner), no mirror; wrap stroke is
/// `muted` so the ring still frames on a near-white background.
fn catppuccin_latte() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 135,
        "lobe": 0.2,
        "mirror": false,
        "specularHalo": false,
        "gradient": [
            "rgba(1e66f5f0)",
            "rgba(ea76cbc8)",
            "rgba(17929980)",
            "rgba(acb0be40)",
            "rgba(eff1f500)"
        ],
        "gradientPositions": "0 22 48 74 100",
        "baseColor": "rgba(acb0bedd)",
        "shimmer": true,
        "shimmerHz": 0.25,
        "shimmerDeg": 20,
        "shimmerScaleMin": 0.85,
        "shimmerScaleMax": 1.3,
        "activeOnly": true
    }))
}

/// Ethereal. The nebula glows up from below the horizon, so the light comes
/// from 270° as one wide, soft source with a bloom halo. Peach foreground
/// into periwinkle and mauve, fading to `selection`.
fn ethereal() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 270,
        "lobe": 0.3,
        "mirror": false,
        "specularHalo": true,
        "gradient": [
            "rgba(ffceadf0)",
            "rgba(c2c4f0d0)",
            "rgba(7d82d9a0)",
            "rgba(c89dc160)",
            "rgba(252e5600)"
        ],
        "gradientPositions": "0 16 40 70 100",
        "baseColor": "rgba(252e56dd)",
        "shimmer": true,
        "shimmerHz": 0.2,
        "shimmerDeg": 22,
        "shimmerScaleMin": 0.8,
        "shimmerScaleMax": 1.4,
        "activeOnly": true
    }))
}

/// Everforest. Overcast light from straight above over foggy treetops: a
/// broad, low-alpha band that drifts slowly and wide. Sand foreground into
/// the greens and the aqua accent, fading to `selection`.
fn everforest() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 90,
        "lobe": 0.28,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(d3c6aac8)",
            "rgba(a7c080b0)",
            "rgba(83c09280)",
            "rgba(7fbbb350)",
            "rgba(3d484d00)"
        ],
        "gradientPositions": "0 20 46 74 100",
        "baseColor": "rgba(3d484ddd)",
        "shimmer": true,
        "shimmerHz": 0.18,
        "shimmerDeg": 30,
        "shimmerScaleMin": 0.85,
        "shimmerScaleMax": 1.3,
        "activeOnly": true
    }))
}

/// Flexoki Light. Ink on paper: the comet is the ink foreground with a
/// trace of the accent blue, one source from the lower right (the way the
/// dithered orb is shaded). No shimmer; a slow pulse instead, like a print
/// under changing light. Wrap stroke is `muted`.
fn flexoki_light() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": -45,
        "lobe": 0.18,
        "mirror": false,
        "specularHalo": false,
        "gradient": [
            "rgba(100f0fee)",
            "rgba(403e3cc0)",
            "rgba(205ea660)",
            "rgba(87858030)",
            "rgba(cecdc300)"
        ],
        "gradientPositions": "0 18 44 72 100",
        "baseColor": "rgba(b7b5acdd)",
        "shimmer": false,
        "pulse": true,
        "pulseHz": 0.25,
        "activeOnly": true
    }))
}

/// Gruvbox. Impressionist sunlight through leaves from the upper right.
/// Warm foreground into yellow and orange with a cool aqua tail, fading to
/// `selection`.
fn gruvbox() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 45,
        "lobe": 0.18,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(d4be98f0)",
            "rgba(d8a657d8)",
            "rgba(e1875ca0)",
            "rgba(7daea350)",
            "rgba(50494500)"
        ],
        "gradientPositions": "0 16 40 68 100",
        "baseColor": "rgba(504945dd)",
        "shimmer": true,
        "shimmerHz": 0.3,
        "shimmerDeg": 18,
        "shimmerScaleMin": 0.85,
        "shimmerScaleMax": 1.3,
        "activeOnly": true
    }))
}

/// Hackerman. Neon: a tight, near-opaque cyan-to-green streak with a
/// specular halo, lit from the synthwave sun overhead. Fast, short shimmer
/// so it flickers rather than drifts.
fn hackerman() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 90,
        "lobe": 0.12,
        "mirror": true,
        "specularHalo": true,
        "gradient": [
            "rgba(d1fffeff)",
            "rgba(82fb9cf0)",
            "rgba(4fe88fb0)",
            "rgba(7cf8f760)",
            "rgba(1f253a00)"
        ],
        "gradientPositions": "0 12 34 64 100",
        "baseColor": "rgba(1f253add)",
        "shimmer": true,
        "shimmerHz": 0.6,
        "shimmerDeg": 8,
        "shimmerScaleMin": 0.9,
        "shimmerScaleMax": 1.2,
        "activeOnly": true
    }))
}

/// Kanagawa. The Great Wave crests from the upper left. Foam foreground
/// into the wave blues and the deep `lighter_background` blue, which is
/// also the wrap stroke; the shimmer swells like the swell.
fn kanagawa() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 135,
        "lobe": 0.2,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(dcd7baf0)",
            "rgba(7fb4cad0)",
            "rgba(7e9cd8a0)",
            "rgba(22324970)",
            "rgba(36364600)"
        ],
        "gradientPositions": "0 18 44 72 100",
        "baseColor": "rgba(223249dd)",
        "shimmer": true,
        "shimmerHz": 0.25,
        "shimmerDeg": 16,
        "shimmerScaleMin": 0.8,
        "shimmerScaleMax": 1.35,
        "activeOnly": true
    }))
}

/// Last Horizon. Cinematic single key light from the lower left with a
/// bloom halo, like the wallpapers' rim-lit portraits. Bright foreground
/// into pale blue, the dusty-rose accent, and red, fading to `selection`.
fn last_horizon() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 225,
        "lobe": 0.22,
        "mirror": false,
        "specularHalo": true,
        "gradient": [
            "rgba(e2dddcf0)",
            "rgba(c4d8e2c0)",
            "rgba(b5979090)",
            "rgba(c38b7b50)",
            "rgba(584e5100)"
        ],
        "gradientPositions": "0 18 44 72 100",
        "baseColor": "rgba(584e51dd)",
        "shimmer": true,
        "shimmerHz": 0.2,
        "shimmerDeg": 20,
        "shimmerScaleMin": 0.85,
        "shimmerScaleMax": 1.3,
        "activeOnly": true
    }))
}

/// Lumon. Clinical and symmetric: fluorescent light from straight above,
/// mirrored, a wide even band of icy cyans. No shimmer walk; a very slow
/// pulse is the only motion.
fn lumon() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 90,
        "lobe": 0.3,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(f2fcfff0)",
            "rgba(b4e4f6d0)",
            "rgba(8bc9eba0)",
            "rgba(6fb8e360)",
            "rgba(243d5600)"
        ],
        "gradientPositions": "0 20 46 74 100",
        "baseColor": "rgba(243d56dd)",
        "shimmer": false,
        "pulse": true,
        "pulseHz": 0.15,
        "activeOnly": true
    }))
}

/// Lupine. Light theme: sun behind the cherry blossoms in the lower left,
/// one source with a halo. Bright blues into violet and hot pink, fading to
/// `selection`; wrap stroke is `muted`.
fn lupine() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 225,
        "lobe": 0.2,
        "mirror": false,
        "specularHalo": true,
        "gradient": [
            "rgba(5482fff0)",
            "rgba(3264ebd0)",
            "rgba(b363ffa0)",
            "rgba(f930fb60)",
            "rgba(d0d0d000)"
        ],
        "gradientPositions": "0 18 44 72 100",
        "baseColor": "rgba(9e9e9edd)",
        "shimmer": true,
        "shimmerHz": 0.3,
        "shimmerDeg": 20,
        "shimmerScaleMin": 0.85,
        "shimmerScaleMax": 1.3,
        "activeOnly": true
    }))
}

/// Matte Black. A single amber sun on the horizon, overhead, with a halo.
/// Gold into the amber accent and ember red, fading to `selection`; the
/// walk is narrow so the sun stays put.
fn matte_black() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 90,
        "lobe": 0.16,
        "mirror": false,
        "specularHalo": true,
        "gradient": [
            "rgba(ffc107f0)",
            "rgba(f59e0bd8)",
            "rgba(e68e0da8)",
            "rgba(c63d3d58)",
            "rgba(2a2a2a00)"
        ],
        "gradientPositions": "0 14 38 68 100",
        "baseColor": "rgba(2a2a2add)",
        "shimmer": true,
        "shimmerHz": 0.25,
        "shimmerDeg": 10,
        "shimmerScaleMin": 0.9,
        "shimmerScaleMax": 1.2,
        "activeOnly": true
    }))
}

/// Miasma. A dim beam from the upper left through smoke: broad, low-alpha,
/// one source, drifting slowly and wide. Ash foreground into ochre, rust,
/// and the olive accent, fading to `selection`.
fn miasma() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 135,
        "lobe": 0.26,
        "mirror": false,
        "specularHalo": false,
        "gradient": [
            "rgba(c2c2b0c0)",
            "rgba(c9a554a0)",
            "rgba(b36d4370)",
            "rgba(78824b40)",
            "rgba(38383800)"
        ],
        "gradientPositions": "0 18 44 72 100",
        "baseColor": "rgba(383838dd)",
        "shimmer": true,
        "shimmerHz": 0.15,
        "shimmerDeg": 25,
        "shimmerScaleMin": 0.8,
        "shimmerScaleMax": 1.4,
        "activeOnly": true
    }))
}

/// Nord. Arctic sky light from above around the eclipsed moon, mirrored
/// like its orbit rings. Snow foreground into the frost cyans and the
/// accent blue, fading to `selection`; a calm, slow walk.
fn nord() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 90,
        "lobe": 0.2,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(d8dee9f0)",
            "rgba(88c0d0d0)",
            "rgba(8fbcbba0)",
            "rgba(81a1c160)",
            "rgba(434c5e00)"
        ],
        "gradientPositions": "0 16 42 72 100",
        "baseColor": "rgba(434c5edd)",
        "shimmer": true,
        "shimmerHz": 0.22,
        "shimmerDeg": 15,
        "shimmerScaleMin": 0.85,
        "shimmerScaleMax": 1.25,
        "activeOnly": true
    }))
}

/// Retro-82. The only ripple preset: the crests are record grooves. Warm
/// glint from the upper left, cream into the peach accent and orange with a
/// teal tail, fading to `selection`.
fn retro_82() -> Map<String, Value> {
    object(json!({
        "effect": "ripple",
        "borderSize": 2,
        "pinDeg": 135,
        "lobe": 0.14,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(f6dcacf0)",
            "rgba(faa968d8)",
            "rgba(e97b3ca8)",
            "rgba(3f8f8a60)",
            "rgba(134e5a00)"
        ],
        "gradientPositions": "0 14 38 68 100",
        "baseColor": "rgba(134e5add)",
        "rippleFreq": 0.035,
        "rippleSpeed": 2.5,
        "rippleGain": 0.7,
        "ripplePower": 6,
        "shimmer": true,
        "shimmerHz": 0.3,
        "shimmerDeg": 14,
        "shimmerScaleMin": 0.9,
        "shimmerScaleMax": 1.2,
        "activeOnly": true
    }))
}

/// Ristretto. Retro stripes fan down from the top, so one source from
/// above. Cream into peach and the coral accent with a coffee-brown tail;
/// wrap stroke is the warm `lighter_background`.
fn ristretto() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 90,
        "lobe": 0.2,
        "mirror": false,
        "specularHalo": false,
        "gradient": [
            "rgba(fcd675f0)",
            "rgba(f8a788d8)",
            "rgba(f38d70a8)",
            "rgba(7d4d3b58)",
            "rgba(403e4100)"
        ],
        "gradientPositions": "0 16 42 72 100",
        "baseColor": "rgba(3d2f2add)",
        "shimmer": true,
        "shimmerHz": 0.28,
        "shimmerDeg": 12,
        "shimmerScaleMin": 0.9,
        "shimmerScaleMax": 1.2,
        "activeOnly": true
    }))
}

/// Rosé Pine (Dawn). Light theme with playful pastel shapes: pine and the
/// deeper teal into rose and iris, fading to `selection`, lit from the
/// upper right with a wide, lively walk. Wrap stroke is `muted`.
fn rose_pine() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 60,
        "lobe": 0.22,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(56949ff0)",
            "rgba(286983c8)",
            "rgba(d7827e98)",
            "rgba(907aa958)",
            "rgba(dfdad900)"
        ],
        "gradientPositions": "0 20 46 74 100",
        "baseColor": "rgba(cecacddd)",
        "shimmer": true,
        "shimmerHz": 0.3,
        "shimmerDeg": 24,
        "shimmerScaleMin": 0.8,
        "shimmerScaleMax": 1.4,
        "activeOnly": true
    }))
}

/// Solitude. Monochrome ink skies: a grey ramp from near-white to the steel
/// accent, lit from a little right of overhead, with a slow, wide walk like
/// the swirling clouds.
fn solitude() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 75,
        "lobe": 0.16,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(d9dbdcf0)",
            "rgba(caccccd0)",
            "rgba(9fa5a9a0)",
            "rgba(79818660)",
            "rgba(343d4100)"
        ],
        "gradientPositions": "0 14 38 68 100",
        "baseColor": "rgba(343d41dd)",
        "shimmer": true,
        "shimmerHz": 0.2,
        "shimmerDeg": 30,
        "shimmerScaleMin": 0.8,
        "shimmerScaleMax": 1.4,
        "activeOnly": true
    }))
}

/// Vantablack. A razor edge on the void: tight, near-opaque white to grey,
/// mirrored, lit from the upper left like the geometric wallpapers. Nothing
/// moves: shimmer and pulse are both off.
fn vantablack() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 135,
        "lobe": 0.1,
        "mirror": true,
        "specularHalo": false,
        "gradient": [
            "rgba(fffffff8)",
            "rgba(ececece0)",
            "rgba(8d8d8da0)",
            "rgba(5c5c5c50)",
            "rgba(1a1a1a00)"
        ],
        "gradientPositions": "0 10 30 60 100",
        "baseColor": "rgba(1a1a1add)",
        "shimmer": false,
        "pulse": false,
        "activeOnly": true
    }))
}

/// White. Light theme of paper layers lit from the right: the "highlight"
/// is the theme's ink greys, one wide soft source, so the ring reads as a
/// shadow edge. Wrap stroke is `selection`.
fn white() -> Map<String, Value> {
    object(json!({
        "effect": "shiny",
        "borderSize": 2,
        "pinDeg": 30,
        "lobe": 0.24,
        "mirror": false,
        "specularHalo": false,
        "gradient": [
            "rgba(1a1a1ae8)",
            "rgba(2a2a2ac8)",
            "rgba(4a4a4a90)",
            "rgba(6e6e6e48)",
            "rgba(c0c0c000)"
        ],
        "gradientPositions": "0 18 44 72 100",
        "baseColor": "rgba(c0c0c0dd)",
        "shimmer": true,
        "shimmerHz": 0.2,
        "shimmerDeg": 18,
        "shimmerScaleMin": 0.9,
        "shimmerScaleMax": 1.2,
        "activeOnly": true
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::look::{self, color, schema};

    fn assert_valid(name: &str, preset: &Map<String, Value>) {
        assert!(!preset.is_empty(), "{name}: empty preset");
        for key in preset.keys() {
            assert!(key == "effect" || schema::spec(key).is_some(), "{name}: unknown look key {key:?}");
        }

        let (look, warn) = look::resolve_shared(&Value::Object(preset.clone()));
        assert!(warn.0.is_empty(), "{name}: {}", warn.0.join("; "));
        assert!(!look.effect.is_empty(), "{name}: resolve produced an empty look");

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
        for (name, preset) in STOCK {
            assert!(for_name(name).is_some(), "{name} is keyed in for_name");
            assert_valid(name, &preset());
        }
        assert!(for_name("not-a-stock-theme").is_none());
    }

    #[test]
    fn stock_names_are_unique_directory_names() {
        let mut seen = std::collections::BTreeSet::new();
        for (name, _) in STOCK {
            assert!(name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'), "{name}");
            assert!(seen.insert(*name), "{name} listed twice");
        }
    }

    /// Every preset ships a full five-stop ramp with matching positions,
    /// whose tail is fully transparent, and a wrap stroke; the effect is one
    /// that draws.
    #[test]
    fn each_stock_preset_has_a_complete_ramp() {
        for (name, preset) in STOCK {
            let p = preset();
            let effect = p["effect"].as_str().unwrap();
            assert!(look::effect_draws(effect), "{name}: effect {effect:?} does not draw");
            assert_eq!(p["borderSize"], 2, "{name}: presets keep the shared border size");

            let ramp = color::as_list(&p["gradient"]);
            assert_eq!(ramp.len(), 5, "{name}: five-stop ramp");
            let positions: Vec<&str> = p["gradientPositions"].as_str().unwrap().split(' ').collect();
            assert_eq!(positions.len(), ramp.len(), "{name}: one position per stop");
            assert_eq!(positions.first(), Some(&"0"), "{name}: ramp starts at the facing edge");
            assert_eq!(positions.last(), Some(&"100"), "{name}: ramp ends at the comet edge");

            let tail = color::parse(ramp.last().unwrap()).unwrap();
            assert_eq!(tail.a, 0.0, "{name}: ramp tail is transparent");
            let head = color::parse(&ramp[0]).unwrap();
            assert!(head.a > 0.7, "{name}: ramp head is solid enough to see");

            let wrap = color::parse(&p["baseColor"]).unwrap();
            assert!(wrap.a > 0.5, "{name}: wrap stroke is visible");
        }
    }
}
