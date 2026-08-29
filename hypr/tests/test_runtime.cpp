#include "../src/runtime.hpp"

#include <cmath>
#include <cstdio>

static int g_fails = 0;

#define CHECK(cond)                                                                                                    \
    do {                                                                                                               \
        if (!(cond)) {                                                                                                 \
            std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                                       \
            g_fails++;                                                                                                 \
        }                                                                                                              \
    } while (0)

static void checkShippedDecisions() {
    // Unmapped → no-op (do not touch positioner / renderer).
    CHECK(!shinyCanUseMappedGeometry(false, true));
    CHECK(!shinyCanDamage(false, true, false));

    // Missing renderer → no-op.
    CHECK(!shinyCanUseMappedGeometry(true, false));
    CHECK(!shinyCanDamage(true, false, false));

    // Both missing → no-op, including when exclusive-fullscreen is claimed.
    CHECK(!shinyCanUseMappedGeometry(false, false));
    CHECK(!shinyCanDamage(false, false, true));

    // Mapped + renderer, not exclusive fullscreen → proceed.
    CHECK(shinyCanUseMappedGeometry(true, true));
    CHECK(shinyCanDamage(true, true, false));

    // Exclusive fullscreen → no-op even when mapped + renderer are live.
    CHECK(!shinyCanDamage(true, true, true));

    // Mapped/renderer fail even if exclusiveFullscreen is false: the fullscreen
    // flag must not paper over the first gate.
    CHECK(!shinyCanDamage(false, true, false));
    CHECK(!shinyCanDamage(true, false, false));

    // VAO -1 (createVao failure) and 0 (default object) → do not bind.
    CHECK(!shinyCanBindVao(-1));
    CHECK(!shinyCanBindVao(0));

    // Real VAO names are positive → bind is allowed.
    CHECK(shinyCanBindVao(1));
    CHECK(shinyCanBindVao(42));

    // Thickness: logical × monitor × combinedScale. Default modif scale is 1.
    CHECK(shinyShaderThick(3.f, 2.f) == 6.f);
    CHECK(shinyShaderThick(3.f, 2.f, 1.f) == 6.f);
    CHECK(shinyShaderThick(3.f, 2.f, 2.f) == 12.f);
}

static void checkPulseDecisions() {
    // pulse false → should not run, regardless of focus / active_only / hz.
    CHECK(!shinyPulseShouldRun(true, false, 0.4f, true, true));
    CHECK(!shinyPulseShouldRun(true, false, 0.4f, true, false));
    CHECK(!shinyPulseShouldRun(true, false, 0.4f, false, true));
    CHECK(!shinyPulseShouldRun(true, false, 0.4f, false, false));

    // pulse true + active_only true + not focused → should not run; focused → should run.
    CHECK(!shinyPulseShouldRun(true, true, 0.4f, true, false));
    CHECK(shinyPulseShouldRun(true, true, 0.4f, true, true));

    // pulse true + active_only false → should run for focused and unfocused.
    CHECK(shinyPulseShouldRun(true, true, 0.4f, false, true));
    CHECK(shinyPulseShouldRun(true, true, 0.4f, false, false));

    // plugin enabled false → should not run.
    CHECK(!shinyPulseShouldRun(false, true, 0.4f, true, true));
    CHECK(!shinyPulseShouldRun(false, true, 0.4f, false, false));
    CHECK(!shinyPulseShouldRun(false, false, 0.4f, false, true));

    // pulse true + hz <= 0 → should not run (even when focused).
    CHECK(!shinyPulseShouldRun(true, true, 0.f, true, true));
    CHECK(!shinyPulseShouldRun(true, true, -0.1f, false, true));

    // pulse false → uniforms time = 0 and pulseHz = 0 even when clock and Hz are non-zero.
    const auto off = shinyPulseUniforms(false, 12.5, 0.4f);
    CHECK(off.time == 0.f);
    CHECK(off.pulseHz == 0.f);
    const auto offOther = shinyPulseUniforms(false, 3.0, 4.f);
    CHECK(offOther.time == 0.f);
    CHECK(offOther.pulseHz == 0.f);

    // pulse true + hz 0 → zeros.
    const auto offHz = shinyPulseUniforms(true, 12.5, 0.f);
    CHECK(offHz.time == 0.f);
    CHECK(offHz.pulseHz == 0.f);

    // pulse true + hz 0.4 → time wrapped into one 1/hz period [0, 2.5).
    const auto on = shinyPulseUniforms(true, 12.5, 0.4f);
    CHECK(on.time >= 0.f);
    CHECK(on.time < 2.5f);
    CHECK(on.pulseHz == 0.4f);
    const auto onMid = shinyPulseUniforms(true, 13.0, 0.4f);
    CHECK(onMid.time > 0.49f);
    CHECK(onMid.time < 0.51f);
    CHECK(onMid.pulseHz == 0.4f);
    const auto onFast = shinyPulseUniforms(true, 0.25, 4.f);
    CHECK(onFast.time >= 0.f);
    CHECK(onFast.time < 0.25f);
    CHECK(onFast.pulseHz == 4.f);

    // Re-arm period is not a once-per-cycle 1/Hz fire (that hitchs vs compositor time).
    CHECK(shinyPulseTickMs(0.4f) > 0);
    CHECK(shinyPulseTickMs(0.4f) < static_cast<int>(1000.f / 0.4f));
    CHECK(shinyPulseTickMs(4.f) > 0);
    CHECK(shinyPulseTickMs(4.f) < static_cast<int>(1000.f / 4.f));

    // Pulse alpha mul: off is identity; on is the 0.5+0.5*sin of the shader.
    CHECK(shinyPulseAlphaMul(0.f, 0.f) == 1.f);
    CHECK(shinyPulseAlphaMul(0.f, 12.5f) == 1.f);
    CHECK(shinyPulseAlphaMul(-0.4f, 0.25f) == 1.f);
    CHECK(shinyPulseAlphaMul(1.f, 0.f) == 0.5f);
    CHECK(shinyPulseAlphaMul(1.f, 0.f) != 1.f);
    CHECK(std::fabs(shinyPulseAlphaMul(1.f, 0.25f) - 1.f) < 1e-5f);
    CHECK(std::fabs(shinyPulseAlphaMul(1.f, 0.75f) - 0.f) < 1e-5f);
}

