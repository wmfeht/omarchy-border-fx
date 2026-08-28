#include "pass.hpp"
#include "teardown.hpp"
#include "runtime.hpp"
#include "shaders.hpp"
#include "globals.hpp"

#include <hyprland/src/render/Renderer.hpp>
#include <hyprland/src/render/OpenGL.hpp>
#include <hyprland/src/render/Shader.hpp>
#include <hyprland/src/output/Monitor.hpp>
#include <hyprland/src/debug/log/Logger.hpp>
#include <hyprland/src/helpers/Color.hpp>

#include <GLES3/gl32.h>

#include <algorithm>

using namespace Render::GL;

static SP<CShader> g_shinyShader;

// The grad* uniforms are not in CShader's uniform lookup table, so they
// are uploaded with raw glUniform* against cached locations. -1 is a
// valid "absent" location: glUniform* silently ignores it.
static GLint g_gradColorsLoc   = -1;
static GLint g_gradPosLoc      = -1;
static GLint g_gradCountLoc    = -1;
static GLint g_gradColorsCwLoc = -1;
static GLint g_gradPosCwLoc    = -1;
static GLint g_gradCountCwLoc  = -1;

static void resetGradUniformLocations() {
    g_gradColorsLoc   = -1;
    g_gradPosLoc      = -1;
    g_gradCountLoc    = -1;
    g_gradColorsCwLoc = -1;
    g_gradPosCwLoc    = -1;
    g_gradCountCwLoc  = -1;
}

static bool hyprGlAlive() {
    return static_cast<bool>(g_pHyprOpenGL);
}

static void hyprMakeCurrent() {
    g_pHyprOpenGL->makeEGLCurrent();
}

static bool hyprShaderLive() {
    return g_shinyShader && g_shinyShader->program();
}

static bool hyprCompileShader() {
    if (!g_pHyprOpenGL)
        return false;

    g_pHyprOpenGL->makeEGLCurrent();
    g_shinyShader = makeShared<CShader>();
    if (!g_shinyShader->createProgram(SHINY_VERT, SHINY_FRAG, true, false)) {
        Log::logger->log(Log::ERR, "[shiny-border] fragment shader failed to compile");
        g_shinyShader.reset();
        return false;
    }

    g_gradColorsLoc   = glGetUniformLocation(g_shinyShader->program(), "gradColors");
    g_gradPosLoc      = glGetUniformLocation(g_shinyShader->program(), "gradPos");
    g_gradCountLoc    = glGetUniformLocation(g_shinyShader->program(), "gradCount");
    g_gradColorsCwLoc = glGetUniformLocation(g_shinyShader->program(), "gradColorsCW");
    g_gradPosCwLoc    = glGetUniformLocation(g_shinyShader->program(), "gradPosCW");
    g_gradCountCwLoc  = glGetUniformLocation(g_shinyShader->program(), "gradCountCW");

    return true;
}

static void hyprResetShader() {
    g_shinyShader.reset();
    resetGradUniformLocations();
}

static void hyprAbandonShader() {
    // Deliberate leak: empty the static without ~CShader / glDelete*.
    (void)new SP<CShader>(std::move(g_shinyShader));
    resetGradUniformLocations();
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
}

CShinyPassElement::CShinyPassElement(const SData& data) : m_data(data) {}

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
    if (!ensureShinyShader())
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
    auto shader = g_pHyprOpenGL->useShader(g_shinyShader);
    if (!shader)
        return {};

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
    uploadRamp(g_gradColorsLoc, g_gradPosLoc, g_gradCountLoc, m_data.shared.stops, m_data.shared.stopPos,
               m_data.shared.stopCount);
    uploadRamp(g_gradColorsCwLoc, g_gradPosCwLoc, g_gradCountCwLoc, m_data.shared.stopsCW, m_data.shared.stopPosCW,
               m_data.shared.stopCountCW);

    const GLint vao = shader->getUniformLocation(SHADER_SHADER_VAO);
    if (!shinyCanBindVao(vao))
        return {};
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
