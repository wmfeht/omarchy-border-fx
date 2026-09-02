.pragma library

// stdout protocol of `scripts/border-fx ensure|apply`: KEY=value lines.
//
// STATUS= success values that mean the window ring is ready. Missing or
// non-success STATUS (load-failed, build-failed, skipped, no-cli, …) is
// fail-closed.
//
// LOOK= carries the resolved look (theme floor, nested overlay, coerced,
// clamped) as one line of compact JSON. BASE= is the same resolve with an
// empty entry: the theme preset (or shared defaults). Chrome re-merges the
// live plugins[] entry against BASE= so a removed user key follows the
// preset again.

function lastStatus(text) {
  var lines = String(text || "").split("\n")
  var last = ""
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (line.length && line.charAt(line.length - 1) === "\r")
      line = line.substring(0, line.length - 1)
    if (line.indexOf("STATUS=") === 0)
      last = line.substring(7)
  }
  return last
}

function isEnsureSuccessStatus(text) {
  var s = lastStatus(text)
  return s === "ok" || s === "hyprpm" || s === "reuse"
}

function parseKeyedLook(text, prefix) {
  var lines = String(text || "").split("\n")
  var key = String(prefix || "LOOK=")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (line.indexOf(key) !== 0)
      continue
    try {
      var v = JSON.parse(line.substring(key.length))
      if (v && typeof v === "object" && !Array.isArray(v) && typeof v.effect === "string")
        return v
    } catch (e) {
      return null
    }
  }
  return null
}

function parseLook(text) {
  return parseKeyedLook(text, "LOOK=")
}

function parseBase(text) {
  return parseKeyedLook(text, "BASE=")
}
