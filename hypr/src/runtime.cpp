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

float shinyRippleCrest(float r, float t, float freq, float speed, float power) {
    const float wave = std::sin(r * freq - t * speed);
    if (!(wave > 0.f))
        return 0.f;
    const float p = std::max(power, 1.f);
    return std::pow(wave, p);
}

float shinyRippleEnergy(float cone, float crest, float gain) {
    return std::max(cone, gain * crest);
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
