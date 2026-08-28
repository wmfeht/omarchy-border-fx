#pragma once

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
