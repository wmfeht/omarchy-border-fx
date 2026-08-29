#include "../src/teardown.hpp"

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

static std::string sourceDir() {
    std::string file = __FILE__;
    const auto  slash = file.find_last_of('/');
    const std::string testsDir = (slash == std::string::npos) ? std::string(".") : file.substr(0, slash);
    return testsDir + "/../src";
}

static std::string readFile(const std::string& path) {
    std::ifstream in(path);
    if (!in)
        return {};
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

static int  g_compiles     = 0;
static int  g_resets       = 0;
static int  g_abandons     = 0;
static int  g_makeCurrent  = 0;
static int  g_removes      = 0;
static int  g_unbindVao    = 0;
static int  g_clearScissor = 0;
static int  g_restoreBlend = 0;
static int  g_restoreProg  = 0;
static bool g_glAlive      = false;
static bool g_shaderLive   = false;
static bool g_compileOk    = true;
static std::string g_exitOrder;

static bool spyGlAlive() {
    return g_glAlive;
}

static void spyMakeCurrent() {
    g_makeCurrent++;
}

static bool spyShaderLive() {
    return g_shaderLive;
}

static bool spyCompile() {
    g_compiles++;
    if (!g_compileOk)
        return false;
    g_shaderLive = true;
    return true;
}

static void spyReset() {
    g_resets++;
    g_shaderLive = false;
    g_exitOrder += "D";
}

static void spyAbandon() {
    g_abandons++;
    g_shaderLive = false;
    g_exitOrder += "D";
}

static void spyRemoveQueued() {
    CHECK(shinyTeardownStarted());
    g_removes++;
    g_exitOrder += "R";
}

static void spyUnbindVao() {
    g_unbindVao++;
}

static void spyClearScissor() {
    g_clearScissor++;
}

static void spyRestoreBlend() {
    g_restoreBlend++;
}

static void spyRestoreProgram() {
    g_restoreProg++;
}

static void bindSpies() {
    shinySetShaderOps({
        .glAlive     = spyGlAlive,
        .makeCurrent = spyMakeCurrent,
        .shaderLive  = spyShaderLive,
        .compile     = spyCompile,
        .reset       = spyReset,
        .abandon     = spyAbandon,
    });
    shinySetPassRemoveOps({
        .removeQueued = spyRemoveQueued,
    });
    shinySetGlRestoreOps({
        .unbindVao      = spyUnbindVao,
        .clearScissor   = spyClearScissor,
        .restoreBlend   = spyRestoreBlend,
        .restoreProgram = spyRestoreProgram,
    });
}

static void checkTeardownOrdering() {
    const std::string main = readFile(sourceDir() + "/main.cpp");
    CHECK(!main.empty());

    // PLUGIN_EXIT must not nuke the compositor frame.
    CHECK(main.find("m_renderPass.clear()") == std::string::npos);

    const auto exitAt0 = main.find("APICALL EXPORT void PLUGIN_EXIT");
    CHECK(exitAt0 != std::string::npos);
    const auto onExitAt = main.find("shinyOnPluginExit();");
    CHECK(onExitAt != std::string::npos);
    CHECK(onExitAt > exitAt0);

    // Event::bus listeners must die before dlclose, including config.reloaded.
    const auto relRst = main.find("g_onConfigReloaded.reset()");
    CHECK(relRst != std::string::npos);
    CHECK(relRst > exitAt0);
    CHECK(relRst < onExitAt);

    // PLUGIN_INIT must clear teardown / compile-failed before first draw.
    const auto initAt  = main.find("PLUGIN_INIT");
    const auto resetAt = main.find("shinyResetLifecycle();");
    const auto exitAt  = main.find("PLUGIN_EXIT");
    CHECK(initAt != std::string::npos && resetAt != std::string::npos && exitAt != std::string::npos);
    CHECK(initAt < resetAt);
    CHECK(resetAt < exitAt);

    const std::string life = readFile(sourceDir() + "/teardown.cpp");
    CHECK(!life.empty());
    const auto onExitDef = life.find("void shinyOnPluginExit()");
    CHECK(onExitDef != std::string::npos);
    const auto markAt = life.find("markShinyTeardown();", onExitDef);
    const auto rmAt   = life.find("shinyRemoveQueuedPassElements();", onExitDef);
    const auto destAt = life.find("destroyShinyShader();", onExitDef);
    CHECK(markAt != std::string::npos && rmAt != std::string::npos && destAt != std::string::npos);
    CHECK(markAt < rmAt);
    CHECK(rmAt < destAt);

    const std::string pass = readFile(sourceDir() + "/pass.cpp");
    CHECK(!pass.empty());
    CHECK(pass.find("hyprAbandonShader") != std::string::npos);
    CHECK(pass.find("std::move(g_shinyShader)") != std::string::npos);
    CHECK(pass.find("std::move(g_rippleShader)") != std::string::npos);
    CHECK(pass.find(".abandon") != std::string::npos);
    CHECK(pass.find("g_shinyShader.reset()") != std::string::npos);
    CHECK(pass.find("g_rippleShader.reset()") != std::string::npos);
    CHECK(pass.find("RIPPLE_FRAG") != std::string::npos);

    const std::string shimmer = readFile(sourceDir() + "/shimmer.hpp");
    CHECK(!shimmer.empty());
    CHECK(shimmer.find("enum ShinyEffect") != std::string::npos);
    CHECK(shimmer.find("SHINY_EFFECT_RIPPLE") == std::string::npos);
    CHECK(pass.find("m_renderPass.clear()") == std::string::npos);
    CHECK(pass.find("shinyFinishMutatedDraw") != std::string::npos);
    CHECK(pass.find("shinyLinearFallbackElements") != std::string::npos);
    CHECK(pass.find("removeAllOfType") != std::string::npos);
}

int main() {
    bindSpies();

    CHECK(!shinyTeardownStarted());

    // Missing shader, GL alive → compile once.
    g_glAlive    = true;
    g_shaderLive = false;
    CHECK(ensureShinyShader() == true);
    CHECK(g_compiles == 1);
    CHECK(g_shaderLive);

    // Already live → no second compile.
    CHECK(ensureShinyShader() == true);
    CHECK(g_compiles == 1);

    // Failed compile latches: one attempt, then stay on fallback until reset.
    shinyResetLifecycle();
    g_compileOk  = false;
    g_shaderLive = false;
    g_compiles   = 0;
    CHECK(ensureShinyShader() == false);
    CHECK(g_compiles == 1);
    CHECK(ensureShinyShader() == false);
    CHECK(g_compiles == 1);
    shinyResetLifecycle();
    CHECK(ensureShinyShader() == false);
    CHECK(g_compiles == 2);

    g_compileOk  = true;
    shinyResetLifecycle();
    g_shaderLive = false;
    g_compiles   = 0;
    CHECK(ensureShinyShader() == true);
    CHECK(g_compiles == 1);
    CHECK(g_shaderLive);

    // Leftover draw after PLUGIN_EXIT must not compile into a dying .so.
    const uint64_t bornEpoch = shinyPassEpoch();
    CHECK(shinyPassElementLive(bornEpoch));
    CHECK(shinyBeginPassDraw(bornEpoch) == SHINY_DRAW_CONTINUE);

    markShinyTeardown();
    CHECK(shinyTeardownStarted());
    CHECK(!shinyPassElementLive(bornEpoch));
    CHECK(shinyBeginPassDraw(bornEpoch) == SHINY_DRAW_EMPTY);
    CHECK(g_unbindVao == 0); // begin is before GL mutate — no restore

    g_shaderLive = false;
    CHECK(ensureShinyShader() == false);
    CHECK(g_compiles == 1);

    g_shaderLive = true;
    CHECK(ensureShinyShader() == false);
    CHECK(g_compiles == 1);

    // Leftover mutated draw: restore GL, emit no new ring.
    const int unbind0 = g_unbindVao;
    CHECK(shinyFinishMutatedDraw(bornEpoch, true, true) == SHINY_DRAW_EMPTY);
    CHECK(g_unbindVao == unbind0 + 1);
    CHECK(g_clearScissor == 1);
    CHECK(g_restoreBlend == 1);
    CHECK(g_restoreProg == 1);

    // No GL + live shader → abandon (clear the static), do not reset / makeCurrent.
    const int makeBefore = g_makeCurrent;
    g_glAlive            = false;
    g_shaderLive         = true;
    destroyShinyShader();
    CHECK(g_resets == 0);
    CHECK(g_abandons == 1);
    CHECK(g_makeCurrent == makeBefore);
    CHECK(!g_shaderLive);

    // GL alive → make current, then reset. No second abandon.
    g_glAlive    = true;
    g_shaderLive = true;
    destroyShinyShader();
    CHECK(g_resets == 1);
    CHECK(g_abandons == 1);
    CHECK(g_makeCurrent == makeBefore + 1);
    CHECK(!g_shaderLive);

    // Same-path reload: INIT clears the teardown latch so the next draw compiles.
    shinyResetLifecycle();
    CHECK(!shinyTeardownStarted());
    CHECK(!shinyPassElementLive(bornEpoch)); // epoch is not rewound
    g_shaderLive = false;
    CHECK(ensureShinyShader() == true);
    CHECK(g_compiles == 2);

    const uint64_t liveEpoch = shinyPassEpoch();
    CHECK(shinyPassElementLive(liveEpoch));
    CHECK(shinyBeginPassDraw(liveEpoch) == SHINY_DRAW_CONTINUE);

    // Mutated draw that cannot complete (useShader fail AND VAO not bindable)
    // restores GL and selects the linear fallback ring.
    const int unbind1   = g_unbindVao;
    const int scissor1  = g_clearScissor;
    const int blend1    = g_restoreBlend;
    const int program1  = g_restoreProg;
    CHECK(shinyFinishMutatedDraw(liveEpoch, false, false) == SHINY_DRAW_FALLBACK);
    CHECK(g_unbindVao == unbind1 + 1);
    CHECK(g_clearScissor == scissor1 + 1);
    CHECK(g_restoreBlend == blend1 + 1);
    CHECK(g_restoreProg == program1 + 1);

    // useShader ok but VAO not bindable → still fallback + restore.
    CHECK(shinyFinishMutatedDraw(liveEpoch, true, false) == SHINY_DRAW_FALLBACK);
    CHECK(g_unbindVao == unbind1 + 2);

    // Completing the shader path does not restore (success path unbinds itself).
    CHECK(shinyFinishMutatedDraw(liveEpoch, true, true) == SHINY_DRAW_CONTINUE);
    CHECK(g_unbindVao == unbind1 + 2);

    // PLUGIN_EXIT unit: mark, recurse-remove, destroy. Not m_renderPass.clear().
    g_exitOrder.clear();
    g_removes    = 0;
    g_glAlive    = true;
    g_shaderLive = true;
    const int resetsBefore = g_resets;
    shinyOnPluginExit();
    CHECK(shinyTeardownStarted());
    CHECK(g_removes == 1);
    CHECK(g_exitOrder == "RD"); // remove then destroy
    CHECK(g_resets == resetsBefore + 1);
    CHECK(!shinyPassElementLive(liveEpoch));
    CHECK(ensureShinyShader() == false);
    CHECK(shinyBeginPassDraw(liveEpoch) == SHINY_DRAW_EMPTY);

    checkTeardownOrdering();

    if (g_fails) {
        std::fprintf(stderr, "%d checks failed\n", g_fails);
        return 1;
    }
    std::puts("ok");
    return 0;
}
