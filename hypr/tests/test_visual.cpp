#include "../src/runtime.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

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
    // GLES host wrapper only. Lighting identity is the bake pipeline
    // (scripts/bake.sh inlines shaders/shiny-lighting.frag); do not grep
    // lighting literals out of both hosts.
    const std::string frag = readFile(sourceDir() + "/shaders.hpp");
    CHECK(!frag.empty());
    CHECK(frag.find("Generated by scripts/bake.sh") != std::string::npos);
    CHECK(frag.find("gl_FragCoord") != std::string::npos);
    CHECK(frag.find("pointer_position") == std::string::npos);
    CHECK(frag.find("atan(-dir.y") == std::string::npos);
    CHECK(frag.find("atan(-p.y, p.x)") == std::string::npos);

    CHECK(frag.find("const int MAX_STEPS = 8;") != std::string::npos);
    CHECK(frag.find("uniform vec4  gradColors[MAX_STEPS];") != std::string::npos);
    CHECK(frag.find("uniform float gradPos[MAX_STEPS];") != std::string::npos);
    CHECK(frag.find("float(i - 1) / float(gradCount - 1)") == std::string::npos);
    CHECK(SHINY_MAX_GRADIENT_STEPS == 8);

    CHECK(frag.find("uniform vec4  gradColorsCW[MAX_STEPS];") != std::string::npos);
    CHECK(frag.find("uniform float gradPosCW[MAX_STEPS];") != std::string::npos);
    CHECK(frag.find("uniform int   gradCountCW;") != std::string::npos);
    CHECK(frag.find("shinyRampColor(t > 0.5, u)") == std::string::npos);

    CHECK(frag.find("uniform vec4  baseColor;") != std::string::npos);
    CHECK(frag.find("decoration:shadow") == std::string::npos);
    CHECK(frag.find("RIPPLE_FRAG") != std::string::npos);
    CHECK(frag.find("rippleFreq") != std::string::npos);
    CHECK(frag.find("if (ripple)") == std::string::npos);
}

static std::string lookJsPath() {
    return sourceDir() + "/../../qml/Look.js";
}

static std::string extractLookDefaults(const std::string& js) {
    const auto start = js.find("var DEFAULTS = {");
    if (start == std::string::npos)
        return {};
    int depth = 0;
    for (size_t i = start; i < js.size(); i++) {
        if (js[i] == '{')
            depth++;
        else if (js[i] == '}') {
            depth--;
            if (depth == 0)
                return js.substr(start, i - start + 1);
        }
    }
    return {};
}

static std::string jsScalar(const std::string& obj, const std::string& key) {
    const std::string needle = "\n  " + key + ":";
    auto              p      = obj.find(needle);
    if (p == std::string::npos)
        return {};
    p += needle.size();
    while (p < obj.size() && std::isspace(static_cast<unsigned char>(obj[p])))
        p++;
    if (p >= obj.size())
        return {};
    if (obj[p] == '"') {
        auto q = obj.find('"', p + 1);
        if (q == std::string::npos)
            return {};
        return obj.substr(p + 1, q - p - 1);
    }
    if (obj[p] == '[')
        return {};
    size_t q = p;
    while (q < obj.size() && obj[q] != ',' && obj[q] != '\n')
        q++;
    return obj.substr(p, q - p);
}

static std::vector<std::string> jsRgbaList(const std::string& obj, const std::string& key) {
    const std::string needle = "\n  " + key + ":";
    auto              p      = obj.find(needle);
    std::vector<std::string> out;
    if (p == std::string::npos)
        return out;
    auto open = obj.find('[', p);
    auto close = obj.find(']', open);
    if (open == std::string::npos || close == std::string::npos || close <= open)
        return out;
    const std::string body = obj.substr(open, close - open);
    size_t            q    = 0;
    while (true) {
        auto r = body.find("rgba(", q);
        if (r == std::string::npos)
            break;
        auto e = body.find(')', r);
        if (e == std::string::npos)
            break;
        out.push_back(body.substr(r, e - r + 1));
        q = e + 1;
    }
    return out;
}

