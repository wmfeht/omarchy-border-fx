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
  check(Look.PLUGIN_ID === "qs.shiny-border", "plugin id")
  const d = Look.merge(null)
  check(d.borderSize === 2, "default borderSize 2 (not C++ 3)")
  check(d.pin === true, "default pin")
  check(d.pinDeg === 120, "default pinDeg 120 (not C++ 90)")
  check(d.shimmer === true, "default shimmer")
  check(d.pulse === false, "default pulse off (not C++ on)")
  check(d.gradient.length === 4, "default 4-stop ramp")
  check(d.gradient[0] === "rgba(33ccffee)", "head rgba")
  check(d.gradientPositions === "0 1 3 100", "positions")
  check(d.baseColor === "rgba(00687855)", "qs-only baseColor")
  check(d.activeOnly === true, "hypr-only activeOnly")
}

function checkMerge() {
  const e = Look.merge({ id: "qs.shiny-border", pinDeg: 90, borderSize: 1 })
  check(e.pinDeg === 90, "override pinDeg")
  check(e.borderSize === 1, "override borderSize")
  check(e.shimmer === true, "unmentioned key stays default")
  check(e.id === undefined, "id is not a look key")

  const emptyRamp = Look.merge({ gradient: [] })
  check(Array.isArray(emptyRamp.gradient) && emptyRamp.gradient.length === 0, "empty gradient is a real override")

  const objRamp = Look.merge({ gradient: { colors: ["rgba(ff0000ff)", "rgba(00ff00ff)"] } })
  check(objRamp.gradient.length === 2 && objRamp.gradient[0] === "rgba(ff0000ff)", "hypr-style {colors}")
}

function checkEntry() {
  const cfg = {
    plugins: [
      { id: "other.thing", pinDeg: 0 },
      { id: "qs.shiny-border", pinDeg: 45, shimmer: false }
    ]
  }
  const e = Look.entryFromConfig(cfg, "qs.shiny-border")
  check(e.pinDeg === 45 && e.shimmer === false, "entryFromConfig picks the id")
  check(Look.entryFromConfig({ plugins: [] }).id === undefined, "missing entry is empty")
  check(Object.keys(Look.entryFromConfig(null)).length === 0, "null config")
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
  check(lua.indexOf("shiny_border") !== -1, "emits shiny_border table")
  check(/border_size\s*=\s*2/.test(lua), "lua border_size = 2")
  check(/pin_deg\s*=\s*120/.test(lua), "lua pin_deg = 120")
  check(/pulse\s*=\s*false/.test(lua), "lua pulse = false")
  check(/shimmer\s*=\s*true/.test(lua), "lua shimmer = true")
  check(lua.indexOf("rgba(33ccffee)") !== -1, "lua keeps hypr rgba")
  check(lua.indexOf("baseColor") === -1 && lua.indexOf("base_color") === -1, "baseColor is QS-only")
  check(lua.indexOf("hl.plugin.load") !== -1, "login load of session .so")
  check(lua.indexOf("hyprland.start") !== -1, "load on hyprland.start, not during parse")
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
  check(/border_size\s*=\s*1/.test(custom.stdout), "custom border_size")
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
