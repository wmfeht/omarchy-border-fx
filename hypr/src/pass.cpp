#include "pass.hpp"
#include "teardown.hpp"
#include "runtime.hpp"
#include "shaders.hpp"
#include "globals.hpp"

#include <hyprland/src/render/Renderer.hpp>
#include <hyprland/src/render/OpenGL.hpp>
#include <hyprland/src/render/Shader.hpp>
#include <hyprland/src/render/ShaderLoader.hpp>
#include <hyprland/src/render/pass/BorderPassElement.hpp>
#include <hyprland/src/output/Monitor.hpp>
#include <hyprland/src/debug/log/Logger.hpp>
#include <hyprland/src/helpers/Color.hpp>
#include <hyprland/src/helpers/memory/Memory.hpp>

#include <GLES3/gl32.h>

#include <algorithm>
#include <vector>

using namespace Render::GL;

static SP<CShader> g_shinyShader;
static SP<CShader> g_rippleShader;

// The grad* / baseColor / ripple uniforms are not in CShader's uniform
// lookup table, so they are uploaded with raw glUniform* against cached
// locations. -1 is a valid "absent" location: glUniform* silently ignores it.
struct ShinyUniformLocs {
    GLint gradColors   = -1;
    GLint gradPos      = -1;
    GLint gradCount    = -1;
    GLint gradColorsCw = -1;
    GLint gradPosCw    = -1;
    GLint gradCountCw  = -1;
    GLint baseColor    = -1;
    GLint mirror       = -1;
    GLint rippleFreq   = -1;
    GLint rippleSpeed  = -1;
    GLint rippleGain   = -1;
    GLint ripplePower  = -1;
};

static ShinyUniformLocs g_shinyLocs;
static ShinyUniformLocs g_rippleLocs;

static void resetGradUniformLocations(ShinyUniformLocs& locs) {
    locs = {};
}

static void cacheProgramUniforms(const SP<CShader>& shader, ShinyUniformLocs& locs, bool ripple) {
    locs = {};
    if (!shader)
        return;
    const auto prog = shader->program();
    locs.gradColors   = glGetUniformLocation(prog, "gradColors");
    locs.gradPos      = glGetUniformLocation(prog, "gradPos");
    locs.gradCount    = glGetUniformLocation(prog, "gradCount");
    locs.gradColorsCw = glGetUniformLocation(prog, "gradColorsCW");
    locs.gradPosCw    = glGetUniformLocation(prog, "gradPosCW");
    locs.gradCountCw  = glGetUniformLocation(prog, "gradCountCW");
    locs.baseColor    = glGetUniformLocation(prog, "baseColor");
    locs.mirror       = glGetUniformLocation(prog, "mirror");
    if (!ripple)
        return;
    locs.rippleFreq  = glGetUniformLocation(prog, "rippleFreq");
    locs.rippleSpeed = glGetUniformLocation(prog, "rippleSpeed");
    locs.rippleGain  = glGetUniformLocation(prog, "rippleGain");
    locs.ripplePower = glGetUniformLocation(prog, "ripplePower");
}

static bool hyprGlAlive() {
    return static_cast<bool>(g_pHyprOpenGL);
}

static void hyprMakeCurrent() {
    g_pHyprOpenGL->makeEGLCurrent();
}

static bool hyprShaderLive() {
    return g_shinyShader && g_shinyShader->program() && g_rippleShader && g_rippleShader->program();
}

static bool hyprCompileOne(SP<CShader>& slot, const std::string& frag, ShinyUniformLocs& locs, bool ripple) {
    slot = makeShared<CShader>();
    if (!slot->createProgram(SHINY_VERT, frag, true, false)) {
        slot.reset();
        resetGradUniformLocations(locs);
        return false;
    }
    cacheProgramUniforms(slot, locs, ripple);
    return true;
}

static bool hyprCompileShader() {
    if (!g_pHyprOpenGL)
        return false;

    g_pHyprOpenGL->makeEGLCurrent();
    if (!hyprCompileOne(g_shinyShader, SHINY_FRAG, g_shinyLocs, false)) {
        Log::logger->log(Log::ERR, "[shiny-border] shiny fragment shader failed to compile");
        return false;
    }
    if (!hyprCompileOne(g_rippleShader, RIPPLE_FRAG, g_rippleLocs, true)) {
        Log::logger->log(Log::ERR, "[shiny-border] ripple fragment shader failed to compile");
        g_shinyShader.reset();
        resetGradUniformLocations(g_shinyLocs);
        return false;
    }
    return true;
}

