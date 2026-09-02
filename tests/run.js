#!/usr/bin/env node
// Compositor-free logic tests. Port of hypr-shiny-border tests/test_runtime.cpp
// checks for shimmer + gradient (the pieces this side actually owns).

const fs = require("fs")
const os = require("os")
const path = require("path")
const vm = require("vm")
const { spawnSync } = require("child_process")

const root = path.resolve(__dirname, "..")
let fails = 0

function loadPragmaLibrary(rel) {
  const file = path.join(root, rel)
  const src = fs.readFileSync(file, "utf8").replace(/^\s*\.pragma library\s*$/m, "")
  const ctx = { Math, Number, String, Object, Array, parseInt, isFinite, console }
  vm.createContext(ctx)
  vm.runInContext(src, ctx, { filename: file })
  return ctx
}

function check(cond, msg) {
  if (!cond) {
    fails++
    console.error("FAIL " + msg)
  }
}

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps === undefined ? 1e-5 : eps)
}

const Shimmer = loadPragmaLibrary("qml/Shimmer.js")
const Gradient = loadPragmaLibrary("qml/Gradient.js")
const Ripple = loadPragmaLibrary("qml/Ripple.js")
const Coverage = loadPragmaLibrary("qml/Coverage.js")
const Look = loadPragmaLibrary("qml/Look.js")

function checkPinnedHeading() {
  const pi = Math.PI
  check(approx(Shimmer.pinnedHeading(0, 0), 0), "pin 0")
  check(approx(Shimmer.pinnedHeading(90, 0), pi * 0.5), "pin 90")
  check(approx(Shimmer.pinnedHeading(180, 0), pi), "pin 180")
  check(approx(Shimmer.pinnedHeading(350, 20), 10 * pi / 180, 1e-4), "pin wrap 350+20")
  check(approx(Shimmer.pinnedHeading(-90, 0), 270 * pi / 180, 1e-4), "pin -90")
  const p = Shimmer.pinnedHeading(-360, -180)
  check(p >= 0 && p < 2 * pi, "pin always in [0, 2π)")
  check(approx(Shimmer.wrapAngle(2 * pi + 0.1), 0.1, 1e-4), "wrap +")
  check(approx(Shimmer.wrapAngle(-0.1), 2 * pi - 0.1, 1e-4), "wrap -")
  check(Shimmer.wrapAngle(0) === 0, "wrap 0")
}

function checkPulseAlphaMul() {
  check(Shimmer.pulseAlphaMul(0, 0) === 1, "pulse off identity")
  check(Shimmer.pulseAlphaMul(0, 12.5) === 1, "pulse off ignores time")
  check(Shimmer.pulseAlphaMul(-0.4, 0.25) === 1, "pulse hz <= 0 identity")
  check(Shimmer.pulseAlphaMul(1, 0) === 0.5, "pulse on at t=0 is 0.5")
  check(Shimmer.pulseAlphaMul(1, 0) !== 1, "pulse on is not identity")
  check(approx(Shimmer.pulseAlphaMul(1, 0.25), 1), "pulse on at quarter period is 1")
  check(approx(Shimmer.pulseAlphaMul(1, 0.75), 0), "pulse on at three-quarter is 0")
}

function checkPulseUniforms() {
  const off = Shimmer.pulseUniforms(false, 12.5, 0.4)
  check(off.time === 0 && off.pulseHz === 0, "pulse false zeros uniforms")
  const offHz = Shimmer.pulseUniforms(true, 12.5, 0)
  check(offHz.time === 0 && offHz.pulseHz === 0, "pulse hz 0 zeros uniforms")
  const on = Shimmer.pulseUniforms(true, 12.5, 0.4)
  check(on.time >= 0 && on.time < 2.5, "pulse time wrapped into 1/hz")
  check(on.pulseHz === 0.4, "pulse hz passes through")
  const onMid = Shimmer.pulseUniforms(true, 13.0, 0.4)
  check(approx(onMid.time, 0.5), "pulse time at mid-cycle")
  const onFast = Shimmer.pulseUniforms(true, 0.25, 4)
  check(onFast.time >= 0 && onFast.time < 0.25, "fast pulse wrap")
  check(onFast.pulseHz === 4, "fast pulse hz")
}

function checkEffectMode() {
  check(Shimmer.effectMode(true, 0.4, true, 0.6) === "shimmer", "shimmer wins when both on")
  check(Shimmer.effectMode(false, 0.4, true, 0.6) === "shimmer", "shimmer on, pulse off")
  check(Shimmer.effectMode(true, 0.4, false, 0.6) === "pulse", "pulse when shimmer off")
  check(Shimmer.effectMode(true, 0.4, true, 0) === "pulse", "shimmer hz 0 falls through to pulse")
  check(Shimmer.effectMode(true, 0.4, true, -1) === "pulse", "shimmer hz < 0 falls through to pulse")
  check(Shimmer.effectMode(true, 0, false, 0.6) === "none", "pulse hz 0 is none")
  check(Shimmer.effectMode(false, 0.4, false, 0.6) === "none", "both off is none")
  check(Shimmer.effectMode(true, 0, true, 0) === "none", "both hz 0 is none")
}

function checkTickMs() {
  check(Shimmer.tickMs(0.4) > 0, "tick > 0")
  check(Shimmer.tickMs(0.4) < 1000 / 0.4, "tick < cycle")
  check(Shimmer.tickMs(0.3) === 50, "slow shimmer clamps to 50")
  check(Shimmer.tickMs(4) > 0 && Shimmer.tickMs(4) < 1000 / 4, "fast tick")
  check(Shimmer.tickMs(0) === 16, "hz 0 → min")
}

function checkClampDt() {
  check(typeof Shimmer.clampDt === "function", "Shimmer.clampDt is shipped")
  check(Shimmer.clampDt(1) === 0.25, "stall dt > 0.25 caps at 0.25")
  check(Shimmer.clampDt(0.016) === 0.016, "normal dt is unchanged")
  check(Shimmer.clampDt(0.25) === 0.25, "dt of 0.25 stays 0.25")
  check(Shimmer.clampDt(0.249) === 0.249, "dt just under the cap is unchanged")
}

function checkShimmer() {
  const p = { hz: 0.6, angleRangeRad: 0.4363, scaleMin: 0.75, scaleMax: 1.35 }

  const idle = Shimmer.makeState(7)
  Shimmer.step(idle, 0, p)
  check(idle.angle.value === 0, "dt 0 angle")
  check(idle.scale.value === 1, "dt 0 scale")
  Shimmer.step(idle, 0.016, { hz: 0, angleRangeRad: 0.4, scaleMin: 0.75, scaleMax: 1.35 })
  check(idle.angle.value === 0, "hz 0 angle")
  check(idle.scale.value === 1, "hz 0 scale")

  const a = Shimmer.makeState(42)
  const b = Shimmer.makeState(42)
  for (let i = 0; i < 500; i++) {
    Shimmer.step(a, 0.016, p)
    Shimmer.step(b, 0.016, p)
  }
  check(a.angle.value === b.angle.value, "determinism angle")
  check(a.scale.value === b.scale.value, "determinism scale")

  const z = Shimmer.makeState(0)
  for (let i = 0; i < 500; i++)
    Shimmer.step(z, 0.016, p)
  check(z.scale.value !== 1 || z.angle.value !== 0, "seed 0 must not wedge")

  const s = Shimmer.makeState(1234)
  let minAngle = 1e9
  let maxAngle = -1e9
  let minScale = 1e9
  let maxScale = -1e9
  for (let i = 0; i < 4000; i++) {
    Shimmer.step(s, 0.016, p)
    minAngle = Math.min(minAngle, s.angle.value)
    maxAngle = Math.max(maxAngle, s.angle.value)
    minScale = Math.min(minScale, s.scale.value)
    maxScale = Math.max(maxScale, s.scale.value)
    check(Math.abs(s.angle.value) <= p.angleRangeRad + 1e-5, "angle bounds")
    check(s.scale.value >= p.scaleMin - 1e-5, "scale min")
    check(s.scale.value <= p.scaleMax + 1e-5, "scale max")
  }
  check(minAngle < -0.01, "walks left of pin")
  check(maxAngle > 0.01, "walks right of pin")
  check(maxScale - minScale > 0.1, "actually resizes")
  check(s.angle.dur !== s.scale.dur, "independent durations")
  check(s.angle.t !== s.scale.t || s.angle.dur !== s.scale.dur, "independent clocks")

  const inv = Shimmer.makeState(99)
  const pInv = { hz: 1, angleRangeRad: 0.1, scaleMin: 1.4, scaleMax: 0.8 }
  for (let i = 0; i < 2000; i++) {
    Shimmer.step(inv, 0.016, pInv)
    check(inv.scale.value >= 0.8 - 1e-5, "inverted min")
    check(inv.scale.value <= 1.4 + 1e-5, "inverted max")
  }

  const flat = Shimmer.makeState(5)
  const pFlat = { hz: 1, angleRangeRad: 0, scaleMin: 0.9, scaleMax: 1.1 }
  for (let i = 0; i < 2000; i++)
    Shimmer.step(flat, 0.016, pFlat)
  check(Math.abs(flat.angle.value) < 1e-5, "zero range stays 0")

  check(Shimmer.lobe(0.18, 1) === 0.18, "lobe identity")
  check(Shimmer.lobe(0.18, 10) === 0.5, "lobe clamp high")
  check(Shimmer.lobe(0.18, 0.01) === 0.04, "lobe clamp low")
  check(Shimmer.thickScale(1) === 1, "thick identity")
  check(Shimmer.thickScale(2) < 2 && Shimmer.thickScale(2) > 1, "thick muted")
  check(Shimmer.thickScale(0) > 0, "thick floor")
}

function rgba(r, g, b, a) {
  return { r: r, g: g, b: b, a: a === undefined ? 1 : a }
}

