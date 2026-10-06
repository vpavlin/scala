// App logic: bridges the local CRDT log store and the event wire. Authors local
// edits as immutable events (cal.meta / event.put / event.del), merges inbound
// events into the log, and folds for the UI — the exact model the desktop core
// (scala_impl.cpp publishAndApply / applyIncoming) uses. Also parses/builds the
// `scala://` invite links the desktop uses to share a calendar's key.
import { AppState, ToastAndroid } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { toByteArray } from "base64-js";
import { store, Calendar, CalEvent } from "./store";
import { Event, ET, Clock, eventToJson, eventFromJson } from "./engine";
import { authorEvent, defaultAddress, bindCalendar, identityForCalendar, isLoamBinding } from "./identities";
import { parseInvite, buildInvite, cleanInviteLink, parseQuery, b64urlDecode, newTicket, invitePayload, claimPayload, ticketAddress } from "./invite-link";
import * as sstat from "./syncstatus";
import * as sync from "./scala-sync";
import { buildInitial, respond } from "./catchup";
import { open as cryptoOpen } from "./crypto";
import { verifyEvent, isSigned } from "./identity";
import * as snapshot from "./snapshot";
import * as storage from "./logos-storage";

// ── device identity (SDS senderId + event author) ───────────────────────────
// The identity is now a secp256k1 keypair (identity.ts); its ADDRESS ("0x…") is the
// verifiable author id used for event.dev / hlc.dev / the SDS senderId. Every authored
// event is signed with the private key and verified on merge.
export async function getDeviceId(): Promise<string> {
  // The DEFAULT identity's address (clock/senderId). Per-event authorship is set per calendar by
  // authorEvent (a calendar can be bound to a different identity than the default).
  return await defaultAddress();
}

// ── clock + event construction (mirrors scala_impl.cpp nextHlc / mkEvent) ────
let clock: Clock | null = null;
let deviceId = "scala-default";
export function myDeviceId(): string { return deviceId; }
// Lazily create the clock, prime it from every calendar's log so we never author
// an event that sorts before a cause we already hold.
async function ensureClock(): Promise<Clock> {
  if (clock) return clock;
  deviceId = await getDeviceId();
  const c = new Clock(deviceId);
  for (const r of await store.getRegistry()) c.primeFrom(await store.getLog(r.id));
  clock = c;
  return c;
}
async function mkEvent(type: string, payload: any, calId?: string): Promise<Event> {
  const c = await ensureClock();
  // Signed payloads must be exactly what JSON round-trips to: drop undefined values at every depth.
  const clean = payload === undefined ? payload : JSON.parse(JSON.stringify(payload));
  const e: Event = { v: 1, id: Crypto.randomUUID(), type, hlc: c.send(Date.now()), dev: deviceId, payload: clean };
  // Transient sync msgs (SYNC_REQ) are never signed (fire constantly, never folded). Content is
  // signed with the CALENDAR'S identity — authorEvent routes to soft/device/keycard and stamps the
  // author. A Keycard identity prompts the PIN (implicit unlock) and a cancel/failure THROWS so the
  // caller aborts the create rather than saving a mis-authored event.
  if (type === ET.SYNC_REQ || !calId) return e;
  return (await authorEvent(calId, e)) as Event;
}
// Event ids authored locally but not yet handed to the wire — the UI greys/badges these as
// "syncing". Cleared when the send resolves; if it never does, RBSR catch-up delivers the event
// anyway (see serveLog / sendSyncReq), so this is only a hint, not the delivery guarantee.
const pendingSend = new Set<string>();
const lastServeLog = new Map<string, number>();   // calId -> last whole-log serve (ms)
const lastFpAnswer = new Map<string, number>();   // calId|peer -> last fingerprint answer (ms)
export function pendingEventIds(): string[] { return [...pendingSend]; }

// Local-FIRST: persist to disk (the durable source of truth) and return immediately so the UI
// renders the change at once. The wire broadcast runs in the BACKGROUND and never blocks the caller
// — a slow/absent shared node must not freeze the app. Delivery is guaranteed by catch-up, not by
// this send; this send is just the fast path.
async function publishAndApply(calId: string, e: Event): Promise<void> {
  await store.appendEvent(calId, e);
  const pid = (e.type === ET.EVENT_PUT && e.payload && e.payload.id) ? String(e.payload.id) : null;
  if (pid) pendingSend.add(pid);   // flag the visible event as not-yet-sent
  void sync.sendEvent(calId, JSON.stringify(eventToJson(e)))
    .then(() => { if (pid) { pendingSend.delete(pid); notifyChange(); } })
    .catch(() => { /* stays flagged; catch-up will deliver it later */ });
}

