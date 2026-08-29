// Compositor-free dump of shipped shinyShimmerStep. Driven by
// tests/run.js checkShimmerParity against qml/Shimmer.js — not a
// third xorshift, not a hardcoded walk table.
#include "../src/runtime.hpp"

#include <cstdio>
#include <cstdlib>

int main(int argc, char** argv) {
    if (argc < 7) {
        std::fprintf(stderr,
                     "usage: dump_shimmer SEED HZ ANGLE_RANGE SCALE_MIN SCALE_MAX DT [DT...]\n");
        return 2;
    }

    const uint32_t seed = static_cast<uint32_t>(std::strtoul(argv[1], nullptr, 10));
    ShinyShimmerParams p;
    p.hz            = std::strtof(argv[2], nullptr);
    p.angleRangeRad = std::strtof(argv[3], nullptr);
    p.scaleMin      = std::strtof(argv[4], nullptr);
    p.scaleMax      = std::strtof(argv[5], nullptr);

    ShinyShimmerState s;
    shinyShimmerSeed(s, seed);
    for (int i = 6; i < argc; i++) {
        const float dt = std::strtof(argv[i], nullptr);
        shinyShimmerStep(s, dt, p);
        std::printf("%.9g %.9g\n", static_cast<double>(s.angle.value), static_cast<double>(s.scale.value));
    }
    return 0;
}