static void checkEffectExclusivity() {
    // Shimmer wins when both are configured on.
    CHECK(shinyEffectMode(true, 0.4f, true, 0.6f) == SHINY_EFFECT_SHIMMER);
    CHECK(shinyEffectMode(false, 0.4f, true, 0.6f) == SHINY_EFFECT_SHIMMER);

    // Shimmer off or hz <= 0 falls through to pulse.
    CHECK(shinyEffectMode(true, 0.4f, false, 0.6f) == SHINY_EFFECT_PULSE);
    CHECK(shinyEffectMode(true, 0.4f, true, 0.f) == SHINY_EFFECT_PULSE);
    CHECK(shinyEffectMode(true, 0.4f, true, -1.f) == SHINY_EFFECT_PULSE);

    // Pulse hz <= 0 disables pulse too.
    CHECK(shinyEffectMode(true, 0.f, false, 0.6f) == SHINY_EFFECT_NONE);
    CHECK(shinyEffectMode(false, 0.4f, false, 0.6f) == SHINY_EFFECT_NONE);
    CHECK(shinyEffectMode(true, 0.f, true, 0.f) == SHINY_EFFECT_NONE);

    // Timer gate: same shape as the pulse gate, but mode-driven.
    CHECK(!shinyEffectShouldRun(true, SHINY_EFFECT_NONE, true, true));
    CHECK(!shinyEffectShouldRun(false, SHINY_EFFECT_SHIMMER, true, true));
    CHECK(!shinyEffectShouldRun(true, SHINY_EFFECT_SHIMMER, true, false));
    CHECK(shinyEffectShouldRun(true, SHINY_EFFECT_SHIMMER, true, true));
    CHECK(shinyEffectShouldRun(true, SHINY_EFFECT_SHIMMER, false, false));
    CHECK(shinyEffectShouldRun(true, SHINY_EFFECT_PULSE, true, true));

    // Tick period follows the active effect's hz.
    CHECK(shinyEffectTickMs(SHINY_EFFECT_PULSE, 0.4f, 4.f) == shinyPulseTickMs(0.4f));
    CHECK(shinyEffectTickMs(SHINY_EFFECT_SHIMMER, 0.4f, 4.f) == shinyPulseTickMs(4.f));
    CHECK(shinyEffectTickMs(SHINY_EFFECT_SHIMMER, 0.4f, 0.6f) > 0);
    CHECK(shinyEffectTickMs(SHINY_EFFECT_SHIMMER, 0.4f, 0.6f) < static_cast<int>(1000.f / 0.6f));
}

