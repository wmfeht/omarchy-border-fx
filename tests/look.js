#!/usr/bin/env node
// Compositor-free tests for the shared look adapter (JSON ↔ QML ↔ Lua).
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
  const warnings = []
  const ctx = {
    Math, Number, String, Object, Array, parseInt, isFinite,
    console: {
      log: function () { console.log.apply(console, arguments) },
      warn: function () {
        warnings.push(Array.prototype.slice.call(arguments).join(" "))
        console.warn.apply(console, arguments)
      },
      error: function () { console.error.apply(console, arguments) }
    }
  }
  vm.createContext(ctx)
  vm.runInContext(src, ctx, { filename: file })
  ctx._warnings = warnings
  return ctx
}

function takeWarnings() {
  const w = Look._warnings.slice()
  Look._warnings.length = 0
  return w
}

function lookApplyEnv() {
  return Object.assign({}, process.env, {
    SESSION_SO: "/tmp/omarchy-border-fx-test.so",
    LUA_FILE: "/tmp/omarchy-border-fx-test.lua"
  })
}

function lookApply(lookJson) {
  const script = path.join(root, "scripts/look-apply.sh")
  const raw = typeof lookJson === "string" ? lookJson : JSON.stringify(lookJson)
  return spawnSync("bash", [script, "--stdout", "--look-json", raw], {
    encoding: "utf8",
    env: lookApplyEnv()
  })
}

function luaAssign(lua, key) {
  const m = new RegExp("\\b" + key + "\\s*=\\s*([^,\\n]+)").exec(lua)
  return m ? m[1].trim() : null
}

function warnedKey(warnings, key) {
  return warnings.some(function (w) { return w.indexOf("look: " + key + ":") !== -1 })
}

function check(cond, msg) {
  if (!cond) {
    fails++
    console.error("FAIL " + msg)
  }
}

const Look = loadPragmaLibrary("qml/Look.js")

function checkDefaults() {
  check(Look.PLUGIN_ID === "wmfeht.border-fx", "plugin id")
  check(Look.LEGACY_PLUGIN_ID === "qs.border-fx", "legacy id")
  check(Look.OLDER_LEGACY_PLUGIN_ID === "qs.shiny-border", "older legacy id")
  check(Look.DEFAULT_EFFECT === "shiny", "default effect")
  const d = Look.merge(null)
  check(d.effect === "shiny", "merge default effect shiny")
  check(d.borderSize === 2, "default borderSize 2")
  check(!Object.prototype.hasOwnProperty.call(d, "pin"), "pin is not a look key")
  check(!Object.prototype.hasOwnProperty.call(Look.DEFAULTS, "pin"), "DEFAULTS has no pin switch")
  check(!Object.prototype.hasOwnProperty.call(Look.DEFAULTS, "quantizeDeg"), "DEFAULTS has no mouse quantize")
  check(d.pinDeg === 120, "default pinDeg 120")
  check(d.shimmer === true, "default shimmer")
  check(d.pulse === false, "default pulse off")
  check(d.mirror === false, "default mirror off")
  check(Look.merge({}).mirror === false, "empty {} look keeps mirror off")
  check(d.gradient.length === 4, "default 4-stop ramp")
  check(d.gradient[0] === "rgba(33ccffee)", "head rgba")
  check(d.gradientPositions === "0 1 3 100", "positions")
  check(d.baseColor === "rgba(00687855)", "default baseColor")
  check(d.activeOnly === true, "hypr-only activeOnly")
}

function checkMerge() {
  const e = Look.merge({ id: "wmfeht.border-fx", pinDeg: 90, borderSize: 1 })
  check(e.pinDeg === 90, "override pinDeg")
  check(e.borderSize === 1, "override borderSize")
  check(e.shimmer === true, "unmentioned key stays default")
  check(e.mirror === false, "unmentioned mirror stays default off")
  check(e.effect === "shiny", "effect stays default")

  const pulseOn = Look.merge({ pulse: true, pulseHz: 1.25, shimmer: false })
  check(pulseOn.pulse === true, "override pulse true")
  check(pulseOn.pulseHz === 1.25, "override pulseHz")
  check(pulseOn.shimmer === false, "pulse recipe can freeze shimmer")

  const mirrorOn = Look.merge({ mirror: true })
  check(mirrorOn.mirror === true, "override mirror true")

  const nestedMirror = Look.merge({ mirror: false, shiny: { mirror: true } })
  check(nestedMirror.mirror === true, "nested shiny.mirror wins")
  check(e.id === undefined, "id is not a look key")

  const emptyRamp = Look.merge({ gradient: [] })
  check(Array.isArray(emptyRamp.gradient) && emptyRamp.gradient.length === 0, "empty gradient is a real override")

  const objRamp = Look.merge({ gradient: { colors: ["rgba(ff0000ff)", "rgba(00ff00ff)"] } })
  check(objRamp.gradient.length === 2 && objRamp.gradient[0] === "rgba(ff0000ff)", "hypr-style {colors}")

  const nested = Look.merge({ pinDeg: 0, shiny: { pinDeg: 45, borderSize: 4 } })
  check(nested.effect === "shiny", "nested keeps effect shiny")
  check(nested.pinDeg === 45, "nested shiny.pinDeg wins over top-level")
  check(nested.borderSize === 4, "nested shiny.borderSize")

  const other = Look.merge({ effect: "other", pinDeg: 10 })
  check(other.effect === "other", "unknown effect is preserved")
  check(other.pinDeg === 10, "look keys still merge when effect is not shiny")

  const leftoverPin = Look.merge({ pin: false, pinDeg: 90, quantizeDeg: 15 })
  check(!Object.prototype.hasOwnProperty.call(leftoverPin, "pin"), "leftover pin:false is not a look key")
  check(leftoverPin.pin !== false, "leftover pin:false does not restore mouse follow")
  check(!Object.prototype.hasOwnProperty.call(leftoverPin, "quantizeDeg"), "leftover quantizeDeg is ignored")
  check(leftoverPin.pinDeg === 90, "pinDeg still merges when leftover pin is present")
}

