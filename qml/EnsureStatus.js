.pragma library

// stdout protocol of `scripts/border-fx ensure|apply`: KEY=value lines.
//
// STATUS= success values that mean the window ring is ready. Missing or
// non-success STATUS (load-failed, build-failed, skipped, no-cli, …) is
// fail-closed.
//
// LOOK= carries the resolved look (defaults applied, nested overlay, coerced,
// clamped) as one line of compact JSON. The chrome adopts it as authoritative
// so windows and chrome render the same numbers.

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

function parseLook(text) {
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (line.indexOf("LOOK=") !== 0)
      continue
    try {
      var v = JSON.parse(line.substring(5))
      if (v && typeof v === "object" && !Array.isArray(v) && typeof v.effect === "string")
        return v
    } catch (e) {
      return null
    }
  }
  return null
}
