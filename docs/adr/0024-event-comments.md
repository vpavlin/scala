# 24. Comments on events, as Scala `ext` items

- **Status:** accepted
- **Date:** 2026-10-10

## Context

[ADR 0021](0021-rsvp-and-extensible-events.md) designed a generic `ext` event (app extension items
grouped by target) and said comments would be implemented by Frequencies on top of it, with Scala
showing at most a count. Frequencies ([plan](https://github.com/vpavlin/frequencies)) puts per-event
comments in Scala instead ("internal comments per event → Scala, not the app"), and it has no UI of
its own yet. Promoters, crew and artists need to discuss a night where they already look at it.

## Decision

- Implement `ext` / `ext.del` in both folds exactly as ADR 0021 describes, guarded by the golden-vector
  parity test:
  - any verified member posts items they author;
  - an item `id` belongs to its first author, and only that author can replace its `data`;
  - deletion counts when it comes from the item's author, or from an owner/editor at the time of
    deleting (moderation);
  - deletions apply after the pass, so a deletion that arrives before its item still wins;
  - items on a deleted event, and items missing `ns`, `kind`, `target` or `id`, are dropped;
  - the fold returns `ext: { target → [items in creation order] }`.
- **Comments are a Scala feature**: items with `ns: "scala"`, `kind: "comment"`, `data: { text }`. Both
  event editors show the thread, a box to post, and Delete for your own comments (owners/editors see it
  on all of them). Frequencies reads the same items, so a comment made in either app shows in both.
- The core (`postExt`, `deleteExt`) and the mobile library (`postExt`, `deleteExt`) are generic: any
  app can store its own `ns`/`kind` items without a Scala change. Event listings attach each event's
  items as `ev.ext`.
- Desktop core 0.12.0 is the first with `postExt`; an older core under a newer view shows the thread
  read-only with an update hint instead of failing.

## Consequences

- One more permanent event type pair on the wire. Peers that predate it ignore unknown types, so
  there's no cutover; their users just don't see comments.
- `ext` lists grow per event; pruning deleted items is a later optimisation.
- Comment text is plain text (no markup), shown with `Text.PlainText` on desktop.