function checkEntry() {
  const cfg = {
    plugins: [
      { id: "other.thing", pinDeg: 0 },
      { id: "wmfeht.border-fx", pinDeg: 45, shimmer: false, effect: "shiny" }
    ]
  }
  const e = Look.entryFromConfig(cfg)
  check(e.pinDeg === 45 && e.shimmer === false, "entryFromConfig picks wmfeht.border-fx")
  check(Look.entryFromConfig({ plugins: [] }).id === undefined, "missing entry is empty")
  check(Object.keys(Look.entryFromConfig(null)).length === 0, "null config")

  const legacy = {
    plugins: [{ id: "qs.border-fx", pinDeg: 30 }]
  }
  check(Look.entryFromConfig(legacy).pinDeg === 30, "falls back to qs.border-fx")
  const older = {
    plugins: [{ id: "qs.shiny-border", pinDeg: 30 }]
  }
  check(Look.entryFromConfig(older).pinDeg === 30, "falls back to qs.shiny-border")
  const bothLegacy = {
    plugins: [
      { id: "qs.shiny-border", pinDeg: 1 },
      { id: "qs.border-fx", pinDeg: 2 }
    ]
  }
  check(Look.entryFromConfig(bothLegacy).pinDeg === 2, "qs.border-fx wins over older legacy")
  const both = {
    plugins: [
      { id: "qs.border-fx", pinDeg: 1 },
      { id: "wmfeht.border-fx", pinDeg: 2 }
    ]
  }
  check(Look.entryFromConfig(both).pinDeg === 2, "wmfeht.border-fx wins over legacy")
}

function checkColors() {
  check(Look.toQtColor("rgba(33ccffee)") === "#ee33ccff", "rgba → Qt #AARRGGBB")
  check(Look.toHyprRgba("#ee33ccff") === "rgba(33ccffee)", "Qt → rgba")
  check(Look.toHyprRgba("rgba(33ccffee)") === "rgba(33ccffee)", "rgba identity")
  check(Look.toQtColor("#ee33ccff") === "#ee33ccff", "Qt identity")
  check(Look.toQtColor("rgb(007a48)") === "#ff007a48", "rgb() assumes ff alpha")
  check(Look.toHyprRgba("#55006878") === "rgba(00687855)", "baseColor round-trip")
  const qt = Look.toQtColorList(["rgba(33ccffee)", "rgba(1ad4c0ee)"])
  check(qt[0] === "#ee33ccff" && qt[1] === "#ee1ad4c0", "list to Qt")
  check(Look.toQtColor("nope") === "#00000000", "junk → transparent")
  check(Look.toQtColor("rgba(33ccffe)") === "#00000000", "7-digit rgba is junk/transparent")
  check(Look.toHyprRgba("rgba(33ccffe)") === "rgba(00000000)", "7-digit rgba → hypr transparent")
  check(Look.toQtColor("rgb(33ccffe)") === "#00000000", "7-digit rgb is junk/transparent")
  check(Look.toQtColor("rgba(33ccff)") === "#ff33ccff", "6-digit rgba still parses (opaque)")
  check(Look.toHyprRgba("rgba(33ccff)") === "rgba(33ccffff)", "6-digit rgba gains ff alpha")
  check(Look.toQtColor("rgba(33ccffee)") === "#ee33ccff", "8-digit rgba still parses")
  check(Look.toHyprRgba("rgba(33ccffe0)") === "rgba(33ccffe0)", "8-digit rgba identity")
  check(Look.toQtColor("rgba(33ccffee0)") === "#00000000", "9-digit rgba is junk")
}

