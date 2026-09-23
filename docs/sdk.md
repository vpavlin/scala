# The Scala SDK — building on the calendar engine

Scala is a local-first, server-less, end-to-end-encrypted **shared-calendar engine** on Logos/Loam:
"a set of people converge on a shared, signed, encrypted set of dated events." It is also an **SDK** —
a reusable spine for any app that needs multi-writer, offline-first, cryptographically-authored
records. You build *on top of* it (a richer renderer, an authoring UI, a domain layer) rather than
forking it.

This document is that contract: what the engine gives you, the invariants you must not break, and the
seams where an app plugs in. It is a synthesis of the ADRs in [`docs/adr/`](adr/) — each section
links the ADR that is the source of truth.

**Frequencies** (a private, decentralized, uncensorable event-organisation app) is used throughout as
a running example of an app built on this SDK — but nothing here is Frequencies-specific; the same
seams serve any consumer.

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

## 2. Integrating Scala into an app

Scala ships as **one engine with two front-ends**, and you integrate at whichever one your app targets.
Both drive the *same* signed event log and the *same* fold, so a calendar created on one is fully
usable on the other.

| You're building… | Integrate against | Language | Entry point |
|---|---|---|---|
| A **Basecamp desktop** app/view | the **`scala` core module** | QML/JS → C++ core | `logos.callModule("scala", <method>, [args])` |
| An **Android** app | the **`calendar.ts`** library | TypeScript | `import { … } from "scala/mobile/src/lib/calendar"` |
| A **headless** service / hub | the **core module** via `logos-hub` | CLI/JSON | `logos-hub call <daemon> scala <method>` |

The core loop is identical on every surface:

```
create or join a calendar  →  author events (signed, through an identity)
        →  subscribe to changes  →  read the folded state and render  →  (sync runs underneath)
```

### 2.1 The API surface (same verbs on both front-ends)

Mobile methods are async TS functions; desktop methods are core-module calls taking/returning JSON
strings. Names line up on purpose.

| Purpose | Mobile (`calendar.ts`) | Desktop (`scala` module) |
|---|---|---|
| Create a calendar | `createCalendar(name, color?, desc?, identityId?, opts?)` | `createCalendar(name, color, identityId)` |
| Edit calendar meta (name/desc/schema/tier) | `updateCalendarMeta(calId, fields)` | `updateCalendarMeta(calId, fieldsJson)` |
| List calendars | *(via `store` / `onChange`)* | `listCalendars()` |
| Create an event | `createEvent(calId, fields, explicitId?)` | `createEvent(calId, eventJson)` |
| Edit an event | `updateEvent(ev)` | `updateEvent(eventJson)` |
| Delete an event | `deleteEvent(ev)` | `deleteEvent(id)` |
| Read events | *(fold via `store` + `expandEvents`)* | `listAllEvents()` / `listEvents(calId)` / `getEvent(id)` |
| Edit history for an event | `getEventHistory(calId, id)` | `getEventHistory(calId, id)` |
| Roles | `setMemberRole(calId, member, role)` | `setMemberRole(calId, member, role)` |
| Share / invite link | `buildInvite(cal)` | `generateShareLink(calId)` |
| Join from an invite | `joinFromInvite(link, identityId?)` | `handleShareLink(link, identityId)` |
| Per-calendar authoring identity | `setCalendarIdentity(calId, identityId)` | *(identity module)* |
| Sync status | *(`startSyncing` `onStatus`)* | `getSyncStatus(calId)` |
| Import/export .ics | `parseIcs` / `buildIcs` (+ `createEvent`) | `importIcs` / `exportCalendarIcs` |
| Per-device settings (KV) | *(AsyncStorage)* | `getSetting(k, def)` / `setSetting(k, v)` |
| Subscribe to changes | `onChange(cb) → unsub` | subscribe to the module's change signal |

**Authoring is always signed** — every write above routes through the bound identity (`authorEvent`)
and is dropped by peers if unsigned/unverified. You never construct a raw event yourself; you call
these verbs and the engine signs, appends, publishes, and folds.

### 2.2 Mobile (TypeScript) — the minimal integration

```ts
import {
  createCalendar, createEvent, updateEvent, deleteEvent,
  joinFromInvite, startSyncing, onChange,
} from "./src/lib/calendar";
import { store } from "./src/lib/store";
import { foldCalendar } from "./src/lib/engine";   // pure fold: log → state
import { expandEvents } from "./src/lib/recur";

// 1. Bring up sync (one shared Waku/Loam node for every app on the device).
await startSyncing(/* shared */ true, (status) => setSyncLabel(status));

// 2. Create a calendar (or joinFromInvite(link) to enter someone else's).
//    createCalendar(name, color?, description?, identityId?, opts?) — schema/open/collab go in opts,
//    all in ONE signed cal.meta (one Keycard tap), not create-then-edit.
const cal = await createCalendar("Main Stage", "#89b4fa", "", undefined, {
  schema: [{ key: "status", type: "enum", options: ["Confirmed", "Tentative", "Cancelled"] }],
});

// 3. Author an event — signed with the calendar's bound identity.
await createEvent(cal.id, {
  title: "Doors", startTime: Date.now(), endTime: Date.now() + 3_600_000,
  fields: { status: "Confirmed" },       // your app's domain data rides in `fields`
});

// 4. React to any change (local edit OR an incoming synced event) and re-render.
const off = onChange(async () => {
  const log = await store.getLog(cal.id);
  const state = foldCalendar(cal.id, log);          // {name,color,schema,events,roles,open,collab,…}
  const dayOccurrences = expandEvents(state.events, dayStart, dayEnd);   // recurrence expansion
  render(state, dayOccurrences);
});
// later: off();
```