static uint64_t rgbaToArgb(const std::string& s) {
    auto open  = s.find('(');
    auto close = s.find(')');
    if (open == std::string::npos || close == std::string::npos || close <= open)
        return 0;
    std::string hex = s.substr(open + 1, close - open - 1);
    if (hex.size() == 6)
        hex += "ff";
    if (hex.size() != 8)
        return 0;
    const unsigned long v   = std::strtoul(hex.c_str(), nullptr, 16);
    const unsigned long rgb = (v >> 8) & 0xffffffUL;
    const unsigned long a   = v & 0xffUL;
    return (static_cast<uint64_t>(a) << 24) | rgb;
}

static std::string pluginInitSection(const std::string& src) {
    const auto a = src.find("PLUGIN_DESCRIPTION_INFO PLUGIN_INIT");
    const auto b = src.find("APICALL EXPORT void PLUGIN_EXIT");
    if (a == std::string::npos || b == std::string::npos || b <= a)
        return {};
    return src.substr(a, b - a);
}

static size_t skipCppString(const std::string& s, size_t i) {
    if (i >= s.size() || s[i] != '"')
        return i;
    i++;
    while (i < s.size()) {
        if (s[i] == '\\') {
            i += 2;
            continue;
        }
        if (s[i] == '"')
            return i + 1;
        i++;
    }
    return i;
}

static std::string hyprCtorDefault(const std::string& init, const std::string& key) {
    const std::string needle = "\"plugin:shiny-border:" + key + "\"";
    auto              p      = init.find(needle);
    if (p == std::string::npos)
        return {};
    size_t i = p + needle.size();
    while (i < init.size() && (std::isspace(static_cast<unsigned char>(init[i])) || init[i] == ','))
        i++;
    i = skipCppString(init, i);
    while (i < init.size() && (std::isspace(static_cast<unsigned char>(init[i])) || init[i] == ','))
        i++;
    if (i >= init.size())
        return {};
    if (init[i] == '"') {
        const size_t start = i + 1;
        i                  = skipCppString(init, i);
        if (i == 0)
            return {};
        return init.substr(start, i - start - 1);
    }
    if (init.compare(i, 10, "CHyprColor") == 0) {
        auto open  = init.find('{', i);
        auto close = init.find('}', open);
        if (open == std::string::npos || close == std::string::npos)
            return {};
        std::string inner = init.substr(open + 1, close - open - 1);
        while (!inner.empty() && std::isspace(static_cast<unsigned char>(inner.front())))
            inner.erase(inner.begin());
        while (!inner.empty() && std::isspace(static_cast<unsigned char>(inner.back())))
            inner.pop_back();
        return inner;
    }
    size_t q = i;
    while (q < init.size() && (std::isalnum(static_cast<unsigned char>(init[q])) || init[q] == '.' || init[q] == '-' || init[q] == '_'))
        q++;
    return init.substr(i, q - i);
}

static std::vector<uint64_t> cppU64Array(const std::string& src, const std::string& name) {
    const std::string needle = name + "[]";
    auto              p      = src.find(needle);
    std::vector<uint64_t> out;
    if (p == std::string::npos)
        return out;
    auto open  = src.find('{', p);
    auto close = src.find('}', open);
    if (open == std::string::npos || close == std::string::npos)
        return out;
    const std::string body = src.substr(open, close - open);
    size_t            q    = 0;
    while (true) {
        auto h = body.find("0x", q);
        if (h == std::string::npos)
            break;
        size_t e = h + 2;
        while (e < body.size() && std::isxdigit(static_cast<unsigned char>(body[e])))
            e++;
        out.push_back(std::strtoull(body.substr(h, e - h).c_str(), nullptr, 16));
        q = e;
    }
    return out;
}