function checkLookApply() {
  const script = path.join(root, "scripts/look-apply.sh")
  const env = lookApplyEnv()
  const r = spawnSync("bash", [script, "--stdout", "--look-json", "{}"], {
    encoding: "utf8",
    env: env
  })
  check(r.status === 0, "look-apply --stdout exits 0: " + (r.stderr || ""))
  const lua = r.stdout || ""
  check(lua.indexOf("wmfeht.border-fx") !== -1, "lua cites wmfeht.border-fx as source of truth")
  check(lua.indexOf("shiny_border") !== -1, "emits shiny_border Hyprland adapter table")
  check(/border_size\s*=\s*2/.test(lua), "lua border_size = 2")
  check(/pin_deg\s*=\s*120/.test(lua), "lua pin_deg = 120")
  check(!/\bpin\s*=/.test(lua), "lua does not emit pin as a mouse-follow switch")
  check(!/quantize_deg/.test(lua), "lua does not emit mouse-heading quantize_deg")
  check(!/mouse/.test(lua), "generated lua does not mention mouse")
  check(!/cursor/.test(lua), "generated lua does not mention cursor")
  check(/pulse\s*=\s*false/.test(lua), "lua pulse = false")
  check(/shimmer\s*=\s*true/.test(lua), "lua shimmer = true")
  check(/mirror\s*=\s*false/.test(lua), "lua mirror = false")
  check(lua.indexOf("rgba(33ccffee)") !== -1, "lua keeps hypr rgba")
  check(/base_color\s*=\s*"rgba\(00687855\)"/.test(lua), "lua includes Hyprland adapter base_color")
  check(lua.indexOf("hl.plugin.load") !== -1, "login load of session .so")
  check(lua.indexOf("hyprland.start") !== -1, "load on hyprland.start, not during parse")
  check(lua.indexOf("__qs_border_fx_start") !== -1, "start guard uses border-fx name")
  check(lua.indexOf("shinyLoaded") !== -1, "gated on loaded plugins")
  check(lua.indexOf("/tmp/omarchy-border-fx-test.so") !== -1, "session so path")

  const off = spawnSync("bash", [script, "--stdout", "--disabled", "--look-json", "{}"], {
    encoding: "utf8",
    env: env
  })
  check(off.status === 0, "look-apply --disabled exits 0")
  check(/SHINY_LOAD = false/.test(off.stdout), "disabled skips plugin.load")
  check(/enabled\s*=\s*false/.test(off.stdout), "disabled sets enabled = false")

  const custom = spawnSync(
    "bash",
    [script, "--stdout", "--look-json", JSON.stringify({ pinDeg: 0, borderSize: 1, gradient: [] })],
    { encoding: "utf8", env: env }
  )
  check(custom.status === 0, "custom look-apply")
  check(/pin_deg\s*=\s*0/.test(custom.stdout), "custom pin_deg")
  check(!/\bpin\s*=/.test(custom.stdout), "custom look still has no pin switch")
  check(/border_size\s*=\s*1/.test(custom.stdout), "custom border_size")

  const leftoverLua = spawnSync(
    "bash",
    [script, "--stdout", "--look-json", JSON.stringify({ pin: false, quantizeDeg: 15, pinDeg: 45 })],
    { encoding: "utf8", env: env }
  )
  check(leftoverLua.status === 0, "leftover pin:false look-apply")
  check(/pin_deg\s*=\s*45/.test(leftoverLua.stdout), "leftover pin:false still fans out pinDeg")
  check(!/\bpin\s*=/.test(leftoverLua.stdout), "leftover pin:false does not emit pin lua")
  check(!/quantize_deg/.test(leftoverLua.stdout), "leftover quantizeDeg does not fan out")

  const customBase = spawnSync(
    "bash",
    [script, "--stdout", "--look-json", JSON.stringify({ baseColor: "rgba(ff000080)" })],
    { encoding: "utf8", env: env }
  )
  check(customBase.status === 0, "custom baseColor look-apply")
  check(/base_color\s*=\s*"rgba\(ff000080\)"/.test(customBase.stdout), "custom baseColor fans out")

  const transBase = spawnSync(
    "bash",
    [script, "--stdout", "--look-json", JSON.stringify({ baseColor: "rgba(00000000)" })],
    { encoding: "utf8", env: env }
  )
  check(transBase.status === 0, "transparent baseColor look-apply")
  check(/base_color\s*=\s*"rgba\(00000000\)"/.test(transBase.stdout), "transparent baseColor is accepted as off")

  const nestedLua = spawnSync(
    "bash",
    [script, "--stdout", "--look-json", JSON.stringify({ pinDeg: 0, shiny: { pinDeg: 77 } })],
    { encoding: "utf8", env: env }
  )
  check(nestedLua.status === 0, "nested look-apply")
  check(/pin_deg\s*=\s*77/.test(nestedLua.stdout), "nested shiny.pinDeg fans out")

  const mirrorLua = spawnSync(
    "bash",
    [script, "--stdout", "--look-json", JSON.stringify({ mirror: true })],
    { encoding: "utf8", env: env }
  )
  check(mirrorLua.status === 0, "mirror look-apply")
  check(/mirror\s*=\s*true/.test(mirrorLua.stdout), "mirror fans out true")

  const nestedMirrorLua = spawnSync(
    "bash",
    [script, "--stdout", "--look-json", JSON.stringify({ mirror: false, shiny: { mirror: true } })],
    { encoding: "utf8", env: env }
  )
  check(nestedMirrorLua.status === 0, "nested shiny.mirror look-apply")
  check(/mirror\s*=\s*true/.test(nestedMirrorLua.stdout), "nested shiny.mirror fans out")

  const otherFx = spawnSync(
    "bash",
    [script, "--stdout", "--look-json", JSON.stringify({ effect: "other" })],
    { encoding: "utf8", env: env }
  )
  check(otherFx.status === 0, "non-shiny effect look-apply")
  check(/SHINY_LOAD = false/.test(otherFx.stdout), "non-shiny effect skips shiny plugin.load")
  check(/enabled\s*=\s*false/.test(otherFx.stdout), "non-shiny effect disables shiny adapter")
}

