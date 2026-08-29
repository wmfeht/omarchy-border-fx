#!/usr/bin/env node
// Compositor-free tests for the shared look adapter (JSON ↔ QML ↔ Lua).
const fs = require("fs")
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
}

function checkLookApply() {
  const script = path.join(root, "scripts/look-apply.sh")
  const env = Object.assign({}, process.env, {
    SESSION_SO: "/tmp/omarchy-border-fx-test.so",
    LUA_FILE: "/tmp/omarchy-border-fx-test.lua"
  })
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

checkDefaults()
checkPluginInitDefaults()
checkMerge()
checkEntry()
checkColors()
checkLookApply()

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok")
