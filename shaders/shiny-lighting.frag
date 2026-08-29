// Shared directional-light ring on a rounded-rect SDF.
// Host wrappers declare uniforms + shinyRampColor and call
// shinyLightingColor(p, size, opacity).
//   Qt:  shaders/shiny.frag  (UBO, qt_TexCoord0, qt_Opacity)
//   GLES: shaders/shiny.gles.frag (CShader uniforms, gl_FragCoord, alpha)

const float TAU = 6.28318530718;
const float AA  = 1.25;

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

// p is Y-down pixel coords from the deco center. size is the deco
// width/height in the same space. opacity is the host global mul
// (qt_Opacity / GLES alpha).
vec4 shinyLightingColor(vec2 p, vec2 size, float opacity) {
    float heading = angle;
    // Unit light direction, Y-up. Parallel rays: the window's width and
    // height set how far those rays travel across this deco.
    vec2 light = vec2(cos(heading), sin(heading));
    vec2 pUp   = vec2(p.x, -p.y);

    float rOut   = max(radiusOuter, 0.0);
    vec2  bOut   = size * 0.5;
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
    return shinyWrapComposite(highlight, baseColor, wrapRing) * opacity;
}
