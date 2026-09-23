// Scala calendar engine — the pure, deterministic fold from a merged event log to
// calendar state. This is a BYTE-FOR-BYTE mirror of the desktop core's
// src/scala_engine.hpp (event-log CRDT): every change is an immutable event;
// current state = fold over the merged log. Merge = union-by-id + HLC sort, so it
// is idempotent (redelivery is a no-op), commutative and associative (arrival
// order is irrelevant) — offline devices converge with no lost writes.
//
// One channel == one calendar; its log holds that calendar's events. Keep this in
// lockstep with scala_engine.hpp; the golden-vector parity test (test/parity)
// guards the two against drift.
import { verifyEvent, isSigned } from "./identity";

// ── HLC (hybrid logical clock): total order wall → ctr → dev ─────────────────
export interface HLC {
  wall: number; // ms epoch (int64 on desktop; safe integer here)
  ctr: number;
  dev: string;
}
export function compareHlc(a: HLC, b: HLC): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.ctr !== b.ctr) return a.ctr < b.ctr ? -1 : 1;
  if (a.dev !== b.dev) return a.dev < b.dev ? -1 : 1;
  return 0;
}

// ── Event: the immutable unit. id (UUIDv4) is the idempotency/dedup key ──────
export interface Event {
  v: number;
  id: string;
  type: string;
  hlc: HLC;
  dev: string;
  payload: any;
  pub?: string; // author's 33B secp256k1 public key (hex) — authenticity layer
  sig?: string; // 64B ECDSA over the canonical event (hex); absent on legacy events
}

// Event type constants — keep in lockstep with scala_engine.hpp ET::.
export const ET = {
  CAL_META: "cal.meta", // {name,color}           — calendar metadata (LWW)
  EVENT_PUT: "event.put", // {id,title,startTime,…} — create/edit an event (LWW upsert by id)
  EVENT_DEL: "event.del", // {id}                   — tombstone an event (terminal)
  MEMBER_SET: "member.set", // {member,role}        — roles (#3): owner/admin grants admin|viewer|remove; opt-in
  EVENT_RSVP: "event.rsvp", // {eventId,status}     — attendance (ADR 0021): LWW per (eventId,author); self-scoped
  EXT: "ext", // {ns,kind,target,id,data}          — generic extension (ADR 0021): app data on a target; `data` OPAQUE to Scala. supersede by id (creator/editor)
  EXT_DEL: "ext.del", // {id}                       — tombstone an ext item (terminal); by the item's author OR an owner/editor (moderation)
  SYNC_REQ: "sync.req", // {from}                  — catch-up: ask peers to re-serve; NOT stored/folded
} as const;

export function eventToJson(e: Event): any {
  const j: any = {
    v: e.v,
    id: e.id,
    type: e.type,
    hlc: { wall: e.hlc.wall, ctr: e.hlc.ctr, dev: e.hlc.dev },
    dev: e.dev,
    payload: e.payload,
  };
  if (e.pub) j.pub = e.pub;
  if (e.sig) j.sig = e.sig;
  return j;
}
export function eventFromJson(j: any): Event {
  const hlc = j && j.hlc && typeof j.hlc === "object" ? j.hlc : {};
  return {
    v: typeof j?.v === "number" ? j.v : 1,
    id: typeof j?.id === "string" ? j.id : "",
    type: typeof j?.type === "string" ? j.type : "",
    hlc: {
      wall: typeof hlc.wall === "number" ? hlc.wall : 0,
      ctr: typeof hlc.ctr === "number" ? hlc.ctr : 0,
      dev: typeof hlc.dev === "string" ? hlc.dev : "",
    },
    dev: typeof j?.dev === "string" ? j.dev : "",
    payload: j && typeof j.payload === "object" && j.payload !== null ? j.payload : {},
    ...(typeof j?.pub === "string" ? { pub: j.pub } : {}),
    ...(typeof j?.sig === "string" ? { sig: j.sig } : {}),
  };
}

