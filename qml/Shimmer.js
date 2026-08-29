.pragma library

// Port of shinyShimmerStep / shinyPinnedHeading / shinyEffectTickMs from
// hypr-shiny-border runtime.cpp (cursor/gradient-steps-bd3a). The walk
// stays on the CPU: two independent channels, each smoothstep-easing
// toward a random target, then picking a new target and duration
// (0.6–1.4 of 1/hz). Do not put this in GLSL.

var TAU = Math.PI * 2
var XORSHIFT_FALLBACK = 0x9E3779B9

function wrapAngle(radians) {
  var r = radians % TAU
  if (r < 0)
    r += TAU
  return r
}

// pinDeg + offsetDeg, degrees CCW → radians in [0, 2π).
// atan(-y, x): 0 = right, 90 = up.
function pinnedHeading(pinDeg, offsetDeg) {
  return wrapAngle((Number(pinDeg) + Number(offsetDeg)) * Math.PI / 180)
}

// ~32 samples per 1/hz cycle, clamped 16–50 ms. Same as shinyPulseTickMs.
// Shader twin: pulse off (brightness <= 0) is identity 1. Pulse on uses
// the same 0.5+0.5*sin that used to breathe spread/thick, now as a
// multiplier on sampled stop alpha. Twin of shinyPulseAlphaMul / GLSL.
function pulseAlphaMul(brightness, time) {
  if (!(Number(brightness) > 0))
    return 1
  return 0.5 + 0.5 * Math.sin(Number(time) * Number(brightness) * TAU)
}

function tickMs(hz) {
  var kMin = 16
  var kMax = 50
  if (!(hz > 0))
    return kMin
  var sampled = Math.floor((1000 / hz) / 32)
  if (sampled < kMin)
    return kMin
  if (sampled > kMax)
    return kMax
  return sampled
}

function makeChannel(value) {
  return { value: value, from: value, to: value, t: 0, dur: 0 }
}

function makeState(seed) {
  var s = {
    angle: makeChannel(0),
    scale: makeChannel(1),
    rng: XORSHIFT_FALLBACK
  }
  seedState(s, seed)
  return s
}

function seedState(s, seed) {
  var n = seed >>> 0
  s.rng = n !== 0 ? n : XORSHIFT_FALLBACK
}

function xorshift32(s) {
  var x = s.rng >>> 0
  x = (x ^ ((x << 13) >>> 0)) >>> 0
  x = (x ^ (x >>> 17)) >>> 0
  x = (x ^ ((x << 5) >>> 0)) >>> 0
  s.rng = x
  return x
}

function rand01(s) {
  return xorshift32(s) / 4294967296
}

function retarget(channel, s, lo, hi, hz) {
  channel.from = channel.value
  channel.to = lo + (hi - lo) * rand01(s)
  channel.t = 0
  // 0.6–1.4 of a nominal 1/hz period. Drawn per channel per hop, so the
  // angle and scale clocks drift apart instead of retargeting in lockstep.
  channel.dur = (0.6 + 0.8 * rand01(s)) / hz
}

function stepChannel(channel, s, dt, lo, hi, hz) {
  if (channel.dur <= 0)
    retarget(channel, s, lo, hi, hz)
  channel.t += dt
  if (channel.t >= channel.dur) {
    channel.value = channel.to
    retarget(channel, s, lo, hi, hz)
    return
  }
  var u = channel.t / channel.dur
  u = u * u * (3 - 2 * u)
  channel.value = channel.from + (channel.to - channel.from) * u
}

function step(s, dt, params) {
  var hz = params && params.hz
  if (!(hz > 0) || !(dt > 0))
    return
  var range = params.angleRangeRad
  if (!(range > 0))
    range = 0
  var lo = params.scaleMin
  var hi = params.scaleMax
  if (lo > hi) {
    var tmp = lo
    lo = hi
    hi = tmp
  }
  stepChannel(s.angle, s, dt, -range, range, hz)
  stepChannel(s.scale, s, dt, lo, hi, hz)
}

function lobe(lobeWidth, scale) {
  var v = lobeWidth * scale
  if (v < 0.04)
    return 0.04
  if (v > 0.5)
    return 0.5
  return v
}

function thickScale(scale) {
  var v = 1 + (scale - 1) * 0.35
  return v < 0.25 ? 0.25 : v
}