static void checkPinnedHeading() {
    const float pi = std::acos(-1.f);

    // Shipped heading is pinDeg + offset only — not pointer vs box center.
    CHECK(std::fabs(shinyPinnedHeading(0, 0)) < 1e-5f);
    CHECK(std::fabs(shinyPinnedHeading(90, 0) - pi * 0.5f) < 1e-5f);
    CHECK(std::fabs(shinyPinnedHeading(180, 0) - pi) < 1e-5f);
    CHECK(std::fabs(shinyPinnedHeading(120, 0) - 120.f * pi / 180.f) < 1e-4f);

    // angle_offset still applies, and the sum wraps into [0, 2π).
    CHECK(std::fabs(shinyPinnedHeading(0, 90) - pi * 0.5f) < 1e-4f);
    CHECK(std::fabs(shinyPinnedHeading(350, 20) - 10.f * pi / 180.f) < 1e-4f);
    CHECK(std::fabs(shinyPinnedHeading(-90, 0) - 270.f * pi / 180.f) < 1e-4f);

    const float p = shinyPinnedHeading(-360, -180);
    CHECK(p >= 0.f);
    CHECK(p < 2.f * pi);

    // Wrap helper on its own.
    CHECK(std::fabs(shinyWrapAngle(2.f * pi + 0.1f) - 0.1f) < 1e-4f);
    CHECK(std::fabs(shinyWrapAngle(-0.1f) - (2.f * pi - 0.1f)) < 1e-4f);
    CHECK(shinyWrapAngle(0.f) == 0.f);
}

static void checkShimmer() {
    const ShinyShimmerParams p{.hz = 0.6f, .angleRangeRad = 0.4363f, .scaleMin = 0.75f, .scaleMax = 1.35f};

    // hz <= 0 or dt <= 0 → no-op.
    ShinyShimmerState idle;
    shinyShimmerSeed(idle, 7);
    shinyShimmerStep(idle, 0.f, p);
    CHECK(idle.angle.value == 0.f);
    CHECK(idle.scale.value == 1.f);
    shinyShimmerStep(idle, 0.016f, ShinyShimmerParams{.hz = 0.f});
    CHECK(idle.angle.value == 0.f);
    CHECK(idle.scale.value == 1.f);

    // Determinism: same seed, same steps → same values.
    ShinyShimmerState a, b;
    shinyShimmerSeed(a, 42);
    shinyShimmerSeed(b, 42);
    for (int i = 0; i < 500; i++) {
        shinyShimmerStep(a, 0.016f, p);
        shinyShimmerStep(b, 0.016f, p);
    }
    CHECK(a.angle.value == b.angle.value);
    CHECK(a.scale.value == b.scale.value);

    // Seed 0 must not wedge xorshift at 0 (state would never move).
    ShinyShimmerState z;
    shinyShimmerSeed(z, 0);
    for (int i = 0; i < 500; i++)
        shinyShimmerStep(z, 0.016f, p);
    CHECK(z.scale.value != 1.f || z.angle.value != 0.f);

    // Bounds + actual movement over a long run.
    ShinyShimmerState s;
    shinyShimmerSeed(s, 1234);
    float minAngle = 1e9f, maxAngle = -1e9f, minScale = 1e9f, maxScale = -1e9f;
    for (int i = 0; i < 4000; i++) { // ~64 s at 16 ms
        shinyShimmerStep(s, 0.016f, p);
        minAngle = std::fmin(minAngle, s.angle.value);
        maxAngle = std::fmax(maxAngle, s.angle.value);
        minScale = std::fmin(minScale, s.scale.value);
        maxScale = std::fmax(maxScale, s.scale.value);
        CHECK(std::fabs(s.angle.value) <= p.angleRangeRad + 1e-5f);
        CHECK(s.scale.value >= p.scaleMin - 1e-5f);
        CHECK(s.scale.value <= p.scaleMax + 1e-5f);
    }
    // The walk visits both sides of the heading and actually resizes.
    CHECK(minAngle < -0.01f);
    CHECK(maxAngle > 0.01f);
    CHECK(maxScale - minScale > 0.1f);

    // Independence: the two channels draw separate durations, so their
    // retarget clocks are not in lockstep.
    CHECK(s.angle.dur != s.scale.dur);
    CHECK(s.angle.t != s.scale.t || s.angle.dur != s.scale.dur);

    // Inverted scale range is swapped, not a hole.
    ShinyShimmerState inv;
    shinyShimmerSeed(inv, 99);
    const ShinyShimmerParams pInv{.hz = 1.f, .angleRangeRad = 0.1f, .scaleMin = 1.4f, .scaleMax = 0.8f};
    for (int i = 0; i < 2000; i++) {
        shinyShimmerStep(inv, 0.016f, pInv);
        CHECK(inv.scale.value >= 0.8f - 1e-5f);
        CHECK(inv.scale.value <= 1.4f + 1e-5f);
    }

    // Zero angle range: the offset eases to 0 and stays there.
    ShinyShimmerState flat;
    shinyShimmerSeed(flat, 5);
    const ShinyShimmerParams pFlat{.hz = 1.f, .angleRangeRad = 0.f, .scaleMin = 0.9f, .scaleMax = 1.1f};
    for (int i = 0; i < 2000; i++)
        shinyShimmerStep(flat, 0.016f, pFlat);
    CHECK(std::fabs(flat.angle.value) < 1e-5f);

    // Effective lobe clamps to the config range; thickness stays muted.
    CHECK(shinyShimmerLobe(0.18f, 1.f) == 0.18f);
    CHECK(shinyShimmerLobe(0.18f, 10.f) == 0.5f);
    CHECK(shinyShimmerLobe(0.18f, 0.01f) == 0.04f);
    CHECK(shinyShimmerThickScale(1.f) == 1.f);
    CHECK(shinyShimmerThickScale(2.f) < 2.f);
    CHECK(shinyShimmerThickScale(2.f) > 1.f);
    CHECK(shinyShimmerThickScale(0.f) > 0.f);
}

