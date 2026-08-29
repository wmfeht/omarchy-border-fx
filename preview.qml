//@ pragma ShellId qs-shiny-border-preview
//@ pragma AppId qs-shiny-border
//@ pragma DataDir $BASE/qs-shiny-border-preview
//@ pragma StateDir $BASE/qs-shiny-border-preview
//@ pragma CacheDir $BASE/qs-shiny-border-preview

// Standalone Quickshell window: ShinyBorder on mock cards, not omarchy-shell.
// Does not clone plugins, does not patch Ui/, does not load into the live shell.
// Entry is at the repo root so `import "qml"` stays inside the qs config folder.
//   mise run preview          stay open; Esc/q or close the window
//   mise run smoke            wait until the overlay is on screen and not Error
import QtQuick
import Quickshell
import "harness"

ShellRoot {
  id: root

  readonly property bool smoke: {
    var v = String(Quickshell.env("SHINY_SMOKE") || "").toLowerCase()
    return v === "1" || v === "true" || v === "yes"
  }
  property bool smoked: false
  readonly property bool laidOut: live.shiny.width >= 1 && live.shiny.height >= 1
  readonly property string shaderLabel: live.shaderError
      ? "error (flat fallback)"
      : (live.shaderOk ? "compiled" : (root.laidOut ? "active" : "loading"))

  function finishSmoke(ok, why) {
    if (!smoke || smoked)
      return
    smoked = true
    if (ok)
      console.log("qs-shiny-border: shader ready")
    else
      console.warn("qs-shiny-border: shader " + why)
    Qt.exit(ok ? 0 : 1)
  }

  Connections {
    target: Quickshell
    function onLastWindowClosed() {
      if (!root.smoked)
        Qt.quit()
    }
  }

  // RHI often leaves ShaderEffect.status at Uncompiled while still drawing.
  // Fail only on Error; otherwise require a laid-out overlay and a short settle.
  Timer {
    interval: 400
    running: root.smoke && root.laidOut && !root.smoked
    repeat: false
    onTriggered: {
      if (live.shaderError)
        root.finishSmoke(false, "error: " + live.shaderLog)
      else
        root.finishSmoke(true, "")
    }
  }

  Timer {
    interval: 8000
    running: root.smoke && !root.smoked
    repeat: false
    onTriggered: root.finishSmoke(false, "timeout")
  }

  FloatingWindow {
    id: win
    title: "qs-shiny-border"
    color: "#0b0d0e"
    implicitWidth: 440
    implicitHeight: 720
    minimumSize: Qt.size(400, 400)

    onVisibleChanged: {
      if (!visible && !root.smoked)
        Qt.quit()
    }

    FocusScope {
      anchors.fill: parent
      focus: true
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape || event.key === Qt.Key_Q) {
          event.accepted = true
          win.visible = false
        }
      }

      Flickable {
        id: flick
        anchors.fill: parent
        anchors.margins: 24
        contentWidth: width
        contentHeight: col.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick

        Column {
          id: col
          width: flick.width
          spacing: 18

          Column {
            width: parent.width
            spacing: 4
            Text {
              text: "qs-shiny-border"
              color: "#cacccc"
              font.pixelSize: 16
              font.weight: Font.DemiBold
            }
            Text {
              text: "standalone window · not omarchy-shell · shader " + root.shaderLabel
              color: "#707880"
              font.pixelSize: 12
            }
            Text {
              width: parent.width
              wrapMode: Text.WordWrap
              text: "Park this next to a focused Hyprland window. Pin 120 is a light from ≈11 o'clock; wide and tall cards should share that direction."
              color: "#707880"
              font.pixelSize: 11
            }
          }

          DemoCard {
            id: live
            title: "Notification card"
            body: "Live looknfeel: 2-stop light glint, pin 120, shimmer 0.28 Hz."
            caption: "defaults — light from ≈11 o'clock, stretched across this card"
            shiny.effect: {
              var v = String(Quickshell.env("BORDER_FX_EFFECT") || "").toLowerCase()
              return v === "ripple" ? "ripple" : "shiny"
            }
          }

          DemoCard {
            title: "Heading check"
            body: "pin 0, shimmer off. Light from the right; the right side should be the hot edge."
            caption: "pinDeg 0 · light from 3 o'clock"
            shiny.shimmer: false
            shiny.pinDeg: 0
          }

          Row {
            spacing: 16

            DemoCard {
              cardWidth: 240
              cardHeight: 52
              title: "Wide"
              body: "Pin 120, shimmer off."
              caption: "wide · same light as Tall"
              shiny.shimmer: false
            }

            DemoCard {
              cardWidth: 120
              cardHeight: 220
              title: "Tall"
              body: "Pin 120, shimmer off."
              caption: "tall · same light as Wide"
              shiny.shimmer: false
            }
          }

          DemoCard {
            title: "Two-color"
            body: "Ramp off; colA / colB branch, same as a <2-stop spec."
            caption: "gradient []"
            shiny.shimmer: false
            shiny.gradient: []
          }

          DemoCard {
            title: "Pulse"
            body: "Shimmer off; highlight alpha breathes at 0.4 Hz. Same uniforms as a pulsing window."
            caption: "pulse · chrome should match a pulsing window"
            shiny.shimmer: false
            shiny.pulse: true
            shiny.pulseHz: 0.4
          }

          DemoCard {
            cardWidth: 320
            cardHeight: 180
            radius: 16
            title: "Panel"
            body: "Larger chrome, 16px rounding. Still a drop-on-one-surface overlay."
            caption: "not a shell-wide BorderSurface hook"
          }

          Text {
            width: parent.width
            text: "Esc / q closes. This process is qs -p preview.qml, not omarchy-shell."
            color: "#4e5254"
            font.pixelSize: 11
          }
        }
      }
    }
  }

  Component.onCompleted: {
    if (smoke)
      Quickshell.watchFiles = false
  }
}
