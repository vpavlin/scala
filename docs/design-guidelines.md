# Scala Design Guidelines

The visual language shared by Scala's two front ends — the **mobile app** (React Native) and the
**Basecamp desktop view** (QML). Extracted from the shipping code so it's the real system, not an
aspiration. It's **Catppuccin Mocha**, dark-only, warm and soft. Reuse it for any new Scala/Loam
surface (and as the starting point for **Frequencies**).

> Platform note: mobile hardcodes these as a `C` constants object; desktop hardcodes them as
> `root.cX` properties in `CalendarView.qml` (the bundled Logos design system is a colder, flatter
> dark, so we override it). Keep the two in sync — same hexes, same roles.

## 1. Colour — Catppuccin Mocha

| Role | Hex | mobile `C` | desktop `root.` | Use |
|---|---|---|---|---|
| Base (app bg) | `#1e1e2e` | `bg` | `cBase` | main canvas, input fills |
| Mantle (panels) | `#181825` | — | `cMantle` | side panels (sidebar, agenda), week columns |
| Crust (deepest) | `#11111b` | — | `cCrust` | text **on** accent fills (blue/yellow buttons) |
| Surface | `#2a2a3c` | `surface` | `cSurface` | cards, selected rows, modals, secondary buttons |
| Surface2 | `#313244` | `border` | `cSurface2` | hairlines, borders, hover, input outline |
| Overlay | `#45475a` | — | `cOverlay` | stronger dividers (rare) |
| Text | `#cdd6f4` | `text` | `cText` | primary text |
| Subtext | `#9399b2` | `sub` | `cSub` | secondary text, labels, times |
| Faint | `#6c7086` | — | `cFaint` | out-of-month days, tertiary/placeholder |
| **Blue (primary)** | `#89b4fa` | `primary` | `cBlue` | primary action, selection, links, "today" ring on selection |
| **Yellow (today)** | `#f9e2af` | `today` | `cYellow` | the "today" marker (filled circle) |
| Green (accent) | `#a6e3a1` | `accent` | `cGreen` | positive / confirm accent |
| Red (danger) | `#f38ba8` | `danger` | `cRed` | destructive actions, validation errors |
| Mauve | `#cba6f7` | — | `cMauve` | spare accent (e.g. a calendar colour) |

**Per-calendar colour** is separate from the palette: each calendar has its own colour (derived from
its id) used for its event **dots** (month), **stripes** (event cards), and its sidebar dot. Never
use a semantic colour (blue/yellow/red) to mean "a calendar."

Dark-only by design — matching the mobile app. No light theme; `body`/panes always paint an explicit
Catppuccin background.

## 2. Typography

- One system font stack; **numeric sizes only** (the bundled DS has no size tokens — that was the old
  "invisible text" bug on desktop).
- Scale (px): **10** (column labels) · **11** (meta, dots labels) · **12** (secondary, chips) ·
  **13** (body, inputs) · **14** (list titles, buttons) · **18** (panel headings) · **20** (month title).
- Weight: normal for body; **medium** for headings, selected chips, primary buttons, "today". No bold.
- `elide`/`numberOfLines` everything in a row so long titles never break layout.

## 3. Spacing & shape

- Spacing steps: **4 / 6 / 8** and the DS `small` / `medium` on desktop. Gutters ~14–16px.
- Radii: **7** (small chips/cards-in-cards) · **8–9** (buttons, inputs, rows, nav) · **10** (day cells,
  list cards) · **12** (event cards, modals) · **full/15** (pills like "Today").
- Layout uses flex/`gap` (RN) and `Layout` + `spacing` (QML) — never per-element margins that collapse.

## 4. Components

| Component | Spec |
|---|---|
| **Primary button** | `cBlue` fill, `cCrust` label, radius 8–9, weight medium; hover `Qt.darker(cBlue,1.12)` |
| **Secondary button** | `cSurface` fill **or** transparent + `cSurface2` 1px border; `cText` label |
| **Icon button** (nav ‹ ›) | 34×34, `cSurface`, radius 9, hover `cSurface2` |
| **Pill** ("Today") | content-width, height 30, radius 15, transparent + `cSurface2` border, `cSub` label |
| **Segmented toggle** (Month/Week) | `cSurface` container; selected segment `cBlue` fill + `cCrust` label; others transparent + `cSub` |
| **Chip** (field type, reminder, tier) | radius 7–9; **selected** = `cBlue` fill+`cCrust` **or** `cBlue` 1px outline; unselected = transparent/`cSurface` + `cSub` |
| **Input / search** | `cBase` fill, `cSurface2` border (→ `cBlue` on focus), radius 8–9, `cText`, `cSub` placeholder; search prefixes 🔍 |
| **Card** (event) | `cSurface`, radius 10–12, a 3–4px calendar-colour **stripe** on the left; hover `cSurface2` |
| **Day cell** (month) | transparent, radius 10; **today** = filled `cYellow` circle with `cCrust` number; **selected** = `cSurface` fill + 1px `cBlue` border; out-of-month = `cFaint`; up to 4 calendar-colour dots |
| **Row** (sidebar/list) | radius 9; selected `cSurface`, hover `cBase`, else transparent; leading 10px colour dot |
| **Modal** | `cSurface` fill + `cSurface2` border, radius 12; inputs inside use `cBase` (darker than the modal) |
| **Banner** (offline/system) | amber for local ("not connected": `#3a2f1a` bg / `#f9e2af`), or the SDK `SharedNodeBanner` orange for node/approval — tap-through, one line + sub |

## 5. Interaction patterns (the "rules")

1. **Today is yellow, selection is blue.** A filled yellow circle marks today; a blue outline (+ surface
   fill) marks the selected day/row/chip. Never overload these two.
2. **Primary action = blue, destructive = red.** One blue primary per surface (`+ Event`, Save/Create,
   Publish). Delete/errors are `cRed`. Secondary actions are surface/outline, not coloured.
3. **Colour means "which calendar", not "what kind".** Calendar colour → dots/stripes/sidebar dot.
   Event *type/status* (Draft/Confirmed…) is a **custom field**, rendered as a chip, not a palette colour.
4. **Panels are darker than content.** Sidebar/agenda = `cMantle`; the calendar canvas = `cBase`; cards
   float on `cSurface`. This layering is what reads as "modern," not borders.
5. **Everything rounded, hover-lit.** Rounded corners everywhere; interactive rows/cards lighten one step
   on hover (`→ cSurface2`) and use a pointing cursor.
6. **Copy is plain and active.** "Duplicate", "No events match your search.", "Not connected to Loam —
   … tap to open Loam". Errors say what's wrong and what to do.
7. **Parity first.** A pattern added to one platform ships on the other with the same tokens (month grid,
   today circle, search, access tiers, offline banner all match across mobile ↔ desktop).

## 6. Where the tokens live

- **Mobile:** `mobile/App.tsx` (`C` in styles), `mobile/src/components/MonthGrid.tsx`,
  `EventModal.tsx` (each file defines the same `C`).
- **Desktop:** `scala-ui/qml/CalendarView.qml` — the `root.cX` block near the top is the source of truth;
  `qml-harness/render.sh` renders it offscreen against the real DS + Qt for visual checks.

When adding a colour or component, add it in **both** places with the same hex, and prefer an existing
token over a new one.
