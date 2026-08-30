// Shared ring / outside-halo coverage. Included by shiny-lighting.frag and
// ripple-lighting.frag. Twin of qml/Coverage.js and shinyHalo* in runtime.cpp.
// halo <= 0 turns the outside glow off; wrap coverage never includes it.

const float AA                  = 1.25;
const float SHINY_HALO_MIX      = 0.65;
const float SHINY_HALO_FALLOFF  = 1.35;

float shinyHaloGlow(float dOut, float localT, float energy, float halo) {
    if (halo <= 0.0)
        return 0.0;
    return (1.0 - smoothstep(0.0, localT * SHINY_HALO_FALLOFF, dOut))
         * smoothstep(-AA, AA, dOut)
         * energy
         * halo;
}

float shinyCoverageCombine(float ring, float glow) {
    return ring + (1.0 - ring) * glow * SHINY_HALO_MIX;
}