function checkGradient() {
  const MAX = Gradient.MAX_STEPS
  check(Gradient.stepCount(-3) === 0, "count -3")
  check(Gradient.stepCount(0) === 0, "count 0")
  check(Gradient.stepCount(1) === 0, "count 1")
  check(Gradient.stepCount(2) === 2, "count 2")
  check(Gradient.stepCount(MAX) === MAX, "count max")
  check(Gradient.stepCount(MAX + 1) === MAX, "count clamp")
  check(Gradient.stepCount(100) === MAX, "count 100")

  check(Gradient.stopPos(0, 2) === 0, "pos 0/2")
  check(Gradient.stopPos(1, 2) === 1, "pos 1/2")
  check(approx(Gradient.stopPos(1, 3), 0.5, 1e-6), "pos 1/3")
  check(approx(Gradient.stopPos(2, 5), 0.5, 1e-6), "pos 2/5")
  check(Gradient.stopPos(0, 1) === 0, "pos lone")
  check(Gradient.stopPos(3, 0) === 0, "pos count 0")
  check(Gradient.stopPos(-1, 4) === 0, "pos i < 0")
  check(Gradient.stopPos(99, 4) === 1, "pos i high")

  const red = rgba(1, 0, 0)
  const green = rgba(0, 1, 0)
  const blue = rgba(0, 0, 1)
  const two = [red, blue]
  let c = Gradient.sample(two, null, 2, 0)
  check(c.r === 1 && c.g === 0 && c.b === 0 && c.a === 1, "sample u=0")
  c = Gradient.sample(two, null, 2, 1)
  check(c.r === 0 && c.g === 0 && c.b === 1, "sample u=1")
  c = Gradient.sample(two, null, 2, 0.5)
  check(approx(c.r, 0.5, 1e-4) && c.g === 0 && approx(c.b, 0.5, 1e-4), "sample u=0.5")
  c = Gradient.sample(two, null, 2, -1)
  check(c.r === 1 && c.b === 0, "sample clamp low")
  c = Gradient.sample(two, null, 2, 2)
  check(c.r === 0 && c.b === 1, "sample clamp high")

  const three = [red, green, blue]
  c = Gradient.sample(three, null, 3, 0.5)
  check(c.r === 0 && c.g === 1 && c.b === 0, "three midpoint")
  c = Gradient.sample(three, null, 3, 0.25)
  check(approx(c.r, 0.5, 1e-4) && approx(c.g, 0.5, 1e-4) && c.b === 0, "three quarter")
  c = Gradient.sample(three, null, 3, 1)
  check(c.r === 0 && c.g === 0 && c.b === 1, "three end")

  const translucent = [rgba(1, 0, 0, 0x80 / 255), rgba(1, 0, 0, 0)]
  c = Gradient.sample(translucent, null, 2, 0.5)
  check(approx(c.a, 0x80 / 255 * 0.5, 1e-4), "sample alpha")

  c = Gradient.sample(three, null, 1, 0.7)
  check(c.r === 1 && c.g === 0 && c.b === 0, "lone stop")
  c = Gradient.sample(three, null, 0, 0.5)
  check(c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0, "empty sample")
  c = Gradient.sample(null, null, 3, 0.5)
  check(c.r === 0 && c.g === 0 && c.b === 0, "null stops")

  const many = []
  for (let i = 0; i < MAX + 1; i++)
    many.push(red)
  many[MAX - 1] = blue
  many[MAX] = green
  c = Gradient.sample(many, null, MAX + 1, 1)
  check(c.r === 0 && c.g === 0 && c.b === 1, "tail past cap ignored")
}

function checkGradientPositions() {
  let r = Gradient.resolvePositions("", 3)
  check(!r.custom, "empty spec not custom")
  check(r.pos[0] === 0 && approx(r.pos[1], 0.5, 1e-6) && r.pos[2] === 1, "empty even")
  r = Gradient.resolvePositions(null, 3)
  check(approx(r.pos[1], 0.5, 1e-6), "null even")

  r = Gradient.resolvePositions("0 70 100", 3)
  check(r.custom, "valid spec")
  check(r.pos[0] === 0 && approx(r.pos[1], 0.7, 1e-6) && r.pos[2] === 1, "0 70 100")

  r = Gradient.resolvePositions(" 0%,  25.5 ,\t90% ", 3)
  check(r.custom, "comma percent")
  check(r.pos[0] === 0 && approx(r.pos[1], 0.255, 1e-6) && approx(r.pos[2], 0.9, 1e-6), "parsed messy")

  r = Gradient.resolvePositions("20 80", 2)
  check(r.custom && approx(r.pos[0], 0.2) && approx(r.pos[1], 0.8), "inset ends")

  r = Gradient.resolvePositions("-50 250", 2)
  check(r.custom && r.pos[0] === 0 && r.pos[1] === 1, "clamp 0..100")

  r = Gradient.resolvePositions("0 60 40 100", 4)
  check(r.custom && approx(r.pos[1], 0.6) && approx(r.pos[2], 0.6) && r.pos[3] === 1, "repair decreasing")

  r = Gradient.resolvePositions("0 100", 3)
  check(!r.custom && approx(r.pos[1], 0.5, 1e-6), "short list even")
  r = Gradient.resolvePositions("0 50 100", 2)
  check(!r.custom && r.pos[1] === 1, "long list even")
  r = Gradient.resolvePositions("0 banana 100", 3)
  check(!r.custom && approx(r.pos[1], 0.5, 1e-6), "junk even")
  r = Gradient.resolvePositions("0 50x 100", 3)
  check(!r.custom, "glued junk")
  check(!Gradient.resolvePositions("0 100", 1).custom, "count 1")
  check(!Gradient.resolvePositions("0 100", 0).custom, "count 0")

  const rgb3 = [rgba(1, 0, 0), rgba(0, 1, 0), rgba(0, 0, 1)]
  const custom = Gradient.resolvePositions("0 70 100", 3)
  check(custom.custom, "sample spec")
  let c = Gradient.sample(rgb3, custom.pos, 3, 0.7)
  check(approx(c.r, 0, 1e-3) && approx(c.g, 1, 1e-3) && approx(c.b, 0, 1e-3), "u=0.7 is green")
  c = Gradient.sample(rgb3, custom.pos, 3, 0.35)
  check(approx(c.r, 0.5, 1e-3) && approx(c.g, 0.5, 1e-3) && c.b === 0, "u=0.35 mid first segment")

  const inset = Gradient.resolvePositions("40 60", 2)
  const rb = [rgba(1, 0, 0), rgba(0, 0, 1)]
  c = Gradient.sample(rb, inset.pos, 2, 0.1)
  check(c.r === 1 && c.b === 0, "below first stop")
  c = Gradient.sample(rb, inset.pos, 2, 0.9)
  check(c.r === 0 && c.b === 1, "past last stop")

  const step = Gradient.resolvePositions("0 50 50 100", 4)
  const rgbr = [rgba(1, 0, 0), rgba(0, 1, 0), rgba(0, 0, 1), rgba(1, 0, 0)]
  c = Gradient.sample(rgbr, step.pos, 4, 0.49)
  check(isFinite(c.r) && isFinite(c.g) && isFinite(c.b), "coincident finite")
  check(c.g > 0.9, "just before hard step: green")
  c = Gradient.sample(rgbr, step.pos, 4, 0.51)
  check(isFinite(c.b) && c.b > 0.9, "just after hard step: blue")
}

function checkGradientCwSide() {
  const red = rgba(1, 0, 0)
  const green = rgba(0, 1, 0)
  const blue = rgba(0, 0, 1)
  const white = rgba(1, 1, 1)
  const primary = [red, green, blue]
  const primaryPos = Gradient.resolvePositions("0 70 100", 3).pos

  let cw = Gradient.resolveCwSide(primary, primaryPos, 0, primary, "0 50 100")
  check(cw.count === 0, "primary off ignores cw")
  cw = Gradient.resolveCwSide(primary, primaryPos, 1, primary, "")
  check(cw.count === 0, "primary count 1 ignores cw")

  cw = Gradient.resolveCwSide(primary, primaryPos, 3, [], "")
  check(cw.count === 3, "mirror count")
  check(cw.stops[0].r === 1 && cw.stops[1].g === 1 && cw.stops[2].b === 1, "mirror colors")
  check(cw.pos[1] === primaryPos[1] && approx(cw.pos[1], 0.7, 1e-6), "mirror pos")

  cw = Gradient.resolveCwSide(primary, primaryPos, 3, [white], "")
  check(cw.count === 3 && cw.stops[0].r === 1, "lone cw color is unset")

  cw = Gradient.resolveCwSide(primary, primaryPos, 3, [], "0 30 100")
  check(cw.count === 3 && cw.stops[1].g === 1 && approx(cw.pos[1], 0.3, 1e-6), "pos-only reshape")

  cw = Gradient.resolveCwSide(primary, primaryPos, 3, [], "0 30")
  check(approx(cw.pos[1], 0.7, 1e-6), "invalid spec mirrors, not even")

  const own = [red, white]
  cw = Gradient.resolveCwSide(primary, primaryPos, 3, own, "")
  check(cw.count === 2, "own count")
  check(cw.stops[0].r === 1 && cw.stops[1].r === 1 && cw.stops[1].g === 1, "own colors")
  check(cw.pos[0] === 0 && cw.pos[1] === 1, "own empty spec is even")

  cw = Gradient.resolveCwSide(primary, primaryPos, 3, own, "20 80")
  check(approx(cw.pos[0], 0.2) && approx(cw.pos[1], 0.8), "own spec")

  cw = Gradient.resolveCwSide(primary, primaryPos, 3, own, "0 70 100")
  check(cw.pos[0] === 0 && cw.pos[1] === 1, "mismatched own spec → even, not primary")

  const many = []
  for (let i = 0; i < Gradient.MAX_STEPS + 1; i++)
    many.push(white)
  cw = Gradient.resolveCwSide(primary, primaryPos, 3, many, "")
  check(cw.count === Gradient.MAX_STEPS, "own over-cap clamps")
}