static void checkGradient() {
    // A ramp needs two stops: 0 / 1 (and nonsense negatives) are "off".
    CHECK(shinyGradientStepCount(-3) == 0);
    CHECK(shinyGradientStepCount(0) == 0);
    CHECK(shinyGradientStepCount(1) == 0);
    CHECK(shinyGradientStepCount(2) == 2);
    CHECK(shinyGradientStepCount(SHINY_MAX_GRADIENT_STEPS) == SHINY_MAX_GRADIENT_STEPS);

    // Past the shader's uniform array → clamp, not wrap or UB.
    CHECK(shinyGradientStepCount(SHINY_MAX_GRADIENT_STEPS + 1) == SHINY_MAX_GRADIENT_STEPS);
    CHECK(shinyGradientStepCount(100) == SHINY_MAX_GRADIENT_STEPS);

    // Stop positions: endpoints pin to 0 / 1, interior stops are evenly spaced.
    CHECK(shinyGradientStopPos(0, 2) == 0.f);
    CHECK(shinyGradientStopPos(1, 2) == 1.f);
    CHECK(std::fabs(shinyGradientStopPos(1, 3) - 0.5f) < 1e-6f);
    CHECK(std::fabs(shinyGradientStopPos(2, 5) - 0.5f) < 1e-6f);
    CHECK(shinyGradientStopPos(0, 1) == 0.f); // lone stop / off → head
    CHECK(shinyGradientStopPos(3, 0) == 0.f);
    CHECK(shinyGradientStopPos(-1, 4) == 0.f);  // out-of-range i clamps
    CHECK(shinyGradientStopPos(99, 4) == 1.f);

    const uint64_t red   = 0xffff0000ULL;
    const uint64_t green = 0xff00ff00ULL;
    const uint64_t blue  = 0xff0000ffULL;

    // Two stops: endpoints are exact, the middle is the linear mix.
    const uint64_t two[] = {red, blue};
    float          rgba[4];
    shinyGradientSample(two, nullptr, 2, 0.f, rgba);
    CHECK(rgba[0] == 1.f && rgba[1] == 0.f && rgba[2] == 0.f && rgba[3] == 1.f);
    shinyGradientSample(two, nullptr, 2, 1.f, rgba);
    CHECK(rgba[0] == 0.f && rgba[1] == 0.f && rgba[2] == 1.f);
    shinyGradientSample(two, nullptr, 2, 0.5f, rgba);
    CHECK(std::fabs(rgba[0] - 0.5f) < 1e-4f);
    CHECK(rgba[1] == 0.f);
    CHECK(std::fabs(rgba[2] - 0.5f) < 1e-4f);

    // u outside [0, 1] clamps to the endpoints (d0*2 never exceeds 1, but
    // the sampler is the reference for the shader's clamp).
    shinyGradientSample(two, nullptr, 2, -1.f, rgba);
    CHECK(rgba[0] == 1.f && rgba[2] == 0.f);
    shinyGradientSample(two, nullptr, 2, 2.f, rgba);
    CHECK(rgba[0] == 0.f && rgba[2] == 1.f);

    // Three stops: the middle stop sits exactly at u = 0.5, and the first
    // segment interpolates independently of the stops after it.
    const uint64_t three[] = {red, green, blue};
    shinyGradientSample(three, nullptr, 3, 0.5f, rgba);
    CHECK(rgba[0] == 0.f && rgba[1] == 1.f && rgba[2] == 0.f);
    shinyGradientSample(three, nullptr, 3, 0.25f, rgba);
    CHECK(std::fabs(rgba[0] - 0.5f) < 1e-4f);
    CHECK(std::fabs(rgba[1] - 0.5f) < 1e-4f);
    CHECK(rgba[2] == 0.f);
    shinyGradientSample(three, nullptr, 3, 1.f, rgba);
    CHECK(rgba[0] == 0.f && rgba[1] == 0.f && rgba[2] == 1.f);

    // Stop alpha survives sampling (the fallback resample needs it; the
    // shader path ignores it by design).
    const uint64_t translucent[] = {0x80ff0000ULL, 0x00ff0000ULL};
    shinyGradientSample(translucent, nullptr, 2, 0.5f, rgba);
    CHECK(std::fabs(rgba[3] - 0x80 / 255.f * 0.5f) < 1e-4f);

    // Degenerate inputs: lone stop samples that stop, empty samples black.
    shinyGradientSample(three, nullptr, 1, 0.7f, rgba);
    CHECK(rgba[0] == 1.f && rgba[1] == 0.f && rgba[2] == 0.f);
    shinyGradientSample(three, nullptr, 0, 0.5f, rgba);
    CHECK(rgba[0] == 0.f && rgba[1] == 0.f && rgba[2] == 0.f && rgba[3] == 0.f);
    shinyGradientSample(nullptr, nullptr, 3, 0.5f, rgba);
    CHECK(rgba[0] == 0.f && rgba[1] == 0.f && rgba[2] == 0.f);

    // More stops than the shader array: the tail is ignored, so u = 1 lands
    // on stop SHINY_MAX_GRADIENT_STEPS, not the 9th.
    uint64_t many[SHINY_MAX_GRADIENT_STEPS + 1];
    for (auto& c : many)
        c = red;
    many[SHINY_MAX_GRADIENT_STEPS - 1] = blue;  // last usable stop
    many[SHINY_MAX_GRADIENT_STEPS]     = green; // past the cap
    shinyGradientSample(many, nullptr, SHINY_MAX_GRADIENT_STEPS + 1, 1.f, rgba);
    CHECK(rgba[0] == 0.f && rgba[1] == 0.f && rgba[2] == 1.f);
}

