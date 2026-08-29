#pragma once

#include "gradient.hpp"
#include "shimmer.hpp"

#include <cstdint>

// Runtime decisions used by assignedBoxGlobal, damageEntire, shader draw,
// border-size fallback, and the unified draw-backend mapping. Hyprland-free
// so tests can drive the same functions without a compositor.
// Gradient lives in gradient.hpp (twin of qml/Gradient.js). Shimmer + pulse
// live in shimmer.hpp (twin of qml/Shimmer.js).

// assignedBoxGlobal / first gate of damageEntire:
// do not call getEdgeDefinedPoint or g_pHyprRenderer->damageRegion without a
// mapped window and a live renderer.
bool shinyCanUseMappedGeometry(bool mapped, bool rendererAlive);

// damageEntire after the mapped/renderer gate is known true:
// skip exclusive fullscreen (FSMODE_FULLSCREEN) — renderWindow already sets
// decorate = false for that mode. Mapped/renderer are still required so a
// caller cannot skip those by passing exclusiveFullscreen = false.
bool shinyCanDamage(bool mapped, bool rendererAlive, bool exclusiveFullscreen);

// shader draw: do not glBindVertexArray when the stashed VAO id is <= 0.
// createVao() can leave SHADER_SHADER_VAO at -1; binding 0xFFFFFFFF is
// GL_INVALID_OPERATION and a compositor kill on NVIDIA.
bool shinyCanBindVao(int vao);

// plugin:shiny-border:border_size vs general:border_size.
// configured >= 0 wins (including 0 = no ring); -1 follows general.
int shinyResolvedBorderSize(int configured, int generalBorderSize);

// Reserved extent after enabled. 0 if the plugin is off, otherwise
// resolvedPx. Unfocused windows still reserve (active_only only skips
// the shader / pulse / heading). Positioning uses this; drawing still
// uses the resolved px.
int shinyEffectiveBorderSize(int resolvedPx, bool enabled);

// Shader-path ring thickness: logical × monitor scale × renderModif combinedScale.
// SData.borderSize stores logical (unscaled) px; pass that in. Pre-scaling
// it and multiplying again is the double-scale bug (3px @ 2× → 12).
// combinedScale() is applied at upload in pass.cpp so deco does not need a
// modif it cannot see. Default 1 is identity (no zoom / no workspace scale).
float shinyShaderThick(float logicalPx, float monitorScale, float modifScale = 1.f);

// Dirty-check used by CShinyBorder::updateWindow. Hyprland-free so tests
// can drive the same decision the deco calls.
// Reposition only when effective border size changed (m_lastEffectiveB).
// Damage when window pos/size or that effective size changed.
// Unchanged geometry + unchanged effective border → neither
// (unrelated config reload).
struct ShinyGeoLatch {
    double posX  = 0;
    double posY  = 0;
    double sizeX = 0;
    double sizeY = 0;
};

struct ShinyUpdateActions {
    bool reposition = false;
    bool damage     = false;
};

ShinyUpdateActions shinyUpdateWindowActions(const ShinyGeoLatch& now, int effectiveBorder, const ShinyGeoLatch& last,
                                            int lastEffectiveBorder);

// Shared draw fields both backends consume. Colors are packed Hyprland
// CHyprColor uint64 (same as sc<uint64_t>(g_cfg.colA->value())).
// borderSize is logical (unscaled) px — SHADER_THICK / CBorderPassElement
// GL scale once. Do not store already-scaled px here.
// stopCount 0 = classic col.a/col.b comet; 2..SHINY_MAX_GRADIENT_STEPS =
// multi-step ramp through stops[0..stopCount-1] (head → lobe edge), each
// stop placed at stopPos (normalized, from shinyGradientResolvePositions).
// The CW trio is the clockwise half (shinyGradientResolveCwSide) — a
// mirror of the primary side unless gradient_cw / gradient_positions_cw
// override it. The shader consumes both. The CBorderPassElement fallback
// is emergency paint: a plain linear gradient of the primary side, with
// shimmer heading (drawAngle) and pulse alpha (shinyFallbackPassAlpha).
// wrap / baseColor, mirror two-head, and the clockwise half are shader-only.
struct ShinyDrawShared {
    int      rounding      = 0;
    int      outerRound    = 0;
    float    roundingPower = 2.f;
    float    a             = 1.f;
    int      borderSize    = 3; // logical (unscaled) px. Scale once (phase 4).
    uint64_t colA          = 0;
    uint64_t colB          = 0;
    uint64_t baseColor     = 0; // wrapping stroke, packed ARGB; a=0 off
    uint64_t stops[SHINY_MAX_GRADIENT_STEPS] = {};
    float    stopPos[SHINY_MAX_GRADIENT_STEPS] = {};
    int      stopCount     = 0;
    uint64_t stopsCW[SHINY_MAX_GRADIENT_STEPS] = {};
    float    stopPosCW[SHINY_MAX_GRADIENT_STEPS] = {};
    int      stopCountCW   = 0;
};

// Fallback-only: inner-box expand/inset px = round(logical × monitor scale).
struct ShinyFallbackPass {
    ShinyDrawShared shared;
    int             expandPx = 0;
};

struct ShinyDrawBackends {
    ShinyDrawShared   shader;
    ShinyFallbackPass fallback;
};

// Map one shared set into both backend payloads. Shader keeps logical
// borderSize; fallback expandPx is the only scale applied here.
ShinyDrawBackends shinyMapDrawBackends(const ShinyDrawShared& p, float monitorScale);

int shinyFallbackExpandPx(int logicalPx, float monitorScale);

// Fallback CBorderPassElement alpha. Pulse on multiplies payload alpha by
// the shipped shinyPulseAlphaMul; pulse off is identity. wrap / baseColor,
// mirror two-head, and the clockwise half stay shader-only.
float shinyFallbackPassAlpha(float payloadAlpha, bool pulseOn, float time, float pulseHz);

// Renderer string on the look / plugin:shiny-border:effect. Empty/null is
// shiny. Do not put these on ShinyEffect (that enum is pulse vs shimmer).
bool shinyEffectDraws(const char* effect);
bool shinyEffectIsRipple(const char* effect);

// Twin of the ripple fragment: pow(max(sin(r*freq - t*speed), 0), max(power, 1)).
// energy = max(cone, gain * crest); gain 0 matches shiny lighting.
float shinyRippleCrest(float r, float t, float freq, float speed, float power);
float shinyRippleEnergy(float cone, float crest, float gain);
float shinyRippleHighlightAlpha(float stopA, float cov, float crest, float gain, float pulseMul);

// Live clock for crest (and for pulse-on-ripple). Wrap so float time
// keeps sub-frame precision; not the pulse 1/hz wrap.
float shinyRippleTime(double clockSeconds);

// Shader `time` uniform: ripple keeps the live clock even when pulse is
// off. Pulse-only still uses shinyPulseUniforms (zero when pulse is off).
float shinyShaderTime(bool pulseOn, bool rippleOn, double clockSeconds, float pulseHz);

// Ring-damage timer: ripple needs a tick with pulse and shimmer both off.
// active_only still skips unfocused. Not a ShinyEffect::RIPPLE.
bool shinyTimerShouldRun(bool enabled, ShinyEffect mode, bool ripple, bool activeOnly, bool focused);
int  shinyTimerTickMs(ShinyEffect mode, bool ripple, float pulseHz, float shimmerHz);
