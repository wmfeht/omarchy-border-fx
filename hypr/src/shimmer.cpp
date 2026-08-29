#include "shimmer.hpp"

#include <algorithm>
#include <cmath>

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
