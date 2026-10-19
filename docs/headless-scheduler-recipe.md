# Reading and writing a Scala calendar headless (for a scheduler)

This is the recipe for shrooms ADR-064. A machine's shrooms-agent runs Scala with no GUI, reads the schedules in the calendars it was invited to, and writes run results back.

Everything below was run on jimmy-crib on 2026-10-19 with logosctl 0.3.1 and scala 0.12.5:
- an "owner" session using loam:main;
- an "agent" session using loam:ctx;
- a third session installed fresh from the public catalog (it got delivery_module 0.4.0 and synced fine).

## 1. Install (once per machine)

1. **logosctl.** Get it from https://github.com/logos-co/logos-logoscore-cli/releases:
   - `logosctl-x86_64-linux.tar.gz`: atlas, proteus, the laptop.
   - `logosctl-aarch64-linux.tar.gz`: pi5.
   - `logosctl-aarch64-macos.tar.gz`: a Mac (untested).

   0.3.2 is the latest; this recipe was tested with 0.3.1.
2. **One isolated session per machine.** Each needs its own HOME, because the Loam root lives in `$HOME/.loam-core/` (or `$LOAM_CORE_DATA`) and Storage data is HOME-relative too:
   ```sh
   S=~/.local/share/shrooms-agent/scala            # anything; one per machine
   export HOME=$S/home LOGOSCTL_CONFIG_DIR=$S/cfg QT_QPA_PLATFORM=offscreen
   logosctl daemon start -d
   logosctl catalog add https://apps.vpavlin.xyz/logos-repo.json
   logosctl package install -y scala        # ~3 min: scala, loam_core, delivery_module, keycard, ble_mesh, libp2p, rln
   logosctl module load loam_core
   logosctl call loam_core hdCreate '<password>'   # ONCE. Returns {"mainAddress":"0x…","mnemonic":"12 words"}. Keep the words offline.
   logosctl module load scala
   ```
3. **After every daemon start**, run `daemon start -d`, then `module load loam_core`, then `call loam_core hdUnlock '<password>'`, then `module load scala`.
   - Until the root is unlocked, nothing can be signed. Writes then **say ok but queue**: `postExt` returns `{"ok":true}`, while `hdState` shows `{"error":"locked","pending":1}`.
   - The queue goes out by itself once unlocked (verified).
   - So keep the password in the agent's config (0600), and check `hdState.pending == 0` after a write.
4. **systemd:** use the same shape as `scala-hub3.service` on the VPS: a oneshot that starts the daemon detached, then loads, unlocks and loads as in step 3. Add a watchdog timer:
   - Every 5 min, run `logosctl call delivery_module getConnectionStatus`. If it isn't a success, restart.
   - The delivery FFI has wedged before, with "request queue full", while still reporting Connected.
5. **Time zones:** `dueOccurrences` reads `/usr/share/zoneinfo` (or `$TZDIR`). Minimal Linux images need the `tzdata` package; macOS has it.

## 2. The calls

Every call prints `{"method":…,"module":…,"result":…,"status":"ok"}`.
- `result` is usually a **JSON document inside a string**, so parse it twice.
- A `bool` method returns a bare `true`/`false`.
- Failures print `{"code":"MODULE_NOT_LOADED"|…,"message":…,"status":"error"}`.

Arguments:
- Pass arguments positionally.
- Pass strings, including JSON, as they are (one argv each).
- Pass **ints and bools bare** (`1792476000000`, `true`). An `int:`/`bool:` prefix silently fails.
- Calls time out after about 20 s if the module is busy.

### Joining (the agent, once per calendar)
```sh
logosctl call scala handleShareLink 'scala://join?id=…&key=…&name=…&inv=<64 hex>' loam:ctx
# → result: true
```
The editor ticket is claimed over the network, usually within 20–60 s. Follow `claim.state` in `listCalendars`: `waiting`, then `redeemed`.

The agent's own address in that calendar:
```sh
logosctl call loam_core hdIdentity scala <calId>
# → {"address":"0xce35…","path":"m/43'/60'/1581'/…","pubHex":"02cd…"}
```

### listCalendars: the folded state the runner's rules check
```json
[{"id":"212fae4f-7e67-405e-a4ba-5c6f4a3bafae","name":"Agent: crib/vpavlin","color":"#7c3aed","description":"",
  "owner":"0x5f72546d5f3dc9a5208109688d75f7d4fc1fb4a0",
  "roles":{"0xce35b9b221f9c87d4f603fe41323804325562c9d":"editor"},
  "invites":{}, "open":false, "collab":false, "rolesConfigured":true,
  "authorAddr":"0xce35b9b221f9c87d4f603fe41323804325562c9d", "binding":"loam:ctx",
  "claim":{"state":"redeemed","ticket":"0x086c…","note":""},
  "schema":[{"key":"session","label":"Session","type":"enum","options":["jimmy-crib/vpavlin"]},
            {"key":"prompt","label":"Prompt","type":"longtext"}, …],
  "encryptionKey":"3a4b3405-…", "isShared":true, "inviteLinks":{}, "creatorId":"0x74f9…"}]
```
**`encryptionKey` is the calendar's read key. Never log it or show it to a model.**

