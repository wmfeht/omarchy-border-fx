// Ripple lighting sibling of shiny-lighting.frag. Same coverage, interior
// discard, ring + outside glow, directional cone, 8-stop ramp, wrap stroke.
// Crest is a radial illumination scalar from the panel center mixed with
// max into cone/glow and highlight energy. localT does not follow crest.
// rippleGain = 0 matches shiny. No textures, no UV/SDF warp, no caustics.

const float TAU = 6.28318530718;
const float AA  = 1.25;

float shinyPulseAlphaMul(float hz, float t) {
    if (hz <= 0.0)
        return 1.0;
    return 0.5 + 0.5 * sin(t * hz * TAU);
}

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

vec4 rippleLightingColor(vec2 p, vec2 size, float opacity) {
    float heading = angle;
    vec2 light = vec2(cos(heading), sin(heading));
    vec2 pUp   = vec2(p.x, -p.y);

    float rOut   = max(radiusOuter, 0.0);
    vec2  bOut   = size * 0.5;
    vec2  innerB = max(bOut - vec2(rOut), vec2(0.0));
    float extent = innerB.x * abs(light.x) + innerB.y * abs(light.y) + rOut;
    extent = max(extent, 1.0);

    float u  = clamp(0.5 - 0.5 * dot(pUp, light) / extent, 0.0, 1.0);
    float d0 = u * 0.5;
    if (mirror != 0)
        d0 = min(u, 1.0 - u) * 0.5;
    bool  cw = (light.x * pUp.y - light.y * pUp.x) < 0.0;

    float spread   = max(range, 0.04);
    float pulseMul = shinyPulseAlphaMul(brightness, time);
    float uRamp = clamp(d0 / max(spread, 1.0e-4), 0.0, 1.0);

    float cone = 1.0 - smoothstep(0.0, spread, d0);
    cone       = pow(max(cone, 0.0), 1.65);

    float localT = mix(thick * 0.38, thick, mix(0.15, 1.0, cone));
    localT       = max(localT, 1.0);

    float rPx   = length(pUp);
    float phase = rPx * rippleFreq - time * rippleSpeed;
    float wave  = sin(phase);
    float crest = pow(max(wave, 0.0), max(ripplePower, 1.0));
    float energy = max(cone, rippleGain * crest);

    float rIn = max(rOut - localT, 0.0);
    vec2  bIn = max(bOut - vec2(localT), vec2(0.5));

    float dOut = sdRoundBox(p, bOut, rOut, roundingPower);
    float dIn  = sdRoundBox(p, bIn, rIn, roundingPower);

    float wrapT    = max(thick, 1.0);
    float rWrap    = max(rOut - wrapT, 0.0);
    vec2  bWrap    = max(bOut - vec2(wrapT), vec2(0.5));
    float dWrap    = sdRoundBox(p, bWrap, rWrap, roundingPower);
    float wrapRing = smoothstep(AA, -AA, dOut) * smoothstep(-AA, AA, dWrap);

    if (dIn < -AA && (baseColor.a <= 0.0 || dWrap < -AA))
        discard;

    float ring = smoothstep(AA, -AA, dOut) * smoothstep(-AA, AA, dIn);
    float glow = (1.0 - smoothstep(0.0, localT * 1.35, dOut)) * smoothstep(-AA, AA, dOut) * energy;

    float cov = ring + (1.0 - ring) * glow * 0.65;
    if (cov < 0.002 && (baseColor.a <= 0.0 || wrapRing < 0.002))
        discard;

    vec4 stop;
    if (gradCount >= 2) {
        stop = shinyRampColor(cw, uRamp);
    } else {
        stop = mix(color, colorSRGB, uRamp);
    }
    float flash     = max(cov, rippleGain * crest * ring);
    float a         = clamp(stop.a * flash * pulseMul, 0.0, 1.0);
    vec4  highlight = vec4(stop.rgb * a, a);
    return shinyWrapComposite(highlight, baseColor, wrapRing) * opacity;
}