function checkGradientLobeU() {
  // Twin of shinyGradientLobeU: d0 = u * 0.5, then / spread (min 0.04).
  check(Gradient.lobeU(0, 0.5) === 0, "lobe 0.5 head")
  check(approx(Gradient.lobeU(0.5, 0.5), 0.5), "lobe 0.5 mid is identity")
  check(Gradient.lobeU(1, 0.5) === 1, "lobe 0.5 far is identity")

  check(Gradient.lobeU(0, 0.18) === 0, "lobe 0.18 head")
  check(approx(Gradient.lobeU(0.36, 0.18), 1), "lobe 0.18 edge at u=0.36")
  check(Gradient.lobeU(1, 0.18) === 1, "lobe 0.18 far holds last stop")
  check(approx(Gradient.lobeU(0.18, 0.18), 0.5), "lobe 0.18 half")

  check(Gradient.lobeU(0, 0.1) === 0, "lobe 0.1 head")
  check(approx(Gradient.lobeU(0.1, 0.1), 0.5), "lobe 0.1 half")
  check(approx(Gradient.lobeU(0.2, 0.1), 1), "lobe 0.1 edge at u=0.2")
  check(Gradient.lobeU(1, 0.1) === 1, "lobe 0.1 far holds last stop")

  check(Gradient.lobeU(0.08, 0) === 1, "spread 0 floors to 0.04")
  check(approx(Gradient.lobeU(0.04, 0.01), 0.5), "tiny spread floors")
  check(Gradient.lobeU(-1, 0.18) === 0, "axis u clamps low")
  check(Gradient.lobeU(2, 0.18) === 1, "axis u clamps high")

  check(Gradient.lobeU(1, 0.18, false) === Gradient.lobeU(1, 0.18), "off flag matches two-arg")

  check(Gradient.lobeU(0, 0.18, true) === 0, "mirror facing still 0")
  check(Gradient.lobeU(1, 0.18, true) === 0, "mirror far is 0")
  check(Gradient.lobeU(1, 0.18, true) !== 1, "mirror far is not 1")
  check(approx(Gradient.lobeU(0.36, 0.18, true), 1), "mirror facing edge at u=0.36")
  check(approx(Gradient.lobeU(0.64, 0.18, true), 1), "mirror far edge at u=0.64")
  check(Gradient.lobeU(0.5, 0.18, true) === 1, "mirror mid-axis holds last stop")

  const rgb = [rgba(1, 0, 0), rgba(0, 0, 1)]
  const even = Gradient.resolvePositions("", 2)
  const head = Gradient.sample(rgb, even.pos, 2, Gradient.lobeU(0, 0.1))
  const tail = Gradient.sample(rgb, even.pos, 2, Gradient.lobeU(0.2, 0.1))
  check(approx(head.r, 1) && head.b === 0, "lobe-scaled even: head is stop 0")
  check(tail.r === 0 && approx(tail.b, 1), "lobe-scaled even: comet edge is last stop")
}

function checkLightProjection() {
  // Mirrors shaders/shiny.frag: angle is a directional light, u is the
  // parallel projection onto that axis, normalized by this panel's
  // rounded-rect support. p is Y-down from center, same as the shader.
  function sample(px, py, w, h, r, heading) {
    const lx = Math.cos(heading)
    const ly = Math.sin(heading)
    const pUpX = px
    const pUpY = -py
    const innerX = Math.max(w * 0.5 - r, 0)
    const innerY = Math.max(h * 0.5 - r, 0)
    const extent = Math.max(innerX * Math.abs(lx) + innerY * Math.abs(ly) + r, 1)
    let u = 0.5 - 0.5 * (pUpX * lx + pUpY * ly) / extent
    if (u < 0)
      u = 0
    if (u > 1)
      u = 1
    return { u: u, cw: (lx * pUpY - ly * pUpX) < 0 }
  }

  const pi = Math.PI
  const r = 12
  const sq = sample(50, 0, 100, 100, r, 0)
  check(approx(sq.u, 0, 1e-4), "pin 0 right edge is the head")
  check(approx(sample(-50, 0, 100, 100, r, 0).u, 1, 1e-4), "pin 0 left edge is the far side")
  check(approx(sample(0, -50, 100, 100, r, 0).u, 0.5, 0.05), "pin 0 top is mid-axis")
  check(approx(sample(0, -50, 100, 100, r, pi * 0.5).u, 0, 1e-4), "pin 90 top is the head")

  const head = 120 * pi / 180
  function corners(w, h) {
    const hw = w * 0.5
    const hh = h * 0.5
    return {
      tr: sample(hw, -hh, w, h, r, head),
      tl: sample(-hw, -hh, w, h, r, head),
      bl: sample(-hw, hh, w, h, r, head),
      br: sample(hw, hh, w, h, r, head)
    }
  }
  const wide = corners(400, 100)
  const tall = corners(100, 400)
  check(wide.tl.u < wide.tr.u && wide.tl.u < wide.bl.u && wide.tl.u < wide.br.u, "wide: head is top-left")
  check(tall.tl.u < tall.tr.u && tall.tl.u < tall.bl.u && tall.tl.u < tall.br.u, "tall: head is top-left")
  check(approx(wide.tl.u, 0, 1e-3) && approx(tall.tl.u, 0, 1e-3), "facing support is u=0 on both aspects")
  check(wide.tr.u > tall.tr.u, "wide stretches the ramp along the top")
  check(tall.bl.u > wide.bl.u, "tall stretches the ramp down the left")
  check(wide.tr.cw !== wide.bl.cw, "pin 120 splits along the light axis, not the edges")
  check(!sample(0, -50, 100, 100, r, 0).cw, "pin 0 top is the CCW half")
  check(sample(0, 50, 100, 100, r, 0).cw, "pin 0 bottom is the CW half")
}

function checkRippleCrest() {
  check(typeof Ripple.crest === "function", "Ripple.crest is shipped")
  const freq = 0.02
  const speed = 2
  const pi = Math.PI
  check(Ripple.crest(0, 0, freq, speed, 8) === 0, "crest at origin is 0")
  const rPeak = (pi * 0.5) / freq
  const peak = Ripple.crest(rPeak, 0, freq, speed, 8)
  const later = Ripple.crest(rPeak, 0.2, freq, speed, 8)
  check(peak > 0.9, "crest at π/2 is a peak")
  check(later !== peak, "later t shifts phase")
  const rNeg = (3 * pi / 2) / freq
  check(Ripple.crest(rNeg, 0, freq, speed, 8) === 0, "negative sine lobe → crest 0")
  check(Ripple.crest(rNeg, 0, freq, speed, 1) === 0, "negative lobe is 0 at power 1 too")
  const rHalf = (pi / 6) / freq
  const p1 = Ripple.crest(rHalf, 0, freq, speed, 1)
  const p8 = Ripple.crest(rHalf, 0, freq, speed, 8)
  check(p1 > 0 && p8 > 0, "off-peak positive lobe is live")
  check(p8 < p1, "high power is sparser than power 1")
  check(p8 < 0.1 * p1, "power 8 is much thinner than power 1")
  check(Ripple.energy(0.3, 0.8, 0) === 0.3, "gain 0 energy matches cone (shiny)")
  check(Ripple.energy(0.9, 0.2, 1) === 0.2, "gain 1 replaces cone with crest")
  check(Ripple.energy(0.9, 0.2, 1) < 0.9, "gain 1 does not keep the shiny cone")
  check(Ripple.highlightAlpha(0, 1, 0.8, 0.85) > 0, "transparent stop still flashes from crest")
  check(Ripple.highlightAlpha(0, 1, 0.8, 0.85) === Ripple.energy(0, 0.8, 0.85),
        "transparent-stop alpha follows crest energy")
  check(Ripple.highlightAlpha(1, 0.4, 0.2, 0.85) === Ripple.energy(1, 0.2, 0.85) * 0.4,
        "opaque-stop alpha blends comet toward crest")
  check(Ripple.highlightAlpha(0.9, 1, 0.1, 0) === 0.9, "gain 0 highlight alpha is stop.a * cov")
  check(Look.effectDraws("ripple") === true, "Look.effectDraws ripple")
  check(Look.effectDraws("other") === false, "Look.effectDraws unknown")
}

function checkRippleOriginFade() {
  check(typeof Ripple.originR === "function", "Ripple.originR is shipped")
  check(typeof Ripple.perimeter === "function", "Ripple.perimeter is shipped")
  check(typeof Ripple.fadeDistance === "function", "Ripple.fadeDistance is shipped")
  check(typeof Ripple.fadeEnvelope === "function", "Ripple.fadeEnvelope is shipped")

  const w = 200
  const h = 100
  const px = 30
  const py = -40
  const rCenter = Ripple.originR(px, py, w, h, 0.5, 0.5)
  check(approx(rCenter, Math.hypot(px, py)), "center origin r is distance from box center")
  check(approx(Ripple.originR(0, 0, w, h, 0.5, 0.5), 0), "center origin r is 0 at the box center")

  const rTopLeft = Ripple.originR(-w / 2, -h / 2, w, h, 0, 0)
  check(approx(rTopLeft, 0), "offset origin r is 0 at the origin point")
  check(Ripple.originR(0, 0, w, h, 0, 0) > 0, "offset origin r is > 0 at the box center")
  check(
    Ripple.originR(px, py, w, h, 0, 0) !== Ripple.originR(px, py, w, h, 0.5, 0.5),
    "non-center origin changes r at a given pixel"
  )

  const rRight = Ripple.originR(-w / 2 + 10, -h / 2, w, h, 0, 0)
  const rDown = Ripple.originR(-w / 2, -h / 2 + 10, w, h, 0, 0)
  check(approx(rRight, rDown), "pixels the same distance from the origin share r")
  check(rRight > 0, "shared-r samples are not the origin")

  check(Ripple.fadeDistance(1, w, h) === Ripple.perimeter(w, h), "fade 1 is the full perimeter")
  check(Ripple.fadeDistance(0, w, h) === 0, "fade 0 distance is 0 (off)")
  check(Ripple.fadeDistance(-1, w, h) === 0, "non-positive fade distance is 0")
  check(
    Ripple.fadeDistance(0.5, w, h) + Ripple.fadeDistance(0.5, w, h) === Ripple.fadeDistance(1, w, h),
    "half + half is the full perimeter distance"
  )
  check(
    Ripple.fadeDistance(0.5, w, h) === Ripple.fadeDistance(0.5, h, w),
    "same perimeter boxes share fade distance"
  )
  check(
    Ripple.fadeDistance(0.5, w * 2, h * 2) > Ripple.fadeDistance(0.5, w, h),
    "larger box yields a longer fade distance at the same proportion"
  )

  const d = Ripple.fadeDistance(0.5, w, h)
  check(d > 0, "positive proportion has a positive pixel distance")
  check(Ripple.fadeEnvelope(0, d) === 1, "envelope at origin is 1")
  check(Ripple.fadeEnvelope(d, d) === 0, "envelope at fade distance is 0")
  check(Ripple.fadeEnvelope(d + 10, d) === 0, "envelope beyond fade distance is 0")
  check(Ripple.fadeEnvelope(40, Ripple.fadeDistance(0, w, h)) === 1, "envelope is identity when fade is 0")
  check(Ripple.fadeEnvelope(40, -5) === 1, "envelope is identity when fade is not positive")

  const freq = 0.02
  const rPeak = (Math.PI * 0.5) / freq
  const peak = Ripple.crest(rPeak, 0, freq, 2, 8)
  const faded = peak * Ripple.fadeEnvelope(rPeak, Ripple.fadeDistance(0.5, w, h))
  check(peak > 0.9, "live crest to scale")
  check(faded < peak, "fade envelope scales a live crest down")
  check(Ripple.energy(0.9, faded, 1) === faded, "gain 1 energy uses the faded crest")
  check(Ripple.energy(0.9, faded, 0) === 0.9, "gain 0 energy stays the cone (fade is crest-only)")
}

