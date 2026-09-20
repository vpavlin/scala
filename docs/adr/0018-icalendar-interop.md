# 18. iCalendar (.ics) import/export — interop with the rest of the world

- **Status:** decided / built (scala core 0.9.17–0.9.18, scala_ui 0.8.8, mobile 0.9.61).
- **Date:** 2026-09-20

## Context

Scala is a self-contained, offline-first shared calendar ([ADR 0001](0001-event-log-crdt.md)),
but a calendar that can't exchange events with the rest of the world is an island. People already
have events in Google Calendar, Apple Calendar, Thunderbird, conference `.ics` invites, etc.
[iCalendar / RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) is the one format they all speak.
We want to **import** an `.ics` into a scala calendar and **export** a scala calendar to `.ics`,
without adding a server, an account, or a heavyweight dependency.

## Decision

Add a **file-format seam only** — no change to the event log, fold, sync, roles, or crypto. An
imported VEVENT becomes an ordinary scala event (authored + signed like any other, so it converges
and obeys permissions); an exported event is a plain VEVENT. The mapping is intentionally small and
lossless for what scala models:

| scala event field | iCalendar |
|---|---|
| `startTime` / `endTime` (ms) | `DTSTART` / `DTEND` — UTC `…Z`, or `VALUE=DATE` when `allDay` (DTEND is exclusive → +1 day) |
| `title` | `SUMMARY` |
| `description` | `DESCRIPTION` |
| `location` | `LOCATION` |
| `url` | `URL` |
| `recur` `{freq,interval,until}` | `RRULE:FREQ=…;INTERVAL=…;UNTIL=…` (DAILY/WEEKLY/MONTHLY/YEARLY) |
| `id` | `UID` (`<id>@scala`) |

Text is escaped (`\ ; , \n`) and content lines are folded at 75 octets per §3.1; the parser unfolds
continuation lines first. Import parses UTC (`Z`), floating (→ local), and `VALUE=DATE` all-day
values, and defaults a missing `DTEND` (+1h, or same-day for all-day). Custom fields, attachments,
and reminders are **not** represented in `.ics` (no standard mapping we want to commit to) — they
survive within scala but don't cross the format boundary.

The logic is implemented **twice, deliberately** — once in the desktop core (C++,
`scala_impl.cpp`) and once in mobile (`mobile/src/lib/ics.ts`) — because the two platforms have
independent engines ([ADR 0006](0006-two-clients-one-fold.md)); they are kept byte-compatible so an
`.ics` round-trips between them and any third-party app.

- **Desktop:** `exportCalendarIcs(calId)` / `importIcs(calId, text)` (+ path wrappers
  `exportCalendarIcsFile` / `importIcsFile` for the view's native file dialogs). Calendar settings →
  *Export .ics* / *Import .ics*.
- **Mobile:** `buildIcs` / `parseIcs`. Export saves to the device's Downloads; import reads an
  `.ics` from the **clipboard** (avoids a document-picker native dependency). Calendar settings →
  *Export .ics* / *Import .ics*.

## Consequences

- Interop with every major calendar app, both directions, with no server or account.
- Imported events are authored by the importing identity — on a **restricted** calendar you can only
  import if you may add events there (the fold enforces it, same as manual entry); a bulk import onto
  a **keycard**-bound calendar would queue one tap per event (import to a device/soft calendar
  instead). Acceptable; noted, not solved.
- Timezone handling is UTC/floating/all-day only — no `VTIMEZONE`/`TZID` database. Floating and
  `TZID` times are read as local; adequate for personal/shared use, revisit if it bites.
- Two implementations to keep in step; covered by the shared table above and a round-trip check.
