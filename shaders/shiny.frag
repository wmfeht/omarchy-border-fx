#version 440

// Directional-light ring: rounded-rect SDF, piecewise-linear ramp with a
// clockwise-half override, outside glow. Highlight RGB and alpha come from
// the sampled stop (or colA/colB). Pulse scales stop alpha; it does not
// breathe lobe width or thickness.
//
// `angle` is a light direction (same pin_deg convention as the sibling:
// 0 = from the right, 90 = from above). The gradient is the pattern of
// that light. Application is a parallel projection onto the light axis,
// not a conic sweep around the center — a wide panel and a tall one with
// the same heading share a direction. Iso-lines are perpendicular to the
// light; 0 is the facing support of this rounded rect. Coverage still
// runs to the far side; the color ramp is scaled onto the lit band
// (lobe) so stop 100 is the comet edge, not the far side.
// The two halves of the light axis still pick primary vs clockwise ramps.
//
// Wrapper: Qt 6 ShaderEffect UBO, item-local Y-down coords.
//   p = (qt_TexCoord0 - 0.5) * vec2(widthPx, heightPx)
// Light math uses Y-up (pUp.y = -p.y) so heading 90 still faces up.
// Lighting body is shaders/shiny-lighting.frag (shared with the GLES host).
//
// Gradient colors are packed as mat4 columns (std140-safe; ShaderEffect
// array uniforms are a footgun). Positions are packed into two vec4s.
// brightness <= 0 is pulse identity; shimmer writes angle / range /
// thick on the CPU. Chrome and windows both drive pulse uniforms.

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
    int   mirror;            // 0 = facing-only comet; 1 = same lobe on the far side
    vec4  color;             // colA, highlight head (straight rgba)
    vec4  colorSRGB;         // colB, shoulder
    vec4  baseColor;         // wrapping ring stroke (straight rgba); a=0 off
    mat4  gradColors0;       // primary stops 0..3 as columns
    mat4  gradColors1;       // primary stops 4..7 as columns
    vec4  gradPos0;          // primary positions 0..3
    vec4  gradPos1;          // primary positions 4..7
    mat4  gradColorsCW0;
    mat4  gradColorsCW1;
    vec4  gradPosCW0;
    vec4  gradPosCW1;
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

// Piecewise-linear chain over one half of the lit band: u 0 at the
// facing support, 1 at the lobe edge. Mixes RGB and A. The 1e-4 guard
// turns coincident stops into a hard step instead of a divide by zero.
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

#include "shiny-lighting.frag"

void main() {
    vec2 p = (qt_TexCoord0 - vec2(0.5)) * vec2(widthPx, heightPx);
    fragColor = shinyLightingColor(p, vec2(widthPx, heightPx), qt_Opacity);
}
