#include "../src/runtime.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

static int g_fails = 0;

#define CHECK(cond)                                                                                                    \
    do {                                                                                                               \
        if (!(cond)) {                                                                                                 \
            std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                                       \
            g_fails++;                                                                                                 \
        }                                                                                                              \
    } while (0)

static void checkDrawAgreement() {
    const ShinyDrawShared p{
        .rounding      = 12,
        .outerRound    = 18,
        .roundingPower = 2.25f,
        .a             = 0.6f,
        .borderSize    = 3,
        .colA          = 0xFF112233ULL,
        .colB          = 0xFF445566ULL,
        .baseColor     = 0x55006878ULL,
        .stops         = {0xFF111111ULL, 0xFF222222ULL, 0xFF333333ULL},
        .stopPos       = {0.f, 0.7f, 1.f},
        .stopCount     = 3,
        .stopsCW       = {0xFF444444ULL, 0xFF555555ULL},
        .stopPosCW     = {0.f, 1.f},
        .stopCountCW   = 2,
    };

    const float scales[] = {1.f, 2.f};
    for (const float scale : scales) {
        const auto mapped = shinyMapDrawBackends(p, scale);

        CHECK(mapped.shader.rounding == mapped.fallback.shared.rounding);
        CHECK(mapped.shader.outerRound == mapped.fallback.shared.outerRound);
        CHECK(mapped.shader.roundingPower == mapped.fallback.shared.roundingPower);
        CHECK(mapped.shader.a == mapped.fallback.shared.a);
        CHECK(mapped.shader.colA == mapped.fallback.shared.colA);
        CHECK(mapped.shader.colB == mapped.fallback.shared.colB);
        CHECK(mapped.shader.baseColor == mapped.fallback.shared.baseColor);
        CHECK(mapped.shader.baseColor == p.baseColor);
        CHECK(mapped.fallback.shared.baseColor == p.baseColor);

        // The gradient stop list and positions feed both backends unchanged:
        // the shader uploads them as uniforms, the fallback resamples them
        // into an evenly spaced CGradientValueData.
        CHECK(mapped.shader.stopCount == p.stopCount);
        CHECK(mapped.fallback.shared.stopCount == p.stopCount);
        CHECK(mapped.shader.stopCountCW == p.stopCountCW);
        for (int i = 0; i < SHINY_MAX_GRADIENT_STEPS; i++) {
            CHECK(mapped.shader.stops[i] == p.stops[i]);
            CHECK(mapped.fallback.shared.stops[i] == p.stops[i]);
            CHECK(mapped.shader.stopPos[i] == p.stopPos[i]);
            CHECK(mapped.fallback.shared.stopPos[i] == p.stopPos[i]);
            CHECK(mapped.shader.stopsCW[i] == p.stopsCW[i]);
            CHECK(mapped.shader.stopPosCW[i] == p.stopPosCW[i]);
        }

        CHECK(mapped.shader.rounding == p.rounding);
        CHECK(mapped.shader.outerRound == p.outerRound);
        CHECK(mapped.shader.roundingPower == p.roundingPower);
        CHECK(mapped.shader.a == p.a);
        CHECK(mapped.shader.colA == p.colA);
        CHECK(mapped.shader.colB == p.colB);

        CHECK(mapped.shader.borderSize == 3);
        CHECK(mapped.fallback.shared.borderSize == 3);
        CHECK(mapped.shader.borderSize == p.borderSize);
        CHECK(mapped.fallback.shared.borderSize == p.borderSize);
        CHECK(mapped.shader.borderSize != 6);
        CHECK(mapped.shader.borderSize != 12);
        CHECK(mapped.fallback.shared.borderSize != 6);
        CHECK(mapped.fallback.shared.borderSize != 12);

        CHECK(mapped.fallback.expandPx == shinyFallbackExpandPx(p.borderSize, scale));
        if (scale == 1.f) {
            CHECK(mapped.fallback.expandPx == 3);
        } else {
            CHECK(mapped.fallback.expandPx == 6);
            CHECK(mapped.fallback.expandPx != 12);
            CHECK(mapped.fallback.expandPx != mapped.fallback.shared.borderSize);
        }
    }

    CHECK(shinyFallbackExpandPx(3, 1.f) == 3);
    CHECK(shinyFallbackExpandPx(3, 2.f) == 6);
    CHECK(shinyFallbackExpandPx(3, 2.f) != 12);
}

