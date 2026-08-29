#pragma once

#include <cstdint>
#include <string>

// Hyprland-free gradient contract. Twin of qml/Gradient.js. Tests drive
// these functions without a compositor. Draw geometry / VAO / backend
// mapping stay in runtime.hpp.

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
// Off (default): d0 = u * 0.5, facing-only comet. On: d0 = min(u, 1-u) * 0.5
// so both ends of the axis are heads. spread is the applied lobe (config /
// shimmer-scaled range, floored at 0.04). Returns 0 at a head, 1 at a
// lobe edge, and stays 1 past it. lobe 0.5 off is identity. Twin of
// uRamp in SHINY_FRAG / shaders/shiny.frag.
float shinyGradientLobeU(float uAxis, float spread, bool mirror = false);

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

// Cached resolve of position / CW strings. Tokenize on spec or stop-list
// change; draw() copies the cached side instead of re-parsing every frame.
struct ShinyResolvedGradient {
    float             stopPos[SHINY_MAX_GRADIENT_STEPS] = {};
    bool              customPos                         = false;
    ShinyGradientSide cw{};
};

struct ShinyGradientCache {
    std::string posSpec;
    std::string cwPosSpec;
    int         stopCount    = -1;
    int         cwColorCount = -1;
    uint64_t    stops[SHINY_MAX_GRADIENT_STEPS]    = {};
    uint64_t    cwColors[SHINY_MAX_GRADIENT_STEPS] = {};
    ShinyResolvedGradient resolved;
    bool filled   = false;
    int  resolves = 0; // times the raw spec was tokenized
};

ShinyResolvedGradient shinyGradientCacheEnsure(ShinyGradientCache& cache, const char* posSpec, int stopCount,
                                               const uint64_t stops[SHINY_MAX_GRADIENT_STEPS],
                                               const uint64_t* cwColors, int cwColorCount, const char* cwPosSpec);
