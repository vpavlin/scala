# 22. App-to-app intents: other apps can ask Scala to do calendar things

- **Status:** proposed
- **Date:** 2026-10-04

## Context

Basecamp 0.3.1 ships app-to-app intents (logos-basecamp `docs/app-to-app-intents.md`). An app lists
what it can do under `provides` in its `metadata.json`. Another app asks with
`logos.request("<intent>", params, cb)`, after listing the intent under `uses` in its own metadata.
Basecamp then:

1. asks the user to confirm (always, even with one provider);
2. brings the providing app forward;
3. delivers `onIntentRequested(requestId, intent, params, requesterName)` to its view;
4. returns the view's `logos.respond(requestId, ok, data, error)` to the caller, then takes the user
   back to the caller.

Providers are `ui_qml` apps by design: intents are for actions a person chooses.

Without intents, another app's only way into Scala is to call the `scala` core directly. That means
learning its method signatures, its double-encoded JSON and its epoch-millisecond strings. It also
gets the calendar keys, which `listCalendars` returns, and it bypasses everything the view does to
choose the identity that signs. The first such caller is Basecamp Voice, which drives Basecamp from
speech ("add dentist on Tuesday at 3"). Any app could be next, for example a chat app adding a meetup.

## Decision

`scala_ui` provides eight intents, handled in `CalendarView.qml` (`handleIntent`):

| Intent | Params | Answers with |
|---|---|---|
| `scala.calendars.list` | — | `calendars: [{name, events, canAdd}]` |
| `scala.events.list` | `from?`, `to?`, `calendar?` | `events: [{title, start, end?, allDay?, location?, calendar}]`, occurrences expanded, ≤ 50 |
| `scala.events.search` | `query` | the same shape, ≤ 50 |
| `scala.event.create` | `title`, `start`, `end?`, `calendar?`, `location?`, `description?` | `event` (same shape) |
| `scala.calendar.create` | `name` | `calendar: {name}` |
| `scala.calendar.join` | `link` (`scala://join?…`) | `calendar: {name}` |
| `scala.calendar.share` | `calendar?` | opens the share dialog; hand-off |
| `scala.calendar.show` | `date?`, `view?` (`day`/`week`/`month`) | shows it; hand-off |

- **Every parameter is a string.**
  - Times are local: `2026-10-05` for a day, `2026-10-05T15:00` for a time. A bare date makes an
    all-day event and, as an end, includes that whole day.
  - These are what a person, or a language model, says. The view converts them, the same way
    `saveEvent` does.
- **Calendars are named, never identified by id.**
  - A name matches exactly (any case), or else the one calendar whose name contains it.
  - With no name given: the last calendar used, or the only one.
  - For writes, only calendars the user can add to (`canAddTo`) count.
- **Nothing secret crosses.**
  - Answers carry names, titles, times and locations. Never ids, keys, authors or attachments.
  - `scala.calendar.share` does not return the invite link. It opens Scala's own share dialog (a
    hand-off), so the user stays in Scala and decides who gets the link.
- **Writes go through the view's own path.**
  - Event creation uses `createEvent`, so keycard-bound calendars show the usual "hold your Keycard"
    overlay. Basecamp has already brought Scala forward, so the user sees it.
  - Calendar creation uses `createDefaultOwner`, so a keycard is never chosen silently.
- **Failures the user can fix are explained in Scala.**
  - The envelope carries only an error code (`bad_request`, `failed`), by Basecamp's design. So an
    unknown calendar, a bad date or a missing title is answered `bad_request`, and Scala shows why in
    a toast, where the user is looking.
  - The list of calendars is one `scala.calendars.list` away for the caller.
- **Two documentation keys on each `provides` entry** that Basecamp ignores:
  - `description` on the entry and on each param, so a caller (or a model) knows what to send;
  - `readOnly: true` on the intents that change nothing, so a caller can skip its own confirmation.
    Basecamp's confirmation still applies.
- **The answer is never synchronous.**
  - Each handler reads fresh data from the core first: a request can arrive before the view's first
    refresh after Basecamp loaded it.
  - That also keeps Basecamp's auto-return from bouncing the user back before Scala was painted.

## Consequences

- Any app can add calendar entries or read the agenda without linking against Scala or learning its
  core API. The user confirms each request in Basecamp's dialog.
- A read is not silent either: Basecamp brings Scala forward and returns the user afterwards.
  Basecamp has no "read" class of intent yet (its doc §7).
- Callers must list each intent in their own `uses`. That is Basecamp's rule, not ours.
- The handlers are view code, so they need the view open: Basecamp opens it on request.
- Tested offscreen: `scala-ui/qml-harness/intents.sh` raises every intent through a mock bridge and
  checks each answer, including the refusals and that share opens the dialog. On a real Basecamp,
  only by hand so far.
- Not covered yet: editing, moving or deleting events, and RSVP. Each needs a way to name one event
  that survives a round trip through a person ("the dentist on Tuesday"), and deleting needs more
  care than a chooser click.
