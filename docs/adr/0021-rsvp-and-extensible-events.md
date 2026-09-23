# 21. RSVP (built-in) + extensible events (apps add their own types)

- **Status:** accepted
- **Date:** 2026-09-23

## Context

Scala's event types are a fixed enum (`cal.meta`, `event.put`, `event.del`, `member.set`, `sync.req`)
with hardcoded fold handling. Frequencies (the venue/community app built on Scala — see
[`docs/sdk.md`](../sdk.md)) needs two things a bare calendar lacks: **attendance** ("who's coming")
and **discussion** (comments under an event). The question is whether these become new Scala built-ins
or whether apps can add their own event types.

Answer: **both, split by how universal each concept is.** Attendance is a general calendar primitive —
every calendar wants it — so RSVP earns a built-in type. Comments are social/app-flavoured, so instead
of bloating Scala we add a **generic extension mechanism** and Frequencies implements comments on top
of it, with no further Scala change. This mirrors the existing philosophy (custom **fields**: Scala
carries app data on an event and shows the value, the app interprets it — [0005](0005-optional-field-schema.md)),
extended from single-writer field values to **multi-writer, per-target streams**.

Both are new fold behaviour, so both change `mobile/src/lib/engine.ts` **and** `src/scala_engine.hpp`
byte-identically, guarded by a golden-vector test ([0006](0006-two-clients-one-fold.md)). Every new
event is signed and dropped-if-unverified like all content ([0007](0007-event-signing-identity.md)).

## Decision

### RSVP — a built-in type

- **Event:** `event.rsvp`, payload `{ eventId, status }`, `status ∈ "going" | "maybe" | "no"` (a fresh
  event with the same author overrides; `status: ""` retracts).
- **Fold:** last-write-wins per `(eventId, author)` by HLC, materialised onto the event as
  `ev.rsvps = { <authorAddr>: status }` (empty/retracted authors omitted). A convenience count may be
  derived in the view, not stored.
- **Access — self-scoped:** any member (holds the calendar key) may set **their own** RSVP; the author
  of an `event.rsvp` is the RSVP-er, and the fold ignores an RSVP whose author tries to set anyone
  else's. No editor role required (it's your own attendance), and it works on a Closed calendar you're
  a member of. An RSVP for a non-existent / tombstoned `eventId` is dropped.
- **UI (both platforms):** a Going / Maybe / No control for *you* on the event, plus a summary
  ("3 going · 1 maybe"). Mobile-testable.

### `ext` — the generic extension primitive

- **Event:** `ext`, payload `{ ns, kind, target, id, data }` — `ns` = app namespace
  (e.g. `xyz.frequencies`), `kind` = app sub-type (e.g. `comment`), `target` = an event or calendar
  id, `id` = a stable id for this item (dedup + supersede), `data` = **opaque to Scala**.
  Tombstone: `ext.del`, payload `{ id }`.
- **Fold:** verify → access-check → dedup by `id` → apply tombstones → store as
  `state.ext[target] = [ { ns, kind, id, author, hlc, data } … ]` in HLC order. **Scala never
  interprets `data`.** It guarantees only: signed, access-controlled, ordered, deduped, tombstone-aware
  delivery of an app's events, grouped by target.
- **Access:** any member may post an `ext` they author; an item may be deleted by its **author** or by
  an **owner/editor** (moderation). (Same signed-member rule as RSVP; deletion adds the moderator path.)
- **No Scala UI semantics.** Scala may show a generic count ("N notes") but does not render `data`.
  A consuming app reduces `state.ext[target]` filtered by its `ns`/`kind` into its own feature —
  **Frequencies** reduces `ns=xyz.frequencies, kind=comment` into a comment thread (append), and could
  add votes, links, etc. later with **no Scala change**.

## Consequences

- **One generic fold change unlocks unlimited app event types.** After `ext` ships (both folds + a
  golden-vector test), Frequencies and any other consumer extend the data model without touching Scala.
- RSVP is first-class and available to every Scala calendar, not just Frequencies.
- The wire format grows two permanent event types — additive, and old peers simply drop unknown types
  (the fold ignores what it doesn't handle), so there's no hard cutover.
- `state.ext` can grow unbounded per target; pruning tombstoned items is a later optimization, not a
  correctness issue.
- **Sequencing:** ship RSVP first (concrete, mobile-testable), then `ext` + its golden-vector test as
  the capability; comments land when Frequencies is a codebase (the test proves `ext` meanwhile).
- Open question deferred: a **public/community read tier** (broadly-readable calendars) is *not* solved
  here — Scala calendars are key-sealed, so "public" needs a key-publishing/discovery design of its own.