static bool tokBool(const std::string& tok, bool want) {
    return tok == (want ? "true" : "false");
}

static bool tokNumber(const std::string& tok, double want) {
    if (tok.empty())
        return false;
    char* end = nullptr;
    const double got = std::strtod(tok.c_str(), &end);
    if (!end || end == tok.c_str())
        return false;
    return std::fabs(got - want) < 1e-9;
}

static bool tokHex(const std::string& tok, uint64_t want) {
    if (tok.size() < 3)
        return false;
    return std::strtoull(tok.c_str(), nullptr, 16) == want;
}

static void checkPluginInitLookDefaults() {
    const std::string js   = readFile(lookJsPath());
    const std::string main = readFile(sourceDir() + "/main.cpp");
    CHECK(!js.empty());
    CHECK(!main.empty());

    const std::string defaults = extractLookDefaults(js);
    const std::string init     = pluginInitSection(main);
    CHECK(!defaults.empty());
    CHECK(!init.empty());

    CHECK(tokBool(hyprCtorDefault(init, "pulse"), jsScalar(defaults, "pulse") == "true"));
    CHECK(tokBool(hyprCtorDefault(init, "shimmer"), jsScalar(defaults, "shimmer") == "true"));
    CHECK(tokBool(hyprCtorDefault(init, "mirror"), jsScalar(defaults, "mirror") == "true"));
    CHECK(tokBool(hyprCtorDefault(init, "active_only"), jsScalar(defaults, "activeOnly") == "true"));

    CHECK(tokNumber(hyprCtorDefault(init, "pin_deg"), std::strtod(jsScalar(defaults, "pinDeg").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "border_size"), std::strtod(jsScalar(defaults, "borderSize").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "shimmer_deg"), std::strtod(jsScalar(defaults, "shimmerDeg").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "angle_offset"), std::strtod(jsScalar(defaults, "angleOffset").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "shimmer_hz"), std::strtod(jsScalar(defaults, "shimmerHz").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "pulse_hz"), std::strtod(jsScalar(defaults, "pulseHz").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "shimmer_scale_min"), std::strtod(jsScalar(defaults, "shimmerScaleMin").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "shimmer_scale_max"), std::strtod(jsScalar(defaults, "shimmerScaleMax").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "lobe"), std::strtod(jsScalar(defaults, "lobe").c_str(), nullptr)));
    CHECK(hyprCtorDefault(init, "effect") == jsScalar(defaults, "effect"));
    CHECK(tokNumber(hyprCtorDefault(init, "ripple_freq"), std::strtod(jsScalar(defaults, "rippleFreq").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "ripple_speed"), std::strtod(jsScalar(defaults, "rippleSpeed").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "ripple_gain"), std::strtod(jsScalar(defaults, "rippleGain").c_str(), nullptr)));
    CHECK(tokNumber(hyprCtorDefault(init, "ripple_power"), std::strtod(jsScalar(defaults, "ripplePower").c_str(), nullptr)));

    CHECK(hyprCtorDefault(init, "gradient_positions") == jsScalar(defaults, "gradientPositions"));
    CHECK(hyprCtorDefault(init, "gradient_positions_cw") == jsScalar(defaults, "gradientPositionsCw"));

    CHECK(tokHex(hyprCtorDefault(init, "col.a"), rgbaToArgb(jsScalar(defaults, "colA"))));
    CHECK(tokHex(hyprCtorDefault(init, "col.b"), rgbaToArgb(jsScalar(defaults, "colB"))));
    CHECK(tokHex(hyprCtorDefault(init, "base_color"), rgbaToArgb(jsScalar(defaults, "baseColor"))));

    const auto wantStops = jsRgbaList(defaults, "gradient");
    CHECK(wantStops.size() == 4);
    const auto gotStops = cppU64Array(main, "kLookDefaultGradient");
    CHECK(gotStops.size() == 4);
    for (size_t i = 0; i < 4 && i < gotStops.size() && i < wantStops.size(); i++)
        CHECK(gotStops[i] == rgbaToArgb(wantStops[i]));

    CHECK(main.find("shinySeedGradientStops") != std::string::npos);
    CHECK(main.find("data.m_colors") != std::string::npos);
    CHECK(main.find("updateColorsOk") != std::string::npos);
    CHECK(main.find("shinySeedGradientStops(g_cfg.gradient, kLookDefaultGradient") != std::string::npos);

    const std::string applyNeedle = "shinyApplyLookGradientDefault()";
    const auto        applyAt     = init.find(applyNeedle);
    const auto        addGrad     = init.find("HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.gradient)");
    const auto        reloadAt    = init.find("HyprlandAPI::reloadConfig()");
    const auto        reloadedAt  = init.find("config.reloaded.listen");
    CHECK(applyAt != std::string::npos);
    CHECK(addGrad != std::string::npos);
    CHECK(reloadAt != std::string::npos);
    CHECK(applyAt < addGrad);
    CHECK(init.find(applyNeedle, addGrad) != std::string::npos);
    CHECK(init.find(applyNeedle, addGrad) < reloadAt);
    CHECK(reloadedAt != std::string::npos);
    CHECK(reloadedAt > reloadAt);
    const auto applyFromReload = init.find("shinyApplyLookGradientDefault();", reloadedAt);
    CHECK(applyFromReload != std::string::npos);
    CHECK(applyFromReload - reloadedAt < 80);
    CHECK(main.find("shinyGradientSetByUser") != std::string::npos);
    CHECK(main.find("getConfigValue(\"plugin:shiny-border:gradient\")") != std::string::npos);
    CHECK(main.find(".setByUser") != std::string::npos);
    CHECK(main.find("g_onConfigReloaded.reset()") != std::string::npos);
    CHECK(init.find("shinySeedGradientStops(g_cfg.gradientCw") == std::string::npos);

    CHECK(jsRgbaList(defaults, "gradientCw").size() < 2);
    CHECK(!hyprCtorDefault(init, "gradient_cw").empty());
}