Your app **reads folded state and renders it**; you never mutate events in place. Domain data lives in
`fields`; your renderer decides what a field *means* (colour, grouping, a poster) — the engine just
carries and shows it.

### 2.3 Desktop (Basecamp core module) — the minimal integration

A Basecamp view (QML) talks to the `scala` core module through `logos.callModule` (the `core(...)`
helper in `scala-ui/qml/CalendarView.qml` wraps this) and re-reads on the module's change signal:

```js
function core(method, args) { return logos.callModule("scala", method, args || []) }

// create + author (JSON in, JSON out)
const calId = JSON.parse(core("createCalendar", ["Main Stage", "#89b4fa", identityId]))
core("createEvent", [calId, JSON.stringify({ title: "Doors", startTime: s, endTime: e,
                                             fields: { status: "Confirmed" } })])

// render: pull the folded events and lay them out
const events = JSON.parse(core("listAllEvents"))     // already folded + calendarId-tagged
// … re-run this on the module's change signal …
```

To ship the view itself, see [`docs/design-guidelines.md`](design-guidelines.md) (tokens, parity) and
`scala-ui/` for the reference view. To run headless (a hub/bot), the same methods are reachable via
`logos-hub call <daemon> scala <method>` — see the `logos-hub` skill.

### 2.4 What you build vs. what you inherit

- **You build:** the views/screens, the authoring UI, and any domain layer (what your `fields` mean,
  how you colour/group/filter, extra screens). This is where an app differentiates.
- **You inherit (don't re-implement):** the event log + fold, signing/identity (incl. Keycard),
  roles + access tiers, invites/join, per-calendar sync, attachments, and .ics. Call the verbs above;
  don't hand-roll storage, crypto, or transport.

---

## 3. The event/wire contract

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

## 4. The extension seam: custom fields, not display magic in the engine

This is the load-bearing design decision for building on the engine without forking it.

**Custom fields ([0005](adr/0005-optional-field-schema.md)) are the extension mechanism.** A calendar
carries a `schema: [{key, label?, type, options?}]` (types: `text`, `number`, `bool`, `enum`, `url`,
`color`, …). Each event carries `fields: {key: value}`. The fold passes them through untouched;
Scala renders each value as a **badge** on the event card. That's it — no interpretation.

**The engine keeps event colour == calendar colour.** A per-event colour override was tried and
**rejected**: in a general calendar the colour *is* the calendar's identity, so overriding it makes
"which calendar does this belong to?" ambiguous. So:

- **Scala** shows a field's *value* (a badge) and always draws the event in its **calendar's** colour.
- **An app on top** layers meaning on those same fields — e.g. map a `status` enum
  (`Confirmed`/`Tentative`/`Cancelled`) or a `venue`/`type` field to colour, grouping, filtering,
  posters. That mapping lives entirely in the consuming app's view. (Frequencies is the example.)

The payoff: **an event authored in a downstream app still reads correctly when opened in Scala** — the
field values are visible, the event sits in its calendar's colour, nothing looks broken. No forked
data model, no per-event colour to reconcile. The downstream app is a *richer renderer + authoring UI*
over the identical event log.

> Rule of thumb: if a capability is "how events *look / are organised* for one app," it lives in that
> app and is driven by a **field**. If it's "what an event *is* on any calendar," it belongs in
> Scala's event model (and then in both folds).

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

## 5. Identity, access, and sync — the rules you inherit

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

## 6. Shipping & verifying (inherited workflow)

- **Parity:** a visible change ships on **both** the desktop view and the mobile app with the same
  tokens. See [`docs/design-guidelines.md`](design-guidelines.md) and [`CLAUDE.md`](../CLAUDE.md).
- **Verify, don't guess:** desktop → `scala-ui/qml-harness/render.sh` (offscreen QML render);
  mobile → `tsc --noEmit` + a Hermes-bundle grep (use `strings -e l` for non-ASCII). Gestures can't
  be harness-tested — verify those on a device.
- **Folds byte-identical**, always — `test/parity` golden vectors.
- **Publish** to the LAN Basecamp repo + F-Droid (loam) via `logos-publish-artifacts`; CI uploads the
  `.lgx` on each push.

---

## 7. TL;DR for an app built on Scala

1. Your app is a **view + authoring layer over Scala's event log**, not a fork. Integrate via the
   `scala` core module (desktop) or `calendar.ts` (mobile) — same verbs, same events, folds, and sync.
2. Add your domain meaning through **custom fields** and a **richer renderer** — not by changing what
   an event *is* in the engine. Colour-code / group / filter by a field in your app; Scala shows the
   value as a badge and keeps the calendar's colour.
3. Anything that changes the **event model or fold** (a new type, a new access rule) is a first-class,
   **signed** event, mirrored in **both** folds, guarded by the parity test.
4. Inherit identity/signing, roles, access tiers, invites, attachments, and sync as-is — call the
   verbs, don't hand-roll storage, crypto, or transport.