static void checkGradientPositions() {
    float pos[SHINY_MAX_GRADIENT_STEPS];

    // Empty / null spec → even spacing, reported as "not custom".
    CHECK(!shinyGradientResolvePositions("", 3, pos));
    CHECK(pos[0] == 0.f);
    CHECK(std::fabs(pos[1] - 0.5f) < 1e-6f);
    CHECK(pos[2] == 1.f);
    CHECK(!shinyGradientResolvePositions(nullptr, 3, pos));
    CHECK(std::fabs(pos[1] - 0.5f) < 1e-6f);

    // A valid spec places the stops; percentages normalize to [0, 1].
    CHECK(shinyGradientResolvePositions("0 70 100", 3, pos));
    CHECK(pos[0] == 0.f);
    CHECK(std::fabs(pos[1] - 0.7f) < 1e-6f);
    CHECK(pos[2] == 1.f);

    // Commas, extra whitespace, and a '%' suffix are all accepted.
    CHECK(shinyGradientResolvePositions(" 0%,  25.5 ,\t90% ", 3, pos));
    CHECK(pos[0] == 0.f);
    CHECK(std::fabs(pos[1] - 0.255f) < 1e-6f);
    CHECK(std::fabs(pos[2] - 0.9f) < 1e-6f);

    // First stop above 0 / last below 100 is allowed: the ends become
    // constant-color bands (clamped sampling handles it).
    CHECK(shinyGradientResolvePositions("20 80", 2, pos));
    CHECK(std::fabs(pos[0] - 0.2f) < 1e-6f);
    CHECK(std::fabs(pos[1] - 0.8f) < 1e-6f);

    // Out-of-range values clamp into [0, 100].
    CHECK(shinyGradientResolvePositions("-50 250", 2, pos));
    CHECK(pos[0] == 0.f);
    CHECK(pos[1] == 1.f);

    // Decreasing sequences are repaired upward, never reordered.
    CHECK(shinyGradientResolvePositions("0 60 40 100", 4, pos));
    CHECK(std::fabs(pos[1] - 0.6f) < 1e-6f);
    CHECK(std::fabs(pos[2] - 0.6f) < 1e-6f);
    CHECK(pos[3] == 1.f);

    // Count mismatch (either direction) or junk → even spacing.
    CHECK(!shinyGradientResolvePositions("0 100", 3, pos));
    CHECK(std::fabs(pos[1] - 0.5f) < 1e-6f);
    CHECK(!shinyGradientResolvePositions("0 50 100", 2, pos));
    CHECK(pos[1] == 1.f);
    CHECK(!shinyGradientResolvePositions("0 banana 100", 3, pos));
    CHECK(std::fabs(pos[1] - 0.5f) < 1e-6f);
    CHECK(!shinyGradientResolvePositions("0 50x 100", 3, pos));
    CHECK(!shinyGradientResolvePositions("0 100", 1, pos));
    CHECK(!shinyGradientResolvePositions("0 100", 0, pos));

    // Positioned sampling: with stops at 0 / 70 / 100, u = 0.7 is exactly
    // the middle stop and u = 0.35 is halfway through the first segment.
    const uint64_t red   = 0xffff0000ULL;
    const uint64_t green = 0xff00ff00ULL;
    const uint64_t blue  = 0xff0000ffULL;
    const uint64_t rgb3[] = {red, green, blue};
    float          custom[SHINY_MAX_GRADIENT_STEPS];
    CHECK(shinyGradientResolvePositions("0 70 100", 3, custom));
    float rgba[4];
    shinyGradientSample(rgb3, custom, 3, 0.7f, rgba);
    CHECK(std::fabs(rgba[0]) < 1e-3f && std::fabs(rgba[1] - 1.f) < 1e-3f && std::fabs(rgba[2]) < 1e-3f);
    shinyGradientSample(rgb3, custom, 3, 0.35f, rgba);
    CHECK(std::fabs(rgba[0] - 0.5f) < 1e-3f);
    CHECK(std::fabs(rgba[1] - 0.5f) < 1e-3f);
    CHECK(rgba[2] == 0.f);

    // Inset endpoints: below the first stop / past the last stop the color
    // holds constant.
    CHECK(shinyGradientResolvePositions("40 60", 2, custom));
    const uint64_t rb[] = {red, blue};
    shinyGradientSample(rb, custom, 2, 0.1f, rgba);
    CHECK(rgba[0] == 1.f && rgba[2] == 0.f);
    shinyGradientSample(rb, custom, 2, 0.9f, rgba);
    CHECK(rgba[0] == 0.f && rgba[2] == 1.f);

    // Coincident stops are a hard step (1e-4 guard), not a NaN.
    const uint64_t rgbr[] = {red, green, blue, red};
    CHECK(shinyGradientResolvePositions("0 50 50 100", 4, custom));
    shinyGradientSample(rgbr, custom, 4, 0.49f, rgba);
    CHECK(std::isfinite(rgba[0]) && std::isfinite(rgba[1]) && std::isfinite(rgba[2]));
    CHECK(rgba[1] > 0.9f); // just before the step: green
    shinyGradientSample(rgbr, custom, 4, 0.51f, rgba);
    CHECK(std::isfinite(rgba[2]));
    CHECK(rgba[2] > 0.9f); // just after: blue heading toward red
}

