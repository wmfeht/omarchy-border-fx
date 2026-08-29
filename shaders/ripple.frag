#version 440

// Ripple lighting sibling of shiny.frag. Same directional-light ring;
// expanding radial crests modulate illumination. Qt 6 ShaderEffect UBO.
// Lighting body is shaders/ripple-lighting.frag (shared with the GLES host).

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4  qt_Matrix;
    float qt_Opacity;
    float widthPx;
    float heightPx;
    float radiusOuter;
    float roundingPower;
    float thick;
    float time;
    float brightness;
    float range;
    float angle;
    int   gradCount;
    int   gradCountCW;
    int   mirror;
    vec4  color;
    vec4  colorSRGB;
    vec4  baseColor;
    mat4  gradColors0;
    mat4  gradColors1;
    vec4  gradPos0;
    vec4  gradPos1;
    mat4  gradColorsCW0;
    mat4  gradColorsCW1;
    vec4  gradPosCW0;
    vec4  gradPosCW1;
    float rippleFreq;
    float rippleSpeed;
    float rippleGain;
    float ripplePower;
    float rippleOriginX;
    float rippleOriginY;
    float rippleFade;
};

const int MAX_STEPS = 8;

vec4 shinyColAt(mat4 m0, mat4 m1, int i) {
    if (i == 0) return m0[0];
    if (i == 1) return m0[1];
    if (i == 2) return m0[2];
    if (i == 3) return m0[3];
    if (i == 4) return m1[0];
    if (i == 5) return m1[1];
    if (i == 6) return m1[2];
    return m1[3];
}

float shinyPosAt(vec4 p0, vec4 p1, int i) {
    if (i == 0) return p0.x;
    if (i == 1) return p0.y;
    if (i == 2) return p0.z;
    if (i == 3) return p0.w;
    if (i == 4) return p1.x;
    if (i == 5) return p1.y;
    if (i == 6) return p1.z;
    return p1.w;
}

vec4 shinyRampColor(bool cw, float u) {
    mat4 m0 = cw ? gradColorsCW0 : gradColors0;
    mat4 m1 = cw ? gradColorsCW1 : gradColors1;
    vec4 p0 = cw ? gradPosCW0 : gradPos0;
    vec4 p1 = cw ? gradPosCW1 : gradPos1;
    int  n  = cw ? gradCountCW : gradCount;
    vec4 g  = shinyColAt(m0, m1, 0);
    for (int i = 1; i < MAX_STEPS; i++) {
        if (i >= n)
            break;
        float t0 = shinyPosAt(p0, p1, i - 1);
        float t1 = shinyPosAt(p0, p1, i);
        vec4  c  = shinyColAt(m0, m1, i);
        g = mix(g, c, clamp((u - t0) / max(t1 - t0, 1.0e-4), 0.0, 1.0));
    }
    return g;
}

#include "ripple-lighting.frag"

void main() {
    vec2 p = (qt_TexCoord0 - vec2(0.5)) * vec2(widthPx, heightPx);
    fragColor = rippleLightingColor(p, vec2(widthPx, heightPx), qt_Opacity);
}
