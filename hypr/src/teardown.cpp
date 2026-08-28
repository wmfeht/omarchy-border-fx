#include "teardown.hpp"

static bool           g_tearingDown   = false;
static bool           g_compileFailed = false;
static ShinyShaderOps g_ops;

void shinySetShaderOps(ShinyShaderOps ops) {
    g_ops = ops;
}

void markShinyTeardown() {
    g_tearingDown = true;
}

bool shinyTeardownStarted() {
    return g_tearingDown;
}

void shinyResetLifecycle() {
    g_tearingDown   = false;
    g_compileFailed = false;
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