static void checkThickness() {
    // Contract: logical × monitor scale × renderModif combinedScale.
    // 3px @ 1× is 3 framebuffer px; @ 2× is 6, not 12. Zoom 2× then 12.
    CHECK(shinyShaderThick(3.f, 1.f) == 3.f);
    CHECK(shinyShaderThick(3.f, 2.f) == 6.f);
    CHECK(shinyShaderThick(3.f, 2.f) != 12.f);
    CHECK(shinyShaderThick(0.f, 2.f) == 0.f);
    CHECK(shinyShaderThick(3.f, 2.f, 1.f) == 6.f);
    CHECK(shinyShaderThick(3.f, 2.f, 2.f) == 12.f);
    // Rounding is already monitor-scaled in deco; upload multiplies combinedScale only.
    CHECK(shinyShaderThick(6.f, 1.f, 2.f) == 12.f);
}

static void checkHeading() {
    // Production heading is pinDeg + angleOffset, wrapped into [0, 2π).
    // Not atan(cursor − center): leftover pointer math is not a heading source.
    const float pi = std::acos(-1.f);

    CHECK(std::fabs(shinyPinnedHeading(0, 0)) < 1e-5f);
    CHECK(std::fabs(shinyPinnedHeading(90, 0) - pi * 0.5f) < 1e-5f);
    CHECK(std::fabs(shinyPinnedHeading(180, 0) - pi) < 1e-5f);

    // angle_offset is part of the visible heading (shader and fallback).
    CHECK(std::fabs(shinyPinnedHeading(0, 90) - pi * 0.5f) < 1e-4f);
    CHECK(std::fabs(shinyPinnedHeading(350, 20) - 10.f * pi / 180.f) < 1e-4f);
    CHECK(std::fabs(shinyPinnedHeading(-90, 0) - 270.f * pi / 180.f) < 1e-4f);

    const float wrapped = shinyPinnedHeading(-360, -180);
    CHECK(wrapped >= 0.f);
    CHECK(wrapped < 2.f * pi);
}

static std::string sourceDir() {
    std::string       file     = __FILE__;
    const auto        slash    = file.find_last_of('/');
    const std::string testsDir = (slash == std::string::npos) ? std::string(".") : file.substr(0, slash);
    return testsDir + "/../src";
}