function checkSharedShaderBake() {
  const lightingPath = path.join(root, "shaders/shiny-lighting.frag")
  const qtPath = path.join(root, "shaders/shiny.frag")
  const glesPath = path.join(root, "shaders/shiny.gles.frag")
  const rippleLightingPath = path.join(root, "shaders/ripple-lighting.frag")
  const rippleQtPath = path.join(root, "shaders/ripple.frag")
  const rippleGlesPath = path.join(root, "shaders/ripple.gles.frag")
  const qsbPath = path.join(root, "shaders/shiny.frag.qsb")
  const rippleQsbPath = path.join(root, "shaders/ripple.frag.qsb")
  const hppPath = path.join(root, "hypr/src/shaders.hpp")
  const lighting = fs.readFileSync(lightingPath, "utf8")
  const qt = fs.readFileSync(qtPath, "utf8")
  const gles = fs.readFileSync(glesPath, "utf8")
  const rippleLighting = fs.readFileSync(rippleLightingPath, "utf8")
  const rippleQt = fs.readFileSync(rippleQtPath, "utf8")
  const rippleGles = fs.readFileSync(rippleGlesPath, "utf8")
  check(lighting.indexOf("vec4 shinyLightingColor") !== -1, "lighting source defines shinyLightingColor")
  check(lighting.indexOf('#include "coverage.frag"') !== -1, "shiny lighting includes shared coverage")
  check(qt.indexOf('#include "shiny-lighting.frag"') !== -1, "qt wrapper includes the lighting source")
  check(gles.indexOf('#include "shiny-lighting.frag"') !== -1, "gles wrapper includes the lighting source")
  check(qt.indexOf("qt_Opacity") !== -1, "qt wrapper uses qt_Opacity")
  check(gles.indexOf("gl_FragCoord") !== -1, "gles wrapper uses gl_FragCoord")
  check(qt.indexOf("vec4 shinyLightingColor") === -1, "qt wrapper does not hand-copy lighting")
  check(gles.indexOf("vec4 shinyLightingColor") === -1, "gles wrapper does not hand-copy lighting")
  check(lighting.indexOf("if (ripple)") === -1, "shiny lighting has no if (ripple)")
  check(lighting.indexOf("rippleGain") === -1, "shiny lighting has no ripple uniforms")
  check(lighting.indexOf("rippleOrigin") === -1, "shiny lighting has no ripple origin")
  check(lighting.indexOf("rippleFade") === -1, "shiny lighting has no ripple fade")
  check(rippleLighting.indexOf("vec4 rippleLightingColor") !== -1, "ripple lighting defines rippleLightingColor")
  check(rippleLighting.indexOf('#include "coverage.frag"') !== -1, "ripple lighting includes shared coverage")
  check(rippleLighting.indexOf("rippleGain * crest") !== -1, "ripple lighting mixes crest via gain")
  check(rippleLighting.indexOf("rippleOriginX") !== -1, "ripple lighting uses origin X")
  check(rippleLighting.indexOf("rippleOriginY") !== -1, "ripple lighting uses origin Y")
  check(rippleLighting.indexOf("rippleFade") !== -1, "ripple lighting uses fade distance")
  check(rippleLighting.indexOf("rippleFade * 2.0 * (size.x + size.y)") !== -1,
        "ripple fade distance is a proportion of the box perimeter")
  check(rippleLighting.indexOf("rPx / rippleFade") === -1,
        "ripple fade is not a raw pixel divisor")
  check(rippleLighting.indexOf("crest *= fade") !== -1, "ripple lighting scales crest by the fade envelope")
  check(rippleLighting.indexOf("length(p - originP)") !== -1, "ripple r is distance from the look origin")
  check(rippleQt.indexOf("float rippleOriginX") !== -1, "ripple qt wrapper declares origin X")
  check(rippleGles.indexOf("uniform float rippleOriginX") !== -1, "ripple gles wrapper declares origin X")
  check(rippleQt.indexOf("float rippleFade") !== -1, "ripple qt wrapper declares fade")
  check(rippleGles.indexOf("uniform float rippleFade") !== -1, "ripple gles wrapper declares fade")
  check(rippleLighting.indexOf("mix(cone, crestLit, gBlend)") !== -1,
        "ripple lighting blends cone to crest (swap, not max-stack)")
  check(rippleLighting.indexOf("mix(stop.a, crestLit, gBlend)") !== -1,
        "ripple lighting blends stop alpha to crest")
  check(rippleLighting.indexOf("max(cone, rippleGain * crest)") === -1,
        "ripple lighting does not stack crest on a full shiny cone")
  check(rippleLighting.indexOf("texture(") === -1, "ripple lighting does not texture()")
  check(rippleQt.indexOf('#include "ripple-lighting.frag"') !== -1, "ripple qt wrapper includes ripple lighting")
  check(rippleGles.indexOf('#include "ripple-lighting.frag"') !== -1, "ripple gles wrapper includes ripple lighting")
  check(rippleQt.indexOf("vec4 rippleLightingColor") === -1, "ripple qt wrapper does not hand-copy lighting")
  check(rippleGles.indexOf("vec4 rippleLightingColor") === -1, "ripple gles wrapper does not hand-copy lighting")

  const baked = spawnSync("bash", [path.join(root, "dev/bake.sh")], {
    encoding: "utf8",
    timeout: 60000,
  })
  check(baked.status === 0, "bake exits 0: " + (baked.stderr || baked.stdout || ""))
  check((baked.stdout || "").indexOf("baked ") !== -1, "bake reports qsb output")
  check((baked.stdout || "").indexOf("inlined ") !== -1, "bake reports shaders.hpp output")
  check(fs.existsSync(qsbPath) && fs.statSync(qsbPath).size > 0, "bake wrote shaders/shiny.frag.qsb")
  check(fs.existsSync(rippleQsbPath) && fs.statSync(rippleQsbPath).size > 0, "bake wrote shaders/ripple.frag.qsb")
  const hpp = fs.readFileSync(hppPath, "utf8")
  check(hpp.indexOf("Generated by dev/bake.sh") !== -1, "shaders.hpp is bake-generated")
  check(hpp.indexOf('#include "coverage.frag"') === -1, "bake expands coverage.frag")
  check(hpp.indexOf('#include "shiny-lighting.frag"') === -1, "bake expands shiny lighting")
  check(hpp.indexOf('#include "ripple-lighting.frag"') === -1, "bake expands ripple lighting")
  check(hpp.indexOf("vec4 shinyLightingColor") !== -1, "shaders.hpp inlines the lighting source")
  check(hpp.indexOf("vec4 rippleLightingColor") !== -1, "shaders.hpp inlines the ripple lighting source")
  check(hpp.indexOf("shinyHaloGlow") !== -1, "shaders.hpp inlines shared halo glow")
  check(hpp.indexOf("shinyCoverageCombine") !== -1, "shaders.hpp inlines shared coverage combine")
  check(hpp.indexOf("specularHalo") !== -1, "inlined programs bind specularHalo")
  check(hpp.indexOf("RIPPLE_FRAG") !== -1, "shaders.hpp exports RIPPLE_FRAG")
  check(hpp.indexOf("gl_FragCoord") !== -1, "inlined gles wrapper keeps gl_FragCoord")
  check(hpp.indexOf("qt_Matrix") === -1, "inlined gles host has no Qt UBO")
  check(hpp.indexOf("widthPx") === -1, "inlined gles host is not the qt wrapper")
  check(hpp.indexOf("if (ripple)") === -1, "inlined programs have no if (ripple) mode flag")
}

