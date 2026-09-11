# 17. Event attachments via Logos Storage (Codex) — decentralized, gated on a mobile fetch client

- **Status:** decided / not yet built. Design accepted; adoption **blocked on a mobile Codex
  fetch client** (see §Constraint + §Path). Interim fallback specified.
- **Date:** 2026-09-11

## Context

We want files attached to calendar events (images, PDFs, docs) — "event attachments". scala is a
**shared, multi-writer, offline-first** calendar ([ADR 0001](0001-event-log-crdt.md),
[0006](0006-two-clients-one-fold.md)): a calendar is distributed among many people, each on phone
and/or desktop, with no central owner. So attachments must be **fetchable by every member** without
relying on any one participant running an always-on server — otherwise we reintroduce exactly the
centralization the app exists to avoid.

scala is **greenfield** for blobs: no blob store, no content-addressing, no file/media path exists
today. Event payloads are opaque JSON and both folds pass unknown fields through unchanged, so the
*sync* surface is nearly free; the *bytes* need an entirely new store.

The ecosystem's content-addressed durability layer is **Logos Storage = Codex**, the Basecamp
module `storage_module` (`github:logos-co/logos-storage-module`, v2.1.3; wraps `libstorage` from
`logos-storage-nim`). It is a normal inter-module dependency (declare it like `loam_core`, call
`modules().storage_module.*`). Objects are addressed by **CID**; nodes discover + fetch blocks from
each other over a DHT (optional mix-net for private queries). This is the *right* substrate for a
shared calendar: federated per-participant nodes, not a hub.

## Decision

**Adopt Codex as the attachment store, behind a content-addressed seam, with a two-id model — but
only once a mobile fetch client exists.** Concretely:

- **Wire:** the event payload carries only lightweight refs:
  `attachments: [{ blobId, storageCid, name, mime, size }]`. This rides the fold as passthrough —
  **one line** in mobile `putPayload` (`calendar.ts`); desktop `createEvent` already passes arbitrary
  JSON; neither fold needs changes.
- **Bytes:** sealed with the **calendar household key `Ke`** (the existing `seal`/`open`,
  AES-256-GCM, `nonceFor(Ke, sealId)`), so blocks are ciphertext on the network and only members with
  `Ke` can open them — zero-trust, consistent with how qaku/kym/perun seal.
- **Two ids (local-first):** `blobId = sha256(sealed)` is the *local* handle (capture works offline,
  instantly); `storageCid` is the Codex handle, filled by an `updateEvent` once Codex returns it
  after upload. Codex mints its CID *after* upload and it is **not** `sha256(sealed)`, so it can't be
  precomputed — hence the sidecar, not a single id.
- **Fetch:** `downloadToUrl(storageCid, path, local=false, 65536)` pulls the sealed blob from
  whichever node holds it; decrypt with `Ke`; cache locally. A member's phone fetches through **its
  own** household's Codex node — federation, not a shared server.

## The constraint that gates this

**`storage_module`/Codex is desktop-only.** Its flake targets only `{x86_64,aarch64}×{linux,darwin}`
(libs `.so/.dylib/.dll`, no Android), and `libstorage` exposes **no REST API** — it's an in-process
library driven via the FFI. So a phone **can neither run Codex nor talk to one**; it could only
participate by proxying through a node that both runs Codex *and* exposes an HTTP bridge we'd build —
and for a mobile-only member that reachable bridge is, by definition, a server (the centralization we
refuse). A calendar's members are mostly phones, so **Codex-on-Basecamp alone serves only the desktop
minority.** That is why adoption is gated rather than immediate.

## Path to unblock: a mobile fetch-only Codex client

Feasible and substantially de-risked (investigated 2026-09-11):

- Upstream already tracks it: open issue **`logos-storage-nim#1221` "Support for Codex on Mobile
  (light client)"**.
- `library/libstorage.nim` already carries Android runtime scaffolding (`-d:android` logcat redirect
  + `setupForeignThreadGc`/`nimGC_setStackBottom`, the JNI foreign-thread-GC setup).
- Its deps are the **nwaku family** (nim-libp2p, nim-libp2p-mix, nim-nat-traversal, nim-datastore/
  leveldbstatic/sqlite3-abi, constantine) — all already cross-compiled to Android arm64 in our own
  stack (that is what `liblogosdelivery` is). The heavy blockers are absent: marketplace/web3/contracts
  and leopard/erasure are ~1 ref each, so fetch is plain block download + reassembly (no erasure
  decode, no Ethereum to port).
- **Fetch-only is the easiest subset:** downloading needs only outbound connections + libp2p
  relay/hole-punch (NAT-friendly), and not serving blocks means far less battery/bandwidth.
- Remaining work (an **upstream contribution**, not scala app work): wire an Android arm64 build
  target (NDK + nim config → `libstorage.so`, mirror libwaku) + a JNI/RN bridge (the existing
  delivery-bridge pattern) + a light/no-serve posture (may want a small upstream flag, which #1221
  should deliver). Unverified until a real build: clean cross-compile of leveldb/nat-traversal, and
  on-device battery/APK-size/NAT behaviour.

First move: engage `#1221` — consume it if the team is building it, or contribute the Android target
(we have the liblogosdelivery expertise).

## Interim (if we need attachments before a mobile client lands)

Carry **small** sealed attachments chunked over the **Waku fleet store** — the decentralized infra
mobile already uses for history backfill. Net-new chunking protocol (Waku's ~150KB/message is why
blobs were kept out of events), bounded store retention = *eventual* availability, and only sane for
modest file sizes (a photo/PDF, not a video). This keeps every participant — phone or desktop — able
to share/fetch with no server of ours, at the cost of durability guarantees.

## Consequences

- The sync/fold surface is trivial and platform-symmetric (one `attachments` field, passthrough).
- Local-first capture is preserved on both platforms (blob stored locally first, keyed by
  `sha256(sealed)`); Codex is replication/durability, never on the capture path.
- Privacy holds: blocks are `Ke`-sealed ciphertext; CID/size/timing are the only metadata leak,
  mitigated by Codex's mix-net query option.
- We take a dependency on an upstream mobile deliverable (`#1221`). Until it exists, attachments are
  either desktop-only (full Codex) or interim Waku-fleet (small/eventual) — a deliberate gate, not a
  half-built feature.
- SDK/ABI risk to verify at build time: the generated `modules().storage_module` proxy under scala's
  `logos-module-builder/0.2.6` pin (storage_module builds against a newer logos-cpp-sdk).

## Related

- perun reached the mirror conclusion: Codex gives it little until it builds real user↔user run/
  artifact sharing, because its media is personal today and it already has an always-on household hub
  (perun ADR 0004). scala differs precisely because it is *inherently* multi-party.
- [ADR 0001](0001-event-log-crdt.md), [0002](0002-adopt-logos-sync.md),
  [0006](0006-two-clients-one-fold.md); perun's `spike/logos-storage` branch (desktop storage_backend
  spike, not merged).