// ── catch-up (qaku SYNC_REQ + seed) ──────────────────────────────────────────
const lastServe: Record<string, number> = {};
// Re-broadcast our whole log for a calendar (answers a SYNC_REQ). Rate-limited per
// calendar so overlapping requests can't flood; idempotent (peers dedup by id).
async function serveLog(calId: string): Promise<void> {
  const now = Date.now();
  if (lastServe[calId] && now - lastServe[calId] < 3000) return;
  lastServe[calId] = now;
  let cleared = false;
  for (const e of await store.getLog(calId)) {
    try {
      await sync.sendEvent(calId, JSON.stringify(eventToJson(e)));
      const pid = e.payload && e.payload.id ? String(e.payload.id) : null;   // it's on the wire now
      if (pid && pendingSend.delete(pid)) cleared = true;
    } catch { /* still offline — try again on the next catch-up */ }
  }
  if (cleared) notifyChange();   // drop the "syncing" flag once re-broadcast succeeds
}
// Kick off catch-up: publish the initial reconciliation message (bounded range
// fingerprints over what we hold). Fresh calendar → empty-set fingerprint →
// recurses down to receive everything; slightly behind → only the changed range.
// Calendars joining from a snapshot: until the snapshot lands (or its head start runs out), the
// general catch-up rounds (startSyncing / reconcile) skip them, so the full catch-up doesn't race the
// snapshot. joinInBackground's own request passes `force`.
const snapshotHeadStart = new Map<string, number>();   // calId -> until (ms)
async function sendSyncReq(calId: string, force = false): Promise<boolean> {
  const until = snapshotHeadStart.get(calId);
  if (!force && until !== undefined) {
    if (Date.now() < until) return false;
    snapshotHeadStart.delete(calId);
  }
  const msg = buildInitial(await store.getLog(calId), deviceId);
  const e = await mkEvent(ET.SYNC_REQ, msg);
  try { await sync.sendEvent(calId, JSON.stringify(eventToJson(e))); return true; }
  catch { return false; }
}

// ── scala:// invite links — MUST match the desktop core byte-for-byte ─────────
// The parsing/building lives in invite-link.ts (pure, node-tested); re-exported for the app.
export { parseInvite, buildInvite, cleanInviteLink } from "./invite-link";

// ── inbound: merge one received event into the calendar's log ────────────────
sync.setEventHandler((calendarId, eventJson) => {
  void (async () => {
    try {
      const j = JSON.parse(eventJson);
      const e = eventFromJson(j);
      if (!e.id) return;
      // CATCH-UP (logos-sync v2, recursive RBSR): step the reconciliation for one
      // incoming range statement — serve the id-exact missing events + publish the
      // fp/ids/need replies (all single-segment). A payload with no `t` is an OLD
      // peer's bare SYNC_REQ → fall back to a whole-log serve so we still feed it.
      if (e.type === ET.SYNC_REQ) {
        const msg: any = e.payload;
        // Store history arrives through Loam like live messages, so old catch-up requests get replayed.
        // Throttle: a whole-log serve at most every 30 s per calendar, and one answer to a round-opening
        // fingerprint per (calendar, peer) every 10 s. Live rounds are further apart than that.
        const now = Date.now();
        if (!msg || !msg.t) {
          if (now - (lastServeLog.get(calendarId) || 0) < 30000) return;
          lastServeLog.set(calendarId, now);
          await serveLog(calendarId); return;
        }
        if (msg.t === "fp") {
          const k = calendarId + "|" + String(msg.from);
          if (now - (lastFpAnswer.get(k) || 0) < 10000) return;
          lastFpAnswer.set(k, now);
        }
        sstat.noteCatchup(calendarId); // a reconciliation exchange is live for this calendar
        const step = respond(await store.getLog(calendarId), msg, deviceId);
        for (const ev of step.serve)
          await sync.sendEvent(calendarId, JSON.stringify(eventToJson(ev))).catch(() => {});
        for (const r of step.replies) {
          if (r.t === "need" && Array.isArray(r.ids)) sstat.noteNeed(calendarId, r.ids.length); // events WE still lack
          await sync.sendEvent(calendarId, JSON.stringify(eventToJson(await mkEvent(ET.SYNC_REQ, r)))).catch(() => {});
        }
        return;
      }
      (await ensureClock()).receive(e.hlc); // advance past the ingested cause
      const isNew = await store.appendEvent(calendarId, e); // idempotent (dedup by id)
      if (isNew) { sstat.noteRecv(calendarId); notifyChange(); } // one deficit event fulfilled
    } catch {
      /* malformed event — ignore */
    }
  })();
});

// ── outbound: local edits → append event + publish ──────────────────────────
// Build an event.put payload from UI fields (never carry calendarId/creatorId —
// the fold sets those). Mirrors scala_impl.cpp createEvent/updateEvent.
function putPayload(id: string, f: any): any {
  const p: any = { id };
  if (f.title !== undefined) p.title = f.title;
  if (f.startTime !== undefined) p.startTime = f.startTime;
  if (f.endTime !== undefined) p.endTime = f.endTime;
  if (f.description !== undefined) p.description = f.description;
  if (f.location !== undefined) p.location = f.location;
  if (f.url !== undefined) p.url = f.url;
  if (f.allDay !== undefined) p.allDay = f.allDay;
  if (f.reminderMin !== undefined) p.reminderMin = f.reminderMin;
  if (f.recur !== undefined) p.recur = f.recur; // recurrence rule (fold passes it through)
  // Custom schema fields (#8) travel under `fields`; the fold passes them through.
  if (f.fields !== undefined) p.fields = f.fields;
  // Attachment refs (ADR 0017): {name,mime,size,storageCid,blobId} — fold passes them through.
  if (f.attachments !== undefined) p.attachments = f.attachments;
  return p;
}

