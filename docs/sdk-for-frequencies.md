# Building on Scala — an SDK guide for Frequencies (and other apps)

Scala is a local-first, server-less, end-to-end-encrypted **shared-calendar engine** on
Logos/Loam. **Frequencies** (a private, decentralized, uncensorable event-organisation app) is
meant to be built *on top of* Scala rather than beside it: Scala owns "a set of people converge on a
shared, signed, encrypted set of dated events," and Frequencies adds the venue/community layer on
top of that same spine.

This document is the contract between the two: what Scala gives you, the invariants you must not
break, and the seams where Frequencies plugs in. It is a synthesis of the ADRs in
[`docs/adr/`](adr/) — each section links the ADR that is the source of truth.

---

## 1. What you get for free

| Capability | Where | ADR |
|---|---|---|
| Event-log **CRDT** + pure **fold** (no mutable rows) | `src/scala_engine.hpp`, `mobile/src/lib/engine.ts` | [0001](adr/0001-event-log-crdt.md) |
| Sync spine (HLC + RBSR set-reconciliation + recursive catch-up) | `logos-sync` | [0002](adr/0002-adopt-logos-sync.md), [0003](adr/0003-catch-up-recursive-rbsr.md) |
| Per-person **signing / identity** (software key or hardware Keycard) | `logos-keycard`, `mobile/src/lib/identities.ts` | [0007](adr/0007-event-signing-identity.md)–[0010](adr/0010-keycard-on-basecamp.md) |
| **Roles** (owner/admin/editor/viewer), opt-in, merge-enforced | fold `MEMBER_SET` | [0004](adr/0004-roles-opt-in.md) |
| **Access tiers** — Closed / Open / Collaborative | fold `open`/`collab` (LWW) | [0019](adr/0019-collaborative-calendar-mode.md) |
| Optional **custom-field schema** per calendar | fold `schema` | [0005](adr/0005-optional-field-schema.md) |
| **Attachments** in Logos Storage (Codex) | `mobile/src/lib/logos-storage.ts` | [0017](adr/0017-attachments-via-logos-storage.md) |
| **iCalendar** import/export | `mobile/src/lib/ics.ts` | [0018](adr/0018-icalendar-interop.md) |
| Transport: one shared Waku/Loam node, Reliable Channels | `logos-transport`, `loam-transport-pkg` | — |
| Desktop **Basecamp view** + Android **RN app**, feature+design parity | `scala-ui/`, `mobile/` | [0006](adr/0006-two-clients-one-fold.md) |

Everything below is *how to consume it without breaking it*.

---

## 2. The event/wire contract

Every change is a signed, self-describing **event** appended to a per-calendar log; state is a **pure
fold** over the log. There are no in-place mutations — an edit is a new `event.put`, a delete is a
tombstone.

```ts
interface Event {
  v: 1;
  id: string;        // uuid
  type: string;      // one of ET (below)
  hlc: string;       // hybrid logical clock — LWW ordering across devices
  dev: string;       // author device/identity id
  payload: any;      // type-specific (see ET)
  pub?: string;      // author's 33-byte secp256k1 public key (hex)
  sig?: string;      // 64-byte ECDSA over the canonical event (hex)
}
```

Event types (`ET`, kept in lockstep between `engine.ts` and `scala_engine.hpp`):

| `type` | payload | meaning |
|---|---|---|
| `cal.meta`  | `{name, color, description?, schema?, open?, collab?}` | calendar metadata (LWW per field) |
| `event.put` | `{id, title, startTime, endTime, …, fields?}` | create/edit an event (LWW upsert by `id`) |
| `event.del` | `{id}` | tombstone an event (terminal) |
| `member.set`| `{member, role}` | grant/redact a role (owner/admin only) |
| `sync.req`  | `{from}` | catch-up request — **not** stored or folded |

**The fold is the source of truth, and it is enforced, not advisory:** it drops any event whose
signature doesn't verify, and it applies role/access rules on merge (`canAdd`/`canEditExisting`). A
peer can't "just write" — it must be allowed by the folded state, or its event is silently dropped.

### The two-fold parity invariant (do not break)
The C++ fold (`src/scala_engine.hpp`) and the TS fold (`mobile/src/lib/engine.ts`) must produce
**byte-identical** output for the same log — a golden-vector test guards them ([0006](adr/0006-two-clients-one-fold.md)).
If you add an event type or a fold rule, change **both** folds in the same commit, or the desktop and
mobile clients diverge. Prefer designs that **don't** touch the fold: the fold spreads the whole
`event.put` payload (`{...payload, calendarId, creatorId}`), so **new event fields ride through for
free** — no fold change needed for additive per-event data.

---

## 3. The seam for Frequencies: custom fields, not new colour/display magic in Scala

This is the load-bearing design decision for the two-app split.