function pluginInitSection(src) {
  const a = src.indexOf("PLUGIN_DESCRIPTION_INFO PLUGIN_INIT")
  const b = src.indexOf("APICALL EXPORT void PLUGIN_EXIT")
  if (a < 0 || b < 0 || b <= a)
    return ""
  return src.slice(a, b)
}

function skipCppString(s, i) {
  if (s[i] !== '"')
    return i
  i++
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2
      continue
    }
    if (s[i] === '"')
      return i + 1
    i++
  }
  return i
}

function hyprCtorDefault(init, key) {
  const needle = '"plugin:shiny-border:' + key + '"'
  const p = init.indexOf(needle)
  if (p < 0)
    return null
  let i = p + needle.length
  while (i < init.length && /[\s,]/.test(init[i]))
    i++
  i = skipCppString(init, i)
  while (i < init.length && /[\s,]/.test(init[i]))
    i++
  if (init[i] === '"') {
    const start = i + 1
    i = skipCppString(init, i)
    return init.slice(start, i - 1).replace(/\\"/g, '"')
  }
  if (init.slice(i, i + 10) === "CHyprColor") {
    const open = init.indexOf("{", i)
    const close = init.indexOf("}", open)
    return init.slice(open + 1, close).trim()
  }
  const m = /^(true|false|0x[0-9a-fA-F]+|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*\[\d+\])/.exec(init.slice(i))
  return m ? m[1] : null
}

function cppU64Array(src, name) {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\[\\]\\s*=\\s*\\{([^}]+)\\}")
  const m = re.exec(src)
  if (!m)
    return null
  return m[1].match(/0x[0-9a-fA-F]+/g)
}

function argbHexFromLookColor(s) {
  const qt = Look.toQtColor(s)
  check(qt && qt.charAt(0) === "#" && qt.length === 9, "Look.toQtColor packed " + s)
  return "0x" + qt.slice(1).toLowerCase()
}

function resolveCtorToken(src, tok) {
  if (!tok)
    return tok
  const m = /^kLookDefaultGradient\[(\d+)\]$/.exec(tok)
  if (!m)
    return tok
  const arr = cppU64Array(src, "kLookDefaultGradient")
  if (!arr)
    return tok
  return arr[Number(m[1])]
}

function sameNumber(a, b) {
  return Number(a) === Number(b)
}

function sameBool(tok, want) {
  return tok === String(want)
}

function sameHex(tok, wantHex) {
  if (!tok || !wantHex)
    return false
  return parseInt(tok, 16) === parseInt(wantHex, 16)
}

