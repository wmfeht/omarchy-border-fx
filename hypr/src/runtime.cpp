#include "runtime.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>

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

int shinyGradientStepCount(int configured) {
    if (configured < 2)
        return 0;
    return std::min(configured, SHINY_MAX_GRADIENT_STEPS);
}

float shinyGradientStopPos(int i, int count) {
    if (count < 2)
        return 0.f;
    const int clamped = std::clamp(i, 0, count - 1);
    return static_cast<float>(clamped) / static_cast<float>(count - 1);
}

float shinyGradientLobeU(float uAxis, float spread, bool mirrorLobe) {
    const float u  = std::clamp(uAxis, 0.f, 1.f);
    const float d0 = (mirrorLobe ? std::min(u, 1.f - u) : u) * 0.5f;
    const float s  = std::max(spread, 0.04f);
    return std::clamp(d0 / s, 0.f, 1.f);
}

bool shinyGradientResolvePositions(const char* spec, int count, float out[SHINY_MAX_GRADIENT_STEPS]) {
    for (int i = 0; i < SHINY_MAX_GRADIENT_STEPS; i++)
        out[i] = shinyGradientStopPos(i, count);

    if (!spec || count < 2 || count > SHINY_MAX_GRADIENT_STEPS)
        return false;

    // One percentage per stop, or the whole spec is rejected — a partial
    // list silently stretching the rest would be harder to reason about
    // than "wrong count = even spacing".
    float       parsed[SHINY_MAX_GRADIENT_STEPS];
    int         found = 0;
    const char* p     = spec;
    while (*p) {
        if (*p == ' ' || *p == '\t' || *p == ',') {
            p++;
            continue;
        }
        char*       end = nullptr;
        const float v   = std::strtof(p, &end);
        if (end == p)
            return false; // junk token
        if (*end == '%')
            end++;
        if (*end && *end != ' ' && *end != '\t' && *end != ',')
            return false; // trailing junk glued to the number
        if (found >= count)
            return false; // more positions than colors
        parsed[found++] = std::clamp(v, 0.f, 100.f) / 100.f;
        p               = end;
    }
    if (found != count)
        return false;

    // Non-decreasing: a stop cannot sit before its predecessor.
    for (int i = 1; i < found; i++)
        parsed[i] = std::max(parsed[i], parsed[i - 1]);

    for (int i = 0; i < found; i++)
        out[i] = parsed[i];
    return true;
}

static void shinyUnpackArgb(uint64_t argb, float rgba[4]) {
    rgba[0] = static_cast<float>((argb >> 16) & 0xFF) / 255.f;
    rgba[1] = static_cast<float>((argb >> 8) & 0xFF) / 255.f;
    rgba[2] = static_cast<float>(argb & 0xFF) / 255.f;
    rgba[3] = static_cast<float>((argb >> 24) & 0xFF) / 255.f;
}

void shinyWrapComposite(const float highlightPremul[4], const float baseStraight[4], float ringCoverage,
                        float outPremul[4]) {
    if (!outPremul)
        return;
    if (!highlightPremul) {
        outPremul[0] = outPremul[1] = outPremul[2] = outPremul[3] = 0.f;
        return;
    }
    if (!baseStraight || baseStraight[3] <= 0.f) {
        outPremul[0] = highlightPremul[0];
        outPremul[1] = highlightPremul[1];
        outPremul[2] = highlightPremul[2];
        outPremul[3] = highlightPremul[3];
        return;
    }
    const float ring  = std::clamp(ringCoverage, 0.f, 1.f);
    const float wrapA = baseStraight[3] * ring;
    const float inv   = 1.f - highlightPremul[3];
    outPremul[0]      = highlightPremul[0] + baseStraight[0] * wrapA * inv;
    outPremul[1]      = highlightPremul[1] + baseStraight[1] * wrapA * inv;
    outPremul[2]      = highlightPremul[2] + baseStraight[2] * wrapA * inv;
    outPremul[3]      = highlightPremul[3] + wrapA * inv;
}

