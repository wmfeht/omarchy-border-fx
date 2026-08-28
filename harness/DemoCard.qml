// Mock chrome surface for the standalone preview. Not an Omarchy plugin.
import QtQuick
import "../qml"

Item {
  id: root

  property alias shiny: border
  readonly property alias shaderOk: border.shaderOk
  readonly property alias shaderError: border.shaderError
  readonly property alias shaderStatus: border.shaderStatus
  readonly property alias shaderLog: border.shaderLog

  property int cardWidth: 380
  property int cardHeight: 88
  property alias radius: card.radius
  property alias cardColor: card.color
  property string title: ""
  property string body: ""
  property string caption: ""

  implicitWidth: cardWidth
  implicitHeight: cardHeight + (caption.length ? 22 : 0)

  Rectangle {
    id: card
    width: root.cardWidth
    height: root.cardHeight
    radius: 12
    color: "#101315"

    ShinyBorder {
      id: border
      radius: card.radius
      // Resolve from this file so the qsb is found even if ShinyBorder's
      // own Qt.resolvedUrl is evaluated against a different QML document.
      shaderSource: Qt.resolvedUrl("../shaders/shiny.frag.qsb")
    }

    Column {
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: 16
      anchors.rightMargin: 16
      spacing: 4

      Text {
        width: parent.width
        text: root.title
        color: "#cacccc"
        font.pixelSize: 14
        font.weight: Font.DemiBold
        elide: Text.ElideRight
      }

      Text {
        width: parent.width
        visible: text.length > 0
        text: root.body
        color: "#8a8e90"
        font.pixelSize: 12
        wrapMode: Text.WordWrap
      }
    }
  }

  Text {
    anchors.top: card.bottom
    anchors.topMargin: 6
    visible: root.caption.length > 0
    text: root.caption
    color: "#707880"
    font.pixelSize: 11
  }
}
