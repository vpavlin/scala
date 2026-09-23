# 0. Record architecture decisions

- **Status:** accepted
- **Date:** 2026-08-13

## Context

Scala grew a lot of load-bearing decisions — how state converges, how a phone and a
desktop stay identical, how catch-up works, how roles and custom fields are modelled —
and until now they lived only in commit messages and people's heads. The old
`docs/PLAN.md` and `migration-plan-*.md` described a *destination we've already reached*
and were actively misleading. These ADRs replace them with a durable record of the
decisions and *why*.

Scala sits on two shared libraries; the decisions specific to *those* layers live in
their own ADRs and are cross-referenced rather than restated:
- **[logos-sync](https://github.com/vpavlin/logos-sync)** — the event-log CRDT, HLC,
  merge, and recursive-RBSR catch-up (scala is its first consumer).
- **[logos-transport](https://github.com/vpavlin/logos-transport)** — the byte transport
  (Waku node, SDS channels, the shared "Loam" node, the offline cache).

## The log

- [0001](0001-event-log-crdt.md) — Event-log CRDT + pure fold, not mutable rows
- [0002](0002-adopt-logos-sync.md) — Adopt logos-sync (extract the sync spine)
- [0003](0003-catch-up-recursive-rbsr.md) — Catch-up = recursive RBSR + reliable trigger
- [0004](0004-roles-opt-in.md) — Roles enforced on merge (revised: two-rule model — owner/editor/viewer + Open toggle + edit-your-own)
- [0005](0005-optional-field-schema.md) — Optional field-schema — calendar as a library
- [0006](0006-two-clients-one-fold.md) — Two clients, one fold (C++ ↔ TS parity) + AES-GCM crypto
- [0007](0007-event-signing-identity.md) — Adopt loam-sync event signing (roles become enforcement)
- [0008](0008-keycard-identity-custody.md) — Adopt Keycard delegation custody (from logos-sync)
- [0009](0009-per-calendar-identity.md) — Multiple authoring identities, bound per calendar
- [0010](0010-keycard-on-basecamp.md) — Keycard on Basecamp — consume the native `keycard` module
- [0011](0011-calendar-views-month-agenda-search.md) — Calendar views — Month, Agenda, Search
- [0012](0012-time-entry-local-or-utc.md) — Entering event times in Local or UTC
- [0013](0013-permission-transparency.md) — Permission transparency — say why you can't edit
- [0014](0014-per-calendar-sync-status.md) — Per-calendar sync status (offline / syncing N / up-to-date)
- [0015](0015-full-form-calendar-create.md) — Full-form calendar create — one signed cal.meta
- [0016](0016-desktop-keycard-authoring.md) — Desktop Keycard authoring — the concrete integration
- [0017](0017-attachments-via-logos-storage.md) — Event attachments via Logos Storage (Codex)
- [0018](0018-icalendar-interop.md) — iCalendar (.ics) import/export — interop with the world
- [0019](0019-collaborative-calendar-mode.md) — Collaborative calendar mode — the third permission tier
- [0020](0020-local-first-responsiveness.md) — Local-first responsiveness — apply now, sync later; cache the fold
- [0021](0021-rsvp-and-extensible-events.md) — RSVP (built-in) + extensible events (apps add their own types) *(proposed)*

Scala also ships an SDK guide for apps built on it — [`docs/sdk.md`](../sdk.md).
Superseded planning docs are archived under [`../archive/`](../archive/).
