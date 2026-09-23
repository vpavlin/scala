#!/usr/bin/env bash
# Offscreen-render CalendarView.qml with a mock `logos` backend → screenshots in shots/.
# Catches runtime errors, binding errors and gross structural breakage that qmllint can't,
# WITHOUT the Basecamp host.
#
# ⚠️  NOT a DS-layout oracle. This harness pins design-system 1.0.0 + Controls style Basic,
#     but the user runs Basecamp 0.2.0, which bundles a DIFFERENT design-system build (and a
#     different Controls style). Component metrics — TextField default widths, Popup sizing,
#     implicit sizes — therefore DIFFER from production. A layout that looks correct here can
#     still overflow in real Basecamp (this is exactly what misled the 0.9.x event-editor
#     popup-overflow fix: the harness showed it fine while Basecamp overflowed). Use the shots
#     to confirm "it renders / no red errors / the right pieces are present" — NOT to judge
#     widths, wrapping or overflow. For DS-specific layout, verify on the real host.
set -euo pipefail
QB=/nix/store/dkfr32yi7p8cdxsnll05q1kax19fl7ay-qtbase-6.9.2
QDECL=/nix/store/agvpq5n8vcqwnkmn8bp8rlczy3fdxm6n-qtdeclarative-6.9.2
DS=/nix/store/w9ra12n0yabd275v33m8x7lqnnrcgb9f-logos-design-system-1.0.0/lib
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
# moc's parser chokes on raw-string literals in an inline class body — keep callModule
# defined out of line, and generate <name>.moc for the #include at the bottom.
"$QB/libexec/moc" harness.cpp -o harness.moc
g++ -std=c++17 -fPIC harness.cpp -o harness \
  -I"$QB/include" -I"$QB/include/QtCore" -I"$QB/include/QtGui" \
  -I"$QDECL/include" -I"$QDECL/include/QtQml" -I"$QDECL/include/QtQuick" \
  -L"$QB/lib" -L"$QDECL/lib" -lQt6Core -lQt6Gui -lQt6Qml -lQt6Quick
mkdir -p shots; rm -f shots/*.png
export QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software QT_QUICK_CONTROLS_STYLE=Basic
IMPORTS="$QDECL/lib/qt-6/qml:$DS"
export QML2_IMPORT_PATH="$IMPORTS" QML_IMPORT_PATH="$IMPORTS"
export LD_LIBRARY_PATH="$QB/lib:$QDECL/lib"
./harness "$HERE/../qml/CalendarView.qml" "$HERE/shots"
echo "→ shots/ : $(ls shots/*.png | wc -l) screenshots"
echo "⚠️  DS 1.0.0 + Controls Basic — NOT Basecamp 0.2.0's bundle. Trust these for"
echo "    'renders / no errors / structure', NOT for widths/overflow. DS layout → verify on host."