static std::string readFile(const std::string& path) {
    std::ifstream in(path);
    if (!in)
        return {};
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

static void checkShaderSource() {
    const std::string frag = readFile(sourceDir() + "/shaders.hpp");
    CHECK(!frag.empty());
    CHECK(frag.find("heading = angle") != std::string::npos);
    CHECK(frag.find("max(roundingPower, 2.0)") == std::string::npos);
    CHECK(frag.find("shinyPulseAlphaMul") != std::string::npos);
    CHECK(frag.find("pointer_position") == std::string::npos);
    CHECK(frag.find("atan(-dir.y") == std::string::npos);
    CHECK(frag.find("atan(-p.y, p.x)") == std::string::npos);
    CHECK(frag.find("vec2 light = vec2(cos(heading), sin(heading));") != std::string::npos);

    // Multi-step ramp: uniform arrays sized like SHINY_MAX_GRADIENT_STEPS,
    // gated on gradCount so the classic branch survives untouched. Stop
    // positions come from gradPos (not computed even spacing), with the
    // coincident-stop guard.
    CHECK(frag.find("const int MAX_STEPS = 8;") != std::string::npos);
    CHECK(frag.find("uniform vec4  gradColors[MAX_STEPS];") != std::string::npos);
    CHECK(frag.find("uniform float gradPos[MAX_STEPS];") != std::string::npos);
    CHECK(frag.find("gradCount >= 2") != std::string::npos);
    CHECK(frag.find("gradPos[i - 1]") != std::string::npos);
    CHECK(frag.find("max(t1 - t0, 1.0e-4)") != std::string::npos);
    CHECK(frag.find("float(i - 1) / float(gradCount - 1)") == std::string::npos);
    CHECK(SHINY_MAX_GRADIENT_STEPS == 8);

    // Per-side ramp: a CW uniform set and one shared chain selected by
    // which half of the light axis the fragment is on.
    CHECK(frag.find("uniform vec4  gradColorsCW[MAX_STEPS];") != std::string::npos);
    CHECK(frag.find("uniform float gradPosCW[MAX_STEPS];") != std::string::npos);
    CHECK(frag.find("uniform int   gradCountCW;") != std::string::npos);
    CHECK(frag.find("shinyRampColor(cw, uRamp)") != std::string::npos);
    CHECK(frag.find("float uRamp = clamp(d0 / max(spread, 1.0e-4), 0.0, 1.0)") != std::string::npos);
    CHECK(frag.find("shinyRampColor(t > 0.5, u)") == std::string::npos);

    // Wrapping baseColor stroke: same composite as shaders/shiny.frag, glow
    // excluded, not stuffed into the last gradient stop, not decoration:shadow.
    CHECK(frag.find("uniform vec4  baseColor;") != std::string::npos);
    CHECK(frag.find("vec4 shinyWrapComposite") != std::string::npos);
    CHECK(frag.find("shinyWrapComposite(highlight, baseColor, wrapRing)") != std::string::npos);
    CHECK(frag.find("shinyWrapComposite(highlight, baseColor, glow") == std::string::npos);
    CHECK(frag.find("shinyWrapComposite(highlight, baseColor, cov") == std::string::npos);
    CHECK(frag.find("decoration:shadow") == std::string::npos);

    const std::string qsFrag = readFile(sourceDir() + "/../../shaders/shiny.frag");
    CHECK(!qsFrag.empty());
    CHECK(qsFrag.find("vec4  baseColor;") != std::string::npos);
    CHECK(qsFrag.find("vec4 shinyWrapComposite") != std::string::npos);
    CHECK(qsFrag.find("shinyWrapComposite(highlight, baseColor, wrapRing)") != std::string::npos);
    CHECK(qsFrag.find("shinyRampColor(cw, uRamp)") != std::string::npos);
    CHECK(qsFrag.find("float uRamp = clamp(d0 / max(spread, 1.0e-4), 0.0, 1.0)") != std::string::npos);

    // Highlight RGB/A from the stop; no white-mix, cone crush, or pulse of
    // spread/thickness. Pulse is an alpha multiplier (identity when off).
    auto checkLighting = [](const std::string& src) {
        CHECK(src.find("vec3(1.0), hot * 0.95") == std::string::npos);
        CHECK(src.find("mix(0.22, 1.0,") == std::string::npos);
        CHECK(src.find("mix(0.055, 1.0,") == std::string::npos);
        CHECK(src.find("range * 0.45") == std::string::npos);
        CHECK(src.find("range * 1.35") == std::string::npos);
        CHECK(src.find("mix(0.78, 1.18, pulse)") == std::string::npos);
        CHECK(src.find("stop.a * cov") != std::string::npos);
        CHECK(src.find("vec4  highlight = vec4(stop.rgb * a, a)") != std::string::npos);
        CHECK(src.find("shinyPulseAlphaMul(brightness, time)") != std::string::npos);
        CHECK(src.find("shinyRampColor(cw, uRamp)") != std::string::npos);
        CHECK(src.find("float uRamp = clamp(d0 / max(spread, 1.0e-4), 0.0, 1.0)") != std::string::npos);
        CHECK(src.find("shinyWrapComposite(highlight, baseColor, wrapRing)") != std::string::npos);
        CHECK(src.find("mix(color, colorSRGB, uRamp)") != std::string::npos);
    };
    checkLighting(frag);
    checkLighting(qsFrag);
}

static void checkProductionWiring() {
    const std::string deco    = readFile(sourceDir() + "/deco.cpp");
    const std::string pass    = readFile(sourceDir() + "/pass.cpp");
    const std::string plug    = readFile(sourceDir() + "/main.cpp");
    const std::string hdr     = readFile(sourceDir() + "/deco.hpp");
    const std::string cfg     = readFile(sourceDir() + "/globals.hpp");
    const std::string runtime = readFile(sourceDir() + "/runtime.hpp");
    CHECK(!deco.empty());
    CHECK(!pass.empty());
    CHECK(!plug.empty());
    CHECK(!hdr.empty());
    CHECK(!cfg.empty());
    CHECK(!runtime.empty());

    CHECK(deco.find("data.angle") != std::string::npos);
    CHECK(deco.find("m_angle") == std::string::npos);
    CHECK(deco.find("setAngle") == std::string::npos);
    CHECK(hdr.find("setAngle") == std::string::npos);
    CHECK(deco.find("getMouseCoordsInternal") == std::string::npos);
    CHECK(plug.find("getMouseCoordsInternal") == std::string::npos);
    CHECK(deco.find("data.pointer") == std::string::npos);

    CHECK(pass.find("SHADER_ANGLE") != std::string::npos);
    CHECK(pass.find("m_data.angle") != std::string::npos);
    CHECK(pass.find("SHADER_POINTER") == std::string::npos);
    CHECK(pass.find("m_data.pointer") == std::string::npos);

    // Shimmer is CPU-modulated: the deco steps the walk and hands the pass a
    // final angle / lobe / thickness scale; shader pulse only scales alpha.
    CHECK(deco.find("shinyShimmerStep") != std::string::npos);
    CHECK(deco.find("shinyShimmerLobe") != std::string::npos);
    CHECK(deco.find("SHINY_EFFECT_PULSE") != std::string::npos);
    CHECK(pass.find("m_data.thickScale") != std::string::npos);

    // Heading is always pinDeg + angleOffset. No pin-vs-mouse latch, no
    // cursor listener, no leftover pin bool that pin:false could flip.
    CHECK(deco.find("shinyPinnedHeading") != std::string::npos);
    CHECK(deco.find("g_cfg.pinDeg->value()") != std::string::npos);
    CHECK(deco.find("g_cfg.angleOffset->value()") != std::string::npos);
    CHECK(deco.find("g_cfg.pin->") == std::string::npos);
    CHECK(plug.find("g_cfg.pin->") == std::string::npos);
    CHECK(plug.find("plugin:shiny-border:pin\"") == std::string::npos);
    CHECK(plug.find("plugin:shiny-border:quantize_deg") == std::string::npos);
    CHECK(plug.find("input.mouse.move") == std::string::npos);
    CHECK(plug.find("onMouseMove") == std::string::npos);
    CHECK(plug.find("g_onMouseMove") == std::string::npos);
    CHECK(plug.find("faces the cursor") == std::string::npos);
    CHECK(plug.find("tracking the mouse") == std::string::npos);
    CHECK(cfg.find("g_onMouseMove") == std::string::npos);
    CHECK(cfg.find("quantizeDeg") == std::string::npos);
    CHECK(plug.find("shinyGpuHeading") == std::string::npos);
    CHECK(deco.find("shinyGpuHeading") == std::string::npos);
    CHECK(plug.find("shinyQuantizeHeading") == std::string::npos);
    CHECK(deco.find("shinyQuantizeHeading") == std::string::npos);
    CHECK(runtime.find("shinyGpuHeading") == std::string::npos);
    CHECK(runtime.find("shinyQuantizeHeading") == std::string::npos);
    CHECK(runtime.find("shinyShouldDamageHeading") == std::string::npos);
    CHECK(runtime.find("shinyPinnedHeading") != std::string::npos);

    // Gradient is one native gradient key, clamped through the shared count
    // helper, and the fallback consumes the same stop list as the shader.
    CHECK(plug.find("plugin:shiny-border:gradient") != std::string::npos);
    CHECK(plug.find("CGradientValue") != std::string::npos);
    CHECK(deco.find("shinyGradientStepCount") != std::string::npos);
    CHECK(deco.find("g_cfg.gradient->value()") != std::string::npos);
    CHECK(pass.find("glUniform4fv") != std::string::npos);
    CHECK(pass.find("gradCount") != std::string::npos);
    CHECK(pass.find("m_data.shared.stops") != std::string::npos);

    // Stop positions: one string key resolved CPU-side (even or custom),
    // uploaded as gradPos, and baked into the fallback by resampling.
    CHECK(plug.find("plugin:shiny-border:gradient_positions") != std::string::npos);
    CHECK(deco.find("shinyGradientResolvePositions") != std::string::npos);
    CHECK(deco.find("shinyGradientSample") != std::string::npos);
    CHECK(runtime.find("shinyGradientLobeU") != std::string::npos);
    CHECK(pass.find("glUniform1fv") != std::string::npos);
    CHECK(pass.find("m_data.shared.stopPos") != std::string::npos);

    // Clockwise half: resolved through the shared helper in the deco and
    // uploaded as its own uniform trio. The fallback linear gradient
    // cannot represent asymmetry and stays primary-side.
    CHECK(plug.find("plugin:shiny-border:gradient_cw") != std::string::npos);
    CHECK(plug.find("plugin:shiny-border:gradient_positions_cw") != std::string::npos);
    CHECK(deco.find("shinyGradientResolveCwSide") != std::string::npos);
    CHECK(pass.find("gradColorsCW") != std::string::npos);
    CHECK(pass.find("m_data.shared.stopsCW") != std::string::npos);

    // baseColor: config key + draw payload + raw glUniform (no CShader slot).
    CHECK(plug.find("plugin:shiny-border:base_color") != std::string::npos);
    CHECK(plug.find("0x55006878") != std::string::npos);
    CHECK(deco.find("shared.baseColor") != std::string::npos || deco.find(".baseColor") != std::string::npos);
    CHECK(deco.find("g_cfg.baseColor->value()") != std::string::npos);
    CHECK(pass.find("m_data.shared.baseColor") != std::string::npos);
    CHECK(pass.find("glUniform4f") != std::string::npos);
    CHECK(pass.find("\"baseColor\"") != std::string::npos);
    CHECK(pass.find("decoration:shadow") == std::string::npos);
    CHECK(plug.find("decoration:shadow") == std::string::npos);
}

static void checkLightProjection() {
    // Mirrors SHINY_FRAG (and qs-shiny-border shaders/shiny.frag): angle is
    // a directional light, u is the parallel projection onto that axis,
    // normalized by this window's rounded-rect support. p is Y-down from
    // center, same as the shader.
    struct Sample {
        float u;
        bool  cw;
    };
    auto sample = [](float px, float py, float w, float h, float r, float heading) -> Sample {
        const float lx     = std::cos(heading);
        const float ly     = std::sin(heading);
        const float pUpX   = px;
        const float pUpY   = -py;
        const float innerX = std::max(w * 0.5f - r, 0.f);
        const float innerY = std::max(h * 0.5f - r, 0.f);
        const float extent = std::max(innerX * std::fabs(lx) + innerY * std::fabs(ly) + r, 1.f);
        float       u      = 0.5f - 0.5f * (pUpX * lx + pUpY * ly) / extent;
        if (u < 0.f)
            u = 0.f;
        if (u > 1.f)
            u = 1.f;
        return {u, (lx * pUpY - ly * pUpX) < 0.f};
    };

    const float pi = std::acos(-1.f);
    const float r  = 12.f;
    CHECK(std::fabs(sample(50.f, 0.f, 100.f, 100.f, r, 0.f).u) < 1e-4f);
    CHECK(std::fabs(sample(-50.f, 0.f, 100.f, 100.f, r, 0.f).u - 1.f) < 1e-4f);
    CHECK(std::fabs(sample(0.f, -50.f, 100.f, 100.f, r, 0.f).u - 0.5f) < 0.05f);
    CHECK(std::fabs(sample(0.f, -50.f, 100.f, 100.f, r, pi * 0.5f).u) < 1e-4f);

    const float head = 120.f * pi / 180.f;
    auto        corners = [&](float w, float h) {
        const float hw = w * 0.5f;
        const float hh = h * 0.5f;
        struct Corners {
            Sample tr, tl, bl, br;
        };
        return Corners{
            sample(hw, -hh, w, h, r, head),
            sample(-hw, -hh, w, h, r, head),
            sample(-hw, hh, w, h, r, head),
            sample(hw, hh, w, h, r, head),
        };
    };
    const auto wide = corners(400.f, 100.f);
    const auto tall = corners(100.f, 400.f);
    CHECK(wide.tl.u < wide.tr.u && wide.tl.u < wide.bl.u && wide.tl.u < wide.br.u);
    CHECK(tall.tl.u < tall.tr.u && tall.tl.u < tall.bl.u && tall.tl.u < tall.br.u);
    CHECK(std::fabs(wide.tl.u) < 1e-3f && std::fabs(tall.tl.u) < 1e-3f);
    CHECK(wide.tr.u > tall.tr.u);
    CHECK(tall.bl.u > wide.bl.u);
    CHECK(wide.tr.cw != wide.bl.cw);
    CHECK(!sample(0.f, -50.f, 100.f, 100.f, r, 0.f).cw);
    CHECK(sample(0.f, 50.f, 100.f, 100.f, r, 0.f).cw);
}

int main() {
    checkDrawAgreement();
    checkThickness();
    checkHeading();
    checkShaderSource();
    checkProductionWiring();
    checkLightProjection();

    if (g_fails) {
        std::fprintf(stderr, "%d checks failed\n", g_fails);
        return 1;
    }
    std::puts("ok");
    return 0;
}