// Refuse to author (with a clear error) when the calendar's identity isn't allowed to write —
// otherwise the fold silently drops the event and it looks like "save didn't save". Mirrors the
// fold's canAdd / canEditExisting rules (engine.ts / scala_engine.hpp).
async function assertAuthorable(calId: string, editEventId?: string): Promise<void> {
  const folded: any = await store.folded(calId); // cached — valid until this calendar's log next changes
  const who = (await identityForCalendar(calId)).address;
  const role = (folded.roles || {})[who];
  const isEditor = who === folded.owner || role === "editor" || role === "admin";
  let ok: boolean;
  if (editEventId) {
    const ev: any = (folded.events || []).find((e: any) => e && e.id === editEventId);
    ok = isEditor || (!!ev && ev.creatorId === who); // an editor, or editing an event you authored
  } else {
    ok = isEditor || (folded.open && role !== "viewer"); // add: open calendar, or an editor
  }
  if (!ok) {
    const short = (a: string) => (a && a.length > 10 ? a.slice(0, 8) + "…" + a.slice(-4) : a || "?");
    throw new Error(`This calendar won't accept a write from your identity (${short(who)}). Its owner is ${short(folded.owner)} — author as an allowed identity (change the default in Identities, or ask the owner for a role).`);
  }
}

export async function createEvent(
  calendarId: string,
  fields: Omit<CalEvent, "id" | "calendarId">,
  // Optional stable id (e.g. an .ics UID) so re-import upserts by id instead of duplicating.
  // Omitted for normal authoring → a fresh uuid.
  explicitId?: string,
): Promise<CalEvent> {
  const id = explicitId || Crypto.randomUUID();
  // A reused id that ALREADY exists is an edit (LWW upsert), not an add — so check the EDIT rule,
  // not the add rule, or the fold silently drops an unauthorised re-write (e.g. re-importing an .ics
  // event another member authored on a non-collaborative calendar) while this call reports success.
  let editing = false;
  if (explicitId) {
    const folded: any = await store.folded(calendarId); // cached fold
    editing = (folded.events || []).some((e: any) => e && e.id === explicitId);
  }
  await assertAuthorable(calendarId, editing ? id : undefined);
  await publishAndApply(calendarId, await mkEvent(ET.EVENT_PUT, putPayload(id, fields), calendarId));
  notifyChange();
  return { ...fields, id, calendarId } as CalEvent;
}

export async function updateEvent(ev: CalEvent): Promise<void> {
  await assertAuthorable(ev.calendarId, ev.id);
  await publishAndApply(ev.calendarId, await mkEvent(ET.EVENT_PUT, putPayload(ev.id, ev), ev.calendarId));
  notifyChange();
}

// Set MY attendance on an event (ADR 0021). Self-scoped: any member may RSVP for themselves, so this
// does NOT go through assertAuthorable (no add/edit role needed) — the fold keys by the signer.
// status ∈ "going" | "maybe" | "no"; "" retracts. Local-first like every write.
export async function setRsvp(calId: string, eventId: string, status: string): Promise<void> {
  await publishAndApply(calId, await mkEvent(ET.EVENT_RSVP, { eventId, status }, calId));
  notifyChange();
}

export async function deleteEvent(ev: CalEvent): Promise<void> {
  await assertAuthorable(ev.calendarId, ev.id);
  await publishAndApply(ev.calendarId, await mkEvent(ET.EVENT_DEL, { id: ev.id }, ev.calendarId));
  notifyChange();
}

// Create a NEW shared calendar on this device. Generates the id + a symmetric
// encryptionKey in the SAME format the desktop uses (two concatenated UUIDv4
// strings, dashes and all — crypto.ts's key derivation matches it byte-for-byte),
// registers membership, starts syncing, and publishes a cal.meta event. The
// invite (buildInvite) carries name+key so a joiner gets metadata even before the
// first cal.meta event reaches them.
export async function createCalendar(
  name: string,
  color = "#89b4fa",
  description = "",
  identityId?: string,
  // Extra meta set AT CREATE so the full form is one signed cal.meta (one Keycard tap), not
  // create-then-edit. schema = custom fields; open = anyone-with-invite-can-add.
  // = fold drops unsigned writes.
  opts?: { schema?: any[]; open?: boolean; collab?: boolean },
): Promise<Calendar> {
  const id = Crypto.randomUUID();
  const encryptionKey = Crypto.randomUUID() + Crypto.randomUUID();
  const nm = name.trim() || "My calendar";
  // Bind the calendar to the chosen identity BEFORE authoring, so the cal.meta (which makes its
  // author the OWNER) is signed by that identity. Its address is the local creatorId too.
  if (identityId) await bindCalendar(id, identityId);
  const author = (await identityForCalendar(id)).address;
  await store.upsertReg({ id, key: encryptionKey, name: nm, color, isShared: true, creatorId: author });
  await sync.joinCalendar(id, encryptionKey);
  const meta: any = { name: nm, color };
  if (description.trim()) meta.description = description.trim();
  if (opts?.schema && opts.schema.length) meta.schema = opts.schema;
  if (opts?.open !== undefined) meta.open = opts.open;
  if (opts?.collab !== undefined) meta.collab = opts.collab;
  await publishAndApply(id, await mkEvent(ET.CAL_META, meta, id));
  notifyChange();
  return { id, name: nm, color, isShared: true, encryptionKey, creatorId: author };
}

