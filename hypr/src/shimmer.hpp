#pragma once

#include <cstdint>

// Hyprland-free shimmer + pulse contract. Twin of qml/Shimmer.js. Tests
// drive these functions without a compositor. Gradient logic lives in
// gradient.hpp; geometry / VAO / backend mapping stay in runtime.hpp.

// Per-deco pulse scheduler: should this deco keep a running pulse
// (timer that damageEntire's)? false if !enabled || !pulse || pulseHz <= 0.
// active_only → only the focused deco; otherwise every mapped shiny deco.
bool shinyPulseShouldRun(bool enabled, bool pulse, float pulseHz, bool activeOnly, bool focused);

// Shader time / pulseHz. Pulse off or hz <= 0 → both zero even if the
// clock is non-zero. Otherwise wrap clockSeconds (double) to one 1/hz
// period, then narrow. One clock: compositor m_globalTimer — not a mix.
struct ShinyPulseUniforms {
    float time    = 0.f;
    float pulseHz = 0.f;
};

ShinyPulseUniforms shinyPulseUniforms(bool pulse, double clockSeconds, float hz);

// Shader twin: pulse off (brightness <= 0) is identity 1. Pulse on uses
// the same 0.5+0.5*sin(time * hz * tau) that used to breathe spread/thick,
// now as a multiplier on sampled stop alpha. Twin of GLSL shinyPulseAlphaMul.
float shinyPulseAlphaMul(float brightness, float time);

// Re-arm period for per-deco pulse damage, milliseconds. Must be much
// smaller than one sine cycle (1/pulseHz) so compositor-time sampling
// does not hitch. Not a process-wide tick.
int shinyPulseTickMs(float pulseHz);

// Which oscillation drives the ring. Shimmer and pulse are mutually
// exclusive: shimmer wins when both are configured on. An effect whose
// hz is <= 0 is off and falls through (shimmer_hz 0 + pulse on → pulse).
enum ShinyEffect {
    SHINY_EFFECT_NONE = 0,
    SHINY_EFFECT_PULSE,
    SHINY_EFFECT_SHIMMER,
};

ShinyEffect shinyEffectMode(bool pulse, float pulseHz, bool shimmer, float shimmerHz);

// Timer gate for whichever effect is active. Same shape as
// shinyPulseShouldRun but mode-driven: false when the plugin is off or
// no effect is on; active_only → only the focused deco keeps a timer.
bool shinyEffectShouldRun(bool enabled, ShinyEffect mode, bool activeOnly, bool focused);

// Re-arm period for the active effect. Pulse samples its sine; shimmer
// samples its eased random walk. Same clamp as shinyPulseTickMs.
int shinyEffectTickMs(ShinyEffect mode, float pulseHz, float shimmerHz);

// Wrap radians into [0, 2π). Shimmer adds a signed offset to the pinned
// heading; the shader and the fallback gradient both expect a wrapped angle.
float shinyWrapAngle(float radians);

// Light heading: (pinDeg + offsetDeg) degrees → radians in [0, 2π).
// GLSL atan(-y, x) convention: 0° faces +x (right), 90° faces up.
// Shader (SHADER_ANGLE) and fallback (CGradientValueData) both draw this
// value, plus optional shimmer wander. Not computed from the cursor.
float shinyPinnedHeading(int pinDeg, int offsetDeg);

// Shimmer: two independent random-walk channels. Each channel eases
// (smoothstep) from its current value to a random target, then draws a
// new target and a new duration — angle and scale retarget on their own
// clocks, so heading drift and resize are visibly decoupled.
struct ShinyShimmerChannel {
    float value = 0.f;
    float from  = 0.f;
    float to    = 0.f;
    float t     = 0.f; // elapsed seconds within the current ease
    float dur   = 0.f; // <= 0 means "pick a target on the next step"
};

struct ShinyShimmerState {
    ShinyShimmerChannel angle; // signed radians around the base heading
    ShinyShimmerChannel scale = {.value = 1.f, .from = 1.f, .to = 1.f};
    uint32_t            rng   = 0x9E3779B9u; // xorshift32; never 0
};

struct ShinyShimmerParams {
    float hz            = 0.6f;     // average retargets per second, per channel
    float angleRangeRad = 0.4363f;  // max |offset| from the base heading (±25°)
    float scaleMin      = 0.75f;    // lobe / thickness scale bounds; swapped if inverted
    float scaleMax      = 1.35f;
};

// Deterministic per-deco stream. seed 0 would wedge xorshift32 at 0 —
// it is replaced with a fixed non-zero constant.
void shinyShimmerSeed(ShinyShimmerState& s, uint32_t seed);

// Advance both channels by dt seconds. hz <= 0 or dt <= 0 is a no-op.
// angle.value stays within ±angleRangeRad; scale.value converges into
// [scaleMin, scaleMax] (one ease if it starts outside).
void shinyShimmerStep(ShinyShimmerState& s, float dt, const ShinyShimmerParams& p);

// Effective highlight half-width: lobe × shimmer scale, clamped to the
// same [0.04, 0.5] the config allows so a wild scale range cannot draw
// a degenerate or full-span lobe.
float shinyShimmerLobe(float lobe, float scale);

// Ring thickness responds to the scale channel too, but muted (35%),
// mirroring how pulse breathes spread harder than thickness.
float shinyShimmerThickScale(float scale);
