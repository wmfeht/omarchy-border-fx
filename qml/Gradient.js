.pragma library

// Port of shinyGradientStepCount / shinyGradientResolvePositions /
// shinyGradientResolveCwSide / shinyGradientSample / shinyGradientLobeU
// from hypr-shiny-border runtime.cpp. Stops are {r,g,b,a} in 0..1, not
// packed ARGB — QML already has colors. Positions are percent of the
// lit band (0 = facing support, 100 = lobe edge).

var MAX_STEPS = 8

function stepCount(configured) {
  var n = Number(configured)
  if (!(n >= 2))
    return 0
  if (n > MAX_STEPS)
    return MAX_STEPS
  return Math.floor(n)
}

function stopPos(i, count) {
  if (!(count >= 2))
    return 0
  var clamped = i
  if (clamped < 0)
    clamped = 0
  if (clamped > count - 1)
    clamped = count - 1
  return clamped / (count - 1)
}

// Full-axis u (0 = facing, 1 = far side) → lit-band u (0 = head, 1 =
// lobe edge). Twin of shinyGradientLobeU / shader uRamp. spread is the
// applied lobe (already pulse-modulated in the shader); values below
// 0.04 floor like max(range, 0.04).
function lobeU(uAxis, spread) {
  var u = Number(uAxis) || 0
  if (u < 0)
    u = 0
  if (u > 1)
    u = 1
  var d0 = u * 0.5
  var s = Number(spread)
  if (!(s >= 0.04))
    s = 0.04
  var x = d0 / s
  if (x < 0)
    x = 0
  if (x > 1)
    x = 1
  return x
}

function evenPositions(count) {
  var pos = []
  for (var i = 0; i < MAX_STEPS; i++)
    pos.push(stopPos(i, count))
  return pos
}

function scanFloat(s, i) {
  var n = s.length
  var start = i
  if (i < n && (s.charAt(i) === "+" || s.charAt(i) === "-"))
    i++
  var saw = false
  while (i < n && s.charAt(i) >= "0" && s.charAt(i) <= "9") {
    saw = true
    i++
  }
  if (i < n && s.charAt(i) === ".") {
    i++
    while (i < n && s.charAt(i) >= "0" && s.charAt(i) <= "9") {
      saw = true
      i++
    }
  }
  if (!saw)
    return start
  if (i < n && (s.charAt(i) === "e" || s.charAt(i) === "E")) {
    var e = i + 1
    if (e < n && (s.charAt(e) === "+" || s.charAt(e) === "-"))
      e++
    var ed = false
    while (e < n && s.charAt(e) >= "0" && s.charAt(e) <= "9") {
      ed = true
      e++
    }
    if (ed)
      i = e
  }
  return i
}

// Always fills pos[0..MAX_STEPS-1] with even spacing first, then the
// custom spec on top when it is usable. custom is true only when the
// spec applied. Empty / count mismatch / junk → even spacing.
function resolvePositions(spec, count) {
  var pos = evenPositions(count)
  if (spec === null || spec === undefined || count < 2 || count > MAX_STEPS)
    return { custom: false, pos: pos }

  var s = String(spec)
  var parsed = []
  var i = 0
  while (i < s.length) {
    var ch = s.charAt(i)
    if (ch === " " || ch === "\t" || ch === ",") {
      i++
      continue
    }
    var start = i
    var end = scanFloat(s, i)
    if (end === i)
      return { custom: false, pos: pos }
    i = end
    if (i < s.length && s.charAt(i) === "%")
      i++
    if (i < s.length) {
      var nch = s.charAt(i)
      if (nch !== " " && nch !== "\t" && nch !== ",")
        return { custom: false, pos: pos }
    }
    if (parsed.length >= count)
      return { custom: false, pos: pos }
    var v = Number(s.slice(start, end))
    if (v < 0)
      v = 0
    if (v > 100)
      v = 100
    parsed.push(v / 100)
  }
  if (parsed.length !== count)
    return { custom: false, pos: pos }

  for (var j = 1; j < parsed.length; j++) {
    if (parsed[j] < parsed[j - 1])
      parsed[j] = parsed[j - 1]
  }
  for (var k = 0; k < parsed.length; k++)
    pos[k] = parsed[k]
  return { custom: true, pos: pos }
}