static void checkGradientCwSide() {
    const uint64_t red    = 0xffff0000ULL;
    const uint64_t green  = 0xff00ff00ULL;
    const uint64_t blue   = 0xff0000ffULL;
    const uint64_t white  = 0xffffffffULL;

    // Primary side: red → green → blue at custom positions 0 / 70 / 100.
    uint64_t primary[SHINY_MAX_GRADIENT_STEPS] = {red, green, blue};
    float    primaryPos[SHINY_MAX_GRADIENT_STEPS];
    CHECK(shinyGradientResolvePositions("0 70 100", 3, primaryPos));

    ShinyGradientSide cw;

    // Primary ramp off → the cw config alone never activates the feature.
    shinyGradientResolveCwSide(primary, primaryPos, 0, primary, 3, "0 50 100", cw);
    CHECK(cw.count == 0);
    shinyGradientResolveCwSide(primary, primaryPos, 1, primary, 3, "", cw);
    CHECK(cw.count == 0);

    // Nothing configured → exact mirror of the primary side, including the
    // custom positions.
    shinyGradientResolveCwSide(primary, primaryPos, 3, nullptr, 0, "", cw);
    CHECK(cw.count == 3);
    CHECK(cw.stops[0] == red && cw.stops[1] == green && cw.stops[2] == blue);
    CHECK(cw.pos[1] == primaryPos[1]);
    CHECK(std::fabs(cw.pos[1] - 0.7f) < 1e-6f);

    // A lone cw color counts as unset (same rule as the primary gradient).
    shinyGradientResolveCwSide(primary, primaryPos, 3, &white, 1, "", cw);
    CHECK(cw.count == 3);
    CHECK(cw.stops[0] == red);

    // positions_cw alone reshapes the half with the inherited colors.
    shinyGradientResolveCwSide(primary, primaryPos, 3, nullptr, 0, "0 30 100", cw);
    CHECK(cw.count == 3);
    CHECK(cw.stops[1] == green);
    CHECK(std::fabs(cw.pos[1] - 0.3f) < 1e-6f);

    // Invalid spec with inherited colors → mirror, not even spacing.
    shinyGradientResolveCwSide(primary, primaryPos, 3, nullptr, 0, "0 30", cw);
    CHECK(std::fabs(cw.pos[1] - 0.7f) < 1e-6f);

    // Own cw colors — the count may differ from the primary side; an empty
    // spec is even spacing (the primary positions belong to another list).
    const uint64_t own[] = {red, white};
    shinyGradientResolveCwSide(primary, primaryPos, 3, own, 2, "", cw);
    CHECK(cw.count == 2);
    CHECK(cw.stops[0] == red && cw.stops[1] == white);
    CHECK(cw.pos[0] == 0.f && cw.pos[1] == 1.f);

    // Own colors + own spec.
    shinyGradientResolveCwSide(primary, primaryPos, 3, own, 2, "20 80", cw);
    CHECK(std::fabs(cw.pos[0] - 0.2f) < 1e-6f);
    CHECK(std::fabs(cw.pos[1] - 0.8f) < 1e-6f);

    // A mismatched spec for own colors falls back to even, not to the
    // primary positions.
    shinyGradientResolveCwSide(primary, primaryPos, 3, own, 2, "0 70 100", cw);
    CHECK(cw.pos[0] == 0.f && cw.pos[1] == 1.f);

    // Over-cap own color count clamps like the primary side.
    uint64_t many[SHINY_MAX_GRADIENT_STEPS + 1];
    for (auto& c : many)
        c = white;
    shinyGradientResolveCwSide(primary, primaryPos, 3, many, SHINY_MAX_GRADIENT_STEPS + 1, "", cw);
    CHECK(cw.count == SHINY_MAX_GRADIENT_STEPS);
}

