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

function checkTickMs() {
  check(Shimmer.tickMs(0.4) > 0, "tick > 0")
  check(Shimmer.tickMs(0.4) < 1000 / 0.4, "tick < cycle")
  check(Shimmer.tickMs(0.3) === 50, "slow shimmer clamps to 50")
  check(Shimmer.tickMs(4) > 0 && Shimmer.tickMs(4) < 1000 / 4, "fast tick")
  check(Shimmer.tickMs(0) === 16, "hz 0 → min")
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

checkPinnedHeading()
checkTickMs()
checkShimmer()
checkGradient()
checkGradientPositions()
checkGradientCwSide()
checkLightProjection()

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok")
