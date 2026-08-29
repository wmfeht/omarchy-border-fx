#include "gradient.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>

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

float shinyGradientLobeU(float uAxis, float spread, bool mirror) {
    const float u  = std::clamp(uAxis, 0.f, 1.f);
    const float d0 = (mirror ? std::min(u, 1.f - u) : u) * 0.5f;
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

static std::string shinySpecKey(const char* spec) {
    return spec ? std::string(spec) : std::string();
}

static bool shinySameU64(const uint64_t* a, const uint64_t* b, int n) {
    for (int i = 0; i < n; i++) {
        const uint64_t av = a ? a[i] : 0;
        const uint64_t bv = b ? b[i] : 0;
        if (av != bv)
            return false;
    }
    return true;
}

ShinyResolvedGradient shinyGradientCacheEnsure(ShinyGradientCache& cache, const char* posSpec, int stopCount,
                                               const uint64_t stops[SHINY_MAX_GRADIENT_STEPS],
                                               const uint64_t* cwColors, int cwColorCount, const char* cwPosSpec) {
    const std::string posKey = shinySpecKey(posSpec);
    const std::string cwKey  = shinySpecKey(cwPosSpec);
    const int         n      = std::clamp(stopCount, 0, SHINY_MAX_GRADIENT_STEPS);
    const int         cn     = std::clamp(cwColorCount, 0, SHINY_MAX_GRADIENT_STEPS);

    uint64_t cwStored[SHINY_MAX_GRADIENT_STEPS] = {};
    if (cwColors) {
        for (int i = 0; i < cn; i++)
            cwStored[i] = cwColors[i];
    }

    if (cache.filled && cache.posSpec == posKey && cache.cwPosSpec == cwKey && cache.stopCount == n &&
        cache.cwColorCount == cn && shinySameU64(cache.stops, stops, n) &&
        shinySameU64(cache.cwColors, cwStored, cn))
        return cache.resolved;

    cache.posSpec      = posKey;
    cache.cwPosSpec    = cwKey;
    cache.stopCount    = n;
    cache.cwColorCount = cn;
    for (int i = 0; i < SHINY_MAX_GRADIENT_STEPS; i++) {
        cache.stops[i]    = (stops && i < n) ? stops[i] : 0;
        cache.cwColors[i] = cwStored[i];
    }

    cache.resolved = ShinyResolvedGradient{};
    cache.resolved.customPos =
        shinyGradientResolvePositions(posSpec, n, cache.resolved.stopPos);
    shinyGradientResolveCwSide(cache.stops, cache.resolved.stopPos, n, cwColors, cwColorCount, cwPosSpec,
                               cache.resolved.cw);
    cache.filled = true;
    cache.resolves++;
    return cache.resolved;
}
