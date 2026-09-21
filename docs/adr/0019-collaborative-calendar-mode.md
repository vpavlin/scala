# 19. Collaborative calendar mode — the third permission tier

- **Status:** decided / built (scala core 0.9.20, scala_ui 0.8.11 — single 3-way selector, mobile 0.9.64).
- **Date:** 2026-09-21

## Context

The permission model ([ADR 0004](0004-roles-opt-in.md), [0013](0013-permission-transparency.md))
had two rules: owner/editors do anything, viewers are read-only, and **everyone else on an Open
calendar may add events but edit/delete only the events they authored**. That leaves a real gap for
a genuinely shared calendar: on an Open calendar, if A adds an event, no one but A (or an
owner/editor) can fix it. The only way to let others co-edit is for the owner to promote each person
to editor — heavyweight, and impossible without owner involvement.

We considered **per-event co-editor lists** (an ACL on each event) but rejected it: it bloats every
event, complicates the fold, and must be mirrored on both platforms — a lot of machinery for a niche
need (Google/Apple don't do per-event sharing either).

## Decision

Add a **third calendar-level mode**, a single LWW meta flag `collab` (like `open`):

- **Closed** — `open:false` — only owner/editors write.
- **Open** — `open:true, collab:false` — anyone adds; edits only their own; owner/editors edit all.
- **Collaborative** — `open:true, collab:true` — **any non-viewer may edit/delete ANY event.**

One branch in the fold: `canEditExisting` returns true when `collab` is set (after the editor/viewer
checks). Enforced deterministically in **both folds** (`scala_engine.hpp` and mobile `engine.ts`) so
it converges — signatures are still always required, so "anyone" means any authenticated member.
The edit-ability gates (`canEditEvent`) honour it so the editor opens for everyone.

**UI (desktop scala_ui ≥0.8.11): a single 3-way selector, not two toggles.** `open` and `collab`
are two flags but *not* two independent axes — they form the ladder above, and the fourth combination
`collab:true, open:false` is off-ladder ("only editors add, but everyone edits existing"), a
confusing state that independent Open + Collaborative toggles let a user create by accident. So both
the New-calendar dialog and the calendar Settings present **one Closed / Open / Collaborative radio**
(helpers `calTierOf` / `calTierMeta`, model `accessTiers`), which only ever writes a valid
`{open,collab}` pair. Picking a tier from Settings writes it immediately; New writes it into the
create-time `cal.meta`. (The two-toggle form shipped briefly in 0.8.9/0.8.10 and was replaced.)

## Consequences

- Covers "a shared team calendar where everyone just edits everything" with no per-event bookkeeping.
- **It changes the fold**, so — like `signaturesRequired` — every participant (both platforms **and any
  headless hub**) must be on ≥0.9.20 / 0.8.9 / 0.9.63 before a calendar turns Collaborative on, or a
  stale peer would fold a non-author edit differently and diverge. New flag defaults off, so existing
  calendars are unaffected.
- For co-editing a *single* event, the answer stays "make them an editor" — we deliberately did not
  add per-event ACLs.
