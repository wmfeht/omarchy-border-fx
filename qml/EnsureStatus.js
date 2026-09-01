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

function isEnsureSuccessStatus(text) {
  var t = String(text || "")
  return t.indexOf("STATUS=ok") !== -1
      || t.indexOf("STATUS=hyprpm") !== -1
      || t.indexOf("STATUS=reuse") !== -1
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