void shinyGradientSample(const uint64_t* stops, const float* pos, int count, float u, float rgba[4]) {
    rgba[0] = rgba[1] = rgba[2] = rgba[3] = 0.f;
    if (!stops || count <= 0)
        return;

    shinyUnpackArgb(stops[0], rgba);
    if (count < 2)
        return;

    // Same chained-mix form as the shader: each segment linearly replaces
    // the accumulated color, so stop i sits exactly at its position. The
    // 1e-4 denominator guard matches the shader — coincident stops become
    // a hard step instead of a division by zero.
    const int   n = std::min(count, SHINY_MAX_GRADIENT_STEPS);
    const float x = std::clamp(u, 0.f, 1.f);
    for (int i = 1; i < n; i++) {
        const float t0 = pos ? pos[i - 1] : shinyGradientStopPos(i - 1, n);
        const float t1 = pos ? pos[i] : shinyGradientStopPos(i, n);
        const float w  = std::clamp((x - t0) / std::max(t1 - t0, 1e-4f), 0.f, 1.f);
        float       next[4];
        shinyUnpackArgb(stops[i], next);
        for (int c = 0; c < 4; c++)
            rgba[c] = rgba[c] + (next[c] - rgba[c]) * w;
    }
}

void shinyGradientResolveCwSide(const uint64_t primaryStops[SHINY_MAX_GRADIENT_STEPS],
                                const float primaryPos[SHINY_MAX_GRADIENT_STEPS], int primaryCount,
                                const uint64_t* cwColors, int cwColorCount, const char* cwPosSpec,
                                ShinyGradientSide& out) {
    out = ShinyGradientSide{};
    if (primaryCount < 2 || primaryCount > SHINY_MAX_GRADIENT_STEPS)
        return; // ramp off — the cw config never activates it on its own

    const int ownCount = shinyGradientStepCount(cwColors ? cwColorCount : 0);
    if (ownCount >= 2) {
        out.count = ownCount;
        for (int i = 0; i < ownCount; i++)
            out.stops[i] = cwColors[i];
        // Own colors, own spacing. An empty / invalid spec is even spacing:
        // the primary positions belong to a different stop list.
        shinyGradientResolvePositions(cwPosSpec, ownCount, out.pos);
        return;
    }

    // Inherit the primary colors; the position spec alone can still
    // reshape this half. Empty / invalid spec = exact mirror.
    out.count = primaryCount;
    for (int i = 0; i < primaryCount; i++)
        out.stops[i] = primaryStops[i];
    if (!shinyGradientResolvePositions(cwPosSpec, primaryCount, out.pos)) {
        for (int i = 0; i < SHINY_MAX_GRADIENT_STEPS; i++)
            out.pos[i] = primaryPos[i];
    }
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

bool shinyPulseShouldRun(bool enabled, bool pulse, float pulseHz, bool activeOnly, bool focused) {
    if (!enabled || !pulse || pulseHz <= 0.f)
        return false;
    if (activeOnly && !focused)
        return false;
    return true;
}

float shinyPulseAlphaMul(float brightness, float time) {
    if (!(brightness > 0.f))
        return 1.f;
    constexpr float kTau = 6.28318530718f;
    return 0.5f + 0.5f * std::sin(time * brightness * kTau);
}

ShinyPulseUniforms shinyPulseUniforms(bool pulse, double clockSeconds, float hz) {
    if (!pulse || hz <= 0.f)
        return {.time = 0.f, .pulseHz = 0.f};
    const double wrapped = std::fmod(clockSeconds, 1.0 / static_cast<double>(hz));
    return {.time = static_cast<float>(wrapped), .pulseHz = hz};
}

int shinyPulseTickMs(float pulseHz) {
    // ~32 samples per sine cycle, clamped so a slow pulse still breathes
    // (not one damage per 1/Hz cycle) and a fast pulse does not exceed ~60fps.
    constexpr int kMinMs = 16;
    constexpr int kMaxMs = 50;
    if (pulseHz <= 0.f)
        return kMinMs;
    const float cycleMs = 1000.f / pulseHz;
    const int   sampled = static_cast<int>(cycleMs / 32.f);
    if (sampled < kMinMs)
        return kMinMs;
    if (sampled > kMaxMs)
        return kMaxMs;
    return sampled;
}

ShinyEffect shinyEffectMode(bool pulse, float pulseHz, bool shimmer, float shimmerHz) {
    if (shimmer && shimmerHz > 0.f)
        return SHINY_EFFECT_SHIMMER;
    if (pulse && pulseHz > 0.f)
        return SHINY_EFFECT_PULSE;
    return SHINY_EFFECT_NONE;
}

bool shinyEffectShouldRun(bool enabled, ShinyEffect mode, bool activeOnly, bool focused) {
    if (!enabled || mode == SHINY_EFFECT_NONE)
        return false;
    if (activeOnly && !focused)
        return false;
    return true;
}

int shinyEffectTickMs(ShinyEffect mode, float pulseHz, float shimmerHz) {
    if (mode == SHINY_EFFECT_SHIMMER)
        return shinyPulseTickMs(shimmerHz);
    return shinyPulseTickMs(pulseHz);
}

float shinyWrapAngle(float radians) {
    const float turn = 2.f * std::acos(-1.f);
    float       r    = std::fmod(radians, turn);
    if (r < 0.f)
        r += turn;
    return r;
}

float shinyPinnedHeading(int pinDeg, int offsetDeg) {
    const float pi = std::acos(-1.f);
    return shinyWrapAngle(static_cast<float>(pinDeg + offsetDeg) * pi / 180.f);
}

static uint32_t shinyXorshift32(uint32_t& s) {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return s;
}

static float shinyRand01(uint32_t& s) {
    return static_cast<float>(shinyXorshift32(s)) * (1.f / 4294967296.f);
}

void shinyShimmerSeed(ShinyShimmerState& s, uint32_t seed) {
    s.rng = seed != 0 ? seed : 0x9E3779B9u;
}

static void shinyShimmerRetarget(ShinyShimmerChannel& c, uint32_t& rng, float lo, float hi, float hz) {
    c.from = c.value;
    c.to   = lo + (hi - lo) * shinyRand01(rng);
    c.t    = 0.f;
    // 0.6–1.4 of a nominal 1/hz period. Drawn per channel per hop, so the
    // angle and scale clocks drift apart instead of retargeting in lockstep.
    c.dur  = (0.6f + 0.8f * shinyRand01(rng)) / hz;
}

static void shinyShimmerStepChannel(ShinyShimmerChannel& c, uint32_t& rng, float dt, float lo, float hi, float hz) {
    if (c.dur <= 0.f)
        shinyShimmerRetarget(c, rng, lo, hi, hz);
    c.t += dt;
    if (c.t >= c.dur) {
        c.value = c.to;
        shinyShimmerRetarget(c, rng, lo, hi, hz);
        return;
    }
    float u = c.t / c.dur;
    u       = u * u * (3.f - 2.f * u); // smoothstep ease
    c.value = c.from + (c.to - c.from) * u;
}

void shinyShimmerStep(ShinyShimmerState& s, float dt, const ShinyShimmerParams& p) {
    if (p.hz <= 0.f || dt <= 0.f)
        return;
    const float range = std::max(p.angleRangeRad, 0.f);
    const float lo    = std::min(p.scaleMin, p.scaleMax);
    const float hi    = std::max(p.scaleMin, p.scaleMax);
    shinyShimmerStepChannel(s.angle, s.rng, dt, -range, range, p.hz);
    shinyShimmerStepChannel(s.scale, s.rng, dt, lo, hi, p.hz);
}

float shinyShimmerLobe(float lobe, float scale) {
    return std::clamp(lobe * scale, 0.04f, 0.5f);
}

float shinyShimmerThickScale(float scale) {
    return std::max(1.f + (scale - 1.f) * 0.35f, 0.25f);
}
