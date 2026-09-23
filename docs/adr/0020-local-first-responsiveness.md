# 20. Local-first responsiveness — apply now, sync later; cache the fold

- **Status:** accepted
- **Date:** 2026-09-23

## Context

Scala is local-first ([0001](0001-event-log-crdt.md)): the on-device event log is the source of
truth and the app must be usable offline. But "local-first" is only real if the UI *feels* local —
and a run of reports ("drag-move took 10s", "delete took 5s to disappear", "app slow to start")
showed it wasn't. Four separate causes, all discovered by **measuring on-device** (instrumenting the
real path with `Date.now()` deltas surfaced to a toast + clipboard, having the user reproduce once and
paste) rather than guessing — the first two "fixes" were wrong because they were guessed:

1. **The write path awaited the network.** `publishAndApply` did `await store.appendEvent` (local)
   then `await sync.sendEvent` (the wire). Every mutation — create/update/delete event, `cal.meta`,
   roles — and `joinFromInvite` blocked the UI on `transport.publishSealed`, which can stall on a slow
   or absent shared node.
2. **The reminder reschedule starved the JS thread.** `scheduleReminders` cancelled all and looped up
   to 400 `await scheduleNotificationAsync` native calls after every edit; the loop monopolised the
   thread so the `setEvents` re-render couldn't paint.
3. **`refresh` re-folded everything, twice, per edit.** `listCalendars` + `listEvents` each folded
   every calendar's whole log from disk on every change (measured: ~13.5s of a 14s move).
4. **The fold re-verified every signature every time.** `verifyEvent` runs secp256k1 verify per event,
   and secp256k1 is ~40ms on Hermes; folding ~90 events cost ~4.2s on cold start (not data volume —
   the logs were tiny — but per-event crypto).

## Decision

**A mutation persists to the local log and renders IMMEDIATELY; the network send is fire-and-forget in
the background.** Delivery is guaranteed by RBSR catch-up ([0003](0003-catch-up-recursive-rbsr.md),
`serveLog` / `SYNC_REQ`), so the initial send is only the fast path — never a blocker. Concretely, the
rules any mutation (and any new one) must follow:

- **Never `await` the wire send in the write path.** `publishAndApply` appends locally and returns;
  the send is `void sync.sendEvent(...).catch(...)`. Same for join/subscribe (`joinFromInvite`
  registers + notifies, then subscribes in the background).
- **Flag, don't block.** An event saved locally but not yet on the wire shows a ⟳ *syncing* pill
  (`pendingEventIds`), cleared when the send resolves or catch-up re-broadcasts it.
- **Cache the fold.** `store.folded(calId)` caches the folded result per calendar and invalidates
  **only** when that calendar's log changes (`appendEvent` / `removeCalendar`). An edit re-folds one
  calendar; reads share the cache (no double fold).
- **Memoize + persist signature verification.** `verifyEvent` is memoized keyed by `(pub, sig, digest)`
  (deterministic in the event's immutable content, so sound); the memo is persisted (`scala.vcache`,
  hydrated before the first fold) so a **cold start skips the crypto**. The fold *output* is unchanged,
  so C++/TS golden-vector parity ([0006](0006-two-clients-one-fold.md)) is intact.
- **Never let a long loop of awaited native calls sit on the edit path.** Best-effort background work
  (reminders) is debounced, guarded against overlap, and **yields to the UI** (`await setTimeout(0)`)
  periodically so rendering interleaves.
- **Destructive + long actions get confirms + loaders, never silent waits** (delete/member-remove
  confirm; attachment fetch shows a non-blocking overlay). See the "no silent actions" rule in
  [`docs/design-guidelines.md`](../design-guidelines.md).

## Consequences

- Edits are instant regardless of network; a move went 13,972ms → ~1,014ms, cold start 4,165ms → ~0.2s
  (second launch, memo warm).
- **Correctness is preserved by the sync layer, not the send.** An un-sent event still propagates via
  catch-up; the fold cache and verify memo change *when/whether* work is done, never the folded state.
- **Debug method of record:** when a phone perf/"stuck" bug can't be reproduced locally, instrument the
  real path and measure before changing anything — don't guess-and-ship (two wrong guesses preceded the
  real fix here). See [0006](0006-two-clients-one-fold.md) for the parity constraint any fold-touching
  optimization must respect.
- Desktop core already enqueues non-blocking (`m_tx->send` guarded by `tx.ready()`), so these were
  mobile fixes; the principles apply to both clients and to any Logos local-first app.
