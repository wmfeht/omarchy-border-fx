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
static bool g_glAlive      = false;
static bool g_shaderLive   = false;
static bool g_compileOk    = true;

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
}

static void spyAbandon() {
    g_abandons++;
    g_shaderLive = false;
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
}

static void checkTeardownOrdering() {
    const std::string main = readFile(sourceDir() + "/main.cpp");
    CHECK(!main.empty());

    // PLUGIN_EXIT: mark, leftover-pass clear, then destroy. Order has bitten.
    const auto markAt  = main.find("markShinyTeardown");
    const auto clearAt = main.find("m_renderPass.clear()");
    const auto destAt  = main.find("destroyShinyShader();");
    CHECK(markAt != std::string::npos && clearAt != std::string::npos && destAt != std::string::npos);
    CHECK(markAt < clearAt);
    CHECK(clearAt < destAt);

    // PLUGIN_INIT must clear teardown / compile-failed before first draw.
    const auto initAt  = main.find("PLUGIN_INIT");
    const auto resetAt = main.find("shinyResetLifecycle();");
    const auto exitAt  = main.find("PLUGIN_EXIT");
    CHECK(initAt != std::string::npos && resetAt != std::string::npos && exitAt != std::string::npos);
    CHECK(initAt < resetAt);
    CHECK(resetAt < exitAt);

    const std::string pass = readFile(sourceDir() + "/pass.cpp");
    CHECK(!pass.empty());
    CHECK(pass.find("hyprAbandonShader") != std::string::npos);
    CHECK(pass.find("std::move(g_shinyShader)") != std::string::npos);
    CHECK(pass.find(".abandon") != std::string::npos);
    CHECK(pass.find("g_shinyShader.reset()") != std::string::npos);
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
    markShinyTeardown();
    CHECK(shinyTeardownStarted());

    g_shaderLive = false;
    CHECK(ensureShinyShader() == false);
    CHECK(g_compiles == 1);

    g_shaderLive = true;
    CHECK(ensureShinyShader() == false);
    CHECK(g_compiles == 1);

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
    g_shaderLive = false;
    CHECK(ensureShinyShader() == true);
    CHECK(g_compiles == 2);

    checkTeardownOrdering();

    if (g_fails) {
        std::fprintf(stderr, "%d checks failed\n", g_fails);
        return 1;
    }
    std::puts("ok");
    return 0;
}
