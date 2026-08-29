#!/usr/bin/env node
// Compositor-free logic tests. Port of hypr-shiny-border tests/test_runtime.cpp
// checks for shimmer + gradient (the pieces this side actually owns).

const fs = require("fs")
const path = require("path")
const vm = require("vm")

const root = path.resolve(__dirname, "..")
let fails = 0

function loadPragmaLibrary(rel) {
  const file = path.join(root, rel)
  const src = fs.readFileSync(file, "utf8").replace(/^\s*\.pragma library\s*$/m, "")
  const ctx = { Math, Number, String, isFinite, console }
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

function checkWrapSource() {
  const frag = fs.readFileSync(path.join(root, "shaders/shiny.frag"), "utf8")
  const qml = fs.readFileSync(path.join(root, "qml/ShinyBorder.qml"), "utf8")
  check(frag.indexOf("vec4 shinyWrapComposite") !== -1, "qs frag wrap composite")
  check(frag.indexOf("shinyWrapComposite(highlight, baseColor, wrapRing)") !== -1, "qs frag wrap uses wrapRing")
  check(frag.indexOf("vec4  baseColor;") !== -1, "qs frag baseColor UBO")
  check(frag.indexOf("decoration:shadow") === -1, "qs frag does not consult decoration:shadow")
  check(qml.indexOf("border.color: root.baseColor") === -1, "QML does not paint a doubled wrap stroke")
  check(qml.indexOf("property vector4d baseColor") !== -1, "ShaderEffect uploads baseColor")
  check(frag.indexOf("float uRamp = clamp(d0 / max(spread, 1.0e-4), 0.0, 1.0)") !== -1,
        "qs ramp scaled onto spread")
  check(frag.indexOf("shinyRampColor(cw, uRamp)") !== -1, "qs samples uRamp not full-axis u")
  check(frag.indexOf("vec3(1.0), hot * 0.95") === -1, "qs does not blow RGB to white")
  check(frag.indexOf("mix(0.22, 1.0,") === -1, "qs does not cone-dim RGB")
  check(frag.indexOf("mix(0.055, 1.0,") === -1, "qs does not crush far-side alpha")
  check(frag.indexOf("range * 0.45") === -1, "qs pulse does not breathe spread")
  check(frag.indexOf("range * 1.35") === -1, "qs pulse does not stretch spread")
  check(frag.indexOf("mix(0.78, 1.18, pulse)") === -1, "qs pulse does not breathe thickness")
  check(frag.indexOf("stop.a * cov") !== -1, "qs highlight alpha from stop")
  check(frag.indexOf("vec4  highlight = vec4(stop.rgb * a, a)") !== -1, "qs premul from stop")
  check(frag.indexOf("shinyPulseAlphaMul(brightness, time)") !== -1, "qs pulse is alpha mul")
  check(frag.indexOf("mix(color, colorSRGB, uRamp)") !== -1, "qs two-stop fallback along lobe")
  check(frag.indexOf("float d0 = u * 0.5;") !== -1, "qs off path is facing-only d0")
  check(frag.indexOf("min(u, 1.0 - u)") !== -1, "qs on path folds d0 to nearer end")
  check(frag.indexOf("smoothstep(0.0, spread, d0)") !== -1, "qs cone uses the same d0")
  check(frag.indexOf("smoothstep(0.0, AA, dOut)") === -1,
        "qs glow does not gate at dOut=0 (that holes coverage)")
  check(frag.indexOf("smoothstep(-AA, AA, dOut) * cone") !== -1,
        "qs glow starts across the ring's outer AA")
  check(frag.indexOf("max(ring, glow * 0.65)") === -1, "qs does not max() ring over a holed glow")
  check(frag.indexOf("ring + (1.0 - ring) * glow * 0.65") !== -1,
        "qs coverage is ring over glow")
  check(frag.indexOf("int   mirror;") !== -1, "qs frag mirror UBO")
  check(frag.indexOf("if (mirror != 0)") !== -1, "qs on path gates on mirror")
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
  check(qml.indexOf("root._pulseOn ? root._pulseTime : 0") !== -1,
        "ShaderEffect time is driven when pulse is the active effect")
  check(qml.indexOf("root._shimmerOn || root._pulseOn") !== -1,
        "chrome timer runs for pulse, not only shimmer")
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
}

function checkGlowCoverage() {
  // Twin of the fragment coverage combine. Gating glow at dOut=0 left a
  // hole just outside the stroke; overlapping the ring's ±AA band and
  // putting glow under the ring keeps coverage monotonic through the halo.
  function clamp(x, a, b) {
    return Math.min(b, Math.max(a, x))
  }
  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)
  }
  const AA = 1.25
  const localT = 2
  const tmax = localT * 1.35
  const cone = 1
  function cov(dOut, gateFrom) {
    const dIn = dOut + localT
    const ring = smoothstep(AA, -AA, dOut) * smoothstep(-AA, AA, dIn)
    const glow = (1 - smoothstep(0, tmax, dOut)) * smoothstep(gateFrom, AA, dOut) * cone
    return { ring: ring, glow: glow, max: Math.max(ring, glow * 0.65),
             over: ring + (1 - ring) * glow * 0.65 }
  }
  const hole = cov(0.5, 0)
  check(hole.max + 0.05 < cov(0, 0).max && hole.max + 0.05 < cov(1.0, 0).max,
        "old dOut=0 gate + max() holes coverage in the halo")
  let last = 2
  let rose = false
  for (let dOut = -1; dOut <= tmax + 0.01; dOut += 0.05) {
    const c = cov(dOut, -AA).over
    if (c > last + 1e-4)
      rose = true
    last = c
  }
  check(!rose, "ring-over-glow coverage falls through the halo")
  check(cov(0.5, -AA).over > cov(0.5, 0).max,
        "overlapping glow start fills the old hole")
}