static void checkProductionWiring() {
    const std::string deco    = readFile(sourceDir() + "/deco.cpp");
    const std::string pass    = readFile(sourceDir() + "/pass.cpp");
    const std::string plug    = readFile(sourceDir() + "/main.cpp");
    const std::string hdr     = readFile(sourceDir() + "/deco.hpp");
    const std::string cfg     = readFile(sourceDir() + "/globals.hpp");
    const std::string runtime      = readFile(sourceDir() + "/runtime.hpp");
    const std::string gradientHdr  = readFile(sourceDir() + "/gradient.hpp");
    const std::string shimmerHdr   = readFile(sourceDir() + "/shimmer.hpp");
    const std::string gradientCpp  = readFile(sourceDir() + "/gradient.cpp");
    const std::string shimmerCpp   = readFile(sourceDir() + "/shimmer.cpp");
    const std::string logicHdr     = runtime + gradientHdr + shimmerHdr;
    CHECK(!deco.empty());
    CHECK(!pass.empty());
    CHECK(!plug.empty());
    CHECK(!hdr.empty());
    CHECK(!cfg.empty());
    CHECK(!runtime.empty());
    CHECK(!gradientHdr.empty());
    CHECK(!shimmerHdr.empty());
    CHECK(!gradientCpp.empty());
    CHECK(!shimmerCpp.empty());

    // Hyprland-free split mirrors qml/Gradient.js / qml/Shimmer.js.
    CHECK(gradientHdr.find("shinyGradientResolvePositions") != std::string::npos);
    CHECK(shimmerHdr.find("shinyShimmerStep") != std::string::npos);
    CHECK(shimmerHdr.find("shinyPulseAlphaMul") != std::string::npos);
    CHECK(runtime.find("bool shinyGradientResolvePositions(") == std::string::npos);
    CHECK(runtime.find("void shinyShimmerStep(") == std::string::npos);
    CHECK(runtime.find("float shinyPulseAlphaMul(") == std::string::npos);

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
    CHECK(logicHdr.find("shinyGpuHeading") == std::string::npos);
    CHECK(logicHdr.find("shinyQuantizeHeading") == std::string::npos);
    CHECK(logicHdr.find("shinyShouldDamageHeading") == std::string::npos);
    CHECK(logicHdr.find("shinyPinnedHeading") != std::string::npos);

    // Gradient is one native gradient key, clamped through the shared count
    // helper, and the fallback consumes the same stop list as the shader.
    CHECK(plug.find("plugin:shiny-border:gradient") != std::string::npos);
    CHECK(plug.find("CGradientValue") != std::string::npos);
    CHECK(deco.find("shinyGradientStepCount") != std::string::npos);
    CHECK(deco.find("g_cfg.gradient->value()") != std::string::npos);
    CHECK(pass.find("glUniform4fv") != std::string::npos);
    CHECK(pass.find("gradCount") != std::string::npos);
    CHECK(pass.find("m_data.shared.stops") != std::string::npos);

    // Stop positions: resolved on spec change (cached), copied into the
    // draw payload, uploaded as gradPos, baked into fallback by resampling.
    // deco draw() must not tokenize the raw position / CW strings.
    CHECK(plug.find("plugin:shiny-border:gradient_positions") != std::string::npos);
    CHECK(deco.find("shinyGradientCacheEnsure") != std::string::npos);
    CHECK(deco.find("shinyGradientResolvePositions") == std::string::npos);
    CHECK(deco.find("strtof") == std::string::npos);
    CHECK(deco.find("shinyLinearFallbackElements") != std::string::npos);
    CHECK(pass.find("shinyGradientSample") != std::string::npos);
    CHECK(logicHdr.find("shinyGradientLobeU") != std::string::npos);
    CHECK(pass.find("glUniform1fv") != std::string::npos);
    CHECK(pass.find("m_data.shared.stopPos") != std::string::npos);

    // Clockwise half: cached with the primary spec, uploaded as its own
    // uniform trio. The fallback linear gradient cannot represent
    // asymmetry and stays primary-side (shader-only).
    CHECK(plug.find("plugin:shiny-border:gradient_cw") != std::string::npos);
    CHECK(plug.find("plugin:shiny-border:gradient_positions_cw") != std::string::npos);
    CHECK(deco.find("shinyGradientResolveCwSide") == std::string::npos);
    CHECK(pass.find("gradColorsCW") != std::string::npos);
    CHECK(pass.find("m_data.shared.stopsCW") != std::string::npos);

    // Emergency fallback: heading (drawAngle) + pulse alpha. wrap /
    // baseColor, mirror two-head, and CW stay shader-only.
    CHECK(deco.find("fallback.angle") != std::string::npos);
    CHECK(deco.find("drawAngle") != std::string::npos);
    CHECK(pass.find("shinyFallbackPassAlpha") != std::string::npos);
    CHECK(pass.find("shader-only") != std::string::npos);
    CHECK(logicHdr.find("shader-only") != std::string::npos);

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

    // mirror: config bool + draw payload + raw glUniform (no CShader slot).
    CHECK(plug.find("plugin:shiny-border:mirror") != std::string::npos);
    CHECK(deco.find("g_cfg.mirror->value()") != std::string::npos);
    CHECK(pass.find("m_data.mirror") != std::string::npos);
    CHECK(pass.find("\"mirror\"") != std::string::npos);
    CHECK(pass.find("glUniform1i") != std::string::npos);
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
    checkPluginInitLookDefaults();
    checkProductionWiring();
    checkLightProjection();

    if (g_fails) {
        std::fprintf(stderr, "%d checks failed\n", g_fails);
        return 1;
    }
    std::puts("ok");
    return 0;
}
