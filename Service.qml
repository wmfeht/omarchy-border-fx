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
// (shallowest BorderSurface, not inner rows), and overlays ShinyBorder
// as an extra child while visible. Hides the stock stroke once on attach
// (fill-colored, same width) so it does not paint under the ring; restores
// on detach. Not a 200 ms rewrite.
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "qml"
import "qml/Look.js" as Look
import "qml/EnsureStatus.js" as EnsureStatus
import "qml/OverlayAttach.js" as OverlayAttach

Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: ""

  readonly property string tag: "wmfeht-border-fx"
  // Bump when the overlay's look changes so attach() drops leftovers from a
  // previous plugin load. omarchy-shell caches service instances; copying
  // QML is not enough if an old ShinyBorder is still a child of the card.
  readonly property int overlayRev: 16

  // shell.json plugins[] entry is the shared look. Services are not injected
  // a settings object — read it off shell.shellConfig ourselves.
  property var shellConfig: root.shell ? root.shell.shellConfig : null
  readonly property var look: Look.merge(Look.entryFromConfig(root.shellConfig, Look.PLUGIN_ID))

  property bool lookApplyPending: false
  property bool hyprReady: false
  // Cards currently carrying a ShinyBorder child. Entries are
  // {host, card}. Attach-once: a second sync on a member does not
  // recreate the overlay or rewrite stock properties.
  property var attached: []
  // Captured host borderSpec/clip while the overlay is on.
  property var stock: []
  property var hostWatches: []
  property bool warnedMissingToasts: false

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
    if (OverlayAttach.isHost(node)) {
      if (out.indexOf(node) === -1) out.push(node)
      return
    }
    eachChild(node, function(ch) { collectHosts(ch, out, seen) })
  }

  function findCard(host) {
    // The toast IS the card. Panel/overlay hosts wrap a BorderSurface child.
    if (OverlayAttach.isChromeCard(host)) return host
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
        if (OverlayAttach.isChromeCard(ch)) hit = ch
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
      if (!ch) return
      if (ch.objectName === root.tag || ch.objectName === "qs-border-fx")
        found = ch
    })
    return found
  }

  function alive(obj) {
    try {
      return !!(obj && obj.borderSpec !== undefined)
    } catch (e) {
      return false
    }
  }

  function stockEntry(card) {
    for (var i = 0; i < root.stock.length; i++) {
      if (root.stock[i].card === card)
        return root.stock[i]
    }
    return null
  }

  function pruneStock() {
    var next = []
    for (var i = 0; i < root.stock.length; i++) {
      if (alive(root.stock[i].card))
        next.push(root.stock[i])
    }
    if (next.length !== root.stock.length)
      root.stock = next
  }

  // Keep the reserved width so content insets do not jump, but paint that
  // strip as the card fill. A transparent native border punches a hole
  // through to the scrim; the ring would then composite over empty pixels.
  // NotificationCard clip: true would scissor the ring at the rounded edge.
  function hideStock(card) {
    if (!card)
      return
    var entry = stockEntry(card)
    var spec = entry ? entry.spec : card.borderSpec
    if (!entry) {
      var next = []
      for (var i = 0; i < root.stock.length; i++)
        next.push(root.stock[i])
      next.push({ card: card, spec: spec, clip: card.clip })
      root.stock = next
    }
    var w = OverlayAttach.stockWidth(spec)
    if (typeof Border !== "undefined" && typeof Border.uniformWidth === "function") {
      var uw = Number(Border.uniformWidth(spec)) || 0
      if (uw > 0)
        w = uw
    }
    try {
      card.borderSpec = Qt.binding(function() {
        if (typeof Border !== "undefined" && typeof Border.flat === "function")
          return Border.flat(card.color, w)
        return OverlayAttach.hiddenSpec(card.color, w)
      })
    } catch (e) {
      if (typeof Border !== "undefined" && typeof Border.flat === "function")
        card.borderSpec = Border.flat(card.color, w)
      else
        card.borderSpec = OverlayAttach.hiddenSpec(card.color, w)
    }
    card.clip = false
  }

  function restoreStock(card) {
    var entry = stockEntry(card)
    if (!entry)
      return
    if (!alive(card)) {
      pruneStock()
      return
    }
    card.borderSpec = entry.spec
    if (entry.clip !== undefined)
      card.clip = entry.clip
    var next = []
    for (var i = 0; i < root.stock.length; i++) {
      if (root.stock[i].card !== card)
        next.push(root.stock[i])
    }
    root.stock = next
  }

  function pluginRoot() {
    if (root.manifest && root.manifest.__sourceDir)
      return String(root.manifest.__sourceDir).replace(/\/$/, "")
    var u = String(Qt.resolvedUrl("."))
    if (u.indexOf("file://") === 0) {
      var rest = u.substring(7)
      // file:///path -> /path; file://localhost/path -> /path (not /localhost/path)
      if (rest.charAt(0) !== "/") {
        var slash = rest.indexOf("/")
        rest = slash === -1 ? "/" : rest.substring(slash)
      }
      try {
        u = decodeURIComponent(rest)
      } catch (e) {
        u = rest
      }
    }
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
    return Look.effectDraws(root.look && root.look.effect)
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

  function watchEntry(host) {
    for (var i = 0; i < root.hostWatches.length; i++) {
      if (root.hostWatches[i].host === host)
        return root.hostWatches[i]
    }
    return null
  }

  function ensureWatch(host) {
    if (!host || !alive(host))
      return
    if (watchEntry(host))
      return
    var w = hostWatchComp.createObject(root, { watchHost: host })
    if (!w)
      return
    var next = []
    for (var i = 0; i < root.hostWatches.length; i++)
      next.push(root.hostWatches[i])
    next.push({ host: host, watch: w })
    root.hostWatches = next
  }

  function destroyAllWatches() {
    for (var i = 0; i < root.hostWatches.length; i++) {
      if (root.hostWatches[i].watch)
        root.hostWatches[i].watch.destroy()
    }
    root.hostWatches = []
  }

  function pruneWatches() {
    var next = []
    for (var i = 0; i < root.hostWatches.length; i++) {
      var e = root.hostWatches[i]
      if (alive(e.host))
        next.push(e)
      else if (e.watch)
        e.watch.destroy()
    }
    if (next.length !== root.hostWatches.length)
      root.hostWatches = next
  }

  function pruneDeadAttached() {
    var next = []
    for (var i = 0; i < root.attached.length; i++) {
      var card = OverlayAttach.entryCard(root.attached[i])
      var host = OverlayAttach.entryHost(root.attached[i])
      var cardOk = alive(card)
      var hostOk = !host || alive(host)
      if (cardOk && hostOk) {
        next.push(root.attached[i])
        continue
      }
      if (cardOk) {
        var shiny = existingShiny(card)
        if (shiny)
          shiny.destroy()
      }
    }
    if (next.length !== root.attached.length)
      root.attached = next
    pruneStock()
  }

  function syncHost(host, opts) {
    opts = opts || {}
    var disable = opts.disable === true
    var hostAlive = alive(host)
    var card = null
    var shiny = null
    if (hostAlive) {
      card = findCard(host)
      if (card && !alive(card))
        card = null
      if (card)
        shiny = existingShiny(card)
    } else {
      card = OverlayAttach.cardForHost(root.attached, host)
      if (card && alive(card))
        shiny = existingShiny(card)
      else
        card = null
    }

    var decision = OverlayAttach.decideHostSync({
      host: hostAlive ? host : null,
      card: card,
      hostAlive: hostAlive,
      hostDestroyed: !hostAlive,
      effectIsShiny: root.effectIsShiny(),
      attached: root.attached,
      existingOverlayRev: shiny ? shiny.overlayRev : null,
      currentOverlayRev: root.overlayRev,
      disable: disable
    })
    var extra = { host: host, card: card }
    var result = OverlayAttach.applyCardPolicy(root.attached, card, decision, extra)
    var act = result.overlayAction

    if (result.assignStock && card && alive(card))
      hideStock(card)

    if ((act === "destroy" || act === "replace") && shiny) {
      shiny.destroy()
      shiny = null
    }
    var created = true
    if (act === "create" || act === "replace") {
      created = false
      if (card && alive(card)) {
        shiny = shinyComp.createObject(card)
        created = !!shiny
        if (shiny)
          shiny.radius = Qt.binding(function() { return card.radius })
      }
    }
    if (result.restoreStock && card)
      restoreStock(card)
    if (created)
      root.attached = result.attached

    if (hostAlive && !disable)
      ensureWatch(host)
  }

  function teardownChrome() {
    var entries = []
    for (var i = 0; i < root.attached.length; i++)
      entries.push(root.attached[i])
    var gathered = gatherHosts()
    for (var g = 0; g < gathered.length; g++)
      syncHost(gathered[g], { disable: true })
    for (var e = 0; e < entries.length; e++) {
      var h = OverlayAttach.entryHost(entries[e])
      var c = OverlayAttach.entryCard(entries[e])
      if (h)
        syncHost(h, { disable: true })
      if (alive(c)) {
        var shiny = existingShiny(c)
        if (shiny)
          shiny.destroy()
      }
    }
    var leftoverStock = []
    for (var s = 0; s < root.stock.length; s++)
      leftoverStock.push(root.stock[s])
    for (var r = 0; r < leftoverStock.length; r++)
      restoreStock(leftoverStock[r].card)
    root.attached = []
    root.stock = []
    destroyAllWatches()
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

  function syncAll() {
    pruneDeadAttached()
    pruneWatches()
    bindNotificationWatch()
    var hosts = gatherHosts()
    var toastCount = 0
    for (var i = 0; i < hosts.length; i++) {
      if (OverlayAttach.isNotificationCard(hosts[i])) toastCount++
      syncHost(hosts[i])
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
      effect: root.look.effect
      rippleFreq: root.look.rippleFreq
      rippleSpeed: root.look.rippleSpeed
      rippleGain: root.look.rippleGain
      ripplePower: root.look.ripplePower
      rippleOriginX: root.look.rippleOriginX
      rippleOriginY: root.look.rippleOriginY
      rippleFade: root.look.rippleFade
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
        if (EnsureStatus.isEnsureSuccessStatus(ensureOut.text))
          root.hyprReady = true
      }
    }
    onExited: function(exitCode) {
      if (EnsureStatus.isEnsureSuccessStatus(ensureOut.text))
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

  Component {
    id: hostWatchComp
    Connections {
      id: conn
      ignoreUnknownSignals: true
      property var watchHost: null
      target: watchHost
      function onVisibleChanged() { if (conn.watchHost) root.syncHost(conn.watchHost) }
      function onOpenedChanged() { if (conn.watchHost) root.syncHost(conn.watchHost) }
      function onOpenChanged() { if (conn.watchHost) root.syncHost(conn.watchHost) }
      function onTargetChanged() {
        if (!conn.target && conn.watchHost)
          root.syncHost(conn.watchHost)
      }
    }
  }

  Timer {
    id: discoverTimer
    interval: 200
    running: true
    repeat: true
    // Host discovery only. syncHost is attach-once; already-attached
    // showing cards do not rewrite borderSpec/clip.
    onTriggered: root.syncAll()
  }

  Connections {
    target: root.shell && root.shell.bar ? root.shell.bar : null
    ignoreUnknownSignals: true
    function onActivePopoutChanged() { Qt.callLater(root.syncAll) }
  }

  Connections {
    id: popupModelWatch
    target: null
    ignoreUnknownSignals: true
    function onCountChanged() { Qt.callLater(root.syncAll) }
    function onRowsInserted() { Qt.callLater(root.syncAll) }
    function onRowsRemoved() { Qt.callLater(root.syncAll) }
  }

  onShellChanged: Qt.callLater(root.syncAll)
  onLookChanged: {
    if (root.hyprReady) lookApplyTimer.restart()
    Qt.callLater(root.syncAll)
  }

  Component.onCompleted: {
    Qt.callLater(root.syncAll)
    Qt.callLater(root.runHyprEnsure)
  }

  Component.onDestruction: {
    root.teardownChrome()
    root.runHyprTeardown()
  }
}
