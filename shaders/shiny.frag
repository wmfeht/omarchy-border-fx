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

const float TAU = 6.28318530718;
const float AA  = 1.25;
const int   MAX_STEPS = 8;

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
    vec2 p = (qt_TexCoord0 - vec2(0.5)) * vec2(widthPx, heightPx);

    float heading = angle;
    // Unit light direction, Y-up. Parallel rays: the window's width and
    // height set how far those rays travel across this panel.
    vec2 light = vec2(cos(heading), sin(heading));
    vec2 pUp   = vec2(p.x, -p.y);

    float rOut   = max(radiusOuter, 0.0);
    vec2  bOut   = vec2(widthPx, heightPx) * 0.5;
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
    // when the wrap is on. Never paint the host contents.
    if (dIn < -AA && (baseColor.a <= 0.0 || dWrap < -AA))
        discard;

    // Ring: inside the outer contour, outside the inner contour.
    float ring = smoothstep(AA, -AA, dOut) * smoothstep(-AA, AA, dIn);
    // Halo outside the rounded rect. Overlap the ring's outer ±AA so
    // coverage does not hole between the stroke and the glow.
    float glow = (1.0 - smoothstep(0.0, localT * 1.35, dOut)) * smoothstep(-AA, AA, dOut) * cone;

    float cov = ring + (1.0 - ring) * glow * 0.65;
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
    fragColor         *= qt_Opacity;
}
