#include "deco.hpp"
#include "globals.hpp"
#include "runtime.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <vector>

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/desktop/Workspace.hpp>
#include <hyprland/src/desktop/state/FocusState.hpp>
#include <hyprland/src/desktop/view/Window.hpp>
#include <hyprland/src/output/Monitor.hpp>
#include <hyprland/src/render/Renderer.hpp>
#include <hyprland/src/render/decorations/DecorationPositioner.hpp>
#include <hyprland/src/render/pass/BorderPassElement.hpp>
#include <hyprland/src/helpers/memory/Memory.hpp>
#include <hyprland/src/managers/eventLoop/EventLoopManager.hpp>
#include <hyprland/src/managers/fullscreen/FullscreenController.hpp>
#include "pass.hpp"

using namespace Hyprutils::Memory;
using namespace Desktop::View;

// Positions / CW resolve on spec change, not every deco draw().
static ShinyGradientCache g_gradCache;

CShinyBorder::CShinyBorder(PHLWINDOW window) : IHyprWindowDecoration(window), m_window(window) {
    m_lastPos  = window->position(IGeometric::GEOMETRIC_CURRENT);
    m_lastSize = window->size(IGeometric::GEOMETRIC_CURRENT);
    // Per-deco stream so overlapping windows do not shimmer in unison.
    shinyShimmerSeed(m_shimmer, sc<uint32_t>(reinterpret_cast<uintptr_t>(this) >> 4));
    syncPulse();
}

CShinyBorder::~CShinyBorder() {
    if (!m_pulseTimer)
        return;
    m_pulseTimer->cancel();
    if (g_pEventLoopManager)
        g_pEventLoopManager->removeTimer(m_pulseTimer);
    m_pulseTimer.reset();
}

ShinyEffect CShinyBorder::effectMode() const {
    return shinyEffectMode(g_cfg.pulse->value(), sc<float>(g_cfg.pulseHz->value()), g_cfg.shimmer->value(),
                           sc<float>(g_cfg.shimmerHz->value()));
}

ShinyShimmerParams CShinyBorder::shimmerParams() const {
    const float pi = std::acos(-1.f);
    return ShinyShimmerParams{
        .hz            = sc<float>(g_cfg.shimmerHz->value()),
        .angleRangeRad = sc<float>(g_cfg.shimmerDeg->value()) * pi / 180.f,
        .scaleMin      = sc<float>(g_cfg.shimmerScaleMin->value()),
        .scaleMax      = sc<float>(g_cfg.shimmerScaleMax->value()),
    };
}

bool CShinyBorder::rippleOn() const {
    return shinyEffectIsRipple(g_cfg.effect ? g_cfg.effect->value().c_str() : "");
}

bool CShinyBorder::pulseWanted() const {
    const auto PWINDOW = m_window.lock();
    const bool focused = PWINDOW && PWINDOW == Desktop::focusState()->window();
    return shinyTimerShouldRun(g_cfg.enabled->value(), effectMode(), rippleOn(), g_cfg.activeOnly->value(), focused);
}

void CShinyBorder::startPulse() {
    if (!g_pEventLoopManager)
        return;

    const auto period = std::chrono::milliseconds(
        shinyTimerTickMs(effectMode(), rippleOn(), sc<float>(g_cfg.pulseHz->value()), sc<float>(g_cfg.shimmerHz->value())));

    if (!m_pulseTimer) {
        m_pulseTimer = makeShared<CEventLoopTimer>(
            period, [this](SP<CEventLoopTimer> self, void*) { onPulseTick(self); }, nullptr);
        g_pEventLoopManager->addTimer(m_pulseTimer);
        damageEntire();
        return;
    }

    if (!m_pulseTimer->armed()) {
        m_pulseTimer->updateTimeout(period);
        damageEntire();
    }
}

void CShinyBorder::stopPulse() {
    m_lastShimmerTick.reset();
    if (!m_pulseTimer)
        return;
    // Disarm only — cancel() is sticky and would prevent a later re-arm.
    m_pulseTimer->updateTimeout(std::nullopt);
}

