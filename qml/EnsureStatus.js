.pragma library

// Success STATUS= values that mean the window ring is ready. Missing or
// non-success STATUS (load-failed, build-failed, skipped, …) is fail-closed.

function isEnsureSuccessStatus(text) {
  var t = String(text || "")
  return t.indexOf("STATUS=ok") !== -1
      || t.indexOf("STATUS=hyprpm") !== -1
      || t.indexOf("STATUS=reuse") !== -1
}
