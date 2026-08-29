.pragma library

// Host discovery and overlay attach policy for Service.qml.
// Duck-types Omarchy chrome (bar popouts, overlay cards, notification
// toasts). Overlay is an extra child. Hide the stock stroke once on
// attach (same-width fill so insets do not jump); restore on detach.
// Do not poll-assign — a JS write still replaces QML bindings.
// Drop leftover overlays whose overlayRev does not match the current stamp.

// Hide stock BorderSurface stroke while the overlay is on. Assign once.
var ASSIGN_STOCK = true

function stockWidth(spec) {
  var w = 0
  if (spec && spec.widths) {
    w = Math.max(
      Number(spec.widths.top) || 0,
      Number(spec.widths.right) || 0,
      Number(spec.widths.bottom) || 0,
      Number(spec.widths.left) || 0
    )
  }
  return w > 0 ? w : 2
}

// Same shape as Border.flat(color, width): native Rectangle.border, no Shape overlay.
function hiddenSpec(color, width) {
  var w = Number(width)
  if (!(w > 0))
    w = 2
  return {
    color: color,
    widths: { top: w, right: w, bottom: w, left: w },
    gradient: { colors: [], angle: 0, enabled: false }
  }
}

function isBarPanelHost(obj) {
  return obj
      && obj.anchorItem !== undefined
      && obj.contentWidth !== undefined
      && obj.borderSpec !== undefined
      && obj.open !== undefined
}

// omarchy.menu / clipboard / emojis: keepLoaded overlay with a centered
// BorderSurface card. `opened` is the plugin lifecycle flag (not `open`).
function isOverlayHost(obj) {
  return obj
      && obj.opened !== undefined
      && obj.cardWidth !== undefined
      && obj.borderSpec !== undefined
}

// NotificationCard is itself the BorderSurface. Duck-type the toast
// presentational API, not objectName — we do not patch that plugin.
function isNotificationCard(obj) {
  return obj
      && obj.cardBorderSpec !== undefined
      && obj.summary !== undefined
      && obj.urgency !== undefined
      && obj.borderSpec !== undefined
      && obj.padding !== undefined
      && obj.radius !== undefined
}

function isHost(obj) {
  return isBarPanelHost(obj) || isOverlayHost(obj) || isNotificationCard(obj)
}

function isChromeCard(obj) {
  return obj
      && obj.borderSpec !== undefined
      && obj.padding !== undefined
      && obj.radius !== undefined
}

function hostShowing(host) {
  if (!host) return false
  if (isNotificationCard(host))
    return host.visible !== false
  if (host.opened === true) return true
  if (host.open === true) return true
  // KeyboardPanel stays mapped through the fade (`open || card.opacity > 0`).
  if (host.open !== undefined)
    return host.visible === true
  return false
}

function overlayRevIsStale(existingRev, currentRev) {
  if (existingRev === undefined || existingRev === null)
    return false
  return Number(existingRev) !== Number(currentRev)
}

function entryCard(entry) {
  if (!entry)
    return null
  if (entry.card !== undefined)
    return entry.card
  return entry
}

function entryHost(entry) {
  if (!entry)
    return null
  if (entry.host !== undefined)
    return entry.host
  return entry
}

function indexOfHostOrCard(list, host, card) {
  if (!list)
    return -1
  for (var i = 0; i < list.length; i++) {
    var e = list[i]
    if (card && (e === card || (e && e.card === card)))
      return i
    if (host && (e === host || (e && e.host === host)))
      return i
  }
  return -1
}

function isAttached(list, card) {
  return indexOfHostOrCard(list, null, card) !== -1
}

function isAttachedHost(list, host) {
  return indexOfHostOrCard(list, host, null) !== -1
}

function isAttachedEntry(list, host, card) {
  return indexOfHostOrCard(list, host, card) !== -1
}

function cardForHost(attached, host) {
  if (!attached || !host)
    return null
  for (var i = 0; i < attached.length; i++) {
    var e = attached[i]
    if (e === host)
      return e
    if (e && e.host === host)
      return e.card !== undefined ? e.card : null
  }
  return null
}

function applyAttachSet(list, card, action, extra) {
  var src = list || []
  var host = extra && extra.host !== undefined ? extra.host : null
  var idx = indexOfHostOrCard(src, host, card)
  if (action === "attach" || action === "replace") {
    if (idx !== -1)
      return src
    if (!card && !(extra && extra.host))
      return src
    var next = []
    for (var i = 0; i < src.length; i++)
      next.push(src[i])
    next.push(extra || card)
    return next
  }
  if (action === "detach") {
    if (idx === -1)
      return src
    var out = []
    for (var j = 0; j < src.length; j++) {
      if (j !== idx)
        out.push(src[j])
    }
    return out
  }
  return src
}

function makeDecision(action, parts) {
  parts = parts || {}
  return {
    action: action,
    assignStock: parts.assignStock === true,
    restoreStock: parts.restoreStock === true,
    dropLeftover: parts.dropLeftover === true,
    createOverlay: parts.createOverlay === true,
    keepOverlay: parts.keepOverlay === true
  }
}

function overlayActionFor(decision) {
  if (!decision)
    return "none"
  if (decision.dropLeftover && decision.createOverlay)
    return "replace"
  if (decision.action === "detach" || decision.dropLeftover)
    return "destroy"
  if (decision.createOverlay)
    return "create"
  if (decision.keepOverlay)
    return "keep"
  return "none"
}

// existingOverlayRev: number when a ShinyBorder child exists, else null.
function decideHostSync(s) {
  s = s || {}
  var card = s.card
  var host = s.host
  var attached = s.attached || []
  var already = isAttachedEntry(attached, host, card)
  var hasOverlay = s.existingOverlayRev !== undefined && s.existingOverlayRev !== null
  var stale = hasOverlay && overlayRevIsStale(s.existingOverlayRev, s.currentOverlayRev)
  var dead = s.hostDestroyed === true || s.hostAlive === false
  var disable = s.disable === true
  var shiny = s.effectIsShiny === true && !disable
  var showing = false
  if (!dead && !disable)
    showing = hostShowing(host)

  var want = shiny && showing && !!card

  if (!want) {
    if (already || hasOverlay)
      return makeDecision("detach", {
        dropLeftover: hasOverlay,
        restoreStock: ASSIGN_STOCK && already
      })
    return makeDecision("noop", {})
  }

  if (stale)
    return makeDecision("replace", {
      dropLeftover: true,
      createOverlay: true,
      assignStock: ASSIGN_STOCK && !already
    })

  if (already && hasOverlay)
    return makeDecision("noop", { keepOverlay: true })

  return makeDecision("attach", {
    createOverlay: !hasOverlay,
    keepOverlay: hasOverlay,
    assignStock: ASSIGN_STOCK && !already
  })
}

function applyCardPolicy(attached, card, decision, extra) {
  var d = decision || makeDecision("noop", {})
  return {
    attached: applyAttachSet(attached, card, d.action, extra),
    overlayAction: overlayActionFor(d),
    assignStock: !!d.assignStock,
    restoreStock: !!d.restoreStock
  }
}