static void checkGradientLobeU() {
    // lobe 0.5 covers d0 in [0, 0.5] = the full axis → identity.
    CHECK(shinyGradientLobeU(0.f, 0.5f) == 0.f);
    CHECK(std::fabs(shinyGradientLobeU(0.5f, 0.5f) - 0.5f) < 1e-6f);
    CHECK(shinyGradientLobeU(1.f, 0.5f) == 1.f);

    // Default-ish lobe 0.18: comet edge is uAxis = 2 * 0.18 = 0.36.
    CHECK(shinyGradientLobeU(0.f, 0.18f) == 0.f);
    CHECK(std::fabs(shinyGradientLobeU(0.36f, 0.18f) - 1.f) < 1e-5f);
    CHECK(shinyGradientLobeU(1.f, 0.18f) == 1.f);
    CHECK(std::fabs(shinyGradientLobeU(0.18f, 0.18f) - 0.5f) < 1e-5f);

    // User lobe 0.1: uAxis 0.2 is the comet edge; past that holds 1.
    CHECK(shinyGradientLobeU(0.f, 0.1f) == 0.f);
    CHECK(std::fabs(shinyGradientLobeU(0.1f, 0.1f) - 0.5f) < 1e-5f);
    CHECK(std::fabs(shinyGradientLobeU(0.2f, 0.1f) - 1.f) < 1e-5f);
    CHECK(shinyGradientLobeU(1.f, 0.1f) == 1.f);

    // Spread below the shader floor (0.04) is floored, not a divide-by-zero.
    CHECK(shinyGradientLobeU(0.08f, 0.f) == 1.f);   // 0.08 * 0.5 / 0.04 = 1
    CHECK(std::fabs(shinyGradientLobeU(0.04f, 0.01f) - 0.5f) < 1e-5f);

    // Axis u is clamped before the scale.
    CHECK(shinyGradientLobeU(-1.f, 0.18f) == 0.f);
    CHECK(shinyGradientLobeU(2.f, 0.18f) == 1.f);

    CHECK(shinyGradientLobeU(1.f, 0.18f, false) == shinyGradientLobeU(1.f, 0.18f));

    CHECK(shinyGradientLobeU(0.f, 0.18f, true) == 0.f);
    CHECK(shinyGradientLobeU(1.f, 0.18f, true) == 0.f);
    CHECK(shinyGradientLobeU(1.f, 0.18f, true) != 1.f);
    CHECK(std::fabs(shinyGradientLobeU(0.36f, 0.18f, true) - 1.f) < 1e-5f);
    CHECK(std::fabs(shinyGradientLobeU(0.64f, 0.18f, true) - 1.f) < 1e-5f);
    CHECK(shinyGradientLobeU(0.5f, 0.18f, true) == 1.f);
}

