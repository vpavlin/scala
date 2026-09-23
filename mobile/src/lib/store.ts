// Local calendar store (AsyncStorage), CRDT log model — mirrors the desktop core
// (src/calendar_store.h): a calendar is a membership entry in the registry; its
// state lives in an append-only EVENT LOG (one channel per calendar). Reads FOLD
// the log (engine.ts). The mobile app is a full peer: it holds its own logs,
// merges inbound events idempotently, and publishes its own.
//
//   scala.calendars       – registry: [{id,key,name,color,isShared,creatorId}]
//   scala.log.<calId>     – that calendar's append-only event log (Event[])
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event, mergeEvents, foldCalendar, eventFromJson, FoldedCalendar } from "./engine";
import { verifyCacheLoad, verifyCacheDump } from "./identity";

export interface Calendar {
  id: string;
  name: string;
  color: string;
  creatorId?: string;
  isShared?: boolean;
  encryptionKey?: string; // present iff shared/joined on this device
  // From the fold (all optional; a plain calendar leaves schema empty / rolesConfigured false):
  description?: string;
  schema?: any[]; // custom-field definitions [{key,label,type,options?}]
  owner?: string; // address of the creator
  roles?: Record<string, string>; // address -> "editor"|"viewer"
  rolesConfigured?: boolean;
  open?: boolean; // may participants add events? (default true)
  collab?: boolean; // Collaborative: may any non-viewer edit ANY event? (default false)
}

// An attachment REFERENCE carried in the event (ADR 0017). The bytes live in Logos Storage,
// sealed with the calendar household key; the event only carries this lightweight handle so the
// CRDT/sync stays small. `storageCid` is the content-addressed handle a fetcher discovers + pulls.
export interface Attachment {
  name: string;         // display filename
  mime: string;         // content type (best-effort)
  size: number;         // plaintext byte length (for UI; the stored blob is sealed)
  storageCid?: string;  // Logos Storage CID of the SEALED bytes (set once uploaded)
  blobId?: string;      // sha256(sealed) — stable local handle / cache key / dedup
}

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  startTime: number; // ms epoch
  endTime: number; // ms epoch
  description?: string;
  location?: string;
  url?: string;                 // meeting / event link
  allDay?: boolean;             // all-day span (time pickers hidden)
  reminderMin?: number;         // reminder lead in minutes (undefined = default 10; 0 = none)
  recur?: import("./recur").Recur; // recurrence rule (undefined = does not repeat)
  rsvps?: Record<string, string>; // ADR 0021: author address → "going"|"maybe"|"no" (folded, read-only)
  fields?: Record<string, any>; // #8: custom schema field values
  attachments?: Attachment[];   // ADR 0017: files stored in Logos Storage, referenced by CID
  creatorId?: string;
  deleted?: boolean; // never set by the fold (tombstoned events are dropped)
}

// Registry entry = membership. `key` is the per-calendar encryptionKey.
export interface CalReg {
  id: string;
  key: string;
  name: string;
  color: string;
  isShared?: boolean;
  creatorId?: string;
}

const K_CALS = "scala.calendars";
const logKey = (calId: string) => `scala.log.${calId}`;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const s = await AsyncStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}
async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ── registry (membership) ─────────────────────────────────────────────────────
async function getRegistry(): Promise<CalReg[]> {
  return readJson<CalReg[]>(K_CALS, []);
}
async function getReg(id: string): Promise<CalReg | undefined> {
  return (await getRegistry()).find((c) => c.id === id);
}
async function upsertReg(r: CalReg): Promise<void> {
  const cals = await getRegistry();
  const i = cals.findIndex((c) => c.id === r.id);
  if (i >= 0) {
    cals[i] = {
      ...cals[i],
      key: r.key || cals[i].key,
      name: r.name || cals[i].name,
      color: r.color || cals[i].color,
      isShared: r.isShared ?? cals[i].isShared,
      creatorId: r.creatorId ?? cals[i].creatorId,
    };
  } else {
    cals.push(r);
  }
  await writeJson(K_CALS, cals);
}
async function removeCalendar(id: string): Promise<void> {
  const cals = (await getRegistry()).filter((c) => c.id !== id);
  await writeJson(K_CALS, cals);
  await AsyncStorage.removeItem(logKey(id)).catch(() => {});
  invalidateFold(id);
}

