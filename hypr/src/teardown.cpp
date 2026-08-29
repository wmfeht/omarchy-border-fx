#include "teardown.hpp"

static bool               g_tearingDown   = false;
static bool               g_compileFailed = false;
static uint64_t           g_passEpoch     = 1;
static ShinyShaderOps     g_ops;
static ShinyPassRemoveOps g_removeOps;
static ShinyGlRestoreOps  g_restoreOps;

void shinySetShaderOps(ShinyShaderOps ops) {
    g_ops = ops;
}

void shinySetPassRemoveOps(ShinyPassRemoveOps ops) {
    g_removeOps = ops;
}

void shinySetGlRestoreOps(ShinyGlRestoreOps ops) {
    g_restoreOps = ops;
}

void markShinyTeardown() {
    g_tearingDown = true;
    g_passEpoch++;
}

bool shinyTeardownStarted() {
    return g_tearingDown;
}

void shinyResetLifecycle() {
    g_tearingDown   = false;
    g_compileFailed = false;
}

uint64_t shinyPassEpoch() {
    return g_passEpoch;
}

bool shinyPassElementLive(uint64_t bornEpoch) {
    if (g_tearingDown)
        return false;
    return bornEpoch == g_passEpoch;
}

bool ensureShinyShader() {
    if (g_tearingDown)
        return false;
    if (g_ops.shaderLive && g_ops.shaderLive())
        return true;
    if (g_compileFailed)
        return false;
    if (!g_ops.compile)
        return false;
    if (g_ops.compile()) {
        g_compileFailed = false;
        return true;
    }
    g_compileFailed = true;
    return false;
}

void destroyShinyShader() {
    if (!g_ops.glAlive || !g_ops.glAlive()) {
        // No context: cannot glDelete. Leaking the SP is deliberate so
        // ~CShader does not run at dlclose.
        if (g_ops.abandon)
            g_ops.abandon();
        return;
    }
    if (g_ops.makeCurrent)
        g_ops.makeCurrent();
    if (g_ops.reset)
        g_ops.reset();
}

void shinyRemoveQueuedPassElements() {
    if (g_removeOps.removeQueued)
        g_removeOps.removeQueued();
}

void shinyOnPluginExit() {
    markShinyTeardown();
    shinyRemoveQueuedPassElements();
    destroyShinyShader();
}

void shinyRestoreGl() {
    if (g_restoreOps.unbindVao)
        g_restoreOps.unbindVao();
    if (g_restoreOps.clearScissor)
        g_restoreOps.clearScissor();
    if (g_restoreOps.restoreBlend)
        g_restoreOps.restoreBlend();
    if (g_restoreOps.restoreProgram)
        g_restoreOps.restoreProgram();
}

ShinyDrawResult shinyBeginPassDraw(uint64_t bornEpoch) {
    if (!shinyPassElementLive(bornEpoch))
        return SHINY_DRAW_EMPTY;
    if (!ensureShinyShader())
        return SHINY_DRAW_EMPTY;
    return SHINY_DRAW_CONTINUE;
}

ShinyDrawResult shinyFinishMutatedDraw(uint64_t bornEpoch, bool useShaderOk, bool vaoBindable) {
    if (shinyPassElementLive(bornEpoch) && useShaderOk && vaoBindable)
        return SHINY_DRAW_CONTINUE;
    shinyRestoreGl();
    if (!shinyPassElementLive(bornEpoch))
        return SHINY_DRAW_EMPTY;
    return SHINY_DRAW_FALLBACK;
}