function checkPluginInitDefaults() {
  const mainPath = path.join(root, "hypr/src/main.cpp")
  const main = fs.readFileSync(mainPath, "utf8")
  check(main.length > 0, "read shipped hypr/src/main.cpp")
  const init = pluginInitSection(main)
  check(init.length > 0, "PLUGIN_INIT body is present")

  const d = Look.DEFAULTS

  check(sameBool(hyprCtorDefault(init, "pulse"), d.pulse), "PLUGIN_INIT pulse == Look.DEFAULTS.pulse")
  check(sameBool(hyprCtorDefault(init, "shimmer"), d.shimmer), "PLUGIN_INIT shimmer == Look.DEFAULTS.shimmer")
  check(sameBool(hyprCtorDefault(init, "mirror"), d.mirror), "PLUGIN_INIT mirror == Look.DEFAULTS.mirror")
  check(sameBool(hyprCtorDefault(init, "active_only"), d.activeOnly), "PLUGIN_INIT active_only == Look.DEFAULTS.activeOnly")

  check(sameNumber(hyprCtorDefault(init, "pin_deg"), d.pinDeg), "PLUGIN_INIT pin_deg == Look.DEFAULTS.pinDeg")
  check(sameNumber(hyprCtorDefault(init, "border_size"), d.borderSize), "PLUGIN_INIT border_size == Look.DEFAULTS.borderSize")
  check(sameNumber(hyprCtorDefault(init, "shimmer_deg"), d.shimmerDeg), "PLUGIN_INIT shimmer_deg == Look.DEFAULTS.shimmerDeg")
  check(sameNumber(hyprCtorDefault(init, "angle_offset"), d.angleOffset), "PLUGIN_INIT angle_offset == Look.DEFAULTS.angleOffset")
  check(sameNumber(hyprCtorDefault(init, "shimmer_hz"), d.shimmerHz), "PLUGIN_INIT shimmer_hz == Look.DEFAULTS.shimmerHz")
  check(sameNumber(hyprCtorDefault(init, "pulse_hz"), d.pulseHz), "PLUGIN_INIT pulse_hz == Look.DEFAULTS.pulseHz")
  check(sameNumber(hyprCtorDefault(init, "shimmer_scale_min"), d.shimmerScaleMin), "PLUGIN_INIT shimmer_scale_min == Look.DEFAULTS.shimmerScaleMin")
  check(sameNumber(hyprCtorDefault(init, "shimmer_scale_max"), d.shimmerScaleMax), "PLUGIN_INIT shimmer_scale_max == Look.DEFAULTS.shimmerScaleMax")
  check(sameNumber(hyprCtorDefault(init, "lobe"), d.lobe), "PLUGIN_INIT lobe == Look.DEFAULTS.lobe")

  check(hyprCtorDefault(init, "gradient_positions") === d.gradientPositions,
    "PLUGIN_INIT gradient_positions == Look.DEFAULTS.gradientPositions")
  check(hyprCtorDefault(init, "gradient_positions_cw") === d.gradientPositionsCw,
    "PLUGIN_INIT gradient_positions_cw == Look.DEFAULTS.gradientPositionsCw")

  check(sameHex(hyprCtorDefault(init, "col.a"), argbHexFromLookColor(d.colA)),
    "PLUGIN_INIT col.a ARGB == Look.DEFAULTS.colA")
  check(sameHex(hyprCtorDefault(init, "col.b"), argbHexFromLookColor(d.colB)),
    "PLUGIN_INIT col.b ARGB == Look.DEFAULTS.colB")
  check(sameHex(hyprCtorDefault(init, "base_color"), argbHexFromLookColor(d.baseColor)),
    "PLUGIN_INIT base_color ARGB == Look.DEFAULTS.baseColor")

  const wantStops = Look.asColorList(d.gradient).map(argbHexFromLookColor)
  check(wantStops.length === 4, "Look.DEFAULTS.gradient is four stops")
  const gotStops = cppU64Array(main, "kLookDefaultGradient")
  check(gotStops !== null && gotStops.length === 4, "kLookDefaultGradient is a four-stop list")
  if (gotStops) {
    for (let i = 0; i < 4; i++)
      check(sameHex(gotStops[i], wantStops[i]), "kLookDefaultGradient[" + i + "] == Look.DEFAULTS.gradient[" + i + "]")
  }

  const gradCtor = resolveCtorToken(main, hyprCtorDefault(init, "gradient"))
  check(sameHex(gradCtor, wantStops[0]), "CGradientValue ctor head is Look.DEFAULTS.gradient[0]")

  const applyNeedle = "shinyApplyLookGradientDefault()"
  const applyAt = init.indexOf(applyNeedle)
  const addGrad = init.indexOf("HyprlandAPI::addConfigValueV2(PHANDLE, g_cfg.gradient)")
  const reloadAt = init.indexOf("HyprlandAPI::reloadConfig()")
  const reloadedAt = init.indexOf("config.reloaded.listen")
  const exitBody = main.slice(main.indexOf("APICALL EXPORT void PLUGIN_EXIT"))
  check(main.indexOf("data.m_colors") !== -1, "4-stop seed writes CGradientValueData.m_colors")
  check(main.indexOf("updateColorsOk") !== -1, "4-stop seed calls updateColorsOk")
  check(main.indexOf("shinySeedGradientStops(g_cfg.gradient, kLookDefaultGradient") !== -1,
    "seed writes kLookDefaultGradient onto g_cfg.gradient")
  check(addGrad >= 0 && reloadAt >= 0, "PLUGIN_INIT registers gradient then reloadConfig")
  check(applyAt >= 0 && applyAt < addGrad, "4-stop apply runs before addConfigValueV2")
  check(init.indexOf(applyNeedle, addGrad) >= 0 && init.indexOf(applyNeedle, addGrad) < reloadAt,
    "4-stop apply re-runs after register, before reloadConfig")
  check(reloadedAt >= 0 && reloadedAt > reloadAt,
    "PLUGIN_INIT listens for config.reloaded after scheduling reloadConfig")
  check(/config\.reloaded\.listen\(\s*\[\]\s*\{\s*shinyApplyLookGradientDefault\(\)\s*;\s*\}\s*\)/.test(init),
    "config.reloaded re-seeds kLookDefaultGradient via shinyApplyLookGradientDefault")
  check(main.indexOf("shinyGradientSetByUser") !== -1, "re-seed is gated on whether lua set the key")
  check(main.indexOf('getConfigValue("plugin:shiny-border:gradient")') !== -1,
    "setByUser is read from the live plugin:shiny-border:gradient key")
  check(main.indexOf(".setByUser") !== -1, "user-set gradient is not overwritten")
  check(exitBody.indexOf("g_onConfigReloaded.reset()") !== -1,
    "PLUGIN_EXIT drops the config.reloaded listener")
  check(init.indexOf("shinySeedGradientStops(g_cfg.gradientCw") < 0,
    "gradient_cw is not seeded with the 4-stop ramp")

  const cwCtor = hyprCtorDefault(init, "gradient_cw")
  check(cwCtor !== null, "gradient_cw still has a one-color CGradientValue ctor")
  check(Look.asColorList(d.gradientCw).length < 2, "Look.DEFAULTS.gradientCw is unset (< 2 colors)")
}

function luaHasNoNonConfig(lua) {
  check(!/=\s*inf\b/.test(lua) && !/=\s*nan\b/.test(lua) && !/=\s*Infinity\b/.test(lua),
    "generated lua has no inf/nan identifiers")
  check(/\btrue\b/.test(lua) || /\bfalse\b/.test(lua), "generated lua has bool literals")
}

