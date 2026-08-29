#pragma once

#include <cstdint>

// Shader lifecycle used by PLUGIN_EXIT / CShinyPassElement::draw.
// Hyprland-free so tests can drive the same functions without a compositor.
//
// Production binds GL via shinySetShaderOps (pass.cpp). Tests bind spies.

struct ShinyShaderOps {
    bool (*glAlive)()     = nullptr;
    void (*makeCurrent)() = nullptr;
    bool (*shaderLive)()  = nullptr;
    bool (*compile)()     = nullptr;
    void (*reset)()       = nullptr;
    void (*abandon)()     = nullptr;
};

void shinySetShaderOps(ShinyShaderOps ops);

void markShinyTeardown();
bool shinyTeardownStarted();
void shinyResetLifecycle();

bool ensureShinyShader();
void destroyShinyShader();

// Pass-element epoch: leftover CShinyPassElement::draw no-ops after PLUGIN_EXIT
// without m_renderPass.clear(). Bumped by markShinyTeardown(); never rewound
// (shinyResetLifecycle does not restore a previous epoch).
uint64_t shinyPassEpoch();
bool     shinyPassElementLive(uint64_t bornEpoch);

// PLUGIN_EXIT shader/pass lifecycle: mark teardown (+ bump epoch), recurse-remove
// leftover plugin pass elements, then destroy the shader. Production PLUGIN_EXIT
// calls this; tests drive the same function.
void shinyOnPluginExit();

struct ShinyPassRemoveOps {
    void (*removeQueued)() = nullptr;
};

void shinySetPassRemoveOps(ShinyPassRemoveOps ops);
void shinyRemoveQueuedPassElements();

// GL restore after a mutated shiny draw bails. Production binds compositor GL;
// tests bind spies.
struct ShinyGlRestoreOps {
    void (*unbindVao)()      = nullptr;
    void (*clearScissor)()   = nullptr;
    void (*restoreBlend)()   = nullptr;
    void (*restoreProgram)() = nullptr;
};

void shinySetGlRestoreOps(ShinyGlRestoreOps ops);
void shinyRestoreGl();

enum ShinyDrawResult {
    SHINY_DRAW_CONTINUE = 0,
    SHINY_DRAW_FALLBACK,
    SHINY_DRAW_EMPTY,
};

// Entry of CShinyPassElement::draw: leftover / no shader → EMPTY (no new ring).
ShinyDrawResult shinyBeginPassDraw(uint64_t bornEpoch);

// After blend/useShader (and the VAO check): restore GL when the shader path
// cannot complete, then FALLBACK (linear ring) or EMPTY (leftover teardown).
ShinyDrawResult shinyFinishMutatedDraw(uint64_t bornEpoch, bool useShaderOk, bool vaoBindable);