function checkShimmerParity() {
  const seed = 42
  const p = { hz: 0.6, angleRangeRad: 0.4363, scaleMin: 0.75, scaleMax: 1.35 }
  const dts = []
  for (let i = 0; i < 120; i++)
    dts.push(0.016)
  dts.push(0, 0.033, 0.001, 0.25, 0.4, 0.05)
  for (let i = 0; i < 40; i++)
    dts.push(0.016)

  const js = Shimmer.makeState(seed)
  const jsRows = []
  for (let i = 0; i < dts.length; i++) {
    Shimmer.step(js, dts[i], p)
    jsRows.push({ angle: js.angle.value, scale: js.scale.value })
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shimmer-parity-"))
  const bin = path.join(dir, "dump_shimmer")
  try {
    const cxx = process.env.CXX || "g++"
    const compiled = spawnSync(
      cxx,
      [
        "-std=gnu++26",
        "-O2",
        "-g",
        "-o",
        bin,
        path.join(root, "hypr/tests/dump_shimmer.cpp"),
        path.join(root, "hypr/src/runtime.cpp"),
        path.join(root, "hypr/src/shimmer.cpp"),
      ],
      { encoding: "utf8", timeout: 60000 }
    )
    check(compiled.status === 0, "dump_shimmer compiles: " + (compiled.stderr || compiled.stdout || ""))
    if (compiled.status !== 0)
      return

    const args = [
      bin,
      String(seed),
      String(p.hz),
      String(p.angleRangeRad),
      String(p.scaleMin),
      String(p.scaleMax),
    ].concat(dts.map(String))
    const dumped = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 15000 })
    check(dumped.status === 0, "dump_shimmer exits 0: " + (dumped.stderr || dumped.stdout || ""))
    if (dumped.status !== 0)
      return

    const cppRows = String(dumped.stdout || "")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => {
        const parts = l.trim().split(/\s+/)
        return { angle: Number(parts[0]), scale: Number(parts[1]) }
      })
    check(cppRows.length === jsRows.length, "js and cpp step counts match: " + jsRows.length + " vs " + cppRows.length)
    const n = Math.min(jsRows.length, cppRows.length)
    let mismatches = 0
    for (let i = 0; i < n; i++) {
      const okAngle = approx(jsRows[i].angle, cppRows[i].angle, 1e-4)
      const okScale = approx(jsRows[i].scale, cppRows[i].scale, 1e-4)
      if (!okAngle || !okScale) {
        mismatches++
        if (mismatches <= 3) {
          check(
            false,
            "shimmer step " +
              i +
              " dt=" +
              dts[i] +
              " js=" +
              jsRows[i].angle +
              "," +
              jsRows[i].scale +
              " cpp=" +
              cppRows[i].angle +
              "," +
              cppRows[i].scale
          )
        }
      }
    }
    check(mismatches === 0, "js Shimmer.step and cpp shinyShimmerStep agree (" + n + " steps, " + mismatches + " mismatches)")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function checkWrapSource() {
  const frag = fs.readFileSync(path.join(root, "shaders/shiny.frag"), "utf8")
  const qml = fs.readFileSync(path.join(root, "qml/ShinyBorder.qml"), "utf8")
  check(frag.indexOf("vec4  baseColor;") !== -1, "qs frag baseColor UBO")
  check(frag.indexOf("decoration:shadow") === -1, "qs frag does not consult decoration:shadow")
  check(qml.indexOf("border.color: root.baseColor") === -1, "QML does not paint a doubled wrap stroke")
  check(qml.indexOf("property vector4d baseColor") !== -1, "ShaderEffect uploads baseColor")
  check(frag.indexOf("int   mirror;") !== -1, "qs frag mirror UBO")
  check(qml.indexOf("property bool mirror") !== -1, "QML overlay exposes mirror")
  check(qml.indexOf("property int mirror: root.mirror ? 1 : 0") !== -1,
        "ShaderEffect uploads mirror")
  check(qml.indexOf("property bool pulse") !== -1, "QML overlay exposes pulse")
  check(qml.indexOf("property real pulseHz") !== -1, "QML overlay exposes pulseHz")
  check(qml.indexOf("function stepPulse()") !== -1, "QML steps pulse time")
  check(qml.indexOf("property real brightness: 0") === -1,
        "ShaderEffect brightness is not stuck at 0")
  check(qml.indexOf("root._pulseOn ? root.pulseHz : 0") !== -1,
        "ShaderEffect brightness is pulse Hz when pulse is the active effect")
  check(qml.indexOf("root._pulseOn || root._rippleOn") !== -1,
        "ShaderEffect time is driven when pulse or ripple is on")
  check(qml.indexOf("root._shimmerOn || root._pulseOn || root._rippleOn") !== -1,
        "chrome timer runs for pulse, shimmer, and ripple")
  check(qml.indexOf("ripple.frag.qsb") !== -1, "chrome binds the ripple fragment")
  check(qml.indexOf("property string effect") !== -1, "chrome overlay exposes effect")
  check(qml.indexOf("property real rippleFreq") !== -1, "chrome overlay exposes rippleFreq")
  check(qml.indexOf("property real rippleOriginX") !== -1, "chrome overlay exposes rippleOriginX")
  check(qml.indexOf("property real rippleOriginY") !== -1, "chrome overlay exposes rippleOriginY")
  check(qml.indexOf("property real rippleFade") !== -1, "chrome overlay exposes rippleFade")
  check(qml.indexOf("Ripple.rippleTime") !== -1, "chrome ticks ripple from the shipped clock")
  check(qml.indexOf("property bool specularHalo") !== -1, "QML overlay exposes specularHalo")
  check(qml.indexOf("Coverage.bleedPx") !== -1, "chrome bleed margin uses shipped Coverage.bleedPx")
  check(qml.indexOf("anchors.margins: -root._haloBleed") !== -1,
        "ShaderEffect grows by the halo bleed without changing borderSize")
  check(qml.indexOf("property real specularHalo: root.specularHalo ? 1 : 0") !== -1,
        "ShaderEffect uploads specularHalo")
  check(qml.indexOf("property real haloBleedPx: root._haloBleed * root.dpr") !== -1,
        "ShaderEffect uploads haloBleedPx")
  check(frag.indexOf("float specularHalo;") !== -1, "qs frag specularHalo UBO")
  check(frag.indexOf("float haloBleedPx;") !== -1, "qs frag haloBleedPx UBO")
  const rippleFrag = fs.readFileSync(path.join(root, "shaders/ripple.frag"), "utf8")
  check(rippleFrag.indexOf("float specularHalo;") !== -1, "ripple qs frag specularHalo UBO")
  check(rippleFrag.indexOf("float haloBleedPx;") !== -1, "ripple qs frag haloBleedPx UBO")
  const shinyLit = fs.readFileSync(path.join(root, "shaders/shiny-lighting.frag"), "utf8")
  const rippleLit = fs.readFileSync(path.join(root, "shaders/ripple-lighting.frag"), "utf8")
  check(shinyLit.indexOf("shinyHaloGlow") !== -1, "shiny lighting calls shipped halo glow")
  check(shinyLit.indexOf("shinyCoverageCombine") !== -1, "shiny lighting calls shipped coverage combine")
  check(shinyLit.indexOf("specularHalo") !== -1, "shiny lighting gates glow with specularHalo")
  check(rippleLit.indexOf("shinyHaloGlow") !== -1, "ripple lighting calls shipped halo glow")
  check(rippleLit.indexOf("shinyCoverageCombine") !== -1, "ripple lighting calls shipped coverage combine")
  check(rippleLit.indexOf("specularHalo") !== -1, "ripple lighting gates glow with specularHalo")
  const deco = fs.readFileSync(path.join(root, "hypr/src/deco.cpp"), "utf8")
  const posAt = deco.indexOf("SDecorationPositioningInfo CShinyBorder::getPositioningInfo")
  const posBody = posAt >= 0 ? deco.slice(posAt, deco.indexOf("void CShinyBorder::onPositioningReply")) : ""
  check(posBody.indexOf("effectiveBorderSize") !== -1, "reserved extents still come from effectiveBorderSize")
  check(posBody.indexOf("shinyHaloExpandPx") === -1 && posBody.indexOf("shinyDamageExpandPx") === -1,
        "reserved extents do not include halo bleed")
  check(deco.indexOf("shinyHaloExpandPx") !== -1, "draw path expands by shipped halo expand")
  check(deco.indexOf("shinyDamageExpandPx") !== -1, "damage path expands by shipped damage expand")
  const stepAt = qml.indexOf("function stepShimmer()")
  check(stepAt !== -1, "chrome has stepShimmer")
  const stepBody = qml.slice(stepAt, qml.indexOf("function stepPulse()"))
  check(stepBody.indexOf("Math.min(dt, 0.25)") !== -1,
        "stepShimmer caps live dt with Math.min(dt, 0.25)")

  const service = fs.readFileSync(path.join(root, "Service.qml"), "utf8")
  check(service.indexOf("mirror: root.look.mirror") !== -1,
        "chrome overlay binds merged look.mirror")
  check(service.indexOf("pulse: root.look.pulse") !== -1,
        "chrome overlay binds merged look.pulse")
  check(service.indexOf("pulseHz: root.look.pulseHz") !== -1,
        "chrome overlay binds merged look.pulseHz")
  check(service.indexOf("Look.effectDraws") !== -1,
        "chrome attach keys off Look.effectDraws (shiny or ripple)")
  check(service.indexOf("effect: root.look.effect") !== -1,
        "chrome overlay binds merged look.effect")
  check(service.indexOf("rippleFreq: root.look.rippleFreq") !== -1,
        "chrome overlay binds merged look.rippleFreq")
  check(service.indexOf("rippleOriginX: root.look.rippleOriginX") !== -1,
        "chrome overlay binds merged look.rippleOriginX")
  check(service.indexOf("rippleOriginY: root.look.rippleOriginY") !== -1,
        "chrome overlay binds merged look.rippleOriginY")
  check(service.indexOf("rippleFade: root.look.rippleFade") !== -1,
        "chrome overlay binds merged look.rippleFade")
  check(service.indexOf("specularHalo: root.look.specularHalo") !== -1,
        "chrome overlay binds merged look.specularHalo")
}

function checkGlowCoverage() {
  // Drive the shipped coverage combine (qml/Coverage.js twin of
  // shaders/coverage.frag). Do not re-implement the fragment here.
  const localT = 2
  const dOut = 2
  const dIn = dOut + localT
  const wrapT = localT
  const dWrap = dOut + wrapT

  const glowLit = Coverage.glow(dOut, localT, 1, 1)
  const covLit = Coverage.combine(Coverage.ring(dOut, dIn), glowLit)
  check(dOut > 0, "sample sits outside the outer contour")
  check(glowLit > 0, "displaying + lit + dOut > 0 → halo glow > 0")
  check(covLit > 0, "displaying + lit + dOut > 0 → halo coverage > 0")

  const glowUnlit = Coverage.glow(dOut, localT, 0, 1)
  check(glowUnlit === 0, "displaying + unlit → no halo")
  check(Coverage.combine(0, glowUnlit) === 0, "displaying + unlit outside coverage is 0")

  const glowOff = Coverage.glow(dOut, localT, 1, 0)
  check(glowOff === 0, "non-displaying + dOut > 0 → no halo")
  check(Coverage.combine(0, glowOff) === 0, "non-displaying outside coverage is 0")
  check(Coverage.glow(dOut, localT, 1, false) === 0, "bool false halo is non-displaying")

  const wrap = Coverage.wrapRing(dOut, dWrap)
  check(wrap < 0.002, "wrap coverage still excludes glow (outside the wrap ring is 0)")
  check(glowLit > wrap, "halo paints outside where wrap does not")

  check(Coverage.bleedPx(2, 0) === 0, "bleedPx is 0 when the halo is off")
  check(Coverage.bleedPx(2, 1) > 0, "bleedPx > 0 when the halo is on")
  check(Coverage.bleedPx(2, 1) > 2, "bleed extends past borderSize")
  check(Look.DEFAULTS.specularHalo === false, "documented default is non-displaying")

  const tmax = localT * Coverage.HALO_FALLOFF
  let last = 2
  let rose = false
  for (let x = -1; x <= tmax + 0.01; x += 0.05) {
    const c = Coverage.combine(Coverage.ring(x, x + localT), Coverage.glow(x, localT, 1, 1))
    if (c > last + 1e-4)
      rose = true
    last = c
  }
  check(!rose, "ring-over-glow coverage falls through the halo")
}

