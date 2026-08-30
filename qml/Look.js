.pragma library

// Shared look: shell.json camelCase + Hyprland rgba() on the wmfeht.border-fx
// plugins[] entry is the source of truth. `effect` selects the renderer
// (`shiny` or `ripple`). Missing look keys mean DEFAULTS below (pinned 120°,
// shimmer, 2-stop light glint, wrap stroke). PLUGIN_INIT registers the same
// numbers so first paint matches chrome.

var PLUGIN_ID = "wmfeht.border-fx"
var LEGACY_PLUGIN_ID = "qs.border-fx"
var OLDER_LEGACY_PLUGIN_ID = "qs.shiny-border"
var DEFAULT_EFFECT = "shiny"

var DEFAULTS = {
  effect: "shiny",
  borderSize: 2,
  shimmer: true,
  shimmerHz: 0.28,
  shimmerDeg: 22,
  shimmerScaleMin: 0.8,
  shimmerScaleMax: 1.4,
  pinDeg: 120,
  angleOffset: 0,
  lobe: 0.16,
  mirror: true,
  gradient: [
    "rgba(f7ffffee)",
    "rgba(0a3f4700)"
  ],
  gradientPositions: "0 99",
  gradientCw: [],
  gradientPositionsCw: "0 22 50 100",
  colA: "rgba(f7ffffee)",
  colB: "rgba(0a3f4700)",
  baseColor: "rgba(0a3f47dd)",
  activeOnly: true,
  pulse: false,
  pulseHz: 0.4,
  rippleFreq: 0.025,
  rippleSpeed: 2,
  rippleGain: 0.85,
  ripplePower: 8,
  rippleOriginX: 0.5,
  rippleOriginY: 0.5,
  rippleFade: 0,
  specularHalo: false
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

// Chrome overlay + window plugin load. Empty/omitted is shiny.
function effectDraws(value) {
  var e = normalizeEffect(value)
  return e === "shiny" || e === "ripple"
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

// Hyprland CIntValue / CFloatValue ranges. Applied in merge so chrome and
// look-apply emit the same numbers. borderSize < 0 is illegal in the look
// document (keep default) — not a chrome-hide / follow-stock sentinel.
var BOOL_KEYS = {
  shimmer: true,
  mirror: true,
  activeOnly: true,
  pulse: true,
  specularHalo: true
}
var INT_RANGE = {
  borderSize: { min: 0, max: 20 },
  pinDeg: { min: -360, max: 360 },
  angleOffset: { min: -180, max: 180 },
  shimmerDeg: { min: 0, max: 180 }
}
var FLOAT_RANGE = {
  shimmerHz: { min: 0, max: 4 },
  pulseHz: { min: 0, max: 4 },
  shimmerScaleMin: { min: 0.2, max: 3 },
  shimmerScaleMax: { min: 0.2, max: 3 },
  lobe: { min: 0.04, max: 0.5 },
  rippleFreq: { min: 0.001, max: 0.2 },
  rippleSpeed: { min: 0, max: 40 },
  rippleGain: { min: 0, max: 2 },
  ripplePower: { min: 1, max: 16 },
  rippleOriginX: { min: 0, max: 1 },
  rippleOriginY: { min: 0, max: 1 },
  rippleFade: { min: 0, max: 1 }
}

function warnLook(key, why) {
  console.warn("look: " + key + ": " + why + ", keeping default")
}

function coerceBool(v) {
  if (v === true || v === false)
    return v
  if (v === 1 || v === 0)
    return v === 1
  return null
}

function coerceFiniteNumber(v) {
  if (typeof v === "boolean")
    return null
  if (typeof v !== "number" || !isFinite(v))
    return null
  return v
}

function clampNum(n, lo, hi) {
  if (n < lo)
    return lo
  if (n > hi)
    return hi
  return n
}

function coerceKey(key, value, fallback) {
  if (BOOL_KEYS[key]) {
    var b = coerceBool(value)
    if (b === null) {
      warnLook(key, "invalid bool")
      return fallback
    }
    return b
  }
  if (INT_RANGE[key]) {
    var ni = coerceFiniteNumber(value)
    if (ni === null) {
      warnLook(key, "invalid number")
      return fallback
    }
    var i = Math.round(ni)
    if (key === "borderSize" && i < 0) {
      warnLook(key, "illegal negative")
      return fallback
    }
    return clampNum(i, INT_RANGE[key].min, INT_RANGE[key].max)
  }
  if (FLOAT_RANGE[key]) {
    var nf = coerceFiniteNumber(value)
    if (nf === null) {
      warnLook(key, "invalid number")
      return fallback
    }
    return clampNum(nf, FLOAT_RANGE[key].min, FLOAT_RANGE[key].max)
  }
  return value
}

function entryFromConfig(config, id) {
  var want = id || PLUGIN_ID
  if (!config || !config.plugins || !config.plugins.length)
    return {}
  var legacy = null
  var older = null
  for (var i = 0; i < config.plugins.length; i++) {
    var e = config.plugins[i]
    if (!e)
      continue
    if (e.id === want)
      return e
    if (e.id === LEGACY_PLUGIN_ID)
      legacy = e
    else if (e.id === OLDER_LEGACY_PLUGIN_ID)
      older = e
  }
  if (want === PLUGIN_ID) {
    if (legacy)
      return legacy
    if (older)
      return older
  }
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
      out[k] = coerceKey(k, picked[k], cloneValue(DEFAULTS[k]))
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
  var m = /^rgba?\(\s*([0-9a-fA-F]{6}|[0-9a-fA-F]{8})\s*\)$/.exec(str)
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
