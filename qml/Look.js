.pragma library

// Shared look: shell.json camelCase + Hyprland rgba() on the qs.border-fx
// plugins[] entry is the source of truth. `effect` selects the renderer
// (`shiny` today). Missing look keys mean the intended shared look
// (looknfeel / ShinyBorder defaults), not the C++ plugin defaults
// (pulse on, pinDeg 90, border 3).

var PLUGIN_ID = "qs.border-fx"
var LEGACY_PLUGIN_ID = "qs.shiny-border"
var DEFAULT_EFFECT = "shiny"

var DEFAULTS = {
  effect: "shiny",
  borderSize: 2,
  shimmer: true,
  shimmerHz: 0.3,
  shimmerDeg: 20,
  shimmerScaleMin: 0.75,
  shimmerScaleMax: 1.35,
  pinDeg: 120,
  angleOffset: 0,
  lobe: 0.18,
  mirrorLobe: false,
  gradient: [
    "rgba(33ccffee)",
    "rgba(1ad4c0ee)",
    "rgba(007a48ee)",
    "rgba(004830aa)"
  ],
  gradientPositions: "0 1 3 100",
  gradientCw: [],
  gradientPositionsCw: "0 22 50 100",
  colA: "rgba(33ccffee)",
  colB: "rgba(00ff99ee)",
  baseColor: "rgba(00687855)",
  activeOnly: true,
  pulse: false,
  pulseHz: 0.4
}

function cloneValue(v) {
  if (Array.isArray(v)) {
    var a = []
    for (var i = 0; i < v.length; i++)
      a.push(v[i])
    return a
  }
  return v
}

function asColorList(v) {
  if (!v)
    return []
  if (Array.isArray(v))
    return v
  if (typeof v === "object" && v.colors && Array.isArray(v.colors))
    return v.colors
  return []
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function normalizeEffect(value) {
  if (value === undefined || value === null || value === "")
    return DEFAULT_EFFECT
  return String(value)
}

function pickLookFields(src) {
  var out = {}
  if (!isPlainObject(src))
    return out
  for (var k in DEFAULTS) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k))
      continue
    if (k === "effect")
      continue
    if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined && src[k] !== null)
      out[k] = src[k]
  }
  return out
}

function entryFromConfig(config, id) {
  var want = id || PLUGIN_ID
  if (!config || !config.plugins || !config.plugins.length)
    return {}
  var legacy = null
  for (var i = 0; i < config.plugins.length; i++) {
    var e = config.plugins[i]
    if (!e)
      continue
    if (e.id === want)
      return e
    if (e.id === LEGACY_PLUGIN_ID)
      legacy = e
  }
  if (want === PLUGIN_ID && legacy)
    return legacy
  return {}
}

function merge(entry) {
  var src = isPlainObject(entry) ? entry : {}
  var effect = normalizeEffect(src.effect)
  var picked = pickLookFields(src)
  var nested = src[effect]
  if (isPlainObject(nested)) {
    var overlay = pickLookFields(nested)
    for (var n in overlay) {
      if (Object.prototype.hasOwnProperty.call(overlay, n))
        picked[n] = overlay[n]
    }
  }
  var out = { effect: effect }
  for (var k in DEFAULTS) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k))
      continue
    if (k === "effect")
      continue
    if (Object.prototype.hasOwnProperty.call(picked, k))
      out[k] = picked[k]
    else
      out[k] = cloneValue(DEFAULTS[k])
  }
  out.gradient = asColorList(out.gradient)
  out.gradientCw = asColorList(out.gradientCw)
  if (typeof out.gradientPositions !== "string")
    out.gradientPositions = String(out.gradientPositions || "")
  if (typeof out.gradientPositionsCw !== "string")
    out.gradientPositionsCw = String(out.gradientPositionsCw || "")
  return out
}

function hex2(n) {
  var v = Math.round(Number(n) || 0)
  if (v < 0)
    v = 0
  if (v > 255)
    v = 255
  var h = v.toString(16)
  return h.length < 2 ? "0" + h : h
}

function parseHyprColor(s) {
  if (s === null || s === undefined)
    return null
  if (typeof s === "object" && s.r !== undefined) {
    return {
      r: Number(s.r) || 0,
      g: Number(s.g) || 0,
      b: Number(s.b) || 0,
      a: s.a === undefined || s.a === null ? 1 : Number(s.a) || 0
    }
  }
  var str = String(s).trim()
  var m = /^rgba?\(\s*([0-9a-fA-F]{6,8})\s*\)$/.exec(str)
  if (m) {
    var hex = m[1]
    if (hex.length === 6)
      hex += "ff"
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: parseInt(hex.slice(6, 8), 16) / 255
    }
  }
  var h8 = /^#([0-9a-fA-F]{8})$/.exec(str)
  if (h8) {
    var x = h8[1]
    return {
      a: parseInt(x.slice(0, 2), 16) / 255,
      r: parseInt(x.slice(2, 4), 16) / 255,
      g: parseInt(x.slice(4, 6), 16) / 255,
      b: parseInt(x.slice(6, 8), 16) / 255
    }
  }
  var h6 = /^#([0-9a-fA-F]{6})$/.exec(str)
  if (h6) {
    var y = h6[1]
    return {
      a: 1,
      r: parseInt(y.slice(0, 2), 16) / 255,
      g: parseInt(y.slice(2, 4), 16) / 255,
      b: parseInt(y.slice(4, 6), 16) / 255
    }
  }
  return null
}

function toQtColor(s) {
  var c = parseHyprColor(s)
  if (!c)
    return "#00000000"
  return "#" + hex2(c.a * 255) + hex2(c.r * 255) + hex2(c.g * 255) + hex2(c.b * 255)
}

function toHyprRgba(s) {
  var c = parseHyprColor(s)
  if (!c)
    return "rgba(00000000)"
  return "rgba(" + hex2(c.r * 255) + hex2(c.g * 255) + hex2(c.b * 255) + hex2(c.a * 255) + ")"
}

function toQtColorList(list) {
  var src = asColorList(list)
  var out = []
  for (var i = 0; i < src.length; i++)
    out.push(toQtColor(src[i]))
  return out
}

function toHyprRgbaList(list) {
  var src = asColorList(list)
  var out = []
  for (var i = 0; i < src.length; i++)
    out.push(toHyprRgba(src[i]))
  return out
}