// ── fold cache ────────────────────────────────────────────────────────────────
// Folding a calendar (read the whole log from disk + reduce it) is O(log size), and the UI's
// refresh reads every calendar TWICE (calendars + events). Cache the folded result per calendar and
// invalidate ONLY when that calendar's log changes — so an edit re-folds just the one calendar, not
// the whole dataset on every keystroke/sync tick. Cold start still folds once per calendar.
const foldCache = new Map<string, FoldedCalendar>();
function invalidateFold(calId: string) { foldCache.delete(calId); }

// The fold verifies every event's signature (secp256k1, slow on Hermes). identity.ts memoizes each
// result; we persist that memo across launches so a COLD start skips the crypto entirely. Hydrate
// once before the first fold; save (debounced) after folds that verified new events.
const VCACHE_KEY = "scala.vcache";
let _vcacheHydrate: Promise<void> | null = null;
function ensureVerifyCache(): Promise<void> {
  if (!_vcacheHydrate) {
    _vcacheHydrate = (async () => {
      try { verifyCacheLoad(await readJson<[string, boolean][]>(VCACHE_KEY, [])); } catch { /* first run */ }
    })();
  }
  return _vcacheHydrate;
}
let _vcacheSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleVerifyCacheSave(): void {
  if (_vcacheSaveTimer) clearTimeout(_vcacheSaveTimer);
  _vcacheSaveTimer = setTimeout(() => { writeJson(VCACHE_KEY, verifyCacheDump()).catch(() => {}); }, 3000);
}

async function foldedFor(calId: string): Promise<FoldedCalendar> {
  const cached = foldCache.get(calId);
  if (cached) return cached;
  await ensureVerifyCache();                 // memo loaded before folding → cold fold skips secp256k1
  const f = foldCalendar(calId, await getLog(calId));
  foldCache.set(calId, f);
  scheduleVerifyCacheSave();                  // persist any newly-verified events
  return f;
}

// ── per-calendar event log ────────────────────────────────────────────────────
async function getLog(calId: string): Promise<Event[]> {
  const raw = await readJson<any[]>(logKey(calId), []);
  const out: Event[] = [];
  for (const j of raw) {
    const e = eventFromJson(j);
    if (e.id) out.push(e);
  }
  return out;
}
// Merge one event into the log (dedup by id), persist. Returns true if NEW.
async function appendEvent(calId: string, ev: Event): Promise<boolean> {
  if (!ev.id) return false;
  const log = await getLog(calId);
  if (log.some((x) => x.id === ev.id)) return false; // dedup — idempotent redelivery
  const merged = mergeEvents([...log, ev]); // keep HLC-sorted + unique
  await writeJson(logKey(calId), merged.map((e) => e)); // Event already plain JSON-safe
  invalidateFold(calId); // log changed → next read re-folds THIS calendar (others stay cached)
  return true;
}

// ── folded reads (what the UI consumes) ───────────────────────────────────────
export const store = {
  getRegistry,
  getReg,
  upsertReg,
  removeCalendar,
  getLog,
  appendEvent,
  folded: foldedFor,   // cached fold (valid until the calendar's log next changes)

  async listCalendars(): Promise<Calendar[]> {
    const regs = await getRegistry();
    const out: Calendar[] = [];
    for (const r of regs) {
      const f = await foldedFor(r.id);
      out.push({
        id: r.id,
        name: f.name || r.name,
        color: f.color || r.color,
        isShared: r.isShared ?? true,
        creatorId: r.creatorId,
        encryptionKey: r.key,
        description: f.description,
        schema: f.schema,
        owner: f.owner,
        roles: f.roles,
        rolesConfigured: f.rolesConfigured,
        open: f.open,
        collab: f.collab,
      });
    }
    return out;
  },

  async eventsFor(calendarId: string): Promise<CalEvent[]> {
    const f = await foldedFor(calendarId);
    return f.events as CalEvent[];
  },

  async listEvents(): Promise<CalEvent[]> {
    const regs = await getRegistry();
    const out: CalEvent[] = [];
    for (const r of regs) {
      const f = await foldedFor(r.id);
      for (const e of f.events) out.push(e as CalEvent);
    }
    return out;
  },
};

// Deterministic calendar color from its id — MUST match the desktop
// (CalendarView.qml calColor): same palette + hash, so a calendar shows the same
// color on every device regardless of any stored color.
const CAL_PALETTE = ["#a6e3a1","#89b4fa","#f9e2af","#f38ba8","#cba6f7","#94e2d5","#fab387","#74c7ec","#eba0ac","#b4befe"];
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CAL_PALETTE[h % CAL_PALETTE.length];
}
