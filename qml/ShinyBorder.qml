// ShaderEffect overlay: directional light on a rounded-rect ring. Drop on
// one surface (panel chrome or NotificationCard) instead of its borderSpec
// overlay. Pass radius from the host. Heading is pin + shimmer walk — no
// MouseArea, no hyprctl cursorpos. Angle is a light direction; the
// gradient is the pattern of that light, projected along the axis using
// this panel's width and height.
import QtQuick
import "Shimmer.js" as Shimmer
import "Gradient.js" as Gradient

Item {
  id: root

  anchors.fill: parent
  z: 100000
  visible: width >= 1 && height >= 1 && borderSize > 0

  property int borderSize: 2
  property real radius: 0
  // Stamped by the service so attach() can drop leftovers from a previous
  // plugin load. Must be a real property: typed QML items reject ad-hoc
  // assigns (same reason BorderSurface will not take `_qsShiny*`).
  property int overlayRev: 0
  property color colA: "#ee33ccff"
  property color colB: "#ee00ff99"
  // Lit-band half-width along the light axis. 0.5 = the whole window.
  property real lobe: 0.18
  property int pinDeg: 120
  property real angleOffset: 0
  property bool shimmer: true
  property real shimmerHz: 0.3
  property real shimmerDeg: 20
  property real shimmerScaleMin: 0.75
  property real shimmerScaleMax: 1.35
  property real roundingPower: 2

  // Hyprland's focused decoration:shadow (rgba(00687855), range 2). The
  // shader crushes the far side to ~5.5% alpha on both halves, so stuffing
  // this hue into the last gradient stop never wrapped the ring. Layer-shell
  // chrome has no drop-shadow; this stroke is that ring. Transparent = off.
  property color baseColor: "#55006878"

  // Multi-step ramp, facing support first. Fewer than two colors keeps
  // colA/colB. Stops match looknfeel.lua (RRGGBBAA → Qt #AARRGGBB). Last
  // stop is the far side of the light axis, not the wrapping teal — that
  // is baseColor.
  property var gradient: [
    "#ee33ccff",
    "#ee1ad4c0",
    "#ee007a48",
    "#aa004830"
  ]
  property string gradientPositions: "0 1 3 100"
  property var gradientCw: []
  property string gradientPositionsCw: "0 22 50 100"

  readonly property real dpr: Screen.devicePixelRatio || 1
  readonly property real _baseAngle: Shimmer.pinnedHeading(pinDeg, angleOffset)
  readonly property real _drawnAngle: Shimmer.wrapAngle(_baseAngle + _shimmerAngle)
  readonly property real _drawnLobe: shimmer && shimmerHz > 0
      ? Shimmer.lobe(lobe, _shimmerScale)
      : Math.max(lobe, 0.04)
  readonly property real _thickScale: shimmer && shimmerHz > 0
      ? Shimmer.thickScale(_shimmerScale)
      : 1
  // On the RHI path, status often stays Uncompiled even while the shader
  // paints. Treat Error as the real failure; Compiled is a bonus.
  readonly property bool shaderOk: effect.status === ShaderEffect.Compiled
  readonly property bool shaderError: effect.status === ShaderEffect.Error
  readonly property int shaderStatus: effect.status
  readonly property string shaderLog: effect.log
  property url shaderSource: Qt.resolvedUrl("../shaders/shiny.frag.qsb")

  property real _shimmerAngle: 0
  property real _shimmerScale: 1
  property var _shimmerState: null
  property real _lastTickMs: 0

  onShimmerChanged: {
    if (!shimmer) {
      _shimmerAngle = 0
      _shimmerScale = 1
    }
  }

  onColAChanged: rebuildRamp()
  onColBChanged: rebuildRamp()
  onGradientChanged: rebuildRamp()
  onGradientPositionsChanged: rebuildRamp()
  onGradientCwChanged: rebuildRamp()
  onGradientPositionsCwChanged: rebuildRamp()

  function vec4rgba(c) {
    var x = Gradient.toRgba(c)
    return Qt.vector4d(x.r, x.g, x.b, x.a)
  }

  function mat4(args) {
    return Qt.matrix4x4(
      args[0], args[1], args[2], args[3],
      args[4], args[5], args[6], args[7],
      args[8], args[9], args[10], args[11],
      args[12], args[13], args[14], args[15]
    )
  }

  function packRamp(stops, pos) {
    var p0 = Gradient.packPos4(pos, 0)
    var p1 = Gradient.packPos4(pos, 4)
    return {
      m0: mat4(Gradient.packColorMat4Args(stops, 0)),
      m1: mat4(Gradient.packColorMat4Args(stops, 4)),
      p0: Qt.vector4d(p0[0], p0[1], p0[2], p0[3]),
      p1: Qt.vector4d(p1[0], p1[1], p1[2], p1[3])
    }
  }

  function rebuildRamp() {
    var stops = Gradient.normalizeStops(gradient)
    var n = Gradient.stepCount(stops.length)
    var resolved = Gradient.resolvePositions(gradientPositions, n)
    var cwStops = Gradient.normalizeStops(gradientCw)
    var cw = Gradient.resolveCwSide(stops, resolved.pos, n, cwStops, gradientPositionsCw)
    var primary = packRamp(Gradient.padStops(stops, n), resolved.pos)
    var clockwise = packRamp(cw.stops, cw.pos)

    effect.color = vec4rgba(colA)
    effect.colorSRGB = vec4rgba(colB)
    effect.gradCount = n
    effect.gradColors0 = primary.m0
    effect.gradColors1 = primary.m1
    effect.gradPos0 = primary.p0
    effect.gradPos1 = primary.p1
    effect.gradCountCW = cw.count
    effect.gradColorsCW0 = clockwise.m0
    effect.gradColorsCW1 = clockwise.m1
    effect.gradPosCW0 = clockwise.p0
    effect.gradPosCW1 = clockwise.p1
  }

  function stepShimmer() {
    if (!_shimmerState)
      _shimmerState = Shimmer.makeState(Math.floor(Math.random() * 0xffffffff) || 1)
    var now = Date.now()
    var dt = _lastTickMs === 0 ? Shimmer.tickMs(shimmerHz) / 1000 : (now - _lastTickMs) / 1000
    _lastTickMs = now
    Shimmer.step(_shimmerState, dt, {
      hz: shimmerHz,
      angleRangeRad: shimmerDeg * Math.PI / 180,
      scaleMin: shimmerScaleMin,
      scaleMax: shimmerScaleMax
    })
    _shimmerAngle = _shimmerState.angle.value
    _shimmerScale = _shimmerState.scale.value
  }

  Component.onCompleted: {
    _shimmerState = Shimmer.makeState(Math.floor(Math.random() * 0xffffffff) || 1)
    rebuildRamp()
  }

  Rectangle {
    anchors.fill: parent
    visible: root.baseColor.a > 0 && effect.status !== ShaderEffect.Error
    color: "transparent"
    radius: root.radius
    border.width: Math.max(root.borderSize, 1)
    border.color: root.baseColor
    antialiasing: true
    enabled: false
  }

  ShaderEffect {
    id: effect
    anchors.fill: parent
    visible: status !== ShaderEffect.Error
    blending: true
    fragmentShader: root.shaderSource

    property real widthPx: root.width * root.dpr
    property real heightPx: root.height * root.dpr
    property real radiusOuter: Math.max(root.radius, 0) * root.dpr
    property real roundingPower: root.roundingPower
    property real thick: root.borderSize * root.dpr * root._thickScale
    property real time: 0
    property real brightness: 0
    property real range: root._drawnLobe
    property real angle: root._drawnAngle
    property int gradCount: 0
    property int gradCountCW: 0
    property vector4d color
    property vector4d colorSRGB
    property matrix4x4 gradColors0
    property matrix4x4 gradColors1
    property vector4d gradPos0
    property vector4d gradPos1
    property matrix4x4 gradColorsCW0
    property matrix4x4 gradColorsCW1
    property vector4d gradPosCW0
    property vector4d gradPosCW1
  }

  Rectangle {
    anchors.fill: parent
    visible: effect.status === ShaderEffect.Error
    color: "transparent"
    radius: root.radius
    border.width: root.borderSize
    border.color: root.colA
    enabled: false
  }

  Timer {
    interval: Shimmer.tickMs(root.shimmerHz)
    repeat: true
    triggeredOnStart: true
    running: root.visible && root.shimmer && root.shimmerHz > 0
             && effect.status !== ShaderEffect.Error
    onRunningChanged: if (!running) root._lastTickMs = 0
    onTriggered: root.stepShimmer()
  }
}