static void checkWrapComposite() {
    // Translucent premultiplied highlight over wrapRing. Drive the shipped
    // helper — do not hard-code the mix result.
    const float hiA          = 0.55f;
    const float highlight[4] = {0.2f * hiA, 0.4f * hiA, 0.1f * hiA, hiA};
    float       out[4];

    // Zero-alpha base is a no-op even with full ring coverage.
    const float off[4] = {0.f, 104.f / 255.f, 120.f / 255.f, 0.f};
    shinyWrapComposite(highlight, off, 1.f, out);
    CHECK(out[0] == highlight[0] && out[1] == highlight[1] && out[2] == highlight[2] && out[3] == highlight[3]);

    // Null / missing base is the same no-op.
    shinyWrapComposite(highlight, nullptr, 1.f, out);
    CHECK(out[0] == highlight[0] && out[1] == highlight[1] && out[2] == highlight[2] && out[3] == highlight[3]);

    // Ring coverage 0 with a live base: glow is excluded, wrap does not paint.
    const float teal[4] = {0.f, 104.f / 255.f, 120.f / 255.f, 85.f / 255.f};
    shinyWrapComposite(highlight, teal, 0.f, out);
    CHECK(out[0] == highlight[0] && out[1] == highlight[1] && out[2] == highlight[2] && out[3] == highlight[3]);

    // Full ring + translucent highlight: wrap hue/alpha must show through.
    // rgba(00687855) / Qt #55006878 — output is not the highlight alone.
    shinyWrapComposite(highlight, teal, 1.f, out);
    CHECK(out[0] != highlight[0] || out[1] != highlight[1] || out[2] != highlight[2] || out[3] != highlight[3]);
    CHECK(out[1] > highlight[1]);
    CHECK(out[2] > highlight[2]);
    CHECK(out[3] > highlight[3]);
    CHECK(out[3] < 1.f);

    // Stop-authored highlight (straight red, stop alpha) still composites
    // over wrapRing. RGB stays red-dominant — not blown toward white.
    const float stopA    = 238.f / 255.f;
    const float redHi[4] = {stopA, 0.f, 0.f, stopA};
    shinyWrapComposite(redHi, teal, 1.f, out);
    CHECK(out[3] > redHi[3]);
    CHECK(out[3] < 1.f);
    CHECK(out[0] > out[1] && out[0] > out[2]);

    // Opaque highlight covers the wrap completely.
    const float opaque[4] = {1.f, 1.f, 1.f, 1.f};
    shinyWrapComposite(opaque, teal, 1.f, out);
    CHECK(out[0] == 1.f && out[1] == 1.f && out[2] == 1.f && out[3] == 1.f);
}

static void checkEffectiveBorderSize() {
    CHECK(shinyEffectiveBorderSize(3, false) == 0);
    CHECK(shinyEffectiveBorderSize(3, true) == 3);
    CHECK(shinyEffectiveBorderSize(0, true) == 0);
    CHECK(shinyEffectiveBorderSize(0, false) == 0);
}

static void checkUpdateWindowActions() {
    const ShinyGeoLatch geo{10.0, 20.0, 100.0, 200.0};
    const int           bs = 3;

    // No geo change + no effective-border change → no reposition, no damage.
    auto a = shinyUpdateWindowActions(geo, bs, geo, bs);
    CHECK(!a.reposition);
    CHECK(!a.damage);

    // Geo change + same effective border → no reposition, damage.
    const ShinyGeoLatch moved{11.0, 20.0, 100.0, 200.0};
    a = shinyUpdateWindowActions(moved, bs, geo, bs);
    CHECK(!a.reposition);
    CHECK(a.damage);

    const ShinyGeoLatch resized{10.0, 20.0, 100.0, 201.0};
    a = shinyUpdateWindowActions(resized, bs, geo, bs);
    CHECK(!a.reposition);
    CHECK(a.damage);

    // Same geo + effective border change → reposition and damage.
    a = shinyUpdateWindowActions(geo, 4, geo, bs);
    CHECK(a.reposition);
    CHECK(a.damage);

    // Same geo, effective 3 → 0 (enabled off).
    a = shinyUpdateWindowActions(geo, 0, geo, 3);
    CHECK(a.reposition);
    CHECK(a.damage);

    // Same geo, 3 → 3 → neither.
    a = shinyUpdateWindowActions(geo, 3, geo, 3);
    CHECK(!a.reposition);
    CHECK(!a.damage);

    // Both change → reposition and damage.
    a = shinyUpdateWindowActions(moved, 4, geo, bs);
    CHECK(a.reposition);
    CHECK(a.damage);
}

int main() {
    checkShippedDecisions();
    checkPulseDecisions();
    checkEffectExclusivity();
    checkPinnedHeading();
    checkShimmer();
    checkGradient();
    checkGradientPositions();
    checkGradientLobeU();
    checkGradientCwSide();
    checkWrapComposite();
    checkEffectiveBorderSize();
    checkUpdateWindowActions();

    if (g_fails) {
        std::fprintf(stderr, "%d checks failed\n", g_fails);
        return 1;
    }
    std::puts("ok");
    return 0;
}
