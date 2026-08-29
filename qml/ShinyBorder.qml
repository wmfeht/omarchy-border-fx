// ShaderEffect overlay: directional light on a rounded-rect ring. Drop on
// one surface (panel chrome or NotificationCard) instead of its borderSpec
// overlay. Pass radius from the host. Heading is pin + shimmer walk — no
// MouseArea, no hyprctl cursorpos. Angle is a light direction; the
// gradient is the pattern of that light, projected along the axis using
// this panel's width and height.
import QtQuick
import "Shimmer.js" as Shimmer
import "Gradient.js" as Gradient
import "Ripple.js" as Ripple

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
  property color colA: "#eef7ffff"
  property color colB: "#000a3f47"
  // Lit-band half-width along the light axis. 0.5 = the whole window.
  property real lobe: 0.16
  // Mirror that lobe onto the far support. Off = facing-only comet.
  property bool mirror: true
  property int pinDeg: 120
  property real angleOffset: 0
  property bool shimmer: true
  property real shimmerHz: 0.28
  property real shimmerDeg: 22
  property real shimmerScaleMin: 0.8
  property real shimmerScaleMax: 1.4
  // Oscillate highlight transparency. Exclusive with shimmer (shimmer
  // wins). Twin of plugin:shiny-border:pulse / pulse_hz.
  property bool pulse: false
  property real pulseHz: 0.4
  property string effect: "shiny"
  property real rippleFreq: 0.025
  property real rippleSpeed: 2
  property real rippleGain: 0.85
  property real ripplePower: 8
  property real rippleOriginX: 0.5
  property real rippleOriginY: 0.5
  property real rippleFade: 0
  property real roundingPower: 2

  // Wrapping ring stroke under the directional highlight. Both hosts
  // composite this in the fragment. Transparent = off. Not Hyprland
  // decoration:shadow, not a gradient stop. Far-side highlight uses the
  // last stop's alpha.
  property color baseColor: "#dd0a3f47"

  // Multi-step ramp, facing support first. Fewer than two colors keeps
  // colA/colB. Stops match Look.DEFAULTS (RRGGBBAA → Qt #AARRGGBB). Last
  // stop is the lobe edge of the comet, not the wrapping teal — that is
  // baseColor. The shader scales 0…100 onto the drawn lit band.
  property var gradient: [
    "#eef7ffff",
    "#000a3f47"
  ]
  property string gradientPositions: "0 99"
  property var gradientCw: []
  property string gradientPositionsCw: "0 22 50 100"

  readonly property real dpr: Screen.devicePixelRatio || 1
  readonly property string _effectMode: Shimmer.effectMode(pulse, pulseHz, shimmer, shimmerHz)
  readonly property bool _shimmerOn: _effectMode === "shimmer"
  readonly property bool _pulseOn: _effectMode === "pulse"
  readonly property bool _rippleOn: effect === "ripple"
  readonly property real _baseAngle: Shimmer.pinnedHeading(pinDeg, angleOffset)
  readonly property real _drawnAngle: _shimmerOn
      ? Shimmer.wrapAngle(_baseAngle + _shimmerAngle)
      : _baseAngle
  readonly property real _drawnLobe: _shimmerOn
      ? Shimmer.lobe(lobe, _shimmerScale)
      : Math.max(lobe, 0.04)
  readonly property real _thickScale: _shimmerOn
      ? Shimmer.thickScale(_shimmerScale)
      : 1
  // On the RHI path, status often stays Uncompiled even while the shader
  // paints. Treat Error as the real failure; Compiled is a bonus.
  readonly property bool shaderOk: ring.status === ShaderEffect.Compiled
  readonly property bool shaderError: ring.status === ShaderEffect.Error
  readonly property int shaderStatus: ring.status
  readonly property string shaderLog: ring.log
  property url shaderSource: Qt.resolvedUrl(_rippleOn ? "../shaders/ripple.frag.qsb" : "../shaders/shiny.frag.qsb")

  property real _shimmerAngle: 0
  property real _shimmerScale: 1
  property var _shimmerState: null
  property real _lastTickMs: 0
  property real _pulseTime: 0
  property real _clockTime: 0

  onShimmerChanged: {
    if (!shimmer) {
      _shimmerAngle = 0
      _shimmerScale = 1
    }
  }

  on_PulseOnChanged: if (_pulseOn) stepPulse()
  on_RippleOnChanged: if (_rippleOn) stepClock()

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

    ring.color = vec4rgba(colA)
    ring.colorSRGB = vec4rgba(colB)
    ring.gradCount = n
    ring.gradColors0 = primary.m0
    ring.gradColors1 = primary.m1
    ring.gradPos0 = primary.p0
    ring.gradPos1 = primary.p1
    ring.gradCountCW = cw.count
    ring.gradColorsCW0 = clockwise.m0
    ring.gradColorsCW1 = clockwise.m1
    ring.gradPosCW0 = clockwise.p0
    ring.gradPosCW1 = clockwise.p1
  }

  function stepShimmer() {
    if (!_shimmerState)
      _shimmerState = Shimmer.makeState(Math.floor(Math.random() * 0xffffffff) || 1)
    var now = Date.now()
    var dt = _lastTickMs === 0 ? Shimmer.tickMs(shimmerHz) / 1000 : (now - _lastTickMs) / 1000
    dt = Math.min(dt, 0.25)
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

  function stepPulse() {
    var u = Shimmer.pulseUniforms(true, Date.now() / 1000, pulseHz)
    _pulseTime = u.time
    if (!_rippleOn)
      _clockTime = _pulseTime
  }

  function stepClock() {
    _clockTime = Ripple.rippleTime(Date.now() / 1000)
  }

  Component.onCompleted: {
    _shimmerState = Shimmer.makeState(Math.floor(Math.random() * 0xffffffff) || 1)
    rebuildRamp()
  }

  ShaderEffect {
    id: ring
    anchors.fill: parent
    visible: status !== ShaderEffect.Error
    blending: true
    fragmentShader: root.shaderSource

    property real widthPx: root.width * root.dpr
    property real heightPx: root.height * root.dpr
    property real radiusOuter: Math.max(root.radius, 0) * root.dpr
    property real roundingPower: root.roundingPower
    property real thick: root.borderSize * root.dpr * root._thickScale
    property real time: (root._pulseOn || root._rippleOn) ? root._clockTime : 0
    property real brightness: root._pulseOn ? root.pulseHz : 0
    property real rippleFreq: root.rippleFreq
    property real rippleSpeed: root.rippleSpeed
    property real rippleGain: root.rippleGain
    property real ripplePower: root.ripplePower
    property real rippleOriginX: root.rippleOriginX
    property real rippleOriginY: root.rippleOriginY
    property real rippleFade: root.rippleFade
    property real range: root._drawnLobe
    property real angle: root._drawnAngle
    property int mirror: root.mirror ? 1 : 0
    property int gradCount: 0
    property int gradCountCW: 0
    property vector4d color
    property vector4d colorSRGB
    property vector4d baseColor: Qt.vector4d(root.baseColor.r, root.baseColor.g, root.baseColor.b, root.baseColor.a)
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
    visible: ring.status === ShaderEffect.Error
    color: "transparent"
    radius: root.radius
    border.width: root.borderSize
    border.color: root.colA
    enabled: false
  }

  Timer {
    interval: Shimmer.tickMs(root._shimmerOn ? root.shimmerHz : (root._pulseOn ? root.pulseHz : 0))
    repeat: true
    triggeredOnStart: true
    running: root.visible && (root._shimmerOn || root._pulseOn || root._rippleOn)
             && ring.status !== ShaderEffect.Error
    onRunningChanged: {
      if (!running) {
        root._lastTickMs = 0
        root._pulseTime = 0
        root._clockTime = 0
      }
    }
    onTriggered: {
      if (root._rippleOn)
        root.stepClock()
      else if (root._pulseOn)
        root.stepPulse()
      if (root._shimmerOn)
        root.stepShimmer()
    }
  }
}