// Remove a calendar from THIS device. A shared p2p calendar can't be deleted for peers —
// this forgets our local copy + membership (registry + event log) so it stops syncing here.
export async function deleteCalendar(calId: string): Promise<void> {
  await store.removeCalendar(calId);
  notifyChange();
}

// Edit a calendar's SHARED metadata (cal.meta, LWW per field) — name/color/description
// travel in the event log to every device. Only the changed fields are written.
export async function updateCalendarMeta(
  calId: string,
  fields: { name?: string; color?: string; description?: string; schema?: any[]; open?: boolean; collab?: boolean },
): Promise<void> {
  const p: any = {};
  if (fields.name !== undefined) p.name = fields.name.trim();
  if (fields.color !== undefined) p.color = fields.color;
  if (fields.description !== undefined) p.description = fields.description.trim();
  if (fields.schema !== undefined) p.schema = fields.schema;
  if (fields.open !== undefined) p.open = fields.open;
  if (fields.collab !== undefined) p.collab = fields.collab;
  if (Object.keys(p).length === 0) return;
  if (p.name !== undefined || p.color !== undefined) {
    const reg = (await store.getRegistry()).find((r) => r.id === calId);
    if (reg) await store.upsertReg({ ...reg, name: p.name ?? reg.name, color: p.color ?? reg.color });
  }
  await publishAndApply(calId, await mkEvent(ET.CAL_META, p, calId));
  notifyChange();
}

// Edit history (#4) for one event: the raw EVENT_PUT/EVENT_DEL entries for its id, in
// time order — who changed it, when, and to what. The fold keeps only the final state,
// so this reads the raw log. Idempotent duplicates share an id so they collapse.
// Friendly label per payload field, for "what changed" on an edit (cheap consecutive-diff, #4).
const HIST_FIELD_LABEL: Record<string, string> = {
  title: "title", startTime: "time", endTime: "time", allDay: "all-day", location: "location",
  url: "link", description: "notes", recur: "repeat", reminderMin: "reminder", fields: "details",
};
export async function getEventHistory(
  calId: string,
  eventId: string,
): Promise<{ author: string; at: number; action: "created" | "edited" | "deleted"; payload: any; changed?: string[] }[]> {
  const seen = new Set<string>();
  const entries = (await store.getLog(calId))
    .filter((e) => (e.type === ET.EVENT_PUT || e.type === ET.EVENT_DEL) && (e.payload as any)?.id === eventId)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    // Only what the fold could accept: an unsigned or forged entry isn't history (mirrors the core).
    .filter((e) => isSigned(e) && verifyEvent(e))
    .sort((a, b) => a.hlc.wall - b.hlc.wall || (a.hlc.dev < b.hlc.dev ? -1 : a.hlc.dev > b.hlc.dev ? 1 : 0));
  return entries.map((e, i) => {
    const action = e.type === ET.EVENT_DEL ? "deleted" : i === 0 ? "created" : "edited";
    let changed: string[] | undefined;
    if (action === "edited") {
      const prev: any = entries[i - 1]?.payload || {};
      const cur: any = e.payload || {};
      const set = new Set<string>();
      for (const k of Object.keys(HIST_FIELD_LABEL)) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(cur[k])) set.add(HIST_FIELD_LABEL[k]);
      }
      changed = [...set]; // e.g. ["time","location"] — empty if only non-user fields moved
    }
    // The author the signature covers (hlc.dev), not the top-level dev a sender can set freely.
    return { author: (e.hlc && e.hlc.dev) || e.dev, at: e.hlc.wall, action, payload: e.payload, changed };
  });
}

// Bootstrap catch-up from a sealed log snapshot in Storage (ADR 0020). Fetches ONE content-addressed
// blob and folds it, instead of receiving hundreds of relay-served messages; normal RBSR sync then
// fills the delta after `pointer.coversUpToHlc`. RBSR stays the guarantee — every event is re-verified,
// so a bad/stale snapshotter can only omit (healed by sync) or forge (dropped). Returns #new events.
//
// NOTE: the phone's Storage client is FETCH-ONLY, so writing snapshots is the hub/desktop's job
// (C++ core + storage_module); this is the reader half. Needs a reachable Codex node + a snapshot
// pointer (a `snapshot {cid,epoch,coversUpToHlc,count}` control message on the channel) — both are the
// remaining live wiring, so this runs only once Storage is connected and a pointer has arrived.
export async function bootstrapFromSnapshot(calId: string, pointer: snapshot.SnapshotPointer): Promise<number> {
  const reg = await store.getReg(calId);
  if (!reg) throw new Error("calendar is not registered on this device");
  if (!storage.available()) throw new Error("Logos Storage is not in this build");
  const dir = await storage.filesDir();
  const path = `${dir}/snap-${pointer.cid}.bin`;
  await storage.fetch(pointer.cid);            // pull from the network if not held locally
  await storage.downloadToFile(pointer.cid, path);
  const sealed = toByteArray(await storage.readFileB64(path)); // base64 file → bytes
  const clock = await ensureClock();
  const { ingested } = await snapshot.ingestSnapshot(sealed, {
    open: (s) => cryptoOpen(reg.key, s),       // decrypt with the calendar's key (members-only)
    verify: verifyEvent,                        // re-verify every signature (never trust the snapshotter)
    append: (e) => store.appendEvent(calId, e), // idempotent (dedup by id); also invalidates the fold
    appendMany: (es) => store.appendMany(calId, es), // one write for the whole snapshot
    normalize: eventFromJson,                   // same parsing as the network path (drops malformed fields)
    observe: (h) => clock.receive(h),           // advance the clock past ingested causes
  });
  if (ingested) notifyChange();
  return ingested;
}