void CShinyBorder::onPulseTick(SP<CEventLoopTimer> self) {
    if (!validMapped(m_window)) {
        stopPulse();
        return;
    }
    if (!pulseWanted()) {
        stopPulse();
        damageEntire();
        return;
    }

    const auto mode = effectMode();
    if (mode == SHINY_EFFECT_SHIMMER) {
        const auto now = std::chrono::steady_clock::now();
        float      dt  = 0.f;
        if (m_lastShimmerTick)
            dt = std::clamp(std::chrono::duration<float>(now - *m_lastShimmerTick).count(), 0.f, 0.25f);
        m_lastShimmerTick = now;
        shinyShimmerStep(m_shimmer, dt, shimmerParams());
    } else {
        m_lastShimmerTick.reset();
    }

    damageEntire();
    if (self)
        self->updateTimeout(std::chrono::milliseconds(
            shinyTimerTickMs(mode, rippleOn(), sc<float>(g_cfg.pulseHz->value()), sc<float>(g_cfg.shimmerHz->value()))));
}

void CShinyBorder::syncPulse() {
    if (pulseWanted()) {
        startPulse();
        return;
    }
    const bool wasArmed = m_pulseTimer && m_pulseTimer->armed();
    stopPulse();
    if (wasArmed)
        damageEntire();
}

int CShinyBorder::borderSize() const {
    const int configured = sc<int>(g_cfg.borderSize->value());
    int       general    = 0;
    if (g_cfg.generalBorderSize && g_cfg.generalBorderSize->good())
        general = sc<int>(*g_cfg.generalBorderSize.value());
    return shinyResolvedBorderSize(configured, general);
}

int CShinyBorder::effectiveBorderSize() const {
    return shinyEffectiveBorderSize(borderSize(), g_cfg.enabled->value());
}

void CShinyBorder::syncExtents() {
    const int bs = effectiveBorderSize();
    if (bs == m_lastEffectiveB)
        return;
    m_lastEffectiveB = bs;
    g_pDecorationPositioner->repositionDeco(this);
}

SDecorationPositioningInfo CShinyBorder::getPositioningInfo() {
    const int bs = effectiveBorderSize();
    m_extents    = {{bs, bs}, {bs, bs}};

    SDecorationPositioningInfo info;
    info.policy         = DECORATION_POSITION_STICKY;
    info.edges          = DECORATION_EDGE_BOTTOM | DECORATION_EDGE_LEFT | DECORATION_EDGE_RIGHT | DECORATION_EDGE_TOP;
    info.reserved       = true;
    info.priority       = 9990; // stock border is 10000; we sit just inside its claim
    info.desiredExtents = m_extents;
    return info;
}

void CShinyBorder::onPositioningReply(const SDecorationPositioningReply& reply) {
    m_assignedGeometry = reply.assignedGeometry;
}

CBox CShinyBorder::assignedBoxGlobal() {
    if (!shinyCanUseMappedGeometry(validMapped(m_window), static_cast<bool>(g_pHyprRenderer)))
        return {};

    const auto PWINDOW = m_window.lock();
    if (!PWINDOW)
        return {};

    CBox box = m_assignedGeometry;
    box.translate(g_pDecorationPositioner->getEdgeDefinedPoint(
        DECORATION_EDGE_BOTTOM | DECORATION_EDGE_LEFT | DECORATION_EDGE_RIGHT | DECORATION_EDGE_TOP, m_window));

    if (!PWINDOW->m_workspace)
        return box;

    if (!PWINDOW->m_pinned)
        box.translate(PWINDOW->m_workspace->m_renderOffset->value());

    return box;
}

