#!/usr/bin/env node
// Content-audit for docs/phase-NN-*.md. Compositor-free, same style as
// tests/audit-unified-plan.js: read the shipped markdown and fail if a
// combined-review finding is missing, a required co-location set is split,
// or the phase documents are not sequential. Does not implement the fixes.

const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const combinedRel = "docs/code-review-combined.md"
const combinedPath = path.join(root, combinedRel)
const docsDir = path.join(root, "docs")
const misePath = path.join(root, "mise.toml")

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

if (!fs.existsSync(combinedPath)) {
  console.error("FAIL missing " + combinedRel)
  process.exit(1)
}

const combined = fs.readFileSync(combinedPath, "utf8")
const combinedSt = fs.statSync(combinedPath)
check(combinedSt.isFile() && combinedSt.size > 0, "combined review is a non-empty file")
check(
  Buffer.byteLength(combined, "utf8") === combinedSt.size,
  "read the whole combined review"
)

// --- Discover sequential phase markdown under docs/ ---

const phaseNames = fs
  .readdirSync(docsDir)
  .filter((f) => /^phase-\d+-.+\.md$/.test(f))
  .sort()

check(phaseNames.length > 1, "more than one sequential phase markdown document")
check(
  phaseNames.length < 29,
  "phase set is not one document per finding (" + phaseNames.length + " files)"
)

const seqNums = phaseNames.map((f) => Number(f.match(/^phase-(\d+)-/)[1]))
check(seqNums[0] === 1, "phase sequence starts at 1")
check(
  seqNums.every((n, i) => n === i + 1),
  "phase files are consecutive phase-01, phase-02, … (got " +
    seqNums.map((n) => String(n).padStart(2, "0")).join(", ") +
    ")"
)