**Custom fields ([0005](adr/0005-optional-field-schema.md)) are the extension mechanism.** A calendar
carries a `schema: [{key, label?, type, options?}]` (types: `text`, `number`, `bool`, `enum`, `url`,
`color`, …). Each event carries `fields: {key: value}`. The fold passes them through untouched;
Scala renders each value as a **badge** on the event card. That's it — no interpretation.

**Scala keeps event colour == calendar colour.** A per-event colour override was tried and
**rejected**: in a general calendar the colour *is* the calendar's identity, so overriding it makes
"which calendar does this belong to?" ambiguous. So:

- **Scala** shows a field's *value* (a badge) and always draws the event in its **calendar's** colour.
- **Frequencies** is where meaning is layered on those same fields — e.g. map a `status` enum
  (`Confirmed`/`Tentative`/`Cancelled`) or a `venue`/`type` field to colour, grouping, filtering,
  posters. That mapping lives entirely in the Frequencies view.

The payoff: **an event authored in Frequencies still reads correctly when opened in Scala** — the
field values are visible, the event sits in its calendar's colour, nothing looks broken. No forked
data model, no per-event colour to reconcile. Frequencies is a *richer renderer + authoring UI* over
the identical event log.

> Rule of thumb: if a capability is "how events *look/are organised* for a venue," it belongs in
> Frequencies and should be driven by a **field**. If it's "what an event *is* on any calendar," it
> belongs in Scala's event model (and then in both folds).

### Extension points already sketched
- **Colour / grouping / filtering by field** — Frequencies-side, from a chosen field. Scala already
  ships field-value badges, a **Day timeline**, and a per-device **calendar show/hide** filter you
  can build on.
- **Public / community tier** — a fold-level access change (extends [0019](adr/0019-collaborative-calendar-mode.md));
  touches both folds, so design it as a first-class Scala event, not a view hack.
- **Posters / images** — reuse attachments in Logos Storage ([0017](adr/0017-attachments-via-logos-storage.md));
  desktop uploads, mobile fetches.
- **Comments / RSVPs** — a new signed event type (`event.note`?) folded LWW/append — again, both
  folds + a signature, never an unsigned side-channel.

---

## 4. Identity, access, and sync — the rules you inherit

- **Signatures are always required.** Author through the identity layer (`authorEvent` /
  `mobile/src/lib/identities.ts`); the fold drops anything unsigned/unverified. A calendar can be bound to a
  software key **or** a Status Keycard (hardware, tap-to-sign) — same seam, per-calendar
  ([0009](adr/0009-per-calendar-identity.md)). Don't reach around it.
- **Refuse un-authorable writes up front** (mirror `assertAuthorable`) instead of store-then-drop —
  otherwise "save" looks successful but the event vanishes on fold. Surface *why* you can't edit
  ([0013](adr/0013-permission-transparency.md)).
- **Access ladder** (single 3-way selector, no off-ladder state): Closed → Open → Collaborative
  ([0019](adr/0019-collaborative-calendar-mode.md)). A `signaturesRequired`-style tightening is a
  fold change → both platforms before anyone turns it on.
- **Sync is app-agnostic.** One shared Waku/Loam node per device carries every app; a calendar is one
  Reliable Channel (SDS) keyed by its content topic; membership = who holds the calendar key. Cold-
  start history is recovered by app-level RBSR on top of SDS ([0003](adr/0003-catch-up-recursive-rbsr.md)).
  Reuse `logos-transport`/`logos-sync`; don't hand-roll ack/retransmit.

---

## 5. Shipping & verifying (inherited workflow)

- **Parity:** a visible change ships on **both** the desktop view and the mobile app with the same
  tokens. See [`docs/design-guidelines.md`](design-guidelines.md) and [`CLAUDE.md`](../CLAUDE.md).
- **Verify, don't guess:** desktop → `scala-ui/qml-harness/render.sh` (offscreen QML render);
  mobile → `tsc --noEmit` + a Hermes-bundle grep (use `strings -e l` for non-ASCII). Gestures can't
  be harness-tested — verify those on a device.
- **Folds byte-identical**, always — `test/parity` golden vectors.
- **Publish** to the LAN Basecamp repo + F-Droid (loam) via `logos-publish-artifacts`; CI uploads the
  `.lgx` on each push.

---

## 6. TL;DR for a Frequencies contributor

1. Frequencies is a **view + authoring layer over Scala's event log**, not a fork. Same events, same
   folds, same sync.
2. Add venue/community meaning through **custom fields** and a **richer Frequencies renderer** — not
   by changing what an event *is* in Scala. Colour-code by a field in Frequencies; Scala shows the
   value as a badge and keeps the calendar's colour.
3. Anything that changes the **event model or fold** (a new type, a new access rule) is a first-class,
   **signed** event, mirrored in **both** folds, guarded by the parity test.
4. Inherit identity/signing, roles, access tiers, attachments, and sync as-is — don't reach around
   them.