// Roles (#3): grant/revoke a member by their device id (owner/admin only — the fold
// enforces it). role "remove" clears the grant. Writes a member.set event.
export async function setMemberRole(calId: string, member: string, role: "editor" | "admin" | "viewer" | "remove"): Promise<void> {
  await publishAndApply(calId, await mkEvent(ET.MEMBER_SET, { member, role }, calId));
  notifyChange();
}

// ── invite tickets (ADR 0022) ─────────────────────────────────────────────────
// Owner/editor: make a one-time ticket key, post member.invite {ticket, role}, and return the invite
// link (join link + &inv=<ticket priv>). The ticket key is also kept on THIS device so the pending
// invite's link can be shown again; it is a bearer secret, like the link.
const ticketKeyName = (ticket: string) => "scala-inv-" + ticket;
export async function createInviteTicket(calId: string, role: "editor" | "viewer"): Promise<{ link: string; ticket: string }> {
  const reg = await store.getReg(calId);
  if (!reg || !reg.key) throw new Error("This calendar has no shared key on this device, so it can't be shared.");
  const folded: any = await store.folded(calId);
  const t = newTicket((n) => Crypto.getRandomBytes(n)); // Hermes-safe RNG (no crypto.getRandomValues)
  await publishAndApply(calId, await mkEvent(ET.MEMBER_INVITE, invitePayload(t.ticket, role), calId));
  try { await SecureStore.setItemAsync(ticketKeyName(t.ticket), t.priv); } catch { /* the link below still works */ }
  notifyChange();
  return { link: buildInvite({ id: calId, name: folded.name || reg.name, encryptionKey: reg.key }, t.priv), ticket: t.ticket };
}
/** The invite link for a pending ticket made on THIS device, or null if its key isn't here. */
export async function inviteLinkFor(calId: string, ticket: string): Promise<string | null> {
  let priv: string | null = null;
  try { priv = await SecureStore.getItemAsync(ticketKeyName(ticket)); } catch { /* */ }
  const reg = await store.getReg(calId);
  if (!priv || !reg || !reg.key || ticketAddress(priv) !== ticket) return null;
  const folded: any = await store.folded(calId);
  return buildInvite({ id: calId, name: folded.name || reg.name, encryptionKey: reg.key }, priv);
}
export async function revokeInvite(calId: string, ticket: string): Promise<void> {
  await publishAndApply(calId, await mkEvent(ET.MEMBER_INVITE, invitePayload(ticket, "revoke"), calId));
  try { await SecureStore.deleteItemAsync(ticketKeyName(ticket)); } catch { /* */ }
  notifyChange();
}