The runner's rules, in these field names. Run nothing unless all of these hold:
- `owner == <pinned>`;
- `open == false && collab == false`;
- `roles` is exactly `{<hdIdentity address>: "editor"}`;
- `invites` is empty.

### listEvents <calId>: the folded events, custom fields flat on each event
```json
[{"id":"8553bb18-e633-455d-8ef6-8091845d1ad1","calendarId":"212fae4f-…","title":"PR + issue check",
  "startTime":1792476000000,"endTime":1792476900000,"recur":{"freq":"daily","interval":2},
  "session":"jimmy-crib/vpavlin","prompt":"Check my open PRs and issues; summarise what changed.",
  "checks":"gh pr list --author @me --json number,updatedAt\ngh issue list --assignee @me --json number,updatedAt",
  "maxCost":0.5,"timeoutMin":15,"enabled":true,
  "creatorId":"0x5f72546d5f3dc9a5208109688d75f7d4fc1fb4a0",
  "ext":[{"ns":"xyz.shrooms","kind":"run","id":"run-8553bb18-1792476000000","target":"8553bb18-…",
          "author":"0xce35…","hlc":{"wall":1792406481014,"ctr":0,"dev":"0xce35…"},
          "data":{"occ":1792476000000,"ranAt":1792476012000,"changed":true,"result":"2 PRs updated, 1 new issue","costUsd":0.04}}]}]
```
- Times are epoch ms (instants).
- `startTime` is the first occurrence.
- `creatorId` is the ORIGINAL author, not the last editor.

### getEventHistory <calId> <eventId>: who changed what (for the change notification)
```json
[{"action":"created","at":1792406325172,"author":"0x5f72…","payload":{…}},
 {"action":"edited","at":1792406483641,"author":"0x5f72…","changed":["title"],"payload":{…}}]
```

### dueOccurrences <calId> <fromMs> <toMs> <tz>   (0.12.5)
```sh
logosctl call scala dueOccurrences 212fae4f-… 1792447200000 1793052000000 Europe/Prague
```
```json
[{"eventId":"8553bb18-…","occ":1792476000000},{"eventId":"8553bb18-…","occ":1792648800000},
 {"eventId":"8553bb18-…","occ":1792821600000},{"eventId":"8553bb18-…","occ":1792998000000}]
```
The last occurrence is 07:00 UTC, i.e. 08:00 CET after the DST change. The others are 06:00 UTC, i.e. 08:00 CEST.
- The window is `[from, to)` and counts STARTS only. An event already running at `from` is not returned.
- Errors look like `{"error":"Unknown time zone: Mars/Base"}`, `{"error":"No such calendar: …"}` or `{"error":"toMs must be after fromMs"}`.
- `""` means the process's own zone.

### postExt <calId> <itemJson>, deleteExt <calId> <id>
```sh
logosctl call scala postExt 212fae4f-… '{"ns":"xyz.shrooms","kind":"run","target":"<eventId>","id":"run-<eventId>-<occ>","data":{…}}'
# → {"id":"run-8553bb18-1792476000000","ok":true}
logosctl call scala deleteExt 212fae4f-… run-8553bb18-1792476000000
# → {"ok":true}
```
- Make `id` deterministic, as `run-<eventId>-<occ>`. A restarted runner can then see the run in `listEvents[].ext` and skip it.
- Only the author can supersede the `data` of an id.

## 3. Learning about changes: watch, with a poll as the fallback

```sh
logosctl watch scala
{"data":{"arg0":"212fae4f-…"},"event":"calendarChanged","module":"scala","timestamp":"2026-10-19T10:41:21Z"}
```
- `calendarChanged(calendarId)` (0.12.5) fires when the calendar's log grows. That covers your own writes and anything new from the wire, coalesced to about one per 300 ms per calendar.
- Seen in the test: one for the agent's own `postExt`, and one about 3 s after the owner edited the event on another node.
- On each one, refold with `listCalendars` and `listEvents`, and diff for the notification.
- `watch` dies with the daemon, so also poll every few minutes.
- Scheduling itself needs no event: ask `dueOccurrences` for `[lastChecked, now)` each minute.

## 4. Gotchas

- **Unlock after every start**, or every write queues unsigned while reporting ok (section 1).
- **Read key in `listCalendars`** (`encryptionKey`), and also in invite links. Keep both out of logs and out of prompts.
- **Wrong numbers.** On a JSON number, the `int:` prefix silently fails. Pass `1792476000000` bare.
- **Separate HOME per session.** Two sessions sharing a HOME share the Loam root and the Storage data.
- **Nothing is retried for you.**
  - Check `claim.state` after a join.
  - Check `hdState.pending` after writes.
  - Check that `listCalendars` lists the calendar at all. A bad link returns `false`.
- **Recurrence** is freq daily/weekly/monthly/yearly with interval and until. There is no BYDAY and there are no exceptions; "morning and evening" is two events.
- **Version.** scala 0.12.4, the current public version, has no `dueOccurrences` and no `calendarChanged`. You need 0.12.5 or later.