static void hyprResetShader() {
    g_shinyShader.reset();
    g_rippleShader.reset();
    resetGradUniformLocations(g_shinyLocs);
    resetGradUniformLocations(g_rippleLocs);
}

static void hyprAbandonShader() {
    // Deliberate leak: empty the statics without ~CShader / glDelete*.
    (void)new SP<CShader>(std::move(g_shinyShader));
    (void)new SP<CShader>(std::move(g_rippleShader));
    resetGradUniformLocations(g_shinyLocs);
    resetGradUniformLocations(g_rippleLocs);
}

struct ShinyQueued {
    CShinyPassElement*   elem = nullptr;
    Render::CRenderPass* pass = nullptr;
};

static std::vector<ShinyQueued> g_queuedShiny;

static void hyprRemoveQueuedPassElements() {
    std::vector<Render::CRenderPass*> passes;
    passes.reserve(g_queuedShiny.size());
    for (const auto& q : g_queuedShiny) {
        if (q.pass)
            passes.push_back(q.pass);
    }
    std::sort(passes.begin(), passes.end());
    passes.erase(std::unique(passes.begin(), passes.end()), passes.end());
    // removeAllOfType is non-recursive; each owning pass (top-level or a
    // CTransformedWindowPassElement nested pass recorded at ctor) is visited.
    for (auto* p : passes)
        p->removeAllOfType("CShinyPassElement");
}

static void hyprUnbindVao() {
    glBindVertexArray(0);
}

static void hyprClearScissor() {
    if (g_pHyprOpenGL)
        g_pHyprOpenGL->scissor(nullptr);
}

static void hyprRestoreBlend() {
    if (g_pHyprOpenGL)
        g_pHyprOpenGL->blend(true);
}

static void hyprRestoreProgram() {
    if (!g_pHyprOpenGL)
        return;
    // useShader is not RAII and caches m_currentProgram. Binding a stock
    // variant updates both GL and that cache; glUseProgram(0) would desync it.
    auto stock = g_pHyprOpenGL->getShaderVariant(Render::SH_FRAG_QUAD);
    if (stock)
        g_pHyprOpenGL->useShader(stock);
}

[[gnu::constructor]] static void bindShinyShaderOps() {
    shinySetShaderOps({
        .glAlive     = hyprGlAlive,
        .makeCurrent = hyprMakeCurrent,
        .shaderLive  = hyprShaderLive,
        .compile     = hyprCompileShader,
        .reset       = hyprResetShader,
        .abandon     = hyprAbandonShader,
    });
    shinySetPassRemoveOps({
        .removeQueued = hyprRemoveQueuedPassElements,
    });
    shinySetGlRestoreOps({
        .unbindVao      = hyprUnbindVao,
        .clearScissor   = hyprClearScissor,
        .restoreBlend   = hyprRestoreBlend,
        .restoreProgram = hyprRestoreProgram,
    });
}

CShinyPassElement::CShinyPassElement(const SData& data) : m_data(data), m_epoch(shinyPassEpoch()) {
    Render::CRenderPass* owner = nullptr;
    if (g_pHyprRenderer)
        owner = &g_pHyprRenderer->currentPass();
    g_queuedShiny.push_back({this, owner});
}

CShinyPassElement::~CShinyPassElement() {
    std::erase_if(g_queuedShiny, [this](const ShinyQueued& q) { return q.elem == this; });
}