void CShinyBorder::draw(PHLMONITOR pMonitor, float const& a) {
    if (!validMapped(m_window)) {
        stopPulse();
        return;
    }

    syncPulse();

    if (!g_cfg.enabled->value())
        return;

    const auto PWINDOW = m_window.lock();
    if (!PWINDOW)
        return;

    if (g_cfg.activeOnly->value() && PWINDOW != Desktop::focusState()->window())
        return;

    const int BORDERSIZE = borderSize();
    if (BORDERSIZE <= 0)
        return;

    if (m_assignedGeometry.width < m_extents.topLeft.x + 1 || m_assignedGeometry.height < m_extents.topLeft.y + 1)
        return;

    CBox outerBox = assignedBoxGlobal()
                        .translate(-pMonitor->m_position + PWINDOW->m_floatingOffset)
                        .scale(pMonitor->m_scale)
                        .round();

    if (outerBox.width < 1 || outerBox.height < 1)
        return;

    ShinyDrawShared shared{
        .rounding      = sc<int>(PWINDOW->rounding() * pMonitor->m_scale),
        .outerRound    = sc<int>((PWINDOW->rounding() + BORDERSIZE) * pMonitor->m_scale),
        .roundingPower = PWINDOW->roundingPower(),
        .a             = a,
        .borderSize    = BORDERSIZE,
        .colA          = sc<uint64_t>(g_cfg.colA->value()),
        .colB          = sc<uint64_t>(g_cfg.colB->value()),
        .baseColor     = sc<uint64_t>(g_cfg.baseColor->value()),
    };
    // Fewer than two gradient colors (unset, or an explicit one-color /
    // empty override) keeps stopCount at 0 → col.a/col.b. The shared
    // look default is four stops.
    const auto& gradientCfg = g_cfg.gradient->value();
    shared.stopCount        = shinyGradientStepCount(sc<int>(gradientCfg.m_colors.size()));
    for (int i = 0; i < shared.stopCount; i++)
        shared.stops[i] = sc<uint64_t>(gradientCfg.m_colors[sc<size_t>(i)].getAsHex());

    // Clockwise half: mirrors the primary side unless gradient_cw /
    // gradient_positions_cw override it. Only the shader can draw the
    // asymmetry — the fallback linear gradient stays primary-side.
    // Position / CW strings are resolved on spec change (cached), not
    // tokenized from the raw spec on every draw().
    const auto& gradientCwCfg = g_cfg.gradientCw->value();
    uint64_t    cwColors[SHINY_MAX_GRADIENT_STEPS] = {};
    const int   cwColorCount = shinyGradientStepCount(sc<int>(gradientCwCfg.m_colors.size()));
    for (int i = 0; i < cwColorCount; i++)
        cwColors[i] = sc<uint64_t>(gradientCwCfg.m_colors[sc<size_t>(i)].getAsHex());
    const auto ramp = shinyGradientCacheEnsure(g_gradCache, g_cfg.gradientPositions->value().c_str(),
                                               shared.stopCount, shared.stops, cwColors, cwColorCount,
                                               g_cfg.gradientPositionsCw->value().c_str());
    const bool customPos = ramp.customPos;
    shared.stopCountCW   = ramp.cw.count;
    for (int i = 0; i < SHINY_MAX_GRADIENT_STEPS; i++) {
        shared.stopPos[i]   = ramp.stopPos[i];
        shared.stopsCW[i]   = ramp.cw.stops[i];
        shared.stopPosCW[i] = ramp.cw.pos[i];
    }

    const auto mapped = shinyMapDrawBackends(shared, pMonitor->m_scale);

    const float baseAngle =
        shinyPinnedHeading(sc<int>(g_cfg.pinDeg->value()), sc<int>(g_cfg.angleOffset->value()));

    const auto mode       = effectMode();
    float      drawAngle  = baseAngle;
    float      lobe       = sc<float>(g_cfg.lobe->value());
    float      thickScale = 1.f;
    if (mode == SHINY_EFFECT_SHIMMER) {
        drawAngle  = shinyWrapAngle(baseAngle + m_shimmer.angle.value);
        lobe       = shinyShimmerLobe(lobe, m_shimmer.scale.value);
        thickScale = shinyShimmerThickScale(m_shimmer.scale.value);
    }

    const double seconds =
        std::chrono::duration<double>(Time::steadyNow() - g_pHyprRenderer->m_globalTimer.chrono()).count();
    // Shimmer is exclusive with pulse: zero uniforms take the shader's
    // nominal branch, and the shimmer channels modulate angle/lobe here.
    // Ripple keeps compositor time even when pulse is off (crest is f(time)).
    const bool ripple = rippleOn();
    const auto pulseU = shinyPulseUniforms(mode == SHINY_EFFECT_PULSE, seconds, sc<float>(g_cfg.pulseHz->value()));
    const float shaderTime =
        shinyShaderTime(mode == SHINY_EFFECT_PULSE, ripple, seconds, sc<float>(g_cfg.pulseHz->value()));

    if (ensureShinyShader()) {
        CShinyPassElement::SData data;
        data.shared      = mapped.shader;
        data.box         = outerBox;
        data.angle       = drawAngle;
        data.time        = shaderTime;
        data.pulseHz     = pulseU.pulseHz;
        data.lobe        = lobe;
        data.thickScale  = thickScale;
        data.mirror      = g_cfg.mirror->value();
        data.customPos   = customPos;
        data.ripple      = ripple;
        data.rippleFreq  = g_cfg.rippleFreq ? sc<float>(g_cfg.rippleFreq->value()) : 0.025f;
        data.rippleSpeed = g_cfg.rippleSpeed ? sc<float>(g_cfg.rippleSpeed->value()) : 2.f;
        data.rippleGain  = g_cfg.rippleGain ? sc<float>(g_cfg.rippleGain->value()) : 0.85f;
        data.ripplePower = g_cfg.ripplePower ? sc<float>(g_cfg.ripplePower->value()) : 8.f;
        data.window      = m_window;
        g_pHyprRenderer->addPassElement(makeUnique<CShinyPassElement>(data));
        return;
    }

    // Emergency linear paint: heading still reaches the fallback via
    // drawAngle; pulse scales fallback alpha. wrap / baseColor, mirror
    // two-head, and the clockwise half stay shader-only.
    CShinyPassElement::SData fallback;
    fallback.shared    = mapped.fallback.shared;
    fallback.box       = outerBox;
    fallback.angle     = drawAngle;
    fallback.time      = shaderTime;
    fallback.pulseHz   = pulseU.pulseHz;
    fallback.customPos = customPos;
    fallback.window    = m_window;
    for (auto& el : shinyLinearFallbackElements(fallback, pMonitor->m_scale))
        g_pHyprRenderer->addPassElement(std::move(el));
}