checkPinnedHeading()
checkRippleCrest()
checkRippleOriginFade()
checkPulseAlphaMul()
checkPulseUniforms()
checkEffectMode()
checkTickMs()
checkClampDt()
checkShimmer()
checkGradient()
checkGradientPositions()
checkGradientLobeU()
checkGradientCwSide()
checkLightProjection()

function instrumentCard(base) {
  var spec = base.borderSpec
  var clip = base.clip
  var specWrites = 0
  var clipWrites = 0
  var card = {}
  for (var k in base) {
    if (!Object.prototype.hasOwnProperty.call(base, k))
      continue
    if (k === "borderSpec" || k === "clip")
      continue
    card[k] = base[k]
  }
  Object.defineProperty(card, "borderSpec", {
    get: function () { return spec },
    set: function (v) { specWrites++; spec = v },
    enumerable: true,
    configurable: true
  })
  Object.defineProperty(card, "clip", {
    get: function () { return clip },
    set: function (v) { clipWrites++; clip = v },
    enumerable: true,
    configurable: true
  })
  Object.defineProperty(card, "specWrites", {
    get: function () { return specWrites },
    enumerable: false
  })
  Object.defineProperty(card, "clipWrites", {
    get: function () { return clipWrites },
    enumerable: false
  })
  return card
}

function makeBarPanel(open, visible) {
  var spec = { kind: "stock-bar" }
  var host = instrumentCard({
    anchorItem: {},
    contentWidth: 220,
    borderSpec: spec,
    open: open,
    visible: visible,
    padding: 8,
    radius: 12,
    clip: true
  })
  return { host: host, card: host, spec: spec }
}

function makeOverlay(opened) {
  var spec = { kind: "stock-overlay" }
  var host = instrumentCard({
    opened: opened,
    cardWidth: 420,
    borderSpec: spec,
    padding: 10,
    radius: 16,
    clip: false
  })
  return { host: host, card: host, spec: spec }
}

function makeToast(visible) {
  var spec = { kind: "stock-toast" }
  var host = instrumentCard({
    cardBorderSpec: {},
    summary: "hello",
    urgency: 1,
    borderSpec: spec,
    padding: 12,
    radius: 10,
    clip: true,
    visible: visible
  })
  return { host: host, card: host, spec: spec }
}

function driveSync(OA, session, host, card, opts) {
  opts = opts || {}
  var overlay = session.overlayOf.get(card) || null
  var decision = OA.decideHostSync({
    host: opts.hostDestroyed ? null : host,
    card: opts.hostDestroyed ? OA.cardForHost(session.attached, host) || card : card,
    hostAlive: opts.hostAlive !== false && !opts.hostDestroyed,
    hostDestroyed: !!opts.hostDestroyed,
    effectDraws: opts.effectDraws !== false,
    attached: session.attached,
    existingOverlayRev: overlay ? overlay.overlayRev : null,
    currentOverlayRev: session.overlayRev,
    disable: !!opts.disable
  })
  var result = OA.applyCardPolicy(session.attached, card, decision, { host: host, card: card })
  if (result.overlayAction === "destroy" || result.overlayAction === "replace")
    session.overlayOf.delete(card)
  if (result.overlayAction === "create" || result.overlayAction === "replace")
    session.overlayOf.set(card, { overlayRev: session.overlayRev })
  session.attached = result.attached
  session.lastDecision = decision
  session.lastResult = result
  return { decision: decision, result: result, overlay: session.overlayOf.get(card) || null }
}

