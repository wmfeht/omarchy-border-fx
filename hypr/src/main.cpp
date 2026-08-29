#include "globals.hpp"
#include "deco.hpp"
#include "pass.hpp"
#include "runtime.hpp"

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/desktop/state/FocusState.hpp>
#include <hyprland/src/desktop/state/WindowState.hpp>
#include <hyprland/src/desktop/view/Window.hpp>
#include <hyprland/src/event/EventBus.hpp>
#include <hyprland/src/helpers/memory/Memory.hpp>
#include <hyprland/src/render/Renderer.hpp>

using namespace Hyprutils::Memory;
using namespace Desktop::View;

static CShinyBorder* shinyOn(PHLWINDOW window) {
    for (auto& d : window->m_windowDecorations) {
        if (auto* shiny = dynamic_cast<CShinyBorder*>(d.get()))
            return shiny;
    }
    return nullptr;
}

static void attach(PHLWINDOW window) {
    if (!validMapped(window) || shinyOn(window))
        return;
    HyprlandAPI::addWindowDecoration(PHANDLE, window, makeUnique<CShinyBorder>(window));
}

APICALL EXPORT std::string PLUGIN_API_VERSION() {
    return HYPRLAND_API_VERSION;
}

APICALL EXPORT PLUGIN_DESCRIPTION_INFO PLUGIN_INIT(HANDLE handle) {
    // Same-path load after unload can reuse the mapping; statics would stay
    // teardown-forever / fallback-forever without this.
    shinyResetLifecycle();

    PHANDLE = handle;

    const std::string HASH        = __hyprland_api_get_hash();
    const std::string CLIENT_HASH = __hyprland_api_get_client_hash();

    if (HASH != CLIENT_HASH) {
        HyprlandAPI::addNotification(PHANDLE,
                                     "[shiny-border] Header/compositor hash mismatch. Rebuild against this Hyprland.",
                                     CHyprColor{1.0, 0.2, 0.2, 1.0}, 8000);
        throw std::runtime_error("[shiny-border] version mismatch");
    }

    // ARGB ints. Defaults match Omarchy's two-stop active gradient.
    g_cfg.enabled      = makeShared<Config::Values::CBoolValue>("plugin:shiny-border:enabled", "Master switch", true);
    g_cfg.activeOnly   = makeShared<Config::Values::CBoolValue>("plugin:shiny-border:active_only", "Only the focused window draws the ring / pulses; unfocused keep padding", true);
    g_cfg.pulse        = makeShared<Config::Values::CBoolValue>("plugin:shiny-border:pulse", "Oscillate highlight transparency", true);
    g_cfg.shimmer      = makeShared<Config::Values::CBoolValue>("plugin:shiny-border:shimmer", "Randomly wander and resize the highlight; exclusive with pulse (shimmer wins)", false);
    g_cfg.angleOffset  = makeShared<Config::Values::CIntValue>("plugin:shiny-border:angle_offset", "Degrees added to the comet heading", 0,
                                                               Config::Values::SIntValueOptions{.min = -180, .max = 180});
    g_cfg.pinDeg       = makeShared<Config::Values::CIntValue>("plugin:shiny-border:pin_deg", "Light heading, degrees CCW; 0 = right, 90 = up", 90,
                                                               Config::Values::SIntValueOptions{.min = -360, .max = 360});
    g_cfg.shimmerDeg   = makeShared<Config::Values::CIntValue>("plugin:shiny-border:shimmer_deg", "Max shimmer wander each side of the heading, degrees", 25,
                                                               Config::Values::SIntValueOptions{.min = 0, .max = 180});
    g_cfg.borderSize   = makeShared<Config::Values::CIntValue>("plugin:shiny-border:border_size", "Border px, -1 = general:border_size", 3,
                                                               Config::Values::SIntValueOptions{.min = -1, .max = 20});
    g_cfg.pulseHz      = makeShared<Config::Values::CFloatValue>("plugin:shiny-border:pulse_hz", "Oscillation rate; 0 disables", 0.4,
                                                                 Config::Values::SFloatValueOptions{.min = 0.f, .max = 4.f});
    g_cfg.shimmerHz    = makeShared<Config::Values::CFloatValue>("plugin:shiny-border:shimmer_hz", "Average shimmer retargets per second; 0 disables", 0.6,
                                                                 Config::Values::SFloatValueOptions{.min = 0.f, .max = 4.f});
    g_cfg.shimmerScaleMin = makeShared<Config::Values::CFloatValue>("plugin:shiny-border:shimmer_scale_min", "Lower bound of the shimmer size scale", 0.75,
                                                                    Config::Values::SFloatValueOptions{.min = 0.2f, .max = 3.f});
    g_cfg.shimmerScaleMax = makeShared<Config::Values::CFloatValue>("plugin:shiny-border:shimmer_scale_max", "Upper bound of the shimmer size scale", 1.35,
                                                                    Config::Values::SFloatValueOptions{.min = 0.2f, .max = 3.f});
    g_cfg.lobe         = makeShared<Config::Values::CFloatValue>("plugin:shiny-border:lobe", "Lit-band half-width along the light axis; 0.5 = the whole window", 0.18,
                                                                Config::Values::SFloatValueOptions{.min = 0.04, .max = 0.5});
    g_cfg.mirrorLobe   = makeShared<Config::Values::CBoolValue>("plugin:shiny-border:mirror_lobe", "Mirror the lit-band lobe onto the far side of the border", false);
    g_cfg.colA         = makeShared<Config::Values::CColorValue>("plugin:shiny-border:col.a", "Highlight head (ARGB)", 0xee33ccff);
    g_cfg.colB         = makeShared<Config::Values::CColorValue>("plugin:shiny-border:col.b", "Highlight shoulder (ARGB)", 0xee00ff99);
    g_cfg.baseColor    = makeShared<Config::Values::CColorValue>("plugin:shiny-border:base_color",
                                                                "Wrapping ring stroke under the highlight; transparent = off (ARGB)", 0x55006878);
    // Single-color default = off (a ramp needs two stops). The gradient's own
    // angle is ignored: the comet heading is pin_deg + angle_offset.
    g_cfg.gradient     = makeShared<Config::Values::CGradientValue>("plugin:shiny-border:gradient",
                                                                    "Multi-step comet ramp, head first; last stop is the lobe edge; fewer than two colors keeps col.a/col.b; angle is ignored",
                                                                    CHyprColor{0xee33ccff});
    g_cfg.gradientPositions = makeShared<Config::Values::CStringValue>("plugin:shiny-border:gradient_positions",
                                                                       "Ramp position per gradient color, percent of the lit band (\"0 70 100\"); empty = even spacing",
                                                                       "");
    g_cfg.gradientCw        = makeShared<Config::Values::CGradientValue>("plugin:shiny-border:gradient_cw",
                                                                         "Clockwise-half colors; fewer than two mirrors gradient; match first/last colors to avoid seams",
                                                                         CHyprColor{0xee33ccff});
    g_cfg.gradientPositionsCw = makeShared<Config::Values::CStringValue>("plugin:shiny-border:gradient_positions_cw",
                                                                         "Clockwise-half ramp positions, percent of the lit band (\"0 30 100\"); empty = mirror / even spacing",
                                                                         "");

    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.enabled);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.activeOnly);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.pulse);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.shimmer);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.angleOffset);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.pinDeg);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.shimmerDeg);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.borderSize);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.pulseHz);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.shimmerHz);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.shimmerScaleMin);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.shimmerScaleMax);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.lobe);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.mirrorLobe);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.colA);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.colB);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.baseColor);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.gradient);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.gradientPositions);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.gradientCw);
    HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.gradientPositionsCw);

    HyprlandAPI::reloadConfig();

    // One handle, plugin-owned. ~CConfigValue erases from the compositor
    // registry; PLUGIN_EXIT resets this before dlclose.
    g_cfg.generalBorderSize.emplace(kGeneralBorderSizeKey);

    g_onWindowOpen = Event::bus()->m_events.window.open.listen([](PHLWINDOW w) { attach(w); });
    g_onFocus      = Event::bus()->m_events.window.active.listen([](PHLWINDOW, Desktop::eFocusReason) {
        for (auto& w : Desktop::windowState()->windows()) {
            if (auto* d = shinyOn(w)) {
                d->syncExtents();
                d->syncPulse();
                d->damageEntire();
            }
        }
    });

    for (auto& w : Desktop::windowState()->windows())
        attach(w);

    HyprlandAPI::addNotification(PHANDLE, "[shiny-border] pinned heading. try not to crash the nest.",
                                 CHyprColor{0.2, 1.0, 0.6, 1.0}, 4000);

    return {"hypr-shiny-border", "Gradient window border with a directional highlight", "wmfeht", "0.1.0"};
}

APICALL EXPORT void PLUGIN_EXIT() {
    // Event::bus() listeners are not plugin-API callbacks. Hyprland will not
    // drop them for us — the SP must die before dlclose or the next
    // window.open / window.active jumps into unmapped .so text.
    g_onWindowOpen.reset();
    g_onFocus.reset();

    // Leftover draw() must not compile a new program into a dying .so.
    markShinyTeardown();

    // Leftover pass is already-rendered dead data. clear() destroys nested
    // CTransformedWindowPassElement → nested CShinyPassElement before dlclose.
    // removeAllOfType("CShinyPassElement") does not recurse.
    // Do not remove CBorderPassElement: that is the stock border too.
    if (g_pHyprRenderer)
        g_pHyprRenderer->m_renderPass.clear();

    destroyShinyShader();

    // Destroy before dlclose so a later config reload cannot flushCaches()
    // through a pointer into unmapped plugin text.
    g_cfg.generalBorderSize.reset();
}
