#pragma once

#include <cstdint>

// Runtime decisions used by assignedBoxGlobal, damageEntire, shader draw,
// border-size fallback, and the unified draw-backend mapping. Hyprland-free
// so tests can drive the same functions without a compositor.

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

// Multi-step gradient: hard cap on configurable stops. Mirrors the shader's
// gradColors[SHINY_MAX_GRADIENT_STEPS] uniform array — keep them in sync.
inline constexpr int SHINY_MAX_GRADIENT_STEPS = 8;

// plugin:shiny-border:gradient_steps → effective stop count. A gradient
// needs at least two stops, so 0 and 1 mean "off" (classic col.a/col.b);
// anything past the uniform array is clamped to SHINY_MAX_GRADIENT_STEPS.
int shinyGradientStepCount(int configured);

// Normalized ramp position of stop i among count stops when spacing is
// even: 0 at the comet head, 1 at the lobe edge. count < 2 or a lone stop
// pins to 0.
float shinyGradientStopPos(int i, int count);

// Map full-axis u (0 = facing support, 1 = far side) onto the lit band.
// Shader: d0 = u * 0.5, cone occupies d0 in [0, spread]. spread is the
// applied lobe (config / shimmer-scaled range, pulse-modulated, floored
// at 0.04). Returns 0 at the head, 1 at the lobe edge, and stays 1 past
// it. lobe 0.5 is identity (uAxis maps to itself). Twin of uRamp in
// SHINY_FRAG / shaders/shiny.frag.
float shinyGradientLobeU(float uAxis, float spread);

// plugin:shiny-border:gradient_positions → per-stop ramp positions.
// Always fills out[0..SHINY_MAX_GRADIENT_STEPS-1] — even spacing first,
// then the custom spec on top when it is usable. Returns true only when
// the spec applied. The spec is one percentage per color (0 = head,
// 100 = lobe edge), separated by spaces and/or commas, optional trailing
// '%'. Anything else — empty spec, count mismatch, junk tokens, count < 2
// — keeps even spacing. Values clamp into [0, 100] and each stop clamps
// up to its predecessor, so the sequence is non-decreasing.
bool shinyGradientResolvePositions(const char* spec, int count, float out[SHINY_MAX_GRADIENT_STEPS]);

// CPU reference for the shader's piecewise-linear chain: sample the ramp
// at u ∈ [0, 1] into rgba[4] (0..1 floats). Stops are packed ARGB uint64
// like ShinyDrawShared colors; pos are normalized stop positions (nullptr
// = even spacing). The shader ignores stop alpha — it shapes alpha from
// coverage like the classic path — but the fallback resample keeps it.
// Coincident stops read as a hard step (1e-4 guard, same as the shader).
// count < 2 samples stop 0 (or transparent black when count <= 0).
void shinyGradientSample(const uint64_t* stops, const float* pos, int count, float u, float rgba[4]);

// Premultiplied "highlight over wrap": out = highlight + (base * ring) * (1 - highlight.a).
// `base` is straight RGBA (0..1). `ringCoverage` is the border-thickness wrap
// ring only (glow excluded). base.a <= 0 is a no-op so a transparent wrap is
// off. Twin of shinyWrapComposite in SHINY_FRAG / shaders/shiny.frag.
void shinyWrapComposite(const float highlightPremul[4], const float baseStraight[4], float ringCoverage,
                        float outPremul[4]);

// Clockwise-half override (plugin:shiny-border:gradient_cw /
// gradient_positions_cw), resolved against the already-resolved primary
// side. Rules:
//   - primary ramp off (primaryCount < 2) → count 0, cw config ignored;
//   - cw colors usable (>= 2 after the step-count clamp) → they replace
//     the primary colors on that half, positioned by cwPosSpec (empty /
//     invalid = even spacing — not the primary positions, which may not
//     even have a matching count);
//   - cw colors unset → the half inherits the primary colors, and
//     cwPosSpec alone can still reshape it; empty / invalid spec is an
//     exact mirror of the primary positions.
// Nothing forces the first/last cw colors to match the primary side —
// mismatched endpoints show a seam at the head / lobe edge (documented).
struct ShinyGradientSide {
    uint64_t stops[SHINY_MAX_GRADIENT_STEPS] = {};
    float    pos[SHINY_MAX_GRADIENT_STEPS]   = {};
    int      count                           = 0;
};

void shinyGradientResolveCwSide(const uint64_t primaryStops[SHINY_MAX_GRADIENT_STEPS],
                                const float primaryPos[SHINY_MAX_GRADIENT_STEPS], int primaryCount,
                                const uint64_t* cwColors, int cwColorCount, const char* cwPosSpec,
                                ShinyGradientSide& out);

// Shared draw fields both backends consume. Colors are packed Hyprland
// CHyprColor uint64 (same as sc<uint64_t>(g_cfg.colA->value())).
// borderSize is logical (unscaled) px — SHADER_THICK / CBorderPassElement
// GL scale once. Do not store already-scaled px here.
// stopCount 0 = classic col.a/col.b comet; 2..SHINY_MAX_GRADIENT_STEPS =
// multi-step ramp through stops[0..stopCount-1] (head → lobe edge), each
// stop placed at stopPos (normalized, from shinyGradientResolvePositions).
// The CW trio is the clockwise half (shinyGradientResolveCwSide) — a
// mirror of the primary side unless gradient_cw / gradient_positions_cw
// override it. The shader consumes both; the CBorderPassElement fallback
// is a plain linear gradient and only draws the primary side.
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