eDecorationType CShinyBorder::getDecorationType() {
    return DECORATION_CUSTOM;
}

void CShinyBorder::updateWindow(PHLWINDOW pWindow) {
    const auto pos  = pWindow->position(IGeometric::GEOMETRIC_CURRENT);
    const auto size = pWindow->size(IGeometric::GEOMETRIC_CURRENT);
    const int  bs   = effectiveBorderSize();

    const auto actions = shinyUpdateWindowActions(
        ShinyGeoLatch{pos.x, pos.y, size.x, size.y}, bs,
        ShinyGeoLatch{m_lastPos.x, m_lastPos.y, m_lastSize.x, m_lastSize.y}, m_lastEffectiveB);

    syncExtents();

    m_lastPos  = pos;
    m_lastSize = size;

    if (actions.damage)
        damageEntire();

    syncPulse();
}

void CShinyBorder::damageEntire() {
    const bool mapped   = validMapped(m_window);
    const bool renderer = static_cast<bool>(g_pHyprRenderer);
    // mapped + renderer first — fullscreen lookup is not safe on an unmapped
    // / closing window, and renderer damage is not safe with a null renderer.
    if (!shinyCanUseMappedGeometry(mapped, renderer))
        return;

    const auto PWINDOW = m_window.lock();
    if (!PWINDOW)
        return;

    // skip exclusive fullscreen — renderWindow already sets decorate = false
    // for that mode
    const bool exclusiveFs =
        Fullscreen::controller()->getFullscreenModes(PWINDOW).internal == Fullscreen::FSMODE_FULLSCREEN;
    if (!shinyCanDamage(mapped, renderer, exclusiveFs))
        return;

    CBox dm = assignedBoxGlobal();
    if (dm.w <= 0 || dm.h <= 0)
        return;

    const int pad = std::max(borderSize() + 6, 8);
    CRegion   rg{dm.copy().expand(2)};
    CBox      hole = dm.copy().expand(-pad);
    if (hole.w > 1 && hole.h > 1)
        rg.subtract(hole);
    g_pHyprRenderer->damageRegion(rg);
}

eDecorationLayer CShinyBorder::getDecorationLayer() {
    return DECORATION_LAYER_OVER;
}

uint64_t CShinyBorder::getDecorationFlags() {
    return DECORATION_PART_OF_MAIN_WINDOW;
}

std::string CShinyBorder::getDisplayName() {
    return "Shiny Border";
}
