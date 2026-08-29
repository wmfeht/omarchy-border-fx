#pragma once

#include <string>

// Hyprland tex300.vert — unit quad, proj maps it onto the decoration box.
inline const std::string SHINY_VERT = R"#(#version 300 es

uniform mat3 proj;
uniform vec4 color;

in vec2 pos;
in vec2 texcoord;
in vec2 texcoordMatte;

out vec4 v_color;
out vec2 v_texcoord;
out vec2 v_texcoordMatte;

void main() {
    gl_Position = vec4(proj * vec3(pos, 1.0), 1.0);
    v_color = color;
    v_texcoord = texcoord;
    v_texcoordMatte = texcoordMatte;
}
)#";

// Directional-light ring on a rounded-rect SDF. Same fragment math as
// qs-shiny-border shaders/shiny.frag; this file is the GLES 3 wrapper
// (CShader uniforms, gl_FragCoord, alpha) instead of a Qt ShaderEffect UBO.
inline const std::string SHINY_FRAG = R"#(#version 300 es
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

const float TAU = 6.28318530718;
const float AA  = 1.25;

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

// Pulse off (hz <= 0) is identity. Pulse on: the existing 0.5+0.5*sin
// scales stop alpha. Twin of shinyPulseAlphaMul in runtime.cpp.
float shinyPulseAlphaMul(float hz, float t) {
    if (hz <= 0.0)
        return 1.0;
    return 0.5 + 0.5 * sin(t * hz * TAU);
}

// Premultiplied highlight over a straight-alpha wrap. Glow is not part of
// coverage; base.a <= 0 skips (same as CPU shinyWrapComposite).
vec4 shinyWrapComposite(vec4 highlight, vec4 base, float ringCoverage) {
    if (base.a <= 0.0)
        return highlight;
    float wrapA = base.a * clamp(ringCoverage, 0.0, 1.0);
    vec4  wrap  = vec4(base.rgb * wrapA, wrapA);
    return highlight + wrap * (1.0 - highlight.a);
}

float sdRoundBox(vec2 p, vec2 b, float r, float power) {
    vec2 q = abs(p) - b + vec2(r);
    vec2 qp = max(q, 0.0);
    float outside;
    if (power < 2.01)
        outside = length(qp);
    else
        outside = pow(pow(max(qp.x, 0.0), power) + pow(max(qp.y, 0.0), power), 1.0 / power);
    return outside + min(max(q.x, q.y), 0.0) - r;
}

void main() {
    vec2 center = topLeft + fullSize * 0.5;
    vec2 p      = gl_FragCoord.xy - center;

    float heading = angle;
    // Unit light direction, Y-up. Parallel rays: the window's width and
    // height set how far those rays travel across this deco.
    vec2 light = vec2(cos(heading), sin(heading));
    vec2 pUp   = vec2(p.x, -p.y);

    float rOut   = max(radiusOuter, 0.0);
    vec2  bOut   = fullSize * 0.5;
    vec2  innerB = max(bOut - vec2(rOut), vec2(0.0));
    // Support of the rounded rect in the light direction — the facing
    // corner (or the whole facing edge, when the light is axis-aligned).
    float extent = innerB.x * abs(light.x) + innerB.y * abs(light.y) + rOut;
    extent = max(extent, 1.0);

    // 0 at the lit support, 1 at the far side. Coverage / cone use this.
    float u  = clamp(0.5 - 0.5 * dot(pUp, light) / extent, 0.0, 1.0);
    float d0 = u * 0.5;
    if (mirror != 0)
        d0 = min(u, 1.0 - u) * 0.5;
    // Negative cross = clockwise of the light axis (old t > 0.5 half).
    bool  cw = (light.x * pUp.y - light.y * pUp.x) < 0.0;

    float spread   = max(range, 0.04);
    float pulseMul = shinyPulseAlphaMul(brightness, time);
    // Stop list fills the comet: 0 at the facing support, 1 at spread.
    // Past the lobe the last stop (RGB and A) is held.
    float uRamp = clamp(d0 / max(spread, 1.0e-4), 0.0, 1.0);

    float cone = 1.0 - smoothstep(0.0, spread, d0);
    cone       = pow(max(cone, 0.0), 1.65);

    // Lit side is locally thicker than the rest of the ring. Pulse does
    // not change thickness; shimmer already wrote thick on the CPU.
    float localT = mix(thick * 0.38, thick, mix(0.15, 1.0, cone));
    localT       = max(localT, 1.0);

    float rIn = max(rOut - localT, 0.0);
    vec2  bIn = max(bOut - vec2(localT), vec2(0.5));

    float dOut = sdRoundBox(p, bOut, rOut, roundingPower);
    float dIn  = sdRoundBox(p, bIn, rIn, roundingPower);

    // Hard border-thickness wrap (Quickshell's old Rectangle stroke), not
    // the variable-width highlight ring and not the outside glow.
    float wrapT    = max(thick, 1.0);
    float rWrap    = max(rOut - wrapT, 0.0);
    vec2  bWrap    = max(bOut - vec2(wrapT), vec2(0.5));
    float dWrap    = sdRoundBox(p, bWrap, rWrap, roundingPower);
    float wrapRing = smoothstep(AA, -AA, dOut) * smoothstep(-AA, AA, dWrap);

    // Client area: inside the highlight inner, and inside the wrap inner
    // when the wrap is on. Never paint window contents.
    if (dIn < -AA && (baseColor.a <= 0.0 || dWrap < -AA))
        discard;

    // Ring: inside the outer contour, outside the inner contour.
    float ring = smoothstep(AA, -AA, dOut) * smoothstep(-AA, AA, dIn);
    // Halo strictly outside the rounded rect. dOut > 0 is outside.
    float glow = (1.0 - smoothstep(0.0, localT * 1.35, dOut)) * smoothstep(0.0, AA, dOut) * cone;

    float cov = max(ring, glow * 0.65);
    if (cov < 0.002 && (baseColor.a <= 0.0 || wrapRing < 0.002))
        discard;

    // Highlight RGB/A from the stop (or colA→colB along the lobe). Specular
    // white is a stop, not a mix toward vec3(1.0). Pulse scales alpha only.
    vec4 stop;
    if (gradCount >= 2) {
        stop = shinyRampColor(cw, uRamp);
    } else {
        stop = mix(color, colorSRGB, uRamp);
    }
    float a         = clamp(stop.a * cov * pulseMul, 0.0, 1.0);
    vec4  highlight = vec4(stop.rgb * a, a);
    fragColor          = shinyWrapComposite(highlight, baseColor, wrapRing);
    fragColor         *= alpha;
}
)#";
