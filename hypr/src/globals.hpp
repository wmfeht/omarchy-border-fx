#pragma once

#include <optional>

#include <hyprland/src/plugins/PluginAPI.hpp>
#include <hyprland/src/config/values/ConfigValues.hpp>
#include <hyprland/src/config/ConfigValue.hpp>
#include <hyprland/src/helpers/signal/Signal.hpp>

inline HANDLE PHANDLE = nullptr;

struct SShinyConfig {
    SP<Config::Values::CBoolValue>  enabled;
    SP<Config::Values::CBoolValue>  activeOnly;
    SP<Config::Values::CBoolValue>  pulse;
    SP<Config::Values::CBoolValue>  shimmer;
    SP<Config::Values::CBoolValue>  mirrorLobe;
    SP<Config::Values::CIntValue>   angleOffset;
    SP<Config::Values::CIntValue>   pinDeg;
    SP<Config::Values::CIntValue>   shimmerDeg;
    SP<Config::Values::CIntValue>   borderSize;
    SP<Config::Values::CFloatValue> pulseHz;
    SP<Config::Values::CFloatValue> shimmerHz;
    SP<Config::Values::CFloatValue> shimmerScaleMin;
    SP<Config::Values::CFloatValue> shimmerScaleMax;
    SP<Config::Values::CFloatValue> lobe;
    SP<Config::Values::CColorValue> colA;
    SP<Config::Values::CColorValue> colB;
    // Wrapping ring stroke under the highlight. Transparent (a=0) = off.
    // Packed ARGB; default matches the shared look rgba(00687855).
    SP<Config::Values::CColorValue> baseColor;
    // Optional multi-step ramp. Fewer than two colors (the single-color
    // default) keeps the classic col.a/col.b comet; two or more colors
    // replace it, first color at the head. The gradient's own angle is
    // ignored — the heading is pin_deg + angle_offset.
    SP<Config::Values::CGradientValue> gradient;
    // Per-stop positions, one percentage per gradient color ("0 70 100"),
    // of the lit band (lobe), not the full window. Empty (default), count
    // mismatch, or junk = even spacing.
    SP<Config::Values::CStringValue>   gradientPositions;
    // Clockwise-half override. Unset (single-color default / empty spec)
    // mirrors the primary side; gradient_positions_cw alone reshapes the
    // half with the primary colors. Only active while gradient is on.
    SP<Config::Values::CGradientValue> gradientCw;
    SP<Config::Values::CStringValue>   gradientPositionsCw;
    // Pointer into Hyprland's CConfigValueBase::registry(). Bound in
    // PLUGIN_INIT, reset in PLUGIN_EXIT — must not be a function-local static
    // (that destructor runs during dlclose; flushCaches() can UAF).
    std::optional<CConfigValue<Config::INTEGER>> generalBorderSize;
};

inline constexpr const char* kGeneralBorderSizeKey = "general:border_size";

inline SShinyConfig g_cfg;

// Keep these alive: hyprutils unregisters the listener when the SP dies.
inline CHyprSignalListener g_onWindowOpen;
inline CHyprSignalListener g_onFocus;