function checkOverlayAttach() {
  const OA = loadPragmaLibrary("qml/OverlayAttach.js")
  check(typeof OA.isBarPanelHost === "function", "OverlayAttach.isBarPanelHost is shipped")
  check(typeof OA.isOverlayHost === "function", "OverlayAttach.isOverlayHost is shipped")
  check(typeof OA.isNotificationCard === "function", "OverlayAttach.isNotificationCard is shipped")
  check(typeof OA.isHost === "function", "OverlayAttach.isHost is shipped")
  check(typeof OA.isChromeCard === "function", "OverlayAttach.isChromeCard is shipped")
  check(typeof OA.hostShowing === "function", "OverlayAttach.hostShowing is shipped")
  check(typeof OA.decideHostSync === "function", "OverlayAttach.decideHostSync is shipped")
  check(typeof OA.applyCardPolicy === "function", "OverlayAttach.applyCardPolicy is shipped")
  check(OA.ASSIGN_STOCK === true, "ASSIGN_STOCK hides the stock stroke while the overlay is on")
  check(typeof OA.stockWidth === "function", "OverlayAttach.stockWidth is shipped")
  check(typeof OA.hiddenSpec === "function", "OverlayAttach.hiddenSpec is shipped")
  check(OA.stockWidth(null) === 2, "stockWidth default is 2")
  check(OA.stockWidth({ widths: { top: 3, right: 1, bottom: 0, left: 2 } }) === 3, "stockWidth is max side")
  const fillSpec = OA.hiddenSpec("#112233", 4)
  check(fillSpec.widths.top === 4 && fillSpec.widths.right === 4, "hiddenSpec is uniform width")
  check(fillSpec.gradient && fillSpec.gradient.enabled === false, "hiddenSpec is native (no overlay gradient)")
  check(fillSpec.color === "#112233", "hiddenSpec keeps fill color")

  const bar = makeBarPanel(true, true)
  const overlay = makeOverlay(true)
  const toast = makeToast(true)
  check(OA.isBarPanelHost(bar.host) === true, "bar-panel host (anchorItem+contentWidth+borderSpec+open)")
  check(OA.isOverlayHost(overlay.host) === true, "overlay host (opened+cardWidth+borderSpec)")
  check(OA.isNotificationCard(toast.host) === true, "notification card (cardBorderSpec+summary+urgency+borderSpec+padding+radius)")
  check(OA.isHost(bar.host) && OA.isHost(overlay.host) && OA.isHost(toast.host), "all three kinds are hosts")
  check(OA.isChromeCard(bar.card) && OA.isChromeCard(overlay.card) && OA.isChromeCard(toast.card),
        "chrome cards have borderSpec+padding+radius")

  // Leftover opened+cardWidth+borderSpec is the overlay duck-type (gets a ring).
  const leftoverDuck = { opened: true, cardWidth: 360, borderSpec: { kind: "leftover" } }
  check(OA.isOverlayHost(leftoverDuck) === true, "leftover opened+cardWidth+borderSpec is overlay host")
  check(OA.isHost(leftoverDuck) === true, "leftover overlay duck-type is a host")
  check(OA.isBarPanelHost(leftoverDuck) === false, "leftover overlay duck-type is not a bar panel")
  check(OA.isNotificationCard(leftoverDuck) === false, "leftover overlay duck-type is not a toast")
  check(OA.hostShowing(leftoverDuck) === true, "leftover overlay duck-type with opened:true is showing")

  const leftoverClosed = { opened: false, cardWidth: 360, borderSpec: {} }
  check(OA.isOverlayHost(leftoverClosed) === true, "closed leftover overlay duck-type is still an overlay host")
  check(OA.hostShowing(leftoverClosed) === false, "closed leftover overlay duck-type is not showing")

  // Subset leftover keys are not a silent extra host kind.
  const subsetNoWidth = { opened: true, borderSpec: {} }
  const subsetNoOpened = { cardWidth: 360, borderSpec: {} }
  const subsetNoSpec = { opened: true, cardWidth: 360 }
  check(OA.isOverlayHost(subsetNoWidth) === false, "opened+borderSpec without cardWidth is not overlay host")
  check(OA.isOverlayHost(subsetNoOpened) === false, "cardWidth+borderSpec without opened is not overlay host")
  check(OA.isOverlayHost(subsetNoSpec) === false, "opened+cardWidth without borderSpec is not overlay host")
  check(OA.isHost(subsetNoWidth) === false, "subset leftover is not a silent extra host")
  check(OA.isHost(subsetNoOpened) === false, "cardWidth+borderSpec leftover is not a host")
  check(OA.isHost({ anchorItem: {}, contentWidth: 1, open: true }) === false,
        "bar-panel subset without borderSpec is not a host")
  check(OA.isHost({
    summary: "x",
    urgency: 1,
    borderSpec: {},
    padding: 1,
    radius: 1
  }) === false, "toast subset without cardBorderSpec is not a host")
  check(OA.isChromeCard({ borderSpec: {} }) === false, "borderSpec alone is not a chrome card")

  check(OA.hostShowing(toast.host) === true, "toast visible is showing")
  toast.host.visible = false
  check(OA.hostShowing(toast.host) === false, "toast visible:false is hidden")
  toast.host.visible = true

  const hiddenOverlay = makeOverlay(false)
  check(OA.hostShowing(hiddenOverlay.host) === false, "overlay opened:false is hidden")
  check(OA.hostShowing(overlay.host) === true, "overlay opened:true is showing")

  check(OA.hostShowing(bar.host) === true, "panel open:true is showing")
  const fading = makeBarPanel(false, true)
  check(OA.hostShowing(fading.host) === true, "panel fade-mapped visible with open:false is showing")
  const closedPanel = makeBarPanel(false, false)
  check(OA.hostShowing(closedPanel.host) === false, "panel open:false visible:false is hidden")

  const session = { attached: [], overlayOf: new Map(), overlayRev: 12 }

  const first = driveSync(OA, session, bar.host, bar.card)
  check(first.decision.action === "attach", "showing shiny bar-panel attaches")
  check(first.decision.assignStock === true, "first attach hides stock stroke")
  check(first.result.assignStock === true, "first attach policy assignStock")
  check(first.result.overlayAction === "create", "first attach creates overlay")
  check(OA.isAttached(session.attached, bar.card) === true, "attach-once: set membership grows")
  check(session.attached.length === 1, "one attached card after first sync")
  check(first.overlay && first.overlay.overlayRev === 12, "created overlay stamped with current overlayRev")

  const second = driveSync(OA, session, bar.host, bar.card)
  check(second.decision.action === "noop", "second sync on attached showing card is noop")
  check(second.decision.assignStock === false, "second sync does not poll-assign borderSpec/clip")
  check(second.decision.createOverlay === false, "second sync does not recreate overlay")
  check(second.result.overlayAction === "keep", "second sync keeps existing overlay")
  check(session.attached.length === 1, "second sync does not grow the attached set")

  const stale = { attached: [], overlayOf: new Map(), overlayRev: 12 }
  stale.overlayOf.set(overlay.card, { overlayRev: 11 })
  const replaced = driveSync(OA, stale, overlay.host, overlay.card)
  check(replaced.decision.action === "replace", "stale overlayRev is drop-and-replace")
  check(replaced.decision.dropLeftover === true, "stale stamp dropLeftover")
  check(replaced.result.overlayAction === "replace", "stale stamp overlayAction replace")
  check(replaced.overlay && replaced.overlay.overlayRev === 12, "replacement stamped with current overlayRev")
  check(OA.isAttached(stale.attached, overlay.card) === true, "replace still attaches the card")
  check(replaced.decision.assignStock === true, "leftover replace hides stock (not already attached)")

  const kept = driveSync(OA, stale, overlay.host, overlay.card)
  check(kept.decision.action === "noop", "matching overlayRev is kept")
  check(kept.decision.dropLeftover === false, "matching stamp is not dropped")
  check(kept.result.overlayAction === "keep", "matching stamp overlayAction keep")
  check(kept.overlay && kept.overlay.overlayRev === 12, "matching stamp overlay remains")

  const sameRevLeftover = { attached: [], overlayOf: new Map(), overlayRev: 12 }
  sameRevLeftover.overlayOf.set(toast.card, { overlayRev: 12 })
  const join = driveSync(OA, sameRevLeftover, toast.host, toast.card)
  check(join.decision.action === "attach", "matching leftover not in set is attach")
  check(join.decision.createOverlay === false, "matching leftover keeps existing child")
  check(join.decision.keepOverlay === true, "matching leftover keepOverlay")
  check(sameRevLeftover.attached.length === 1, "matching leftover joins the attached set")
  check(join.decision.assignStock === true, "matching leftover join hides stock")

  bar.host.open = false
  bar.host.visible = false
  const hidden = driveSync(OA, session, bar.host, bar.card)
  check(hidden.decision.action === "detach", "hide of attached host detaches")
  check(hidden.result.overlayAction === "destroy", "hide destroys overlay child")
  check(OA.isAttached(session.attached, bar.card) === false, "hide removes card from attached set")
  check(session.attached.length === 0, "attached set empty after hide")
  check(hidden.overlay === null, "overlay gone after hide")
  check(hidden.decision.restoreStock === true, "hide restores stock stroke")
  check(hidden.result.restoreStock === true, "hide policy restoreStock")

  bar.host.open = true
  bar.host.visible = true
  driveSync(OA, session, bar.host, bar.card)
  check(session.attached.length === 1, "re-show attaches again")
  const destroyed = driveSync(OA, session, bar.host, bar.card, { hostDestroyed: true })
  check(destroyed.decision.action === "detach", "destroy of attached host detaches")
  check(OA.isAttached(session.attached, bar.card) === false, "destroy removes card from attached set")
  check(destroyed.decision.restoreStock === true, "destroy restores stock stroke")

  const disableSess = { attached: [], overlayOf: new Map(), overlayRev: 12 }
  driveSync(OA, disableSess, toast.host, toast.card)
  check(disableSess.attached.length === 1, "toast attached before disable")
  const disabled = driveSync(OA, disableSess, toast.host, toast.card, { disable: true })
  check(disabled.decision.action === "detach", "disable teardown detaches")
  check(disabled.result.overlayAction === "destroy", "disable destroys overlay")
  check(disableSess.attached.length === 0, "disable clears attached set")
  check(disabled.decision.restoreStock === true, "disable restores stock stroke")

  const notShiny = { attached: [], overlayOf: new Map(), overlayRev: 12 }
  driveSync(OA, notShiny, overlay.host, overlay.card)
  const off = driveSync(OA, notShiny, overlay.host, overlay.card, { effectDraws: false })
  check(off.decision.action === "detach", "non-shiny effect detaches chrome")
  check(notShiny.attached.length === 0, "non-shiny effect clears attached set")

  const rippleSess = { attached: [], overlayOf: new Map(), overlayRev: 12 }
  const rippleOn = driveSync(OA, rippleSess, overlay.host, overlay.card, { effectDraws: Look.effectDraws("ripple") })
  check(Look.effectDraws("ripple") === true, "ripple is a drawing effect")
  check(rippleOn.decision.action === "attach", "ripple effect attaches chrome like shiny")
  check(rippleSess.attached.length === 1, "ripple attach grows the attached set")
  const rippleOff = driveSync(OA, rippleSess, overlay.host, overlay.card, { effectDraws: Look.effectDraws("other") })
  check(rippleOff.decision.action === "detach", "unknown effect detaches after ripple")
  check(rippleSess.attached.length === 0, "unknown effect clears attached set")

  const noAttach = driveSync(OA, { attached: [], overlayOf: new Map(), overlayRev: 12 },
    leftoverClosed, leftoverClosed, { effectDraws: true })
  check(noAttach.decision.action === "noop", "hidden leftover overlay duck-type does not attach")
}