const phases = phaseNames.map((name) => {
  const rel = "docs/" + name
  const full = path.join(docsDir, name)
  const st = fs.statSync(full)
  const text = fs.readFileSync(full, "utf8")
  check(st.isFile() && st.size > 0, rel + " is a non-empty regular file")
  check(/^# /m.test(text), rel + " has a top-level heading")
  check(/^## /m.test(text), rel + " has section headings")
  check(/\*\*Sequence:\*\*/.test(text), rel + " states Sequence")
  check(/\*\*Depends on:\*\*/.test(text), rel + " states Depends on")
  check(/\*\*Finding IDs:\*\*/.test(text), rel + " lists Finding IDs")
  const idsLine = text.match(/\*\*Finding IDs:\*\*\s*([0-9, ]+)/)
  const ids = idsLine
    ? idsLine[1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => n > 0)
    : []
  return { name, rel, text, seq: Number(name.match(/^phase-(\d+)-/)[1]), ids }
})

check(
  phases.some((p) => p.ids.length > 1),
  "at least one phase combines issues that share a sitting"
)

// --- Finding IDs 1–29 from the combined summary table (not hardcoded titles) ---

const tableMeta = {}
const tableIds = []
for (const line of combined.split("\n")) {
  const m = line.match(
    /^\| (\d+) \| (P1|P2|Low) \| (.+) \| (CONFIRMED(?: \/ PARTIAL)?|PARTIAL) \| (.+) \|$/
  )
  if (!m) continue
  const id = Number(m[1])
  tableIds.push(id)
  tableMeta[id] = {
    severity: m[2],
    title: m[3],
    verdict: m[4],
    pathCol: m[5],
  }
}

check(tableIds.length === 29, "combined summary table has 29 rows (got " + tableIds.length + ")")
check(
  tableIds.every((id, i) => id === i + 1),
  "combined summary table IDs are 1–29"
)

function extractCombinedFindings(src) {
  const headingRe = /^### (\d+)\. .*$/gm
  const headings = []
  let hm
  while ((hm = headingRe.exec(src))) {
    headings.push({ id: Number(hm[1]), index: hm.index })
  }
  const out = {}
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index
    let end = src.length
    if (i + 1 < headings.length) end = headings[i + 1].index
    const after = src.slice(start + 1, end)
    const nextH2 = after.search(/\n## /)
    if (nextH2 !== -1) end = start + 1 + nextH2
    let body = src.slice(start, end)
    body = body.replace(/\n---\s*$/, "\n").replace(/\s+$/, "\n")
    out[headings[i].id] = body
  }
  return out
}

const combinedBodies = extractCombinedFindings(combined)
check(
  Object.keys(combinedBodies).length === 29,
  "combined review has ### N. bodies for findings 1–29"
)

function findingRegion(text, id) {
  const re = new RegExp("^### " + id + "\\. .*$", "m")
  const m = re.exec(text)
  if (!m) return ""
  const start = m.index
  const rest = text.slice(start + 1)
  const next = rest.search(/\n### /)
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next)
}

const owner = Object.create(null)
for (const p of phases) {
  check(p.ids.length > 0, p.rel + " owns at least one finding ID")
  for (const id of p.ids) {
    if (owner[id]) {
      check(false, "finding " + id + " listed in both " + owner[id].rel + " and " + p.rel)
    } else {
      owner[id] = p
    }
  }
}

for (let id = 1; id <= 29; id++) {
  check(!!owner[id], "finding " + id + " appears in a phase Finding IDs list")
}

check(
  owner[1] && owner[1].seq === 1 && phases[0].ids.indexOf(1) !== -1,
  "finding 1 is in the first implementation phase (" + phases[0].rel + ")"
)
check(
  owner[1] && owner[4] && owner[1].rel !== owner[4].rel,
  "finding 1 is not bundled into the 4+5+16 merge phase"
)

function colocate(ids, label) {
  const files = ids.map((id) => (owner[id] ? owner[id].rel : "(missing)"))
  const same = files.every((f) => f && f === files[0] && f !== "(missing)")
  check(same, "co-location " + label + " share a phase (got " + files.join(", ") + ")")
}

colocate([4, 5, 16], "4+5+16 (typed coerce + clamps)")
colocate([6, 23], "6+23 (STATUS= / hyprReady)")
colocate([2, 8, 11], "2+8+11 (disable persist, non-shiny load, teardown/ensure race)")
colocate([9, 10], "9+10 (dual shaders + fragile/untested surfaces)")
colocate([12, 13], "12+13 (render-pass clear + GL bail)")

// --- Each owned finding still has ID, severity, verdict, files, stated fix ---

for (let id = 1; id <= 29; id++) {
  const p = owner[id]
  if (!p) continue
  const region = findingRegion(p.text, id)
  const meta = tableMeta[id]
  const combinedBody = combinedBodies[id] || ""
  check(region.length > 0, p.rel + " contains ### " + id + ". heading (not ID-only in the header)")
  check(has(region, "**ID:** " + id), "finding " + id + " keeps ID in the finding body")
  check(
    has(region, "**Severity:** " + meta.severity),
    "finding " + id + " keeps severity " + meta.severity
  )
  check(has(region, "**Verdict:"), "finding " + id + " keeps a Verdict field")
  check(has(region, meta.verdict.split(" / ")[0]), "finding " + id + " keeps verdict " + meta.verdict)

  if (has(combinedBody, "**Files:**")) {
    check(has(region, "**Files:**"), "finding " + id + " keeps Files field")
  }

  if (/\*\*Fix/.test(combinedBody)) {
    check(/\*\*Fix/.test(region), "finding " + id + " keeps the stated Fix")
  }

  const verdictAt = combinedBody.indexOf("**Verdict:")
  const fromVerdict = (verdictAt >= 0 ? combinedBody.slice(verdictAt) : combinedBody).replace(
    /\s+$/,
    ""
  )
  check(
    has(region, fromVerdict),
    "finding " + id + " preserves combined-review body (not a title-only stub)"
  )
}

// Later phases name an earlier phase document when they depend on one.
for (const p of phases) {
  const dep = (p.text.match(/\*\*Depends on:\*\*[^\n]*/) || [""])[0]
  if (p.seq === 1) {
    check(/none/i.test(dep), p.rel + " is the first phase and depends on none")
  } else {
    check(
      /phase-\d+/.test(dep),
      p.rel + " states dependence on an earlier phase-NN document"
    )
  }
}

const mise = fs.readFileSync(misePath, "utf8")
const testRun = (mise.match(/\[tasks\.test\][\s\S]*?^run = "([^"]+)"/m) || [])[1] || ""
check(
  has(testRun, "tests/audit-review-phases.js"),
  "mise.toml tasks.test runs tests/audit-review-phases.js"
)

if (fails) {
  console.error(fails + " checks failed")
  process.exit(1)
}
console.log("ok  " + phases.length + " phase documents, findings 1–29")
console.log("ok")