function toRgba(c) {
  if (c === null || c === undefined)
    return { r: 0, g: 0, b: 0, a: 1 }
  if (typeof c === "object" && c.r !== undefined)
    return {
      r: Number(c.r) || 0,
      g: Number(c.g) || 0,
      b: Number(c.b) || 0,
      a: c.a === undefined || c.a === null ? 1 : Number(c.a) || 0
    }
  if (typeof Qt !== "undefined" && Qt.color) {
    var q = Qt.color(c)
    if (q && q.r !== undefined)
      return { r: q.r, g: q.g, b: q.b, a: q.a === undefined ? 1 : q.a }
  }
  return { r: 0, g: 0, b: 0, a: 1 }
}

function normalizeStops(list) {
  var out = []
  if (!list || !list.length)
    return out
  for (var i = 0; i < list.length && out.length < MAX_STEPS; i++)
    out.push(toRgba(list[i]))
  return out
}

function padStops(stops, count) {
  var out = []
  var n = count < 0 ? 0 : count
  if (n > MAX_STEPS)
    n = MAX_STEPS
  for (var i = 0; i < MAX_STEPS; i++)
    out.push(i < n && stops[i] ? toRgba(stops[i]) : { r: 0, g: 0, b: 0, a: 0 })
  return out
}

// Clockwise-half override, same rules as shinyGradientResolveCwSide:
//   primary ramp off (count < 2) → count 0, cw config ignored
//   cw colors usable (>= 2) → they replace the primary colors; empty /
//     invalid pos spec is even spacing (not the primary positions)
//   cw colors unset → inherit primary colors; pos spec alone can reshape;
//     empty / invalid spec is an exact mirror of the primary positions
function resolveCwSide(primaryStops, primaryPos, primaryCount, cwColors, cwPosSpec) {
  var out = { stops: padStops([], 0), pos: evenPositions(0), count: 0 }
  if (primaryCount < 2 || primaryCount > MAX_STEPS)
    return out

  var ownCount = stepCount(cwColors && cwColors.length ? cwColors.length : 0)
  if (ownCount >= 2) {
    out.count = ownCount
    out.stops = padStops(cwColors, ownCount)
    out.pos = resolvePositions(cwPosSpec, ownCount).pos
    return out
  }

  out.count = primaryCount
  out.stops = padStops(primaryStops, primaryCount)
  var resolved = resolvePositions(cwPosSpec, primaryCount)
  if (!resolved.custom) {
    var mirrored = []
    for (var i = 0; i < MAX_STEPS; i++)
      mirrored.push(primaryPos && primaryPos[i] !== undefined ? primaryPos[i] : 0)
    out.pos = mirrored
  } else {
    out.pos = resolved.pos
  }
  return out
}

function sample(stops, pos, count, u) {
  var rgba = { r: 0, g: 0, b: 0, a: 0 }
  if (!stops || count <= 0)
    return rgba
  rgba = {
    r: Number(stops[0].r) || 0,
    g: Number(stops[0].g) || 0,
    b: Number(stops[0].b) || 0,
    a: stops[0].a === undefined ? 1 : Number(stops[0].a) || 0
  }
  if (count < 2)
    return rgba
  var n = count > MAX_STEPS ? MAX_STEPS : count
  var x = u
  if (x < 0)
    x = 0
  if (x > 1)
    x = 1
  for (var i = 1; i < n; i++) {
    var t0 = pos ? pos[i - 1] : stopPos(i - 1, n)
    var t1 = pos ? pos[i] : stopPos(i, n)
    var den = t1 - t0
    if (den < 1e-4)
      den = 1e-4
    var w = (x - t0) / den
    if (w < 0)
      w = 0
    if (w > 1)
      w = 1
    var next = stops[i]
    rgba.r = rgba.r + (next.r - rgba.r) * w
    rgba.g = rgba.g + (next.g - rgba.g) * w
    rgba.b = rgba.b + (next.b - rgba.b) * w
    var na = next.a === undefined ? 1 : next.a
    rgba.a = rgba.a + (na - rgba.a) * w
  }
  return rgba
}

// Row-major args for Qt.matrix4x4 so GLSL column i is stop start+i.
function packColorMat4Args(stops, start) {
  var r = [0, 0, 0, 0]
  var g = [0, 0, 0, 0]
  var b = [0, 0, 0, 0]
  var a = [0, 0, 0, 0]
  for (var i = 0; i < 4; i++) {
    var s = stops && stops[start + i]
    if (!s)
      continue
    r[i] = s.r
    g[i] = s.g
    b[i] = s.b
    a[i] = s.a === undefined ? 1 : s.a
  }
  return r.concat(g, b, a)
}

function packPos4(pos, start) {
  function at(i) {
    if (!pos || pos[i] === undefined || pos[i] === null)
      return 0
    return Number(pos[i]) || 0
  }
  return [at(start), at(start + 1), at(start + 2), at(start + 3)]
}
