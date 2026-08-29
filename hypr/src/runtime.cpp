#include "runtime.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

bool shinyCanUseMappedGeometry(bool mapped, bool rendererAlive) {
    return mapped && rendererAlive;
}

bool shinyCanDamage(bool mapped, bool rendererAlive, bool exclusiveFullscreen) {
    if (!shinyCanUseMappedGeometry(mapped, rendererAlive))
        return false;
    if (exclusiveFullscreen)
        return false;
    return true;
}

bool shinyCanBindVao(int vao) {
    return vao > 0;
}

int shinyResolvedBorderSize(int configured, int generalBorderSize) {
    if (configured >= 0)
        return configured;
    return generalBorderSize;
}

int shinyEffectiveBorderSize(int resolvedPx, bool enabled) {
    if (!enabled)
        return 0;
    return resolvedPx;
}

float shinyShaderThick(float logicalPx, float monitorScale, float modifScale) {
    return logicalPx * monitorScale * modifScale;
}

ShinyUpdateActions shinyUpdateWindowActions(const ShinyGeoLatch& now, int effectiveBorder, const ShinyGeoLatch& last,
                                            int lastEffectiveBorder) {
    const bool borderChanged = (effectiveBorder != lastEffectiveBorder);
    const bool geoChanged    = (now.posX != last.posX || now.posY != last.posY || now.sizeX != last.sizeX ||
                                now.sizeY != last.sizeY);
    return ShinyUpdateActions{
        .reposition = borderChanged,
        .damage     = geoChanged || borderChanged,
    };
}

int shinyFallbackExpandPx(int logicalPx, float monitorScale) {
    return static_cast<int>(std::round(static_cast<float>(logicalPx) * monitorScale));
}

ShinyDrawBackends shinyMapDrawBackends(const ShinyDrawShared& p, float monitorScale) {
    ShinyDrawBackends out;
    out.shader            = p;
    out.fallback.shared   = p;
    out.fallback.expandPx = shinyFallbackExpandPx(p.borderSize, monitorScale);
    return out;
}

float shinyFallbackPassAlpha(float payloadAlpha, bool pulseOn, float time, float pulseHz) {
    if (!pulseOn)
        return payloadAlpha;
    return payloadAlpha * shinyPulseAlphaMul(pulseHz, time);
}

bool shinyEffectDraws(const char* effect) {
    if (!effect || effect[0] == '\0')
        return true;
    return std::strcmp(effect, "shiny") == 0 || std::strcmp(effect, "ripple") == 0;
}

bool shinyEffectIsRipple(const char* effect) {
    return effect && std::strcmp(effect, "ripple") == 0;
}

float shinyRippleOriginR(float px, float py, float width, float height, float originX, float originY) {
    const float dx = px - (originX - 0.5f) * width;
    const float dy = py - (originY - 0.5f) * height;
    return std::hypot(dx, dy);
}

float shinyRipplePerimeter(float width, float height) {
    return 2.f * (width + height);
}

float shinyRippleFadeDistance(float fade, float width, float height) {
    if (!(fade > 0.f))
        return 0.f;
    return fade * shinyRipplePerimeter(width, height);
}

float shinyRippleFadeEnvelope(float r, float fadePx) {
    if (!(fadePx > 0.f))
        return 1.f;
    return std::clamp(1.f - r / fadePx, 0.f, 1.f);
}

float shinyRippleCrest(float r, float t, float freq, float speed, float power) {
    const float wave = std::sin(r * freq - t * speed);
    if (!(wave > 0.f))
        return 0.f;
    const float p = std::max(power, 1.f);
    return std::pow(wave, p);
}

float shinyRippleEnergy(float cone, float crest, float gain) {
    const float g        = std::clamp(gain, 0.f, 1.f);
    const float crestLit = std::clamp(gain * crest, 0.f, 1.f);
    return cone * (1.f - g) + crestLit * g;
}

float shinyRippleHighlightAlpha(float stopA, float cov, float crest, float gain, float pulseMul) {
    const float g        = std::clamp(gain, 0.f, 1.f);
    const float crestLit = std::clamp(gain * crest, 0.f, 1.f);
    return std::clamp((stopA * (1.f - g) + crestLit * g) * cov * pulseMul, 0.f, 1.f);
}

float shinyRippleTime(double clockSeconds) {
    constexpr double kPeriod = 1024.0;
    double           w       = std::fmod(clockSeconds, kPeriod);
    if (w < 0.0)
        w += kPeriod;
    return static_cast<float>(w);
}

float shinyShaderTime(bool pulseOn, bool rippleOn, double clockSeconds, float pulseHz) {
    if (rippleOn)
        return shinyRippleTime(clockSeconds);
    return shinyPulseUniforms(pulseOn, clockSeconds, pulseHz).time;
}

bool shinyTimerShouldRun(bool enabled, ShinyEffect mode, bool ripple, bool activeOnly, bool focused) {
    if (!enabled)
        return false;
    if (activeOnly && !focused)
        return false;
    if (ripple)
        return true;
    return mode != SHINY_EFFECT_NONE;
}

int shinyTimerTickMs(ShinyEffect mode, bool ripple, float pulseHz, float shimmerHz) {
    if (mode != SHINY_EFFECT_NONE)
        return shinyEffectTickMs(mode, pulseHz, shimmerHz);
    if (ripple)
        return shinyPulseTickMs(0.f);
    return shinyPulseTickMs(0.f);
}