function checkOverlayAttachWiring() {
  const service = fs.readFileSync(path.join(root, "Service.qml"), "utf8")
  check(
    service.indexOf('import "qml/OverlayAttach.js" as OverlayAttach') !== -1,
    "Service.qml imports shipped OverlayAttach"
  )
  check(service.indexOf("OverlayAttach.isHost") !== -1, "Service uses OverlayAttach.isHost")
  check(service.indexOf("OverlayAttach.isChromeCard") !== -1, "Service uses OverlayAttach.isChromeCard")
  check(service.indexOf("OverlayAttach.isNotificationCard") !== -1, "Service uses OverlayAttach.isNotificationCard")
  check(service.indexOf("OverlayAttach.decideHostSync") !== -1, "Service uses OverlayAttach.decideHostSync")
  check(service.indexOf("OverlayAttach.applyCardPolicy") !== -1, "Service uses OverlayAttach.applyCardPolicy")
  check(service.indexOf('objectName === "qs-border-fx"') !== -1,
        "leftover qs-border-fx chrome children are still discovered so they can be dropped")
  check(service.indexOf("function isBarPanelHost") === -1, "no QML-only isBarPanelHost copy")
  check(service.indexOf("function isOverlayHost") === -1, "no QML-only isOverlayHost copy")
  check(service.indexOf("function isNotificationCard") === -1, "no QML-only isNotificationCard copy")
  check(service.indexOf("function isHost") === -1, "no QML-only isHost copy")
  check(service.indexOf("function isChromeCard") === -1, "no QML-only isChromeCard copy")
  check(service.indexOf("function hostShowing") === -1, "no QML-only hostShowing copy")
  check(service.indexOf("function hideStock") !== -1, "Service hides stock stroke on attach")
  check(service.indexOf("function restoreStock") !== -1, "Service restores stock stroke on detach")
  check(service.indexOf("result.assignStock") !== -1, "Service hides stock from attach policy, not a poll")
  check(service.indexOf("result.restoreStock") !== -1, "Service restores stock from detach policy")
  const hideAt = service.indexOf("function hideStock")
  const restoreAt = service.indexOf("function restoreStock")
  const hideFn = hideAt === -1 ? "" : service.slice(hideAt, restoreAt)
  check(/card\.borderSpec\s*=/.test(hideFn), "hideStock assigns borderSpec")
  check(hideFn.indexOf("Qt.binding") !== -1, "hidden stock spec tracks card.color")
  check(/card\.clip\s*=\s*false/.test(hideFn), "hideStock drops clip so the ring is not scissored")
  const restoreFn = restoreAt === -1 ? "" : service.slice(restoreAt, service.indexOf("function pluginRoot"))
  check(/card\.borderSpec\s*=\s*entry\.spec/.test(restoreFn), "restoreStock writes the captured spec")

  check(/onActivePopoutChanged\(\)\s*\{\s*Qt\.callLater\(root\.syncAll\)/.test(service),
        "onActivePopoutChanged invokes syncAll")
  check(/onCountChanged\(\)\s*\{\s*Qt\.callLater\(root\.syncAll\)/.test(service),
        "popup model onCountChanged invokes syncAll")
  check(/onRowsInserted\(\)\s*\{\s*Qt\.callLater\(root\.syncAll\)/.test(service),
        "popup model onRowsInserted invokes syncAll")
  check(/onRowsRemoved\(\)\s*\{\s*Qt\.callLater\(root\.syncAll\)/.test(service),
        "popup model onRowsRemoved invokes syncAll")
  check(service.indexOf("onShellChanged: Qt.callLater(root.syncAll)") !== -1,
        "onShellChanged invokes syncAll")
  check(service.indexOf("function onVisibleChanged()") !== -1
      && service.indexOf("function onOpenedChanged()") !== -1
      && service.indexOf("function onOpenChanged()") !== -1,
        "host hide/destroy watches bind visible/opened/open")
  check(service.indexOf("root.teardownChrome()") !== -1, "service destruction tears down chrome overlays")
  check(service.indexOf("Qt.callLater(root.syncAll)") !== -1, "completed/look path can invoke syncAll")

  const discoverAt = service.indexOf("id: discoverTimer")
  check(discoverAt !== -1, "repeating discover timer still exists for new-host discovery")
  const discover = service.slice(discoverAt, service.indexOf("Connections {", discoverAt))
  check(discover.indexOf("interval: 200") !== -1, "discover timer interval is 200")
  check(discover.indexOf("repeat: true") !== -1, "discover timer repeats")
  check(discover.indexOf("onTriggered: root.syncAll()") !== -1, "discover timer calls syncAll, not a borderSpec rewrite")
  check(!/card\.borderSpec\s*=/.test(discover), "discover timer does not assign card.borderSpec")
  check(!/card\.clip\s*=/.test(discover), "discover timer does not assign card.clip")
}

function checkOverlayRevStamp() {
  const service = fs.readFileSync(path.join(root, "Service.qml"), "utf8")
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"))
  const m = /readonly property int overlayRev:\s*(-?\d+)/.exec(service)
  check(!!m, "overlayRev is a dedicated integer property")
  const rev = m ? Number(m[1]) : NaN
  check(Number.isInteger(rev), "overlayRev is an integer stamp")
  check(service.indexOf("Number(manifest.version)") === -1, "overlayRev is not Number(manifest.version)")
  check(String(rev) !== String(Number("0.1.0")), 'Number("0.1.0") is not the overlay stamp')
  check(String(rev) !== String(Number(manifest.version)), "overlayRev is not package semver")

  const OA = loadPragmaLibrary("qml/OverlayAttach.js")
  const overlay = makeOverlay(true)
  const current = { attached: [], overlayOf: new Map(), overlayRev: rev }
  current.overlayOf.set(overlay.card, { overlayRev: rev - 1 })
  const replaced = driveSync(OA, current, overlay.host, overlay.card)
  check(replaced.decision.action === "replace", "stale vs current overlayRev still drop-and-replace")
  check(replaced.result.overlayAction === "replace", "stale stamp overlayAction replace")
  check(replaced.overlay && replaced.overlay.overlayRev === rev, "replacement uses the integer overlay stamp")
}

function checkCiConfig() {
  const ghDir = path.join(root, ".github/workflows")
  const gitlab = path.join(root, ".gitlab-ci.yml")
  let text = ""
  let found = ""
  if (fs.existsSync(ghDir)) {
    for (const f of fs.readdirSync(ghDir)) {
      if (!/\.(yml|yaml)$/.test(f)) continue
      const body = fs.readFileSync(path.join(ghDir, f), "utf8")
      if (body.indexOf("mise run test") !== -1 || /node tests\//.test(body)) {
        text = body
        found = ".github/workflows/" + f
        break
      }
    }
  }
  if (!text && fs.existsSync(gitlab)) {
    const body = fs.readFileSync(gitlab, "utf8")
    if (body.indexOf("mise run test") !== -1 || /node tests\//.test(body)) {
      text = body
      found = ".gitlab-ci.yml"
    }
  }
  check(!!found, "repo has a CI config that runs compositor-free tests")
  check(
    text.indexOf("mise run test") !== -1 || /node tests\/(run|look|hypr-session)/.test(text),
    "CI job invokes compositor-free tests (" + found + ")"
  )
}

function checkEnsureStatusReady() {
  const EnsureStatus = loadPragmaLibrary("qml/EnsureStatus.js")
  check(typeof EnsureStatus.isEnsureSuccessStatus === "function", "EnsureStatus.isEnsureSuccessStatus is shipped")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=ok") === true, "STATUS=ok is ready")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=hyprpm") === true, "STATUS=hyprpm is ready")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=reuse") === true, "STATUS=reuse is ready")
  check(EnsureStatus.isEnsureSuccessStatus("hypr-ensure: done\nSTATUS=ok\n") === true, "STATUS=ok among logs is ready")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=load-failed") === false, "STATUS=load-failed is not ready")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=build-failed") === false, "STATUS=build-failed is not ready")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=skipped") === false, "STATUS=skipped is not ready")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=no-hyprctl") === false, "STATUS=no-hyprctl is not ready")
  check(EnsureStatus.isEnsureSuccessStatus("") === false, "empty stdout is not ready")
  check(
    EnsureStatus.isEnsureSuccessStatus("hypr-ensure: load refused\nSTATUS=load-failed\n") === false,
    "STATUS=load-failed among logs is not ready"
  )
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=no-cli") === false, "STATUS=no-cli (launcher without cargo) is not ready")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=cli-build-failed") === false, "STATUS=cli-build-failed is not ready")
  check(EnsureStatus.isEnsureSuccessStatus("STATUS=okay") === false, "STATUS=okay is not a success prefix match")
  check(
    EnsureStatus.isEnsureSuccessStatus("STATUS=ok\nSTATUS=load-failed\n") === false,
    "last STATUS= line wins when a later failure overwrites ok"
  )
  check(EnsureStatus.lastStatus("a\nSTATUS=reuse\nSTATUS=ok\n") === "ok", "lastStatus is the last STATUS= value")

  check(typeof EnsureStatus.parseLook === "function", "EnsureStatus.parseLook is shipped")
  const adopted = EnsureStatus.parseLook('ensure: log line\nLOOK={"effect":"shiny","pinDeg":77}\nSTATUS=ok\n')
  check(adopted && adopted.effect === "shiny" && adopted.pinDeg === 77, "parseLook reads the LOOK= line among logs")
  check(EnsureStatus.parseLook("STATUS=ok\n") === null, "parseLook without LOOK= is null")
  check(EnsureStatus.parseLook("LOOK={not json") === null, "parseLook on junk is null, not a throw")
  check(EnsureStatus.parseLook('LOOK=[1,2]') === null, "parseLook rejects a non-object look")
  check(EnsureStatus.parseLook('LOOK={"pinDeg":1}') === null, "parseLook requires an effect string")
  check(EnsureStatus.parseLook("") === null, "parseLook on empty is null")

  const service = fs.readFileSync(path.join(root, "Service.qml"), "utf8")
  check(
    service.indexOf('import "qml/EnsureStatus.js" as EnsureStatus') !== -1,
    "Service.qml imports shipped EnsureStatus"
  )
  const ensureAt = service.indexOf("id: ensureProc")
  const lookApplyAt = service.indexOf("id: lookApplyProc")
  check(ensureAt !== -1 && lookApplyAt > ensureAt, "ensureProc precedes lookApplyProc")
  const ensureProc = service.slice(ensureAt, lookApplyAt)
  check(
    ensureProc.indexOf("EnsureStatus.isEnsureSuccessStatus") !== -1,
    "ensureProc keys hyprReady on shipped isEnsureSuccessStatus"
  )
  const onExitedAt = ensureProc.indexOf("onExited:")
  check(onExitedAt !== -1, "ensureProc has onExited")
  const onExited = ensureProc.slice(onExitedAt)
  check(
    !/onExited:\s*function\s*\(\s*exitCode\s*\)\s*\{\s*root\.hyprReady\s*=\s*true/.test(onExited),
    "ensureProc onExited does not force hyprReady = true"
  )
  check(
    onExited.indexOf("EnsureStatus.isEnsureSuccessStatus") !== -1,
    "ensureProc onExited still consults STATUS via EnsureStatus (fail closed)"
  )
  check(
    onExited.indexOf("root.adoptLook") !== -1 &&
      ensureProc.indexOf("onStreamFinished") === -1,
    "ensureProc adopts LOOK= once on exit, not on the stream and the exit"
  )
  check(onExited.indexOf("runLookApply") === -1, "ensure does not re-apply after it already persisted the look")
}

function extractPluginRootSrc() {
  const service = fs.readFileSync(path.join(root, "Service.qml"), "utf8")
  const start = service.indexOf("function pluginRoot()")
  if (start === -1)
    return ""
  const brace = service.indexOf("{", start)
  let depth = 0
  for (let i = brace; i < service.length; i++) {
    const c = service.charAt(i)
    if (c === "{")
      depth++
    else if (c === "}") {
      depth--
      if (depth === 0)
        return service.slice(start, i + 1)
    }
  }
  return ""
}

function checkPluginRoot() {
  const src = extractPluginRootSrc()
  check(src.indexOf("function pluginRoot()") === 0, "extracted shipped pluginRoot from Service.qml")
  check(src.indexOf("decodeURIComponent") !== -1, "shipped pluginRoot percent-decodes file:// URLs")

  function run(resolvedUrl, manifest) {
    const ctx = {
      root: { manifest: manifest || null },
      Qt: { resolvedUrl: function () { return resolvedUrl } },
      String: String,
      decodeURIComponent: decodeURIComponent,
    }
    vm.createContext(ctx)
    vm.runInContext(src + "\nthis.__out = pluginRoot()", ctx)
    return ctx.__out
  }

  const spaced = run("file:///tmp/has%20space/plugin/", null)
  check(typeof spaced === "string" && spaced.indexOf(" ") !== -1, "file:// %20 decodes to a space: " + spaced)
  check(
    spaced.indexOf("/tmp/has space/plugin") !== -1,
    "file:///tmp/has%20space/plugin/ → decoded path with space: " + spaced
  )

  const localHost = run("file://localhost/tmp/foo", null)
  check(localHost === "/tmp/foo", "file://localhost/tmp/foo → /tmp/foo (got " + localHost + ")")
  check(localHost.indexOf("/localhost/") === -1, "file://localhost is not treated as a path")

  const three = run("file:///tmp/foo", null)
  check(three === "/tmp/foo", "file:///tmp/foo still /tmp/foo (got " + three + ")")

  const injected = run("file:///tmp/has%20space/plugin/", { __sourceDir: "/injected/source/" })
  check(injected === "/injected/source", "manifest.__sourceDir wins over file:// fallback: " + injected)
}

checkSharedShaderBake()
checkShimmerParity()
checkWrapSource()
checkEnsureStatusReady()
checkGlowCoverage()
checkOverlayAttach()
checkOverlayAttachWiring()
checkOverlayRevStamp()
checkCiConfig()
checkPluginRoot()

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok")
