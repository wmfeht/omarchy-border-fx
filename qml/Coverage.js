.pragma library

// CPU twin of shaders/coverage.frag (included by both lighting bodies).
// Chrome uses bleedPx for the overlay's extra draw margin. Tests drive
// glow / combine / wrapRing — wrap coverage never includes the halo.

var AA = 1.25
var HALO_MIX = 0.65
var HALO_FALLOFF = 1.35

function clamp01(x) {
  if (x <= 0)
    return 0
  if (x >= 1)
    return 1
  return x
}

function smoothstep(e0, e1, x) {
  var t = clamp01((Number(x) - Number(e0)) / (Number(e1) - Number(e0)))
  return t * t * (3 - 2 * t)
}

function ring(dOut, dIn) {
  return smoothstep(AA, -AA, dOut) * smoothstep(-AA, AA, dIn)
}

// Border-thickness wrap only. Glow is not part of this coverage.
function wrapRing(dOut, dWrap) {
  return smoothstep(AA, -AA, dOut) * smoothstep(-AA, AA, dWrap)
}

function glow(dOut, localT, energy, halo) {
  var h = Number(halo)
  if (!(h > 0))
    return 0
  return (1 - smoothstep(0, Number(localT) * HALO_FALLOFF, dOut))
       * smoothstep(-AA, AA, dOut)
       * Number(energy)
       * h
}

function combine(ringCov, glowCov) {
  var r = Number(ringCov)
  return r + (1 - r) * Number(glowCov) * HALO_MIX
}

// Extra samples outside the outer contour, same units as thick.
// Off / non-positive halo is 0 so reserved borderSize is unchanged.
function bleedPx(thick, halo) {
  if (!(Number(halo) > 0))
    return 0
  var t = Number(thick)
  if (!(t > 1))
    t = 1
  return t * HALO_FALLOFF + AA
}