// Union by id, sort by HLC. Idempotent — redelivery is a no-op. Pure.
export function mergeEvents(...logs: Event[][]): Event[] {
  const byId = new Map<string, Event>();
  for (const log of logs) for (const e of log) if (e.id && !byId.has(e.id)) byId.set(e.id, e);
  const out = [...byId.values()];
  out.sort((x, y) => compareHlc(x.hlc, y.hlc));
  return out;
}

export interface FoldedCalendar {
  id: string;
  name: string;
  color: string;
  description: string;
  schema: any[];
  owner: string;
  roles: Record<string, string>;
  rolesConfigured: boolean;
  open: boolean;
  collab: boolean;
  events: any[];
  // ADR 0021 generic extensions: target id -> app items in HLC order. Scala never interprets
  // `data`; a consuming app (e.g. Frequencies) filters by ns/kind and reduces into its feature.
  ext: Record<string, Array<{ ns: string; kind: string; id: string; author: string; hlc: HLC; data: any }>>;
}

// ── fold: merged log → calendar state ────────────────────────────────────────
// Returns {id, name, color, events:[…]}. cal.meta is LWW (last by HLC wins).
// Events are LWW upsert by event id; a tombstone is TERMINAL (a later edit can't
// resurrect it). Mirrors scala_engine.hpp foldCalendar exactly.
export function foldCalendar(calId: string, log: Event[]): FoldedCalendar {
  const ordered = mergeEvents(log);
  let name = "";
  let color = "";
  let description = "";
  let owner = "";
  let schema: any[] = []; // OPTIONAL custom-field defs; empty by default (plain calendar)
  const events = new Map<string, any>(); // event id -> payload
  const tombstones = new Set<string>();
  const rsvpOf = new Map<string, Map<string, string>>(); // eventId -> (author -> status) — ADR 0021, LWW by HLC
  // ADR 0021 generic extensions. extCreator: id -> first author (owns supersede/delete). extItems:
  // id -> current item (author stays the creator; data/hlc advance on supersede). extTomb: deleted ids.
  const extCreator = new Map<string, string>();
  const extItems = new Map<string, { ns: string; kind: string; target: string; id: string; author: string; hlc: HLC; data: any }>();
  const extTomb = new Set<string>();

  // Roles + permissions (two rules) — parity with scala_engine.hpp. owner/editor/viewer +
  // an Open toggle: (1) owner/editors do anything, viewers read-only; (2) everyone else may
  // ADD iff Open, and EDIT/DELETE only the events THEY authored. Single HLC-ordered pass.
  const roleOf = new Map<string, string>(); // dev -> "editor"|"viewer"
  const creatorOf = new Map<string, string>(); // event id -> ORIGINAL author (edit-your-own)
  let rolesConfigured = false;
  let openCal = true; // cal.meta "open" (LWW): may participants add? default yes
  let collabCal = false; // cal.meta "collab" (LWW): may any non-viewer edit ANY event?
  const isEditor = (dev: string, verified: boolean): boolean => {
    if (rolesConfigured && !verified) return false; // privileged claim must be authenticated
    if (dev === owner) return true;
    const r = roleOf.get(dev);
    return r === "editor" || r === "admin";
  };
  const isViewer = (dev: string): boolean => roleOf.get(dev) === "viewer";
  const canAdd = (dev: string, verified: boolean): boolean => {
    if (isEditor(dev, verified)) return true;
    if (isViewer(dev)) return false;
    return openCal;
  };
  const canEditExisting = (dev: string, creator: string, verified: boolean): boolean => {
    if (isEditor(dev, verified)) return true;
    if (isViewer(dev)) return false;
    if (collabCal) return true; // Collaborative: any non-viewer edits anything
    return !!creator && dev === creator;
  };

  for (const e of ordered) {
    // A present-but-invalid signature = forgery/tampering → drop. Unsigned (legacy) events
    // are admitted but never count as authenticated.
    const signed = isSigned(e);
    const verified = signed && verifyEvent(e);
    if (!verified) continue; // signatures ALWAYS required — every event is signed via the loam identity; drop anything unsigned/tampered
    const author = e.dev;
    if (e.type === ET.CAL_META) {
      const creating = !owner;
      if (creating) owner = author; // creator = first cal.meta author
      if (!creating && !isEditor(author, verified)) continue; // only owner/editors change settings
      const p: any = e.payload;
      if (Object.prototype.hasOwnProperty.call(p, "name")) name = p.name ?? name;
      if (Object.prototype.hasOwnProperty.call(p, "color")) color = p.color ?? color;
      if (Object.prototype.hasOwnProperty.call(p, "description")) description = p.description ?? description;
      if (Array.isArray(p.schema)) schema = p.schema;
      if (Object.prototype.hasOwnProperty.call(p, "open")) openCal = p.open !== false;
      if (Object.prototype.hasOwnProperty.call(p, "collab")) collabCal = p.collab === true;
    } else if (e.type === ET.MEMBER_SET) {
      // A role grant is admitted only from an AUTHENTICATED owner/editor.
      const authed = verified && (author === owner || roleOf.get(author) === "editor" || roleOf.get(author) === "admin");
      if (!owner || !authed) continue;
      const m: string = (e.payload as any)?.member ?? "";
      const r: string = (e.payload as any)?.role ?? "";
      if (!m || m === owner) continue; // owner role is fixed
      rolesConfigured = true;
      if (r === "remove") roleOf.delete(m);
      else if (r === "editor" || r === "admin") roleOf.set(m, "editor"); // "admin" = legacy alias
      else if (r === "viewer") roleOf.set(m, "viewer");
    } else if (e.type === ET.EVENT_PUT) {
      const id: string = e.payload?.id ?? "";
      if (!id || tombstones.has(id)) continue; // tombstone terminal
      const exists = creatorOf.has(id);
      if (!exists) { if (!canAdd(author, verified)) continue; creatorOf.set(id, author); } // create
      else if (!canEditExisting(author, creatorOf.get(id)!, verified)) continue; // edit
      const ev = { ...e.payload, calendarId: calId, creatorId: creatorOf.get(id) }; // ORIGINAL author
      events.set(id, ev);
    } else if (e.type === ET.EVENT_DEL) {
      const id: string = e.payload?.id ?? "";
      if (!id) continue;
      if (!canEditExisting(author, creatorOf.get(id) ?? "", verified)) continue;
      tombstones.add(id);
      events.delete(id);
    } else if (e.type === ET.EVENT_RSVP) {
      // Self-scoped attendance (ADR 0021): any verified member sets THEIR OWN status (author = signer),
      // LWW per (eventId, author) — the log is HLC-ordered so a later RSVP overwrites. "" = retract.
      const eid: string = e.payload?.eventId ?? "";
      if (!eid) continue;
      const status: string = e.payload?.status ?? "";
      let m = rsvpOf.get(eid);
      if (!m) { m = new Map<string, string>(); rsvpOf.set(eid, m); }
      if (status === "") m.delete(author); else m.set(author, status);
    } else if (e.type === ET.EXT) {
      // Generic extension (ADR 0021). Any verified member may CREATE an item (its own id); a
      // SUPERSEDE (same id) is honoured only from the creator or an editor/owner. `data` opaque.
      const p: any = e.payload;
      // Safe string reads: "" for a missing OR non-string field (matches the C++ jstr helper), so a
      // crafted non-string id/target/ns can't diverge the two folds.
      const jstr = (o: any, k: string): string => (typeof o?.[k] === "string" ? o[k] : "");
      const id = jstr(p, "id");
      const target = jstr(p, "target");
      if (!id || !target || extTomb.has(id)) continue; // need id+target; tombstone terminal
      const exists = extCreator.has(id);
      if (!exists) {
        extCreator.set(id, author);
        extItems.set(id, { ns: jstr(p, "ns"), kind: jstr(p, "kind"), target, id, author, hlc: e.hlc, data: p?.data ?? null });
      } else {
        if (author !== extCreator.get(id) && !isEditor(author, verified)) continue; // supersede: creator/editor only
        const it = extItems.get(id)!; // keep ns/kind/target/author/hlc from CREATION; only data advances
        it.data = p?.data ?? null;    // (hlc stays first-posted → the item holds its place in the thread)
      }
    } else if (e.type === ET.EXT_DEL) {
      // Tombstone an ext item — by its author (creator) OR an owner/editor (moderation). Terminal.
      const id: string = typeof e.payload?.id === "string" ? e.payload.id : "";
      if (!id || !extCreator.has(id)) continue; // unknown id → nothing to authorise/delete
      if (author !== extCreator.get(id) && !isEditor(author, verified)) continue;
      extTomb.add(id);
      extItems.delete(id);
    }
  }

  // Attach RSVPs to surviving events only, authors in sorted order (match C++ std::map iteration).
  for (const [eid, m] of rsvpOf) {
    const ev = events.get(eid);
    if (!ev || m.size === 0) continue;
    const rsvps: Record<string, string> = {};
    [...m.keys()].sort().forEach((a) => (rsvps[a] = m.get(a)!));
    ev.rsvps = rsvps;
  }

  // Materialize ext grouped by target. Array ORDER is significant for parity (the golden test
  // compares arrays element-wise), so sort each target's items by HLC then id — total + identical
  // to the C++ fold. Empty targets are omitted.
  const extByTarget = new Map<string, Array<{ ns: string; kind: string; target: string; id: string; author: string; hlc: HLC; data: any }>>();
  for (const it of extItems.values()) {
    let arr = extByTarget.get(it.target);
    if (!arr) { arr = []; extByTarget.set(it.target, arr); }
    arr.push(it);
  }
  const ext: FoldedCalendar["ext"] = {};
  [...extByTarget.keys()].sort().forEach((t) => {
    const arr = extByTarget.get(t)!;
    arr.sort((x, y) => compareHlc(x.hlc, y.hlc) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    ext[t] = arr.map((it) => ({ ns: it.ns, kind: it.kind, id: it.id, author: it.author, hlc: it.hlc, data: it.data }));
  });

  // Match C++ std::map iteration: events ordered by id string.
  const ids = [...events.keys()].sort();
  const roles: Record<string, string> = {};
  [...roleOf.keys()].sort().forEach((k) => (roles[k] = roleOf.get(k)!));
  return { id: calId, name, color, description, schema, owner, roles, rolesConfigured, open: openCal, collab: collabCal, events: ids.map((id) => events.get(id)), ext };
}

// ── Clock: stamps local events, advances past ingested causes ────────────────
// Mirrors the desktop nextHlc (wall→ctr bump) and additionally primes from the
// whole log on load + advances on every ingest (receive), so mobile-authored
// events causally sort after everything it has already seen. This is strictly a
// correctness improvement over the desktop clock and does NOT affect the wire or
// the fold (convergence is over the merged set, independent of either clock).
export class Clock {
  wall = 0;
  ctr = 0;
  dev: string;
  constructor(dev: string) {
    this.dev = dev;
  }
  // Prime from an existing log so we never author an event that sorts before a
  // cause we already hold.
  primeFrom(log: Event[]) {
    for (const e of log) this.observe(e.hlc);
  }
  private observe(remote: HLC) {
    if (remote.wall > this.wall) {
      this.wall = remote.wall;
      this.ctr = remote.ctr;
    } else if (remote.wall === this.wall && remote.ctr > this.ctr) {
      this.ctr = remote.ctr;
    }
  }
  receive(remote: HLC) {
    this.observe(remote);
  }
  send(now: number): HLC {
    if (now > this.wall) {
      this.wall = now;
      this.ctr = 0;
    } else {
      this.ctr += 1;
    }
    return { wall: this.wall, ctr: this.ctr, dev: this.dev };
  }
}
