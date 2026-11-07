# 26. On the phone, Logos Storage goes through Loam

- **Status:** accepted
- **Date:** 2026-11-03

## Context

Scala's Android app bundled its own Logos Storage client (libstorage, about 28 MB) to fetch
attachments and join snapshots (ADRs 0017 and 0020). That copy stayed on an old build with the known
download stall, started a second Storage node next to Loam's, and had to be fixed separately from
every other app.

Loam now runs one Storage fetch client for the whole phone (loam-transport ADR 0020). It fetches a CID
as a background job that outlives the asking app, shares a cache, and recovers from network changes by
itself (Loam 0.0.68). Backpack already uses it.

## Decision

- The app no longer contains libstorage. `scala-sdk/logos-storage.ts` asks Loam for a CID
  (`fetchToFile`), polls Loam's job, and copies the finished file out of Loam's cache. It re-asks when
  Loam forgot the job or it stalled, as Backpack does.
- Storage nodes known to hold a file are passed to Loam as peers: the invite's hub for a snapshot, and
  the "attachment hub" setting for attachments. Both are SPRs; `scala-sdk/spr.ts` reads one into the
  peer id and addresses Loam dials. The default attachment hub is the 0.3 Scala hub (VPS, port 8299).
- Without Loam, or with Storage switched off in Loam, attachments say so ("install Loam") and the
  join skips the snapshot; normal sync still brings every event.
- The file helpers the app still needs (files dir, read and write as base64, save to Downloads) stay
  in a small native module, `ScalaFiles`, with no native library.
- Removing a calendar also unsubscribes its topic, so the node and Loam's cache stop carrying it.

## Consequences

- A smaller APK and one Storage node per phone; Storage fixes ship once, in Loam.
- Attachments and snapshots need Loam. Delivery does not: Scala keeps its own node as the fallback.
- Fetching is still all the phone does; uploads remain a desktop and hub job.
- The desktop is unchanged: it uses the Storage module that Basecamp hosts.