// Joiner: redeem a ticket from an invite link. The claim must sort AFTER the invite in HLC order, so it
// is posted only once the invite has synced in (our clock has then observed it). Pending claims are kept
// in SecureStore (the ticket key is a secret) and retried on every log change and on restart; the result
// is reported once via onClaimResult.
type PendingClaim = { priv: string; posted?: boolean; member?: string; errShown?: boolean };
export type ClaimResult = { calId: string; name: string; kind: "ok" | "used" | "error"; role?: string; message?: string };
const PENDING_CLAIMS = "scala-pending-claims";
const claimListeners = new Set<(r: ClaimResult) => void>();
export function onClaimResult(cb: (r: ClaimResult) => void): () => void { claimListeners.add(cb); return () => claimListeners.delete(cb); }
const emitClaim = (r: ClaimResult) => claimListeners.forEach((l) => { try { l(r); } catch { /* */ } });
let claimsPending: boolean | null = null; // null = not read yet this run
async function readClaims(): Promise<Record<string, PendingClaim>> {
  let c: Record<string, PendingClaim> = {};
  try { const s = await SecureStore.getItemAsync(PENDING_CLAIMS); c = s ? JSON.parse(s) : {}; } catch { /* */ }
  claimsPending = Object.keys(c).length > 0;
  return c;
}
async function writeClaims(c: Record<string, PendingClaim>): Promise<void> {
  claimsPending = Object.keys(c).length > 0;
  try {
    if (Object.keys(c).length) await SecureStore.setItemAsync(PENDING_CLAIMS, JSON.stringify(c));
    else await SecureStore.deleteItemAsync(PENDING_CLAIMS);
  } catch { /* */ }
}
async function addPendingClaim(calId: string, priv: string): Promise<void> {
  const c = await readClaims();
  if (c[calId] && c[calId].priv === priv) return; // same link opened twice
  c[calId] = { priv };
  await writeClaims(c);
}
let claimsBusy = false;
let claimsAgain = false;
export async function processPendingClaims(): Promise<void> {
  if (claimsBusy) { claimsAgain = true; return; } // guard re-entry (onChange fires in bursts)
  claimsBusy = true;
  let anyChange = false;
  try {
    do {
      claimsAgain = false;
      const claims = await readClaims();
      let changed = false;
      for (const calId of Object.keys(claims)) {
        const pc = claims[calId];
        const reg = await store.getReg(calId);
        if (!reg) { delete claims[calId]; changed = true; continue; } // calendar removed from this device
        const folded: any = await store.folded(calId);
        const name = folded.name || reg.name || "calendar";
        let ticket = "";
        try { ticket = ticketAddress(pc.priv); } catch { delete claims[calId]; changed = true; continue; }
        let member = pc.member;
        if (!member) {
          try { member = (await identityForCalendar(calId)).address; }
          catch (e) {
            if (!pc.errShown) { pc.errShown = true; changed = true; emitClaim({ calId, name, kind: "error", message: String((e as any)?.message ?? e) }); }
            continue;
          }
        }
        const role = (folded.roles || {})[member];
        if (role || (folded.owner && folded.owner === member)) {
          delete claims[calId]; changed = true;
          emitClaim({ calId, name, kind: "ok", role: role || "owner" });
          continue;
        }
        if (pc.posted) {
          // Our claim is in the log but gives no role: an earlier claim won, or the ticket was revoked first.
          delete claims[calId]; changed = true;
          emitClaim({ calId, name, kind: "used" });
          continue;
        }
        if ((folded.invites || {})[ticket]) {
          try {
            await publishAndApply(calId, await mkEvent(ET.MEMBER_CLAIM, claimPayload(calId, pc.priv, member), calId));
            pc.posted = true; pc.member = member; changed = true;
            claimsAgain = true; // re-check the fold now that the claim is in
          } catch (e) {
            if (!pc.errShown) { pc.errShown = true; changed = true; emitClaim({ calId, name, kind: "error", message: String((e as any)?.message ?? e) }); }
          }
          continue;
        }
        // Not pending. If the invite IS in our log, it was already redeemed or revoked; otherwise it just
        // hasn't synced yet — keep waiting.
        const log = await store.getLog(calId);
        const seen = log.some((e) => e.type === ET.MEMBER_INVITE && (e.payload as any)?.ticket === ticket && isSigned(e) && verifyEvent(e));
        if (seen) { delete claims[calId]; changed = true; emitClaim({ calId, name, kind: "used" }); }
      }
      if (changed) { await writeClaims(claims); anyChange = true; }
    } while (claimsAgain);
  } finally { claimsBusy = false; }
  if (anyChange) notifyChange();
}
let claimTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleClaims(): void {
  if (claimTimer) return;
  claimTimer = setTimeout(() => { claimTimer = null; processPendingClaims().catch(() => {}); }, 400);
}

// Device-LOCAL alias (never synced): overrides the display name on THIS phone while the
// official cal.meta name is preserved for everyone. Empty alias clears it.
export async function getAlias(calId: string): Promise<string> {
  try { return (await SecureStore.getItemAsync("scala-alias-" + calId)) || ""; } catch { return ""; }
}
export async function setAlias(calId: string, alias: string): Promise<void> {
  try {
    if (alias.trim()) await SecureStore.setItemAsync("scala-alias-" + calId, alias.trim());
    else await SecureStore.deleteItemAsync("scala-alias-" + calId);
  } catch { /* ignore */ }
  notifyChange();
}

// Rebind an existing calendar to a different authoring identity (future events author as it).
export async function setCalendarIdentity(calId: string, identityId: string): Promise<void> {
  await bindCalendar(calId, identityId);
}
export { bindingFor as calendarIdentityId } from "./identities";

export async function joinFromInvite(link: string, identityId?: string): Promise<Calendar | null> {
  const inv = parseInvite(link);
  if (!inv) return null;
  // Author my events here as this identity — but a calendar ALREADY on this device keeps its binding
  // (re-opening a link, e.g. an invite for a role, must not switch identity: that would cost the role).
  const existing = await store.getReg(inv.calendarId);
  if (identityId && !existing) {
    await bindCalendar(inv.calendarId, identityId);
    // A Loam identity is resolved now, so a Loam problem surfaces here (nothing joined) instead of at
    // the first write. Throws a user-facing message.
    if (isLoamBinding(identityId)) await identityForCalendar(inv.calendarId);
  }
  // Register membership; name/color arrive via cal.meta events once synced (the
  // invite name seeds the registry so the UI isn't blank in the meantime).
  await store.upsertReg({
    id: inv.calendarId,
    key: inv.key,
    name: inv.name || "Shared calendar",
    color: "#89b4fa",
    isShared: true,
  });
  if (inv.inv) await addPendingClaim(inv.calendarId, inv.inv); // ADR 0022: claim the offered role once the invite syncs
  notifyChange();   // local-first: the calendar shows up NOW; history/subscribe happen in the background
  if (inv.inv) scheduleClaims();
  const f = (await store.listCalendars()).find((c) => c.id === inv.calendarId) || null;
  // Subscribe + pull history off the UI path — never block "joined" on the network.
  void joinInBackground(link, inv);
  return f;
}

