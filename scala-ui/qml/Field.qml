// Styled text input — a plain QtQuick.Controls TextField themed with design-system
// tokens (a separate file, not an inline component, so it works on every Qt runtime
// the Basecamp host might bundle).
import QtQuick
import QtQuick.Controls
import Logos.Theme

TextField {
    implicitWidth: 120   // don't let the default (large) TextField width force the containing layout wide
    color: Theme.palette.text
    placeholderTextColor: Theme.palette.textTertiary
    font.pixelSize: 14
    selectByMouse: true
    background: Rectangle {
        radius: Theme.spacing.radiusSmall
        color: Theme.palette.background
        border.width: 1
        border.color: Theme.palette.borderHairline
    }
}
