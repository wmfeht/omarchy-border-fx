#!/usr/bin/env node
// Content-audit for docs/unified-project.md. Compositor-free, same style as
// tests/run.js: read the review document and fail if the unified-project
// topics are missing. Does not implement unification; it only checks the plan.

const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const planRel = "docs/unified-project.md"
const planPath = path.join(root, planRel)

let fails = 0

function check(cond, msg) {
  if (!cond) {
    fails++
    console.error("FAIL " + msg)
  } else {
    console.log("ok  " + msg)
  }
}

function has(hay, needle) {
  return hay.indexOf(needle) !== -1
}

function hasRe(hay, re) {
  return re.test(hay)
}

if (!fs.existsSync(planPath)) {
  console.error("FAIL missing " + planRel)
  process.exit(1)
}

const st = fs.statSync(planPath)
const text = fs.readFileSync(planPath, "utf8")

check(st.isFile(), "plan is a regular file")
check(st.size > 0, "plan is non-empty")
check(planRel.endsWith(".md"), "plan path is markdown")
check(Buffer.byteLength(text, "utf8") === st.size, "read the whole plan file")

check(has(text, "qs-shiny-border"), "mentions qs-shiny-border")
check(has(text, "hypr-shiny-border"), "mentions hypr-shiny-border")

check(
  has(text, "omarchy plugin add") || has(text, "omarchy plugin install"),
  "Omarchy plugin install (omarchy plugin add or install)"
)
check(has(text, "omarchy plugin enable"), "mentions omarchy plugin enable")
check(has(text, "omarchy plugin disable"), "mentions omarchy plugin disable")
check(has(text, "omarchy plugin remove"), "mentions omarchy plugin remove")

check(
  has(text, "manifest.json") && hasRe(text, /clone root|git root|repo root/i),
  "manifest.json at clone/git/repo root so omarchy plugin add works"
)

const sharedInstall =
  hasRe(text, /shared install/i) &&
  has(text, "hypr-ensure") &&
  has(text, ".so") &&
  hasRe(text, /Quickshell|omarchy-shell|Service\.qml/)
check(sharedInstall, "shared install of both Hyprland .so and Quickshell sides")

check(
  hasRe(text, /no install hooks/i) || hasRe(text, /never runs install hooks/i),
  "honest about Omarchy no install hooks"
)
check(hasRe(text, /\bno sudo\b/i) || has(text, "no sudo"), "honest about no sudo")
check(hasRe(text, /symlink/i), "covers plugin-dir symlink refusal")

const sharedConfig =
  hasRe(text, /shared config/i) &&
  (has(text, "shell.json") || hasRe(text, /plugins\[\]/))
check(sharedConfig, "shared configuration sourced from Omarchy plugin / shell.json")

const bothUpdate =
  hasRe(text, /hyprctl eval/) &&
  hasRe(text, /Hyprland/) &&
  hasRe(text, /Quickshell/) &&
  hasRe(text, /fan-?out/i) &&
  hasRe(text, /config(?:uration)? change/i)
check(
  bothUpdate,
  "a config change fans out to both Hyprland (hyprctl eval) and Quickshell"
)

check(has(text, "PLUGIN_INIT"), "plugin keys exist only after PLUGIN_INIT")
check(hasRe(text, /looknfeel|shiny_border/), "Hyprland Lua shiny_border / looknfeel")
check(hasRe(text, /two (processes|runtimes)/i), "two processes/runtimes, not one in-memory object")

check(
  hasRe(text, /^# /m) && hasRe(text, /^## /m),
  "markdown document with headings (not a README footnote)"
)
check(!has(text, path.basename(__filename) + " is the plan"), "plan is not this audit script")

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok  " + planRel + " (" + st.size + " bytes)")
console.log("ok")