// The most recent join's step trace, shown in the Sync debug panel (copied only on request).
let lastJoinTrace: string[] = [];
export function getJoinTrace(): string[] {
  return lastJoinTrace;
}

// How long peer catch-up waits for a snapshot before asking peers anyway. The wait keeps the RBSR
// delta small when Storage answers quickly; the cap stops an unreachable Storage node from stalling
// sync. The snapshot keeps going in the background and ingests whenever it lands.
const SNAPSHOT_HEAD_START_MS = 20_000;

async function joinInBackground(link: string, inv: NonNullable<ReturnType<typeof parseInvite>>): Promise<void> {
  const t0 = Date.now();
  const trace: string[] = [];
  lastJoinTrace = trace;
  const D = (s: string) => { trace.push(`+${Date.now() - t0}ms ${s}`); };
  try {
    const clean = cleanInviteLink(link);
    D(`join ${inv.calendarId.slice(0, 8)} snap=${inv.snap ? inv.snap.cid.slice(0, 12) : "none"} stor=${inv.stor ? "yes" : "no"} len=${link.length}${clean.length !== link.length ? ` (${link.length - clean.length} stray chars removed)` : ""}`);
    // The link carries a snap/stor param that parseInvite rejected: re-run its exact decode to say why
    // (a paste-mangled link decodes to control bytes and fails JSON.parse).
    const q = parseQuery(clean.split("?")[1] || "");
    if (q["stor"] !== undefined && !inv.stor) D("stor param rejected (not a signed peer record)");
    if (q["snap"] !== undefined && !inv.snap) {
      try {
        const dec = b64urlDecode(q["snap"]);
        D(`snap param rejected; decodes to ${dec.length} chars: ${JSON.stringify(dec.slice(0, 24))}`);
        D(`snap parses as ${JSON.stringify(JSON.parse(dec)).slice(0, 60)} but has no string cid`);
      } catch (e) { D(`snap param undecodable: ${String(e).slice(0, 90)}`); }
    }

    // A re-join of a calendar that's already subscribed may throw; the snapshot and catch-up below
    // don't depend on it, so carry on.
    try { await sync.joinCalendar(inv.calendarId, inv.key); D("joinCalendar ok"); }
    catch (e) { D(`joinCalendar threw: ${String(e).slice(0, 80)}`); }

    // ADR 0020: bootstrap from one Storage blob, then let RBSR fill the delta.
    let snapDone = false;
    if (inv.snap) snapshotHeadStart.set(inv.calendarId, Date.now() + SNAPSHOT_HEAD_START_MS);
    const snap = inv.snap ? runSnapshot(inv, D).finally(() => { snapDone = true; snapshotHeadStart.delete(inv.calendarId); }) : null;
    if (snap) {
      await Promise.race([snap, new Promise((r) => setTimeout(r, SNAPSHOT_HEAD_START_MS))]);
      if (!snapDone) D(`snapshot still running after ${SNAPSHOT_HEAD_START_MS / 1000}s; asking peers now`);
    }
    snapshotHeadStart.delete(inv.calendarId);
    D((await sendSyncReq(inv.calendarId, true)) ? "sync request sent" : "sync request NOT sent (send failed)");
    if (snap) await snap;
  } catch (e) {
    D(`join failed: ${String(e).slice(0, 120)}`);
    console.log("[scala] background join failed:", e);
  }
}

async function runSnapshot(inv: NonNullable<ReturnType<typeof parseInvite>>, D: (s: string) => void): Promise<void> {
  const cid: string = inv.snap.cid;
  try {
    ToastAndroid.show(`Snapshot: fetching ${cid.slice(0, 10)}…`, ToastAndroid.SHORT);
    D("storage init…");
    await storage.init(inv.stor ? { "bootstrap-node": [inv.stor] } : {}); // reach the snapshot hub's Storage
    D("storage ready; fetching snapshot…");
    const n = await bootstrapFromSnapshot(inv.calendarId, inv.snap);
    D(`snapshot: ${n} new events`);
    ToastAndroid.show(n ? `Snapshot: ${n} events loaded ✓` : "Snapshot: nothing new (already have these events)", ToastAndroid.LONG);
  } catch (e) {
    D(`snapshot failed: ${String(e).slice(0, 120)}`);
    ToastAndroid.show(`Snapshot failed, syncing from peers: ${String(e).slice(0, 80)}`, ToastAndroid.LONG);
    await storageDiag(D);
  }
}

