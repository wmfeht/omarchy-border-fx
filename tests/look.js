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
  check(Look.PLUGIN_ID === "qs.border-fx", "plugin id")
  check(Look.LEGACY_PLUGIN_ID === "qs.shiny-border", "legacy id")
  check(Look.DEFAULT_EFFECT === "shiny", "default effect")
  const d = Look.merge(null)
  check(d.effect === "shiny", "merge default effect shiny")
  check(d.borderSize === 2, "default borderSize 2 (not C++ 3)")
  check(!Object.prototype.hasOwnProperty.call(d, "pin"), "pin is not a look key")
  check(!Object.prototype.hasOwnProperty.call(Look.DEFAULTS, "pin"), "DEFAULTS has no pin switch")
  check(!Object.prototype.hasOwnProperty.call(Look.DEFAULTS, "quantizeDeg"), "DEFAULTS has no mouse quantize")
  check(d.pinDeg === 120, "default pinDeg 120 (not C++ 90)")
  check(d.shimmer === true, "default shimmer")
  check(d.pulse === false, "default pulse off (not C++ on)")
  check(d.mirror === false, "default mirror off")
  check(Look.merge({}).mirror === false, "empty {} look keeps mirror off")
  check(d.gradient.length === 4, "default 4-stop ramp")
  check(d.gradient[0] === "rgba(33ccffee)", "head rgba")
  check(d.gradientPositions === "0 1 3 100", "positions")
  check(d.baseColor === "rgba(00687855)", "default baseColor")
  check(d.activeOnly === true, "hypr-only activeOnly")
}

function checkMerge() {
  const e = Look.merge({ id: "qs.border-fx", pinDeg: 90, borderSize: 1 })
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
      { id: "qs.border-fx", pinDeg: 45, shimmer: false, effect: "shiny" }
    ]
  }
  const e = Look.entryFromConfig(cfg)
  check(e.pinDeg === 45 && e.shimmer === false, "entryFromConfig picks qs.border-fx")
  check(Look.entryFromConfig({ plugins: [] }).id === undefined, "missing entry is empty")
  check(Object.keys(Look.entryFromConfig(null)).length === 0, "null config")

  const legacy = {
    plugins: [{ id: "qs.shiny-border", pinDeg: 30 }]
  }
  check(Look.entryFromConfig(legacy).pinDeg === 30, "falls back to qs.shiny-border")
  const both = {
    plugins: [
      { id: "qs.shiny-border", pinDeg: 1 },
      { id: "qs.border-fx", pinDeg: 2 }
    ]
  }
  check(Look.entryFromConfig(both).pinDeg === 2, "qs.border-fx wins over legacy")
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
  check(lua.indexOf("qs.border-fx") !== -1, "lua cites qs.border-fx as source of truth")
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

checkDefaults()
checkMerge()
checkEntry()
checkColors()
checkLookApply()

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok")