function checkTypedCoerce() {
  takeWarnings()
  const d = Look.DEFAULTS

  const strFalsePulse = Look.merge({ pulse: "false" })
  const strFalsePulseWarns = takeWarnings()
  check(strFalsePulse.pulse === false, "string \"false\" on default-false pulse keeps false (not inverted)")
  check(warnedKey(strFalsePulseWarns, "pulse"), "string \"false\" pulse warns")

  const strFalseMirror = Look.merge({ mirror: "false" })
  const strFalseMirrorWarns = takeWarnings()
  check(strFalseMirror.mirror === false, "string \"false\" on default-false mirror keeps false")
  check(warnedKey(strFalseMirrorWarns, "mirror"), "string \"false\" mirror warns")

  const strFalseShimmer = Look.merge({ shimmer: "false" })
  const strFalseShimmerWarns = takeWarnings()
  check(strFalseShimmer.shimmer === true, "string \"false\" on default-true shimmer keeps default true")
  check(warnedKey(strFalseShimmerWarns, "shimmer"), "string \"false\" shimmer warns")

  const realFalse = Look.merge({ shimmer: false, pulse: false, mirror: false })
  takeWarnings()
  check(realFalse.shimmer === false, "real JSON false applies on shimmer")
  check(realFalse.pulse === false, "real JSON false applies on pulse")
  check(realFalse.mirror === false, "real JSON false applies on mirror")

  const realTrue = Look.merge({ pulse: true, mirror: true, shimmer: true })
  takeWarnings()
  check(realTrue.pulse === true && realTrue.mirror === true && realTrue.shimmer === true,
    "real JSON true applies")

  const oneZero = Look.merge({ pulse: 1, mirror: 0, shimmer: 0 })
  takeWarnings()
  check(oneZero.pulse === true, "numeric 1 is a valid bool true")
  check(oneZero.mirror === false, "numeric 0 is a valid bool false")
  check(oneZero.shimmer === false, "numeric 0 turns default-true shimmer off")

  const infBorder = Look.merge({ borderSize: "inf" })
  const infWarns = takeWarnings()
  check(infBorder.borderSize === d.borderSize, "string \"inf\" keeps default borderSize")
  check(warnedKey(infWarns, "borderSize"), "string \"inf\" warns")

  const nanBorder = Look.merge({ borderSize: "nan" })
  check(nanBorder.borderSize === d.borderSize, "string \"nan\" keeps default borderSize")
  check(warnedKey(takeWarnings(), "borderSize"), "string \"nan\" warns")

  const abcBorder = Look.merge({ borderSize: "abc" })
  check(abcBorder.borderSize === d.borderSize, "string \"abc\" keeps default borderSize")
  check(warnedKey(takeWarnings(), "borderSize"), "string \"abc\" warns")

  const emptyPulse = Look.merge({ pulse: "" })
  check(emptyPulse.pulse === false, "empty string pulse keeps default false")
  check(warnedKey(takeWarnings(), "pulse"), "empty string pulse warns")

  const arrLobe = Look.merge({ lobe: [] })
  check(arrLobe.lobe === d.lobe, "array lobe keeps default")
  check(warnedKey(takeWarnings(), "lobe"), "array lobe warns")

  const objHz = Look.merge({ shimmerHz: {} })
  check(objHz.shimmerHz === d.shimmerHz, "object shimmerHz keeps default")
  check(warnedKey(takeWarnings(), "shimmerHz"), "object shimmerHz warns")

  const numNaN = Look.merge({ borderSize: Number.NaN, shimmerHz: Number.POSITIVE_INFINITY })
  const numNaNWarns = takeWarnings()
  check(numNaN.borderSize === d.borderSize, "NaN number keeps default borderSize")
  check(numNaN.shimmerHz === d.shimmerHz, "Infinity number keeps default shimmerHz")
  check(warnedKey(numNaNWarns, "borderSize") && warnedKey(numNaNWarns, "shimmerHz"),
    "non-finite numbers warn")

  const boolAsNum = Look.merge({ lobe: true, pulseHz: false })
  check(boolAsNum.lobe === d.lobe, "bool true is not a finite number for lobe")
  check(boolAsNum.pulseHz === d.pulseHz, "bool false is not a finite number for pulseHz")
  check(warnedKey(takeWarnings(), "lobe"), "bool-as-number warns")
}

function checkClamps() {
  takeWarnings()
  const d = Look.DEFAULTS

  const lobeHigh = Look.merge({ lobe: 1, shimmer: false })
  check(lobeHigh.lobe === 0.5, "lobe: 1 clamps to 0.5 even with shimmer off")
  check(lobeHigh.shimmer === false, "shimmer false still applies next to lobe clamp")

  const lobeLow = Look.merge({ lobe: 0 })
  check(lobeLow.lobe === 0.04, "lobe: 0 clamps to 0.04")

  const thick = Look.merge({ borderSize: 100 })
  check(thick.borderSize === 20, "borderSize: 100 clamps to 20")

  const neg = Look.merge({ borderSize: -1 })
  const negWarns = takeWarnings()
  check(neg.borderSize === d.borderSize, "borderSize: -1 is illegal, keeps default")
  check(warnedKey(negWarns, "borderSize"), "borderSize: -1 warns")

  const zeroBorder = Look.merge({ borderSize: 0 })
  check(zeroBorder.borderSize === 0, "borderSize: 0 is a shared hide, not the -1 sentinel")

  const headings = Look.merge({
    pinDeg: 120.7,
    angleOffset: 10.7,
    shimmerDeg: 20.2
  })
  check(headings.pinDeg === 121, "pinDeg fractional becomes int")
  check(headings.angleOffset === 11, "angleOffset fractional becomes int")
  check(headings.shimmerDeg === 20, "shimmerDeg fractional becomes int")
  check(headings.pinDeg === Math.round(120.7), "pinDeg uses the same round as CIntValue-bound chrome")

  const headingClamp = Look.merge({
    pinDeg: 400,
    angleOffset: -200,
    shimmerDeg: 200
  })
  check(headingClamp.pinDeg === 360, "pinDeg clamps to 360")
  check(headingClamp.angleOffset === -180, "angleOffset clamps to -180")
  check(headingClamp.shimmerDeg === 180, "shimmerDeg clamps to 180")

  const hz = Look.merge({ shimmerHz: 10, pulseHz: -1 })
  check(hz.shimmerHz === 4, "shimmerHz clamps to 4")
  check(hz.pulseHz === 0, "pulseHz clamps to 0")

  const scales = Look.merge({ shimmerScaleMin: 0.1, shimmerScaleMax: 10 })
  check(scales.shimmerScaleMin === 0.2, "shimmerScaleMin clamps to 0.2")
  check(scales.shimmerScaleMax === 3, "shimmerScaleMax clamps to 3")
}

