#version 300 es
precision highp float;

in vec2 v_texcoord;
layout(location = 0) out vec4 fragColor;

uniform vec4  color;             // col.a, highlight head (straight alpha)
uniform vec4  colorSRGB;         // col.b, shoulder
uniform vec4  baseColor;         // wrapping ring stroke (straight alpha); a=0 off
uniform vec2  topLeft;
uniform vec2  fullSize;
uniform float radius;
uniform float radiusOuter;
uniform float roundingPower;
uniform float thick;
uniform float time;
uniform float alpha;
uniform float range;             // lit-band half-width along the light axis (0.04–0.5)
uniform float brightness;        // pulse Hz; <= 0 is identity alpha mul
uniform float angle;             // light direction, radians: 0 = right, 90 = up

// Multi-step ramp (plugin:shiny-border:gradient / gradient_positions,
// plus the gradient_cw / gradient_positions_cw clockwise-half override).
// Not in CShader's uniform table — pass.cpp uploads these with raw
// glUniform* calls. Positions are normalized, non-decreasing (deco
// resolves even spacing or the custom spec CPU-side). The CW set is a
// mirror of the primary set unless overridden; whenever gradCount >= 2
// the deco guarantees gradCountCW >= 2 too.
const int MAX_STEPS = 8;
uniform vec4  gradColors[MAX_STEPS];
uniform float gradPos[MAX_STEPS];
uniform int   gradCount;         // < 2 keeps the classic color / colorSRGB branch
uniform vec4  gradColorsCW[MAX_STEPS];
uniform float gradPosCW[MAX_STEPS];
uniform int   gradCountCW;
uniform int   mirror;            // 0 = facing-only comet; 1 = same lobe on the far side
uniform float specularHalo;      // 0 = hard outer contour; 1 = lit-side halo bleed

// Piecewise-linear chain over one half of the lit band: u 0 at the
// facing support, 1 at the lobe edge. Mixes RGB and A. The 1e-4 guard
// turns coincident stops into a hard step instead of a divide by zero.
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

#include "shiny-lighting.frag"

void main() {
    vec2 center = topLeft + fullSize * 0.5;
    vec2 p      = gl_FragCoord.xy - center;
    fragColor   = shinyLightingColor(p, fullSize, alpha);
}
