// snapshot.ts — bootstrap catch-up from a sealed log snapshot (ADR 0020; loam-sync PR #2 mirror).
// A joining/reconnecting device fetches ONE sealed blob from content-addressed Storage (Codex) and
// folds it, instead of receiving hundreds of relay-served messages — then RBSR-tails the delta. This
// is scala's mirror of loam-sync/src/snapshot.ts (scala keeps its own crypto/engine, ADR parity), and
// is deliberately PURE + seam-based: it imports only ./engine, and takes open/verify/append as seams,
// so the live crypto/identity/store/Storage wiring lives in calendar.ts and this stays unit-testable.
//
// RBSR stays the correctness guarantee — a snapshot is an accelerator. ingestSnapshot re-verifies every
// signature, so a bad/stale snapshotter can only omit events (healed by RBSR) or include forged ones
// (dropped). Determinism (same cut → same Storage CID) comes from the canonical serialization below,
// byte-identical to loam-sync's serializeSnapshot (so a C++ hub writer and this reader agree).
import { compareHlc, type Event, type HLC } from "./engine";

const enc = (s: string) => new TextEncoder().encode(s);

// Canonical JSON: keys sorted recursively, no whitespace. Byte-identical to loam-sync `cjson`
// (TS + C++), so scala's snapshot format matches the shared spine.
function cjson(v: any): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(cjson).join(",") + "]";
  if (typeof v === "object") {
    const ks = Object.keys(v).sort();
    return "{" + ks.map((k) => JSON.stringify(k) + ":" + cjson(v[k])).join(",") + "}";
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return "null";
}

export interface SnapshotPointer {
  v: number;
  cid: string;
  epoch: number; // the epoch-grid boundary (ms) the cut was taken at
  coversUpToHlc: HLC; // exclusive: the snapshot holds events with HLC < this
  count: number;
}

/** The snapshot-epoch grid: the latest boundary at or before nowMs. Writers target a COMPLETED (past)
 *  epoch so RBSR has converged and independent writers agree on the cut → the CID. */
export function epochBoundary(nowMs: number, epochSizeMs: number): number {
  if (!(epochSizeMs > 0)) throw new Error("epochSizeMs must be > 0");
  return Math.floor(nowMs / epochSizeMs) * epochSizeMs;
}

/** The exclusive HLC upper bound for a wall-clock boundary. */
export function boundaryHlc(boundaryMs: number): HLC {
  return { wall: boundaryMs, ctr: 0, dev: "" };
}

/** Events of a cut in canonical (HLC, id) order: exactly those with HLC strictly before the boundary. */
export function selectCut(log: Event[], boundaryMs: number): Event[] {
  const bound = boundaryHlc(boundaryMs);
  return log
    .filter((e) => e && e.id && compareHlc(e.hlc, bound) < 0)
    .sort((a, b) => compareHlc(a.hlc, b.hlc) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Canonical, deterministic snapshot plaintext bytes (seal these, then upload). Matches loam-sync. */
export function serializeSnapshot(events: Event[], coversUpToHlc: HLC): Uint8Array {
  return enc(cjson({ v: 1, coversUpToHlc, count: events.length, events }));
}

/** Inverse of serializeSnapshot (the bytes are valid JSON). Does NOT verify — ingestSnapshot does. */
export function parseSnapshot(bytes: Uint8Array): { v: number; coversUpToHlc: HLC; count: number; events: Event[] } {
  const o = JSON.parse(new TextDecoder().decode(bytes));
  return { v: o.v, coversUpToHlc: o.coversUpToHlc, count: o.count, events: Array.isArray(o.events) ? o.events : [] };
}

/** Seams the reader needs — injected by calendar.ts (crypto.open with the calendar key, identity
 *  verifyEvent, store.appendEvent) so this module stays pure + unit-testable. */
export interface IngestSeams {
  open: (sealed: Uint8Array) => Uint8Array | null; // decrypt with the calendar's encryptionKey
  verify: (ev: Event) => boolean; // re-verify the signature (never trust the snapshotter)
  append: (ev: Event) => Promise<boolean>; // idempotent (dedup by id); true if new
  observe?: (hlc: HLC) => void; // advance the clock past ingested causes (optional)
}

/** Open → parse → VERIFY every signature → append. Returns how many NEW events were ingested and the
 *  coversUpToHlc to RBSR-tail from. A forged/unverifiable event is dropped (RBSR heals any omission). */
export async function ingestSnapshot(
  sealed: Uint8Array,
  seams: IngestSeams,
): Promise<{ ingested: number; coversUpToHlc: HLC | null }> {
  const plain = seams.open(sealed);
  if (!plain) throw new Error("ingestSnapshot: cannot open snapshot (wrong key or corrupt)");
  const { events, coversUpToHlc } = parseSnapshot(plain);
  let ingested = 0;
  for (const e of events) {
    if (!seams.verify(e)) continue; // drop forged/unsigned — the snapshotter can only omit, not inject
    seams.observe?.(e.hlc);
    if (await seams.append(e)) ingested++;
  }
  return { ingested, coversUpToHlc: coversUpToHlc ?? null };
}