// After a failed fetch, record what the Storage node knows (its own addresses, connections, routing
// table) and try a direct connect to each node it knows, so the trace shows whether this app can
// actually dial the snapshot hub. Never throws.
async function storageDiag(D: (s: string) => void): Promise<void> {
  const within = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);
  try {
    D(`storage bootstrap nodes: ${storage.bootstrapCount()}`);
    const d = JSON.parse(await within(storage.debug(), 10000));
    const nodes: any[] = Array.isArray(d?.table?.nodes) ? d.table.nodes : [];
    D(`storage self: ${(d?.addrs ?? []).join(", ") || "no addrs"} · connections ${(d?.connections ?? []).length} · table ${nodes.length}`);
    for (const n of nodes.slice(0, 4)) {
      const addrs: string[] = Array.isArray(n?.addresses) ? n.addresses : [];
      D(`node …${String(n?.peerId ?? "?").slice(-8)} at ${addrs.join(", ") || "no addrs"}`);
      try { await within(storage.connect(String(n.peerId), addrs), 15000); D("  direct connect ok"); }
      catch (e) { D(`  direct connect failed: ${String(e).slice(0, 110)}`); }
    }
  } catch (e) { D(`storage debug failed: ${String(e).slice(0, 100)}`); }
}

// ── shared-node preference ──────────────────────────────────────────────────
// Default ON: use Loam when it's installed (the transport falls back to Scala's own node otherwise).
// Only an explicit "0" (the user switched it off) opts out; opt-in left most users off the BLE mesh.
export async function getSharedNode(): Promise<boolean> {
  return (await SecureStore.getItemAsync("scala-shared-node")) !== "0";
}
export async function setSharedNode(on: boolean): Promise<void> {
  await SecureStore.setItemAsync("scala-shared-node", on ? "1" : "0");
}

/** Bring sync up on every shared calendar we hold a key for. */
// ── periodic, foreground-gated self-reconcile ────────────────────────────────
// The startup ladder (askAll at 0/9/24s, pull at 2/12s) only covers the mesh warm-up;
// after it the phone goes silent, so a peer's event authored LATER isn't pulled until
// something re-triggers (pre-fix, a desktop restart). Rather than lean on peers pushing,
// the phone asks for what it's missing on its own: re-send the bounded RBSR fingerprint
// (sendSyncReq — ~1KB, zero follow-up when already converged) + re-pull the fleet store.
// Gated on AppState "active" so it costs no battery/data in the background, and fires an
// immediate reconcile the moment the app is foregrounded (when the user is actually looking).
const RECONCILE_MS = 45000;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
async function reconcileAll(): Promise<void> {
  if (AppState.currentState !== "active") return; // idle in background
  for (const r of await store.getRegistry()) if (r.key) sendSyncReq(r.id).catch(() => {});
  sync.storeSync().catch(() => {});
}
function ensurePeriodicReconcile(): void {
  if (reconcileTimer) return; // idempotent — startSyncing runs again on every join
  reconcileTimer = setInterval(() => { reconcileAll().catch(() => {}); }, RECONCILE_MS);
  // Foregrounding is the highest-value moment to catch up (the user is watching) — do it at once.
  appStateSub = AppState.addEventListener("change", (s) => { if (s === "active") reconcileAll().catch(() => {}); });
}

export async function startSyncing(shared?: boolean, onStatus?: (s: string) => void): Promise<void> {
  const useShared = shared ?? (await getSharedNode());
  const regs = await store.getRegistry();
  await sync.startSync({
    deviceId: await getDeviceId(),
    calendars: regs.filter((c) => c.key).map((c) => ({ id: c.id, encryptionKey: c.key })),
    shared: useShared,
    onStatus,
  });
  // Catch-up: ask peers to re-serve each calendar's log. Retried a few times to beat a
  // still-forming mesh (a dropped first SYNC_REQ otherwise = no history). qaku pattern.
  const askAll = () => { for (const c of regs.filter((r) => r.key)) sendSyncReq(c.id).catch(() => {}); };
  askAll();
  setTimeout(askAll, 9000);
  setTimeout(askAll, 24000);
  // Reliable history: pull every joined calendar's log straight from the fleet store. SYNC_REQ
  // only re-serves from a LIVE peer (which a phone often can't reach — "joined but no history"),
  // whereas the store always has it. Retried once the mesh + store peers are reachable.
  const pull = () => { sync.storeSync().catch(() => {}); };
  setTimeout(pull, 2000);
  setTimeout(pull, 12000);
  // After the warm-up ladder, keep reconciling on our own (foreground-gated) so late peer
  // events arrive without relying on a peer to push or on an app restart.
  ensurePeriodicReconcile();
  scheduleClaims(); // resume invite claims left pending by a previous run
}

// ── tiny change bus so the UI can refresh after inbound/outbound edits ───────
type Listener = () => void;
const listeners = new Set<Listener>();
export function onChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notifyChange() {
  listeners.forEach((l) => l());
}
// Pending invite claims advance as the log changes (the invite arrives → claim; the claim folds → role).
// The claim processor itself calls notifyChange only through listeners, never this hook, so no loop.
listeners.add(() => { if (!claimsBusy && claimsPending !== false) scheduleClaims(); });