checkPinnedHeading()
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
    effectIsShiny: opts.effectIsShiny !== false,
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
  check(OA.ASSIGN_STOCK === false, "overlay-only: ASSIGN_STOCK is false")

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
  check(first.decision.assignStock === false, "first attach does not assign stock (overlay-only)")
  check(first.result.overlayAction === "create", "first attach creates overlay")
  check(OA.isAttached(session.attached, bar.card) === true, "attach-once: set membership grows")
  check(session.attached.length === 1, "one attached card after first sync")
  check(first.overlay && first.overlay.overlayRev === 12, "created overlay stamped with current overlayRev")
  check(bar.card.specWrites === 0, "first attach does not write borderSpec")
  check(bar.card.clipWrites === 0, "first attach does not write clip")
  check(bar.card.borderSpec === bar.spec, "host borderSpec identity preserved on attach")

  const second = driveSync(OA, session, bar.host, bar.card)
  check(second.decision.action === "noop", "second sync on attached showing card is noop")
  check(second.decision.assignStock === false, "second sync does not assign borderSpec/clip")
  check(second.decision.createOverlay === false, "second sync does not recreate overlay")
  check(second.result.overlayAction === "keep", "second sync keeps existing overlay")
  check(session.attached.length === 1, "second sync does not grow the attached set")
  check(bar.card.specWrites === 0, "second sync does not write borderSpec")
  check(bar.card.clipWrites === 0, "second sync does not write clip")
  check(bar.card.borderSpec === bar.spec, "borderSpec unchanged after second sync")
  check(bar.card.clip === true, "clip unchanged after second sync")

  const stale = { attached: [], overlayOf: new Map(), overlayRev: 12 }
  stale.overlayOf.set(overlay.card, { overlayRev: 11 })
  const replaced = driveSync(OA, stale, overlay.host, overlay.card)
  check(replaced.decision.action === "replace", "stale overlayRev is drop-and-replace")
  check(replaced.decision.dropLeftover === true, "stale stamp dropLeftover")
  check(replaced.result.overlayAction === "replace", "stale stamp overlayAction replace")
  check(replaced.overlay && replaced.overlay.overlayRev === 12, "replacement stamped with current overlayRev")
  check(OA.isAttached(stale.attached, overlay.card) === true, "replace still attaches the card")
  check(overlay.card.specWrites === 0, "leftover replace does not assign borderSpec")

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
  check(toast.card.specWrites === 0, "matching leftover join does not assign borderSpec")

  bar.host.open = false
  bar.host.visible = false
  const hidden = driveSync(OA, session, bar.host, bar.card)
  check(hidden.decision.action === "detach", "hide of attached host detaches")
  check(hidden.result.overlayAction === "destroy", "hide destroys overlay child")
  check(OA.isAttached(session.attached, bar.card) === false, "hide removes card from attached set")
  check(session.attached.length === 0, "attached set empty after hide")
  check(hidden.overlay === null, "overlay gone after hide")
  check(bar.card.borderSpec === bar.spec, "hide leaves host borderSpec untouched (overlay-only)")
  check(bar.card.clip === true, "hide leaves host clip untouched (overlay-only)")
  check(bar.card.specWrites === 0 && bar.card.clipWrites === 0, "hide does not write stock properties")

  bar.host.open = true
  bar.host.visible = true
  driveSync(OA, session, bar.host, bar.card)
  check(session.attached.length === 1, "re-show attaches again")
  const destroyed = driveSync(OA, session, bar.host, bar.card, { hostDestroyed: true })
  check(destroyed.decision.action === "detach", "destroy of attached host detaches")
  check(OA.isAttached(session.attached, bar.card) === false, "destroy removes card from attached set")
  check(bar.card.borderSpec === bar.spec, "destroy leaves host borderSpec untouched")

  const disableSess = { attached: [], overlayOf: new Map(), overlayRev: 12 }
  driveSync(OA, disableSess, toast.host, toast.card)
  check(disableSess.attached.length === 1, "toast attached before disable")
  const disabled = driveSync(OA, disableSess, toast.host, toast.card, { disable: true })
  check(disabled.decision.action === "detach", "disable teardown detaches")
  check(disabled.result.overlayAction === "destroy", "disable destroys overlay")
  check(disableSess.attached.length === 0, "disable clears attached set")
  check(toast.card.borderSpec === toast.spec, "disable leaves host borderSpec untouched")
  check(toast.card.clip === true, "disable leaves host clip untouched")

  const notShiny = { attached: [], overlayOf: new Map(), overlayRev: 12 }
  driveSync(OA, notShiny, overlay.host, overlay.card)
  const off = driveSync(OA, notShiny, overlay.host, overlay.card, { effectIsShiny: false })
  check(off.decision.action === "detach", "non-shiny effect detaches chrome")
  check(notShiny.attached.length === 0, "non-shiny effect clears attached set")

  const noAttach = driveSync(OA, { attached: [], overlayOf: new Map(), overlayRev: 12 },
    leftoverClosed, leftoverClosed, { effectIsShiny: true })
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
  check(service.indexOf("function isBarPanelHost") === -1, "no QML-only isBarPanelHost copy")
  check(service.indexOf("function isOverlayHost") === -1, "no QML-only isOverlayHost copy")
  check(service.indexOf("function isNotificationCard") === -1, "no QML-only isNotificationCard copy")
  check(service.indexOf("function isHost") === -1, "no QML-only isHost copy")
  check(service.indexOf("function isChromeCard") === -1, "no QML-only isChromeCard copy")
  check(service.indexOf("function hostShowing") === -1, "no QML-only hostShowing copy")
  check(service.indexOf("function hideStock") === -1, "Service does not hideStock")
  check(service.indexOf("function restoreStock") === -1, "Service does not restoreStock")
  check(!/card\.borderSpec\s*=/.test(service), "Service never JS-assigns card.borderSpec")
  check(!/card\.clip\s*=/.test(service), "Service never JS-assigns card.clip")

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
    ensureProc.indexOf("onStreamFinished") !== -1 &&
      ensureProc.indexOf("EnsureStatus.isEnsureSuccessStatus") !== -1,
    "ensureProc collector still keys ready on success STATUS= only"
  )
}

checkWrapSource()
checkEnsureStatusReady()
checkGlowCoverage()
checkOverlayAttach()
checkOverlayAttachWiring()

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok")
