// omarchy-shell service: put ShinyBorder on every showing panel card and
// notification toast, load the Hyprland window ring, and fan the shared look
// out to both. This is the control plane; Omarchy itself has no install hooks.
//
// Hosts:
//   KeyboardPanel / PopupCard — bar popouts (audio, clock, network, …)
//   overlay shells            — Super+Space menu (omarchy.menu), and the
//                               same opened+cardWidth chrome (clipboard,
//                               emojis). A showing overlay is active.
//   NotificationCard          — omarchy.notifications popup toasts. Each
//                               card is the chrome (not a wrapper host).
//
// Does not patch qs.Ui. Walks shell.bar.moduleSlots, summoned panel
// loaders, and the notifications service tree, finds the chrome card
// (shallowest BorderSurface, not inner rows), hides the stock stroke,
// and overlays ShinyBorder while visible.
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "qml"
import "qml/Look.js" as Look

Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  readonly property string tag: "qs-border-fx"
  // Bump when the overlay's look changes so attach() drops leftovers from a
  // previous plugin load. omarchy-shell caches service instances; copying
  // QML is not enough if an old ShinyBorder is still a child of the card.
  readonly property int overlayRev: 11

  // shell.json plugins[] entry is the shared look. Services are not injected
  // a settings object — read it off shell.shellConfig ourselves.
  property var shellConfig: root.shell ? root.shell.shellConfig : null
  readonly property var look: Look.merge(Look.entryFromConfig(root.shellConfig, Look.PLUGIN_ID))

  property bool lookApplyPending: false
  property bool hyprReady: false
  // BorderSurface is a typed QML object — it will not take ad-hoc `_qsShiny*`
  // properties. Stock specs live here, keyed by object identity.
  property var stock: []
  property bool warnedMissingToasts: false

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

  function eachChild(obj, fn) {
    if (!obj) return
    var seenLocal = []
    function emit(ch) {
      if (!ch) return
      if (seenLocal.indexOf(ch) !== -1) return
      seenLocal.push(ch)
      fn(ch)
    }
    var lists = []
    try {
      if (obj.children) lists.push(obj.children)
      if (obj.data && obj.data !== obj.children) lists.push(obj.data)
      // Quickshell Variants: PanelWindow instances are not Item children.
      if (obj.instances && obj.instances !== obj.children && obj.instances !== obj.data)
        lists.push(obj.instances)
    } catch (e) {}
    for (var li = 0; li < lists.length; li++) {
      var list = lists[li]
      if (!list || list.length === undefined) continue
      for (var i = 0; i < list.length; i++) {
        try { emit(list[i]) } catch (e) {}
      }
    }
    try {
      if (obj.contentItem) emit(obj.contentItem)
    } catch (e) {}
    try {
      if (typeof obj.itemAt === "function" && typeof obj.count === "number") {
        for (var j = 0; j < obj.count; j++)
          emit(obj.itemAt(j))
      }
    } catch (e) {}
  }

  function collectHosts(node, out, seen) {
    if (!node || seen.indexOf(node) !== -1) return
    seen.push(node)
    if (isHost(node)) {
      if (out.indexOf(node) === -1) out.push(node)
      return
    }
    eachChild(node, function(ch) { collectHosts(ch, out, seen) })
  }

  function findCard(host) {
    // The toast IS the card. Panel/overlay hosts wrap a BorderSurface child.
    if (isChromeCard(host)) return host
    // Shallowest BorderSurface. Menu/clipboard wrap the card in a
    // fullscreen PanelWindow; row cells are BorderSurfaces nested inside
    // the card and must not get a ring.
    var queue = [host]
    var seen = [host]
    var steps = 0
    while (queue.length && steps < 64) {
      steps++
      var node = queue.shift()
      var hit = null
      eachChild(node, function(ch) {
        if (hit) return
        if (isChromeCard(ch)) hit = ch
      })
      if (hit) return hit
      eachChild(node, function(ch) {
        if (seen.indexOf(ch) === -1) {
          seen.push(ch)
          queue.push(ch)
        }
      })
    }
    return null
  }

  function existingShiny(card) {
    var found = null
    eachChild(card, function(ch) {
      if (found) return
      if (ch && ch.objectName === root.tag) found = ch
    })
    return found
  }

  function stockWidth(spec) {
    var w = 0
    if (typeof Border.uniformWidth === "function")
      w = Number(Border.uniformWidth(spec)) || 0
    if (w <= 0 && spec && spec.widths) {
      w = Math.max(
        Number(spec.widths.top) || 0,
        Number(spec.widths.right) || 0,
        Number(spec.widths.bottom) || 0,
        Number(spec.widths.left) || 0
      )
    }
    return w > 0 ? w : 2
  }

  function stockEntry(card) {
    for (var i = 0; i < stock.length; i++) {
      if (stock[i].card === card) return stock[i]
    }
    return null
  }

  function alive(obj) {
    try {
      return !!(obj && obj.borderSpec !== undefined)
    } catch (e) {
      return false
    }
  }

  function hideStock(card) {
    var entry = stockEntry(card)
    var spec = entry ? entry.spec : card.borderSpec
    if (!entry)
      stock.push({ card: card, spec: spec, clip: card.clip })
    // Keep the reserved width so content insets do not jump, but paint that
    // strip as the card fill. A transparent native border insets the fill and
    // punches a hole through to the scrim/wallpaper; the wrapping teal then
    // composites over empty pixels instead of the chrome (preview has no hole
    // — DemoCard fill goes to the edge).
    // NotificationCard sets clip: true; that would scissor the ring at the
    // rounded edge, so drop it while the overlay is on.
    card.borderSpec = Border.flat(card.color, stockWidth(spec))
    card.clip = false
  }

  function restoreStock(card) {
    var entry = stockEntry(card)
    if (!entry) return
    if (!alive(card)) {
      pruneStock()
      return
    }
    card.borderSpec = entry.spec
    if (entry.clip !== undefined) card.clip = entry.clip
    var next = []
    for (var i = 0; i < stock.length; i++) {
      if (stock[i].card !== card) next.push(stock[i])
    }
    stock = next
  }

  function pruneStock() {
    var next = []
    for (var i = 0; i < stock.length; i++) {
      if (alive(stock[i].card)) next.push(stock[i])
    }
    if (next.length !== stock.length) stock = next
  }

  function pluginRoot() {
    if (root.manifest && root.manifest.__sourceDir)
      return String(root.manifest.__sourceDir).replace(/\/$/, "")
    var u = String(Qt.resolvedUrl("."))
    if (u.indexOf("file://") === 0)
      u = u.substring(7)
    if (u.charAt(0) !== "/")
      u = "/" + u
    return u.replace(/\/$/, "")
  }

  function scriptPath(name) {
    return pluginRoot() + "/scripts/" + name
  }

  function lookJson() {
    try {
      return JSON.stringify(root.look)
    } catch (e) {
      return "{}"
    }
  }

  function effectIsShiny() {
    return String(root.look && root.look.effect ? root.look.effect : Look.DEFAULT_EFFECT) === "shiny"
  }

  function runHyprEnsure() {
    if (ensureProc.running)
      return
    ensureProc.command = ["bash", scriptPath("hypr-ensure.sh"), "--look-json", lookJson()]
    ensureProc.running = true
  }

  function runLookApply() {
    if (lookApplyProc.running) {
      root.lookApplyPending = true
      return
    }
    lookApplyProc.command = ["bash", scriptPath("look-apply.sh"), "--eval", "--look-json", lookJson()]
    lookApplyProc.running = true
  }

  function runHyprTeardown() {
    // Detached: this service is being destroyed, so a child Process would die.
    Quickshell.execDetached(["bash", scriptPath("hypr-teardown.sh")])
  }

  function attach(host) {
    if (!alive(host)) return
    var card = findCard(host)
    if (!card || !alive(card)) return
    hideStock(card)
    var shiny = existingShiny(card)
    if (shiny && Number(shiny.overlayRev) !== root.overlayRev) {
      shiny.destroy()
      shiny = null
    }
    if (!shiny) {
      shiny = shinyComp.createObject(card)
      if (!shiny) return
      shiny.radius = Qt.binding(function() { return card.radius })
    }
  }

  function detach(host) {
    if (!alive(host)) {
      pruneStock()
      return
    }
    var card = findCard(host)
    if (!card) return
    if (alive(card)) {
      var shiny = existingShiny(card)
      if (shiny) shiny.destroy()
    }
    restoreStock(card)
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

  function notificationsRoot() {
    if (!root.shell) return null
    var id = "omarchy.notifications"
    var registry = root.shell.pluginRegistry
    if (registry && typeof registry.resolveEnabledId === "function") {
      var resolved = registry.resolveEnabledId(id)
      if (resolved) id = resolved
    }
    if (typeof root.shell.serviceFor === "function")
      return root.shell.serviceFor(id)
    if (typeof root.shell.firstPartyServiceFor === "function")
      return root.shell.firstPartyServiceFor(id)
    return null
  }

  function bindNotificationWatch() {
    var svc = notificationsRoot()
    var model = svc && svc.popupModel ? svc.popupModel : null
    if (popupModelWatch.target !== model)
      popupModelWatch.target = model
  }

  function gatherHosts() {
    var hosts = []
    var seen = []
    var bar = root.shell && root.shell.bar
    if (bar && bar.moduleSlots) {
      for (var i = 0; i < bar.moduleSlots.length; i++) {
        var slot = bar.moduleSlots[i]
        if (slot && slot.activeItem) collectHosts(slot.activeItem, hosts, seen)
      }
    }
    var loaders = root.shell && root.shell.panelLoaders
    if (loaders) {
      for (var id in loaders) {
        var loader = loaders[id]
        if (loader && loader.item) collectHosts(loader.item, hosts, seen)
      }
    }
    var notifications = notificationsRoot()
    if (notifications) collectHosts(notifications, hosts, seen)
    return hosts
  }

  function sweep() {
    pruneStock()
    bindNotificationWatch()
    var hosts = gatherHosts()
    var toastCount = 0
    for (var i = 0; i < hosts.length; i++) {
      if (isNotificationCard(hosts[i])) toastCount++
      if (hostShowing(hosts[i]) && root.effectIsShiny()) attach(hosts[i])
      else detach(hosts[i])
    }
    var expected = 0
    try {
      var svc = notificationsRoot()
      if (svc && svc.popupModel) expected = Number(svc.popupModel.count) || 0
    } catch (e) { expected = 0 }
    if (expected > 0 && toastCount === 0) {
      if (!root.warnedMissingToasts) {
        root.warnedMissingToasts = true
        console.warn(root.tag + ": " + expected
            + " notification popup(s) showing, no NotificationCard found")
      }
    } else if (toastCount > 0) {
      root.warnedMissingToasts = false
    }
  }

  Component {
    id: shinyComp
    ShinyBorder {
      objectName: root.tag
      overlayRev: root.overlayRev
      borderSize: root.look.borderSize
      colA: Look.toQtColor(root.look.colA)
      colB: Look.toQtColor(root.look.colB)
      lobe: root.look.lobe
      mirror: root.look.mirror
      pinDeg: root.look.pinDeg
      angleOffset: root.look.angleOffset
      shimmer: root.look.shimmer
      shimmerHz: root.look.shimmerHz
      shimmerDeg: root.look.shimmerDeg
      shimmerScaleMin: root.look.shimmerScaleMin
      shimmerScaleMax: root.look.shimmerScaleMax
      pulse: root.look.pulse
      pulseHz: root.look.pulseHz
      baseColor: Look.toQtColor(root.look.baseColor)
      gradient: Look.toQtColorList(root.look.gradient)
      gradientPositions: root.look.gradientPositions
      gradientCw: Look.toQtColorList(root.look.gradientCw)
      gradientPositionsCw: root.look.gradientPositionsCw
    }
  }

  Process {
    id: ensureProc
    stdout: StdioCollector {
      id: ensureOut
      waitForEnd: true
      onStreamFinished: {
        var t = String(ensureOut.text || "")
        if (t.indexOf("STATUS=ok") !== -1 || t.indexOf("STATUS=hyprpm") !== -1
            || t.indexOf("STATUS=reuse") !== -1)
          root.hyprReady = true
      }
    }
    onExited: function(exitCode) {
      root.hyprReady = true
      if (exitCode !== 0)
        console.warn(root.tag + ": hypr-ensure exited " + exitCode)
      Qt.callLater(root.runLookApply)
    }
  }

  Process {
    id: lookApplyProc
    onExited: function() {
      if (root.lookApplyPending) {
        root.lookApplyPending = false
        root.runLookApply()
      }
    }
  }

  Timer {
    id: lookApplyTimer
    interval: 150
    repeat: false
    onTriggered: root.runLookApply()
  }

  Timer {
    interval: 200
    running: true
    repeat: true
    onTriggered: root.sweep()
  }

  Connections {
    target: root.shell && root.shell.bar ? root.shell.bar : null
    ignoreUnknownSignals: true
    function onActivePopoutChanged() { Qt.callLater(root.sweep) }
  }

  Connections {
    id: popupModelWatch
    target: null
    ignoreUnknownSignals: true
    function onCountChanged() { Qt.callLater(root.sweep) }
    function onRowsInserted() { Qt.callLater(root.sweep) }
    function onRowsRemoved() { Qt.callLater(root.sweep) }
  }

  onShellChanged: Qt.callLater(root.sweep)
  onLookChanged: if (root.hyprReady) lookApplyTimer.restart()

  Component.onCompleted: {
    Qt.callLater(root.sweep)
    Qt.callLater(root.runHyprEnsure)
  }

  Component.onDestruction: {
    var hosts = gatherHosts()
    for (var i = 0; i < hosts.length; i++)
      detach(hosts[i])
    root.runHyprTeardown()
  }
}