function checkLookApplyTyped() {
  const d = Look.DEFAULTS
  const mistyped = {
    pulse: "false",
    shimmer: "false",
    mirror: "false",
    borderSize: "inf",
    lobe: 1,
    colA: "rgba(33ccffe)",
    angleOffset: 10.7,
    shimmerDeg: 20.2
  }
  const merged = Look.merge(mistyped)
  const a = lookApply(mistyped)
  const b = lookApply(mistyped)
  check(a.status === 0, "look-apply mistyped run 1 exits 0: " + (a.stderr || ""))
  check(b.status === 0, "look-apply mistyped run 2 exits 0: " + (b.stderr || ""))
  check(a.stdout === b.stdout, "look-apply mistyped stdout is deterministic")
  const lua = a.stdout || ""
  luaHasNoNonConfig(lua)
  check(luaAssign(lua, "pulse") === "false", "lua pulse stays false (string \"false\" not inverted)")
  check(luaAssign(lua, "shimmer") === "true", "lua shimmer keeps default true for string \"false\"")
  check(luaAssign(lua, "mirror") === "false", "lua mirror stays false for string \"false\"")
  check(luaAssign(lua, "border_size") === String(d.borderSize), "lua border_size default for \"inf\"")
  check(luaAssign(lua, "lobe") === "0.5", "lua lobe clamped to 0.5")
  check(luaAssign(lua, "angle_offset") === "11", "lua angle_offset is int 11")
  check(luaAssign(lua, "shimmer_deg") === "20", "lua shimmer_deg is int 20")
  check(/a\s*=\s*"rgba\(00000000\)"/.test(lua), "lua 7-digit col.a is transparent")
  check(a.stderr.indexOf("look: pulse:") !== -1, "look-apply stderr warns on pulse string")
  check(a.stderr.indexOf("look: shimmer:") !== -1, "look-apply stderr warns on shimmer string")
  check(a.stderr.indexOf("look: borderSize:") !== -1, "look-apply stderr warns on inf")
  check(merged.pulse === false && luaAssign(lua, "pulse") === "false",
    "merge and lua agree on mistyped pulse")
  check(merged.shimmer === true && luaAssign(lua, "shimmer") === "true",
    "merge and lua agree on mistyped shimmer")
  check(merged.lobe === 0.5 && luaAssign(lua, "lobe") === "0.5",
    "merge and lua agree on clamped lobe")
  check(merged.borderSize === d.borderSize && luaAssign(lua, "border_size") === String(d.borderSize),
    "merge and lua agree on inf borderSize")
  check(merged.angleOffset === 11 && luaAssign(lua, "angle_offset") === "11",
    "merge and lua agree on int angleOffset")
  check(merged.shimmerDeg === 20 && luaAssign(lua, "shimmer_deg") === "20",
    "merge and lua agree on int shimmerDeg")

  const hundred = lookApply({ borderSize: 100 })
  check(hundred.status === 0, "look-apply borderSize 100 exits 0")
  check(luaAssign(hundred.stdout, "border_size") === "20", "lua border_size 100 → 20")
  check(Look.merge({ borderSize: 100 }).borderSize === 20, "merge borderSize 100 → 20 matches lua")

  const minus = lookApply({ borderSize: -1 })
  check(minus.status === 0, "look-apply borderSize -1 exits 0")
  check(luaAssign(minus.stdout, "border_size") === String(d.borderSize),
    "lua border_size -1 keeps default (shared illegal, not follow-stock)")
  check(minus.stderr.indexOf("look: borderSize:") !== -1, "look-apply stderr warns on -1")
  check(Look.merge({ borderSize: -1 }).borderSize === d.borderSize,
    "merge borderSize -1 matches lua default")

  const seven = lookApply({ colA: "rgba(33ccffe)", colB: "rgba(00ff99)", baseColor: "rgba(00687855)" })
  check(seven.status === 0, "look-apply 7-digit colA exits 0")
  check(/a\s*=\s*"rgba\(00000000\)"/.test(seven.stdout), "7-digit col.a lua is transparent")
  check(/b\s*=\s*"rgba\(00ff99ff\)"/.test(seven.stdout), "6-digit col.b still parses")
  check(/base_color\s*=\s*"rgba\(00687855\)"/.test(seven.stdout), "8-digit baseColor still parses")

  const abc = lookApply({ borderSize: "abc", pulseHz: "nan" })
  check(abc.status === 0, "look-apply abc/nan exits 0 (no set -e crash)")
  luaHasNoNonConfig(abc.stdout)
  check(luaAssign(abc.stdout, "border_size") === String(d.borderSize), "lua abc borderSize → default")
  check(luaAssign(abc.stdout, "pulse_hz") === "0.4" || luaAssign(abc.stdout, "pulse_hz") === String(d.pulseHz),
    "lua nan pulseHz → default")

  const pyNan = lookApply('{"borderSize": NaN, "shimmerHz": Infinity}')
  check(pyNan.status === 0, "look-apply Python NaN/Infinity JSON exits 0")
  luaHasNoNonConfig(pyNan.stdout)
  check(luaAssign(pyNan.stdout, "border_size") === String(d.borderSize), "Python NaN borderSize → default")
  check(luaAssign(pyNan.stdout, "shimmer_hz") === "0.3" || luaAssign(pyNan.stdout, "shimmer_hz") === String(d.shimmerHz),
    "Python Infinity shimmerHz → default")

  const typedOk = lookApply({ pulse: true, shimmer: false, mirror: 1, borderSize: 3, lobe: 0.2 })
  check(typedOk.status === 0, "look-apply well-typed exits 0")
  check(luaAssign(typedOk.stdout, "pulse") === "true", "lua real true pulse")
  check(luaAssign(typedOk.stdout, "shimmer") === "false", "lua real false shimmer")
  check(luaAssign(typedOk.stdout, "mirror") === "true", "lua numeric 1 mirror")
  check(luaAssign(typedOk.stdout, "border_size") === "3", "lua well-typed border_size")
  check(luaAssign(typedOk.stdout, "lobe") === "0.2", "lua well-typed lobe")
}

