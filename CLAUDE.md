# Scala — notes for contributing agents

Scala is a local-first, server-less, end-to-end-encrypted shared calendar on Logos/Loam:
a Basecamp desktop view (QML, `scala-ui/`), an Android app (React Native, `mobile/`), and a
C++ core (`src/`). Desktop and mobile keep **feature + design parity** — a visible change ships on
both, with the same tokens.

## Before touching the UI

Read **[`docs/design-guidelines.md`](docs/design-guidelines.md)** — the shared Catppuccin design
system *and* the agent playbook: reuse a token (don't invent one; add new ones to both `C` in mobile
and `root.cX` on desktop), never use the DS `Theme.palette.*` on desktop (it's overridden), numeric
font sizes only, and **no silent actions** (show success/failure; guard async against double-fire).

## Verify (don't guess)

- **Desktop view:** `scala-ui/qml-harness/render.sh` renders `CalendarView.qml` offscreen → `shots/*.png`;
  read them. `Unable to assign [undefined] to QColor` = a stray/undefined token. ⚠️ It pins DS 1.0.0 +
  Controls Basic, **not** Basecamp 0.2.0's bundle, so it is a runtime/binding/**structural** smoke test
  only — trust it for "renders / no errors / right pieces present", **NOT** for widths, wrapping or
  overflow (that mismatch misled the event-editor popup fix). DS-specific layout → verify on the real host.
- **Mobile:** `cd mobile && npx tsc --noEmit -p tsconfig.json` clean for the files you touched. To
  confirm a string landed in a release APK, grep the Hermes bundle — but non-ASCII strings
  (emoji/em-dash) are stored **UTF-16**, so use `strings -e l`, not plain grep.

## Correctness invariants

- The core fold (`src/scala_engine.hpp`) and the mobile fold (`mobile/src/lib/engine.ts`) must stay
  **byte-identical** — a golden-vector parity test (`test/parity`) guards them. Change both together.
- Signatures are always required; the fold silently drops unverified events. Identity/signing is
  loam-based (loam-keycard), not scala's own key.

## Shipping

Build as testable batches: bump versions (`scala-ui/metadata.json`, `mobile/app.json` +
`android/app/build.gradle`), build (`nix build .#lgx-portable` for core/view; gradle
`assembleRelease` for mobile), publish to the LAN repos, note the versions on the PR. CI already
uploads the `.lgx` artifacts on each push.