std::vector<UP<IPassElement>> shinyLinearFallbackElements(const CShinyPassElement::SData& data, float monitorScale) {
    // Emergency paint only. Heading is data.angle; pulse may scale alpha
    // via shinyFallbackPassAlpha. wrap / baseColor, mirror two-head, and
    // the clockwise half are shader-only — CBorderPassElement is a plain
    // linear gradient of the primary side, not the shared look.
    const auto mapped    = shinyMapDrawBackends(data.shared, monitorScale);
    CBox       windowBox = data.box.copy().expand(-mapped.fallback.expandPx).round();

    std::vector<CHyprColor> stops;
    if (mapped.fallback.shared.stopCount >= 2 && data.customPos) {
        stops.reserve(SHINY_MAX_GRADIENT_STEPS);
        for (int i = 0; i < SHINY_MAX_GRADIENT_STEPS; i++) {
            float rgba[4];
            shinyGradientSample(mapped.fallback.shared.stops, mapped.fallback.shared.stopPos, mapped.fallback.shared.stopCount,
                                shinyGradientStopPos(i, SHINY_MAX_GRADIENT_STEPS), rgba);
            stops.emplace_back(rgba[0], rgba[1], rgba[2], rgba[3]);
        }
    } else if (mapped.fallback.shared.stopCount >= 2) {
        stops.reserve(sc<size_t>(mapped.fallback.shared.stopCount));
        for (int i = 0; i < mapped.fallback.shared.stopCount; i++)
            stops.emplace_back(mapped.fallback.shared.stops[i]);
    } else {
        stops = {CHyprColor{mapped.fallback.shared.colA}, CHyprColor{mapped.fallback.shared.colB}};
    }
    Config::CGradientValueData grad(std::move(stops), data.angle);

    CBorderPassElement::SBorderData bd;
    bd.box           = windowBox;
    bd.grad1         = grad;
    bd.round         = mapped.fallback.shared.rounding;
    bd.outerRound    = mapped.fallback.shared.outerRound;
    bd.roundingPower = mapped.fallback.shared.roundingPower;
    bd.a             = shinyFallbackPassAlpha(mapped.fallback.shared.a, data.pulseHz > 0.f, data.time, data.pulseHz);
    bd.borderSize    = mapped.fallback.shared.borderSize;
    bd.window        = data.window;

    std::vector<UP<IPassElement>> out;
    out.emplace_back(makeUnique<CBorderPassElement>(bd));
    return out;
}

static std::vector<UP<IPassElement>> shinyFallbackIf(ShinyDrawResult result, const CShinyPassElement::SData& data, float monitorScale) {
    if (result == SHINY_DRAW_FALLBACK)
        return shinyLinearFallbackElements(data, monitorScale);
    return {};
}

bool CShinyPassElement::needsLiveBlur() {
    return false;
}

bool CShinyPassElement::needsPrecomputeBlur() {
    return false;
}

bool CShinyPassElement::disableSimplification() {
    return true;
}

std::optional<CBox> CShinyPassElement::boundingBox() {
    if (!g_pHyprRenderer->m_renderData.pMonitor)
        return std::nullopt;
    return m_data.box.copy().scale(1.F / g_pHyprRenderer->m_renderData.pMonitor->m_scale).round();
}

CRegion CShinyPassElement::opaqueRegion() {
    return {};
}

