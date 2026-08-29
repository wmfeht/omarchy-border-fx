#version 300 es
precision highp float;

in vec2 v_texcoord;
layout(location = 0) out vec4 fragColor;

uniform vec4  color;
uniform vec4  colorSRGB;
uniform vec4  baseColor;
uniform vec2  topLeft;
uniform vec2  fullSize;
uniform float radius;
uniform float radiusOuter;
uniform float roundingPower;
uniform float thick;
uniform float time;
uniform float alpha;
uniform float range;
uniform float brightness;
uniform float angle;
uniform float rippleFreq;
uniform float rippleSpeed;
uniform float rippleGain;
uniform float ripplePower;
uniform float rippleOriginX;
uniform float rippleOriginY;
uniform float rippleFade;

const int MAX_STEPS = 8;
uniform vec4  gradColors[MAX_STEPS];
uniform float gradPos[MAX_STEPS];
uniform int   gradCount;
uniform vec4  gradColorsCW[MAX_STEPS];
uniform float gradPosCW[MAX_STEPS];
uniform int   gradCountCW;
uniform int   mirror;
uniform float specularHalo;

vec4 shinyRampColor(bool cw, float u) {
    vec4 g = cw ? gradColorsCW[0] : gradColors[0];
    int  n = cw ? gradCountCW : gradCount;
    for (int i = 1; i < MAX_STEPS; i++) {
        if (i >= n)
            break;
        float t0 = cw ? gradPosCW[i - 1] : gradPos[i - 1];
        float t1 = cw ? gradPosCW[i] : gradPos[i];
        vec4  c  = cw ? gradColorsCW[i] : gradColors[i];
        g = mix(g, c, clamp((u - t0) / max(t1 - t0, 1.0e-4), 0.0, 1.0));
    }
    return g;
}

#include "ripple-lighting.frag"

void main() {
    vec2 center = topLeft + fullSize * 0.5;
    vec2 p      = gl_FragCoord.xy - center;
    fragColor   = rippleLightingColor(p, fullSize, alpha);
}