function checkLookApplyEval() {
  const script = fs.readFileSync(path.join(root, "scripts/look-apply.sh"), "utf8")
  check(
    script.indexOf("dofile([=[${LUA_FILE}]=])") === -1,
    "look-apply eval is not dofile long-bracket concat of LUA_FILE"
  )

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "look-eval-"))
  const binDir = path.join(dir, "bin")
  const luaDir = path.join(dir, "with]=]bracket")
  const home = path.join(dir, "home")
  const config = path.join(dir, "config")
  const logPath = path.join(dir, "hyprctl.log")
  fs.mkdirSync(binDir)
  fs.mkdirSync(luaDir, { recursive: true })
  fs.mkdirSync(home)
  fs.mkdirSync(path.join(config, "hypr"), { recursive: true })
  const luaFile = path.join(luaDir, "border-fx.lua")
  check(luaFile.indexOf("]=]") !== -1, "eval fixture path contains ]=]")

  const stub = [
    "#!/usr/bin/env bash",
    "LOG=" + JSON.stringify(logPath),
    "{",
    '  echo "BEGIN $*"',
    "  i=0",
    '  for a in "$@"; do',
    '    i=$((i+1))',
    '    printf "ARG%d=%s\\n" "$i" "$a"',
    "  done",
    '} >> "$LOG"',
    'if [[ $1 == -i && $3 == plugin && $4 == list ]]; then',
    "  echo '[{\"name\":\"hypr-shiny-border\"}]'",
    "  exit 0",
    "fi",
    'if [[ $1 == -i && $3 == eval ]]; then',
    '  printf "EVAL_PAYLOAD=%s\\n" "$4" >> "$LOG"',
    "  echo ok",
    "  exit 0",
    "fi",
    "exit 0",
    "",
  ].join("\n")
  fs.writeFileSync(path.join(binDir, "hyprctl"), stub)
  fs.chmodSync(path.join(binDir, "hyprctl"), 0o755)

  try {
    const r = spawnSync(
      "bash",
      [path.join(root, "scripts/look-apply.sh"), "--eval", "--lua", luaFile, "--look-json", "{}"],
      {
        encoding: "utf8",
        env: Object.assign({}, process.env, {
          PATH: binDir + ":" + (process.env.PATH || "/usr/bin:/bin"),
          HOME: home,
          XDG_CONFIG_HOME: config,
          SESSION_SO: path.join(dir, "dummy.so"),
        }),
        timeout: 15000,
      }
    )
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : ""
    check(r.status === 0, "look-apply --eval exits 0: " + (r.stderr || r.stdout || ""))
    const payloadMatch = log.match(/^EVAL_PAYLOAD=(.*)$/m)
    const payload = payloadMatch ? payloadMatch[1] : ""
    check(payload.length > 0, "look-apply --eval recorded an eval payload")
    check(
      payload.indexOf("dofile([=[" + luaFile + "]=])") === -1,
      "eval payload is not dofile([=[LUA_FILE]=]) concat: " + payload
    )
    check(payload.indexOf(luaFile) !== -1, "eval payload still names the lua file: " + payload)
    console.log("look-apply-eval log:\n" + log)
    console.log("look-apply-eval payload: " + payload)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

checkDefaults()
checkPluginInitDefaults()
checkMerge()
checkTypedCoerce()
checkClamps()
checkEntry()
checkColors()
checkLookApply()
checkLookApplyTyped()
checkLookApplyEval()

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok")