std::vector<UP<IPassElement>> CShinyPassElement::draw() {
    if (shinyBeginPassDraw(m_epoch) != SHINY_DRAW_CONTINUE)
        return {};

    auto&      rd = g_pHyprRenderer->m_renderData;
    const auto mon = rd.pMonitor;
    if (!mon || m_data.box.w <= 0 || m_data.box.h <= 0)
        return {};

    CBox box = m_data.box;
    rd.renderModif.applyToBox(box);

    const auto proj = g_pHyprRenderer->projectBoxToTarget(box);

    const auto inv = Math::wlTransformToHyprutils(Math::invertTransform(mon->m_transform));

    CBox transformed = box;
    transformed.transform(inv, mon->m_transformedSize.x, mon->m_transformedSize.y);

    g_pHyprOpenGL->blend(true);
    auto& prog = m_data.ripple ? g_rippleShader : g_shinyShader;
    auto& locs = m_data.ripple ? g_rippleLocs : g_shinyLocs;
    auto  shader = g_pHyprOpenGL->useShader(prog);
    if (!shader)
        return shinyFallbackIf(shinyFinishMutatedDraw(m_epoch, false, false), m_data, sc<float>(mon->m_scale));

    const CHyprColor colA{m_data.shared.colA};
    const CHyprColor colB{m_data.shared.colB};
    const float      modifScale = rd.renderModif.combinedScale();

    shader->setUniformMatrix3fv(SHADER_PROJ, 1, GL_TRUE, proj.getMatrix());
    shader->setUniformFloat4(SHADER_COLOR, sc<float>(colA.r), sc<float>(colA.g), sc<float>(colA.b), sc<float>(colA.a));
    shader->setUniformFloat4(SHADER_COLOR_SRGB, sc<float>(colB.r), sc<float>(colB.g), sc<float>(colB.b), sc<float>(colB.a));
    shader->setUniformFloat2(SHADER_TOP_LEFT, sc<float>(transformed.x), sc<float>(transformed.y));
    shader->setUniformFloat2(SHADER_FULL_SIZE, sc<float>(transformed.width), sc<float>(transformed.height));
    shader->setUniformFloat(SHADER_RADIUS, sc<float>(m_data.shared.rounding) * modifScale);
    shader->setUniformFloat(SHADER_RADIUS_OUTER, sc<float>(m_data.shared.outerRound) * modifScale);
    shader->setUniformFloat(SHADER_ROUNDING_POWER, m_data.shared.roundingPower);
    shader->setUniformFloat(SHADER_THICK, shinyShaderThick(sc<float>(m_data.shared.borderSize), sc<float>(mon->m_scale), modifScale) * m_data.thickScale);
    shader->setUniformFloat(SHADER_TIME, m_data.time);
    shader->setUniformFloat(SHADER_ALPHA, m_data.shared.a);
    shader->setUniformFloat(SHADER_RANGE, m_data.lobe);
    shader->setUniformFloat(SHADER_BRIGHTNESS, m_data.pulseHz);
    shader->setUniformFloat(SHADER_ANGLE, m_data.angle);
    glUniform1i(locs.mirror, m_data.mirror ? 1 : 0);

    // CShader has no third color slot; upload like the gradient arrays.
    {
        const CHyprColor base{m_data.shared.baseColor};
        glUniform4f(locs.baseColor, sc<float>(base.r), sc<float>(base.g), sc<float>(base.b), sc<float>(base.a));
    }

    if (m_data.ripple) {
        glUniform1f(locs.rippleFreq, m_data.rippleFreq);
        glUniform1f(locs.rippleSpeed, m_data.rippleSpeed);
        glUniform1f(locs.rippleGain, m_data.rippleGain);
        glUniform1f(locs.ripplePower, m_data.ripplePower);
    }

    // Always upload the counts — uniforms persist per program, so a classic
    // draw must clear a previous gradient draw's counts back to 0.
    const auto uploadRamp = [](GLint colorsLoc, GLint posLoc, GLint countLoc, const uint64_t* stops,
                               const float* stopPos, int stopCount) {
        const int steps = std::clamp(stopCount, 0, SHINY_MAX_GRADIENT_STEPS);
        GLfloat   gradVals[SHINY_MAX_GRADIENT_STEPS * 4] = {};
        GLfloat   gradPos[SHINY_MAX_GRADIENT_STEPS]      = {};
        for (int i = 0; i < steps; i++) {
            const CHyprColor stop{stops[i]};
            gradVals[i * 4 + 0] = sc<float>(stop.r);
            gradVals[i * 4 + 1] = sc<float>(stop.g);
            gradVals[i * 4 + 2] = sc<float>(stop.b);
            gradVals[i * 4 + 3] = sc<float>(stop.a);
            gradPos[i]          = stopPos[i];
        }
        glUniform4fv(colorsLoc, SHINY_MAX_GRADIENT_STEPS, gradVals);
        glUniform1fv(posLoc, SHINY_MAX_GRADIENT_STEPS, gradPos);
        glUniform1i(countLoc, steps);
    };
    uploadRamp(locs.gradColors, locs.gradPos, locs.gradCount, m_data.shared.stops, m_data.shared.stopPos,
               m_data.shared.stopCount);
    uploadRamp(locs.gradColorsCw, locs.gradPosCw, locs.gradCountCw, m_data.shared.stopsCW, m_data.shared.stopPosCW,
               m_data.shared.stopCountCW);

    const GLint vao = shader->getUniformLocation(SHADER_SHADER_VAO);
    if (!shinyCanBindVao(vao))
        return shinyFallbackIf(shinyFinishMutatedDraw(m_epoch, true, false), m_data, sc<float>(mon->m_scale));
    glBindVertexArray(vao);

    const CRegion* dmg = &rd.damage;
    if (rd.clipBox.width != 0 && rd.clipBox.height != 0) {
        CRegion clip{rd.clipBox.x, rd.clipBox.y, rd.clipBox.width, rd.clipBox.height};
        clip.intersect(rd.damage);
        clip.forEachRect([](const auto& RECT) {
            g_pHyprOpenGL->scissor(&RECT, g_pHyprRenderer->m_renderData.transformDamage);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        });
    } else {
        dmg->forEachRect([](const auto& RECT) {
            g_pHyprOpenGL->scissor(&RECT, g_pHyprRenderer->m_renderData.transformDamage);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
        });
    }

    glBindVertexArray(0);
    g_pHyprOpenGL->scissor(nullptr);
    return {};
}
