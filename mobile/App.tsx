// Scala mobile — shared calendar peer over Logos Delivery (SDS channels).
// Month grid + day detail + event editor; calendars live in a left drawer.
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View, Text, TextInput, Pressable, Switch, ScrollView, StyleSheet, Alert, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, ToastAndroid, Animated,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView, GestureDetector, Gesture } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { store, Calendar, CalEvent, colorForId } from "./src/lib/store";
import {
  onChange, startSyncing, joinFromInvite, createEvent, updateEvent, deleteEvent,
  createCalendar, deleteCalendar, buildInvite, getSharedNode, setSharedNode,
  updateCalendarMeta, getAlias, setAlias, getEventHistory, getDeviceId, setMemberRole,
  setCalendarIdentity, calendarIdentityId,
} from "./src/lib/calendar";
import { FieldDef } from "./src/components/EventModal";

const FIELD_TYPES = ["text", "longtext", "number", "date", "datetime", "bool", "url", "enum", "color"];
import { deliveryAvailable, getDebug, refreshDebug } from "./src/lib/scala-sync";
import { SharedNodeStatus } from "./src/lib/loam-transport-pkg/src/SharedNodeStatus";
import { ensureNotifyPermission, scheduleReminders } from "./src/lib/notify";
import { MonthGrid, CellRect } from "./src/components/MonthGrid";
import { expandEvents } from "./src/lib/recur";
import { EventModal, EventDraft } from "./src/components/EventModal";
import { Drawer } from "./src/components/Drawer";
import { IdentitiesPanel, KeycardTapOverlay, KeycardPinGate } from "./src/components/KeycardProbe";
import { listIdentities, getDefaultIdentityId, identityForCalendar } from "./src/lib/identities";
import * as codexStorage from "./src/lib/logos-storage";
import { buildIcs, parseIcs, icsToBase64 } from "./src/lib/ics";
import { open as openSealed } from "./src/lib/crypto";
import { toByteArray, fromByteArray } from "base64-js";
import type { Attachment } from "./src/lib/store";
import * as sstat from "./src/lib/syncstatus";

// Per-calendar sync freshness chip (offline / syncing N / up-to-date), fed by syncstatus.ts.
// ── access tier (ADR 0019): one 3-way choice, not two independent toggles ─────
// open + collab form a LADDER (Closed→Open→Collaborative), not independent axes; the fourth combo
// (collab && !open) is off-ladder and confusing ("only editors add, but everyone edits existing").
// A single selector only ever writes a valid {open,collab} pair. Mirrors desktop scala_ui ≥0.8.11.
type AccessTier = "closed" | "open" | "collaborative";
const ACCESS_TIERS: { tier: AccessTier; title: string; desc: string }[] = [
  { tier: "closed", title: "Closed", desc: "Only editors add events; everyone edits only their own." },
  { tier: "open", title: "Open", desc: "Anyone you invite can add events; everyone edits only their own." },
  { tier: "collaborative", title: "Collaborative", desc: "Anyone you invite can add — and edit or delete ANY event." },
];
function tierOf(cal?: { open?: boolean; collab?: boolean }): AccessTier {
  if (cal && (cal as any).collab) return "collaborative";
  if (!cal || cal.open !== false) return "open";
  return "closed";
}
function tierMeta(tier: AccessTier): { open: boolean; collab: boolean } {
  if (tier === "collaborative") return { open: true, collab: true };
  if (tier === "open") return { open: true, collab: false };
  return { open: false, collab: false };
}
function AccessTierSelector({ value, onChange, C, s }: { value: AccessTier; onChange: (t: AccessTier) => void; C: any; s: any }) {
  return (
    <View>
      {ACCESS_TIERS.map((t) => {
        const sel = value === t.tier;
        return (
          <Pressable key={t.tier} onPress={() => onChange(t.tier)}
            style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: sel ? C.primary : C.border, backgroundColor: sel ? C.surface : "transparent", marginBottom: 6 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: sel ? C.primary : C.border, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
              {sel ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary }} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text }}>{t.title}</Text>
              <Text style={s.sub}>{t.desc}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// Render an event's custom-field values as small badges (status/type/tags → Frequencies).
// Skips empty + long (text) values; caps at 4. Renders nothing for events with no fields.
function EventBadges({ ev }: { ev: any }) {
  const f = (ev as any).fields;
  if (!f) return null;
  const vals = Object.values(f).filter((v) => v !== "" && v != null && v !== false).map(String).filter((v) => v.length > 0 && v.length <= 24);
  if (!vals.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {vals.slice(0, 4).map((v, i) => (
        <View key={i} style={{ backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
          <Text style={{ color: C.text, fontSize: 10 }} numberOfLines={1}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function SyncChip({ calId }: { calId: string }) {
  const [, bump] = useState(0);
  useEffect(() => sstat.onSyncChange(() => bump((n) => n + 1)), []);
  const st = sstat.getCalSync(calId);
  const [bg, fg, label] = !st.online
    ? ["#3a2f1a", "#f9e2af", "offline"]
    : st.syncing
      ? ["#1e2f4a", "#89b4fa", st.behind > 0 ? `syncing ${st.behind}` : "syncing…"]
      : ["#1e3a2a", "#a6e3a1", "up to date"];
  return <Text style={{ fontSize: 10, fontWeight: "700", color: fg, backgroundColor: bg, borderColor: fg, borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, overflow: "hidden", textTransform: "uppercase" }}>{label}</Text>;
}
import { QRModal } from "./src/components/QRModal";
import { ScanModal } from "./src/components/ScanModal";
import * as Clipboard from "expo-clipboard";
import { updateWidgetAgenda } from "./src/lib/widget";

const C = {
  bg: "#1e1e2e", surface: "#2a2a3c", text: "#cdd6f4", sub: "#9399b2",
  primary: "#89b4fa", border: "#313244", accent: "#a6e3a1", danger: "#f38ba8", today: "#f9e2af",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function atHour(d: Date, h: number) { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; }
function msg(e: unknown) { return e instanceof Error ? e.message : String(e); }

export default function App() {
  const [cals, setCals] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  // Per-device: calendars hidden from the combined views (local convenience, never synced).
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set());
  const HIDDEN_KEY = "scala.hiddenCals";
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(HIDDEN_KEY);
        if (raw) setHiddenCals(new Set(JSON.parse(raw)));
      } catch { /* storage unavailable — show all */ }
    })();
  }, []);
  const toggleCalVisible = useCallback((id: string) => {
    setHiddenCals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);
  // Events on visible calendars only — feeds every combined view (month/week/day/agenda).
  const visibleEvents = useMemo(() => events.filter((e) => !hiddenCals.has(e.calendarId)), [events, hiddenCals]);
  const [viewMode, setViewMode] = useState<"month" | "week" | "day" | "agenda">("month"); // month grid / week strip / day timeline / upcoming agenda
  const [query, setQuery] = useState(""); // agenda search
  const [status, setStatus] = useState("starting");
  const [shared, setShared] = useState(false);

  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState(new Date());
  const [drawer, setDrawer] = useState(false);

  const [modal, setModal] = useState<{ open: boolean; draft: EventDraft; editing?: CalEvent; calId: string }>({
    open: false, draft: { title: "", startTime: Date.now(), endTime: Date.now() + 3600_000 }, calId: "",
  });

  const [newCalName, setNewCalName] = useState("");
  const [newCalDesc, setNewCalDesc] = useState("");
  const [newCalIdentity, setNewCalIdentity] = useState("");   // which identity authors the new calendar
  const [identities, setIdentities] = useState<{ id: string; kind: string; label: string; address: string }[]>([]);
  const [newCalOpen, setNewCalOpen] = useState(false);        // full "new calendar" form modal
  const [newCalSchema, setNewCalSchema] = useState<FieldDef[]>([]); // custom fields, set at create
  const [newCalTier, setNewCalTier] = useState<AccessTier>("closed"); // access tier (ADR 0019) — default Closed
  const [joinIdentity, setJoinIdentity] = useState("");       // identity to author my events on a joined calendar
  // DEV: editable Codex fetch target. Default = the always-on scala VPS hub (public Storage provider
  // 128.140.55.128:8199, systemd scala-hub.service) so attachments resolve out-of-the-box; still
  // editable in the debug modal for a LAN/mesh/other bootstrap without a rebuild.
  const [codexAddr, setCodexAddr] = useState("/ip4/128.140.55.128/tcp/8199/p2p/16Uiu2HAm9MihmCFk6rY2YdkNa78LU5xrdj4wBn5jUUea5ABqCVa8");
  const [codexCid, setCodexCid] = useState("zDvZRwzm27RpKjiufRiwVrR8rgHm9ekioBPhcF6CPTRi1TKsZaKc");
  // Bootstrap off our OWN Loam Storage network (the VPS hub's private DHT root) instead of the public
  // logos.test net (kad-incompatible with our build). The hub advertises its public IP so any phone reaches it.
  const [codexBoot, setCodexBoot] = useState("spr:CiUIAhIhAs8AX5JLuRffkJiqakPZmpE_WeRw_xFzpYfWF13jGgupEgIDARo7CicAJQgCEiECzwBfkku5F9-QmKpqQ9makT9Z5HD_EXOlh9YXXeMaC6kQiOWy1QYaCgoIBICMN4AGIAcqRzBFAiEApW6gyJWos3KuqcV6DfAYwnwddjGni2ryZqjI7ud6MtMCICqFNyyEC3YgjiYHN0Wr3XZRn0ESD8v00Sv6cWynXTvK");
  const [codexDbg, setCodexDbg] = useState(false);       // Codex debug modal open
  const [codexLog, setCodexLog] = useState<string[]>([]); // live step-by-step log
  const [codexBusy, setCodexBusy] = useState(false);
  const codexScrollRef = useRef<ScrollView>(null);

  // Run the cross-node fetch as discrete steps, appending a live log line per step (with timing and
  // the real error incl. RN reject code) so progress is visible interactively and shareable via Copy.
  const runCodexTest = useCallback(async () => {
    if (codexBusy) return;
    const ts = () => new Date().toISOString().slice(11, 23);
    const push = (line: string) => setCodexLog((L) => [...L, `${ts()}  ${line}`]);
    const yield_ = () => new Promise((r) => setTimeout(r, 0)); // let the UI paint between steps
    const step = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
      push(`▶ ${label}…`); await yield_();
      const t0 = Date.now();
      try { const r = await fn(); push(`  ✓ ${label} (${Date.now() - t0}ms)`); await yield_(); return r; }
      catch (e: any) { push(`  ✗ ${label} (${Date.now() - t0}ms): [${e?.code ?? "?"}] ${e?.message ?? e}`); await yield_(); throw e; }
    };
    setCodexBusy(true); setCodexLog([]); await yield_();
    const addr = codexAddr.trim(), CID = codexCid.trim(), boot = codexBoot.trim();
    const PEER = (addr.split("/p2p/")[1] || "").trim();
    try {
      if (!codexStorage.available()) { push("✗ native module not in this build (x86_64 emulator?)"); return; }
      if (!CID) { push("✗ enter a CID"); return; }
      push(`net  ${boot ? "OUR bootstrap (" + boot.slice(0, 20) + "…)" : "logos.test (public)"}`);
      push(`cid  ${CID}`); await yield_();
      // Bootstrap off our own node → its DHT knows the provider; discovery then finds + fetches.
      await step("init node", () => codexStorage.init(boot ? { "bootstrap-node": [boot] } : {}));
      push(`  version=${await codexStorage.version()}`);
      push(`  spr=${(await codexStorage.spr()).slice(0, 44)}…`); await yield_();
      // Optional: also dial the holder directly if a /p2p/ multiaddr was given (belt-and-suspenders).
      if (PEER) await step("connect peer", () => codexStorage.connect(PEER, [addr]));
      const dbg = await step("debug (peers)", () => codexStorage.debug());
      try { const j = JSON.parse(dbg); push(`  connected peers: ${(j.connections || []).length}`); } catch { /* raw */ }
      try { push(`  exists=${await codexStorage.exists(CID)}`); } catch (e: any) { push(`  exists ✗ [${e?.code ?? "?"}] ${e?.message ?? e}`); }
      await yield_();
      const dir = await codexStorage.filesDir();
      // downloadToFile does download_init then download_stream internally; its reject code names which stage failed.
      const content = await step("download (init+stream)", () => codexStorage.downloadToFile(CID, `${dir}/fetched.txt`, { local: false }));
      push(content ? `✅ CONTENT: ${content}` : "✅ downloaded — file on disk (empty/large, not shown inline)");
    } catch { push("— stopped —"); }
    finally { setCodexBusy(false); await yield_(); }
  }, [codexBusy, codexAddr, codexCid]);
  const [calSetIdentity, setCalSetIdentity] = useState("");   // the open calendar-settings sheet's bound identity
  const [currentCalId, setCurrentCalId] = useState<string>("");     // #5: last-tapped calendar (preselected for new events)
  const [aliasMap, setAliasMap] = useState<Record<string, string>>({}); // #7: device-local name overrides
  const [calSet, setCalSet] = useState<{ cal: Calendar; name: string; desc: string; alias: string; schema: FieldDef[] } | null>(null); // #7 settings sheet
  const [nf, setNf] = useState<{ key: string; label: string; type: string; options: string }>({ key: "", label: "", type: "text", options: "" }); // #8 new custom field (options: comma-separated, for enum)
  const [nm, setNm] = useState<{ id: string; role: "editor" | "viewer" }>({ id: "", role: "editor" }); // #3 new member
  const [invite, setInvite] = useState("");
  const [lastInvite, setLastInvite] = useState("");
  const [qr, setQr] = useState<{ value: string; title: string } | null>(null);
  const [dbg, setDbg] = useState<any>(null); // non-null → Debug panel open
  useEffect(() => {
    if (!dbg) return;
    let alive = true;
    const tick = async () => { await refreshDebug().catch(() => {}); if (alive) setDbg({ ...getDebug(), t: Date.now() }); };
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [!!dbg]);
  const [scanning, setScanning] = useState(false);

  const refresh = useCallback(async () => {
    const cs = await store.listCalendars();
    setCals(cs);
    const evs = (await store.listEvents()).filter((e) => !e.deleted);
    setEvents(evs);
    scheduleReminders(evs); // #1: keep local event reminders in step with the data
    const am: Record<string, string> = {};
    for (const c of cs) { const a = await getAlias(c.id); if (a) am[c.id] = a; }
    setAliasMap(am);
  }, []);

  useEffect(() => {
    refresh();
    ensureNotifyPermission(); // #1: ask once so reminders can be scheduled
    // Debounce store changes: a sync/catch-up burst fires onChange many times in a row; running the
    // full refresh (listEvents + scheduleReminders) on each one saturates the JS thread and makes the
    // UI (e.g. tapping a day) lag. Coalesce bursts into one refresh.
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const off = onChange(() => { if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 200); });
    (async () => {
      setShared(await getSharedNode());
      if (!deliveryAvailable()) { setStatus("no delivery node in this build"); return; }
      try { await startSyncing(undefined, setStatus); } catch (e) { setStatus("sync error: " + msg(e)); }
    })();
    return () => { if (refreshTimer) clearTimeout(refreshTimer); if (off) off(); };
  }, [refresh]);

  const writable = useMemo(() => cals.filter((c) => c.encryptionKey), [cals]);
  // Real stable per-install id (SecureStore), loaded async — NOT the "scala-default"
  // placeholder that myDeviceId() returns before the clock initializes.
  const [me, setMe] = useState("");
  useEffect(() => { getDeviceId().then(setMe).catch(() => {}); }, []);
  // Feed the per-calendar sync chip from the REAL signal — backend up AND ≥1 fleet peer — not the
  // status string (a node process being up ≠ connected; 0 peers = writes stay on this device). The
  // loud "not connected / restart Loam" shout is the SDK's SharedNodeBanner (peer-drop aware).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { await refreshDebug(); } catch { /* */ }
      if (!alive) return;
      const d = getDebug();
      sstat.setOnline(d.backend === "up" && typeof d.peers === "number" && d.peers > 0);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const l = await listIdentities(); if (alive) setIdentities(l); } catch { /* */ } };
    load(); const t = setInterval(load, 3000);
    getDefaultIdentityId().then((d) => { if (alive) { setNewCalIdentity((cur) => cur || d); setJoinIdentity((cur) => cur || d); } }).catch(() => {});
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => {   // load the open settings-sheet's calendar→identity binding
    if (!calSet) return;
    let alive = true;
    (async () => { try { const b = await calendarIdentityId(calSet.cal.id); const d = await getDefaultIdentityId(); if (alive) setCalSetIdentity(b || d); } catch { /* */ } })();
    return () => { alive = false; };
  }, [calSet?.cal.id]);
  const displayName = useCallback((c: Calendar) => aliasMap[c.id] || c.name, [aliasMap]);
  const roleOf = useCallback((c: Calendar): string => {
    if (!c.rolesConfigured) return "open";
    if (c.owner && c.owner === me) return "owner";
    return c.roles?.[me] || "viewer";
  }, [me]);
  // Two-rule permissions (mirror the fold): owner/editors do anything; viewers read-only;
  // everyone else may ADD iff Open, and edit/delete only events they authored.
  // Permission checks must use the address that will ACTUALLY author events on this calendar — its
  // BOUND identity (per-calendar), not the single global default. A Keycard-owned calendar bound to
  // the Keycard identity is writable even when the global default is the device key. meFor maps
  // calId → that authoring address; falls back to `me` until resolved.
  const [meFor, setMeFor] = useState<Record<string, string>>({});
  const [kcFor, setKcFor] = useState<Record<string, boolean>>({}); // calId → signed by a Keycard (edits need a card tap)
  useEffect(() => {
    let alive = true;
    (async () => {
      const metas = await Promise.all(cals.map(async (c) => [c.id, await identityForCalendar(c.id)] as const));
      if (!alive) return;
      setMeFor(Object.fromEntries(metas.map(([id, m]) => [id, m.address])));
      setKcFor(Object.fromEntries(metas.map(([id, m]) => [id, m.kind === "keycard"])));
    })();
    return () => { alive = false; };
  }, [cals, identities]);
  const addrFor = useCallback((c?: Calendar) => (c && meFor[c.id]) || me, [meFor, me]);
  const isEditorMe = useCallback((c?: Calendar) => { if (!c) return true; const a = addrFor(c); return c.owner === a || c.roles?.[a] === "editor" || c.roles?.[a] === "admin"; }, [addrFor]);
  const isViewerMe = useCallback((c?: Calendar) => { if (!c) return false; return c.roles?.[addrFor(c)] === "viewer"; }, [addrFor]);
  const canAddTo = useCallback((c?: Calendar) => isEditorMe(c) || (!isViewerMe(c) && c?.open !== false), [isEditorMe, isViewerMe]);
  const canEditEvent = useCallback((c?: Calendar, ev?: CalEvent) => isEditorMe(c) || (!isViewerMe(c) && ((c as any)?.collab === true || (!!ev && ev.creatorId === addrFor(c)))), [isEditorMe, isViewerMe, addrFor]);
  // Human "why can't I edit this" — the identity that WOULD author here (addrFor) vs owner/roles.
  const shortA = (a?: string) => (a ? a.replace(/^scala-/, "").slice(0, 10) + "…" : "?");
  const readonlyReason = useCallback((c?: Calendar, ev?: CalEvent): string => {
    if (!c) return "";
    const a = addrFor(c);
    if (isViewerMe(c)) return `You're a viewer on "${c.name}" — read-only.`;
    if (ev && ev.creatorId && !isEditorMe(c) && ev.creatorId !== a)
      return `Only the author can edit this event (created by ${shortA(ev.creatorId)}). You're signing as ${shortA(a)}.`;
    if (c.owner && a !== c.owner && !isEditorMe(c))
      return `This calendar is owned by ${shortA(c.owner)}, but you're signing as ${shortA(a)}. If that owner was a Keycard you re-enrolled, its address changed and this calendar is orphaned — make a new one, or bind an identity that owns/edits it.`;
    if (c.open === false && !isEditorMe(c))
      return `"${c.name}" is closed — only its owner/editors can add events. You're signing as ${shortA(a)}.`;
    return `You can't write to "${c.name}" as ${shortA(a)}.`;
  }, [addrFor, isEditorMe, isViewerMe]);
  // Calendars you can actually add events to (skip read-only / orphaned-owner) — for the + button
  // and the new-event calendar picker. Falls back to all writable if none qualify.
  const addableCals = useMemo(() => writable.filter((c) => canAddTo(c)), [writable, canAddTo]);
  const pickCals = addableCals.length ? addableCals : writable;
  const openCalSettings = (c: Calendar) => {
    setNf({ key: "", label: "", type: "text", options: "" }); setNm({ id: "", role: "editor" });
    setCalSet({ cal: c, name: c.name, desc: c.description || "", alias: aliasMap[c.id] || "", schema: c.schema ? [...c.schema] : [] });
  };
  const saveCalSettings = async () => {
    if (!calSet) return;
    if (calSet.name.trim() && calSet.name !== calSet.cal.name) await updateCalendarMeta(calSet.cal.id, { name: calSet.name });
    if ((calSet.desc || "") !== (calSet.cal.description || "")) await updateCalendarMeta(calSet.cal.id, { description: calSet.desc });
    if (JSON.stringify(calSet.schema) !== JSON.stringify(calSet.cal.schema || [])) await updateCalendarMeta(calSet.cal.id, { schema: calSet.schema });
    await setAlias(calSet.cal.id, calSet.alias);
    setCalSet(null);
  };
  // iCalendar (.ics): export this calendar to the device's Downloads; import from clipboard .ics text.
  const exportCalIcs = async () => {
    if (!calSet) return;
    try {
      const evs = events.filter((e) => e.calendarId === calSet.cal.id);
      const ics = buildIcs(calSet.cal.name || "calendar", evs);
      const fname = (calSet.cal.name || "calendar").replace(/[^\w.-]+/g, "_") + ".ics";
      const at = await codexStorage.saveToDownloads(fname, "text/calendar", icsToBase64(ics));
      Alert.alert("Exported ✅", `${evs.length} event(s)\nto ${at}`);
    } catch (e: any) { Alert.alert("Export failed", e?.message ?? String(e)); }
  };
  const importCalIcs = async () => {
    if (!calSet) return;
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || text.indexOf("BEGIN:VEVENT") < 0) {
        Alert.alert("Import .ics", "Copy an iCalendar (.ics) document to the clipboard first, then tap Import."); return;
      }
      const parsed = parseIcs(text);
      if (!parsed.length) { Alert.alert("Import .ics", "No events found in the clipboard .ics."); return; }
      const cid = calSet.cal.id;
      const runImport = async () => {
        // Pass the parsed id (derived from the VEVENT UID) so re-importing upserts by id instead of
        // duplicating (idempotent round-trip of our own export).
        for (const ev of parsed) await createEvent(cid, ev as any, (ev as any).id);
        await refresh();
        Alert.alert("Imported ✅", `${parsed.length} event(s) added to ${calSet.cal.name}.`);
      };
      // A Keycard-bound calendar signs each event with a physical tap — a silent N-tap bulk import
      // is easy to abandon half-done, so warn (and let the user bail) before starting. kcFor is keyed
      // by CALENDAR id (see its build at the kcFor effect + the kcFor[c.id] badge), so key on cid.
      if (parsed.length > 1 && kcFor[cid]) {
        Alert.alert("Keycard calendar",
          `This calendar signs with a Keycard, so importing ${parsed.length} events needs ${parsed.length} card taps (one per event). Continue?`,
          [{ text: "Cancel", style: "cancel" },
           { text: `Import (${parsed.length} taps)`, onPress: () => { runImport().catch((e) => Alert.alert("Import failed", e?.message ?? String(e))); } }]);
        return;
      }
      await runImport();
    } catch (e: any) { Alert.alert("Import failed", e?.message ?? String(e)); }
  };
  // #8: custom-field schema editing (staged in calSet, written on Save).
  // Build a FieldDef from the `nf` inputs. Enum needs comma-separated options, or it can't be picked.
  const buildFieldDef = (): FieldDef | null => {
    const key = nf.key.trim().replace(/\s+/g, "_");
    if (!key) return null;
    const def: FieldDef = { key, label: nf.label.trim() || key, type: nf.type };
    if (nf.type === "enum") {
      const options = nf.options.split(",").map((o) => o.trim()).filter(Boolean);
      if (!options.length) { Alert.alert("Enum needs options", "Add at least one comma-separated option (e.g. Draft, Confirmed, Cancelled)."); return null; }
      def.options = options;
    }
    return def;
  };
  const addField = () => {
    if (!calSet) return;
    const def = buildFieldDef();
    if (!def) return;
    if (calSet.schema.some((f) => f.key === def.key)) { Alert.alert("Field exists", `"${def.key}" is already defined.`); return; }
    setCalSet((v) => v && { ...v, schema: [...v.schema, def] });
    setNf({ key: "", label: "", type: "text", options: "" });
  };
  const removeField = (key: string) => setCalSet((v) => v && { ...v, schema: v.schema.filter((f) => f.key !== key) });
  // #3: role management — writes a member.set event immediately (owner/admin only; the fold enforces it).
  const canManage = !!calSet && (calSet.cal.owner === me || calSet.cal.roles?.[me] === "editor" || calSet.cal.roles?.[me] === "admin");
  const members: [string, string][] = calSet
    ? [...(calSet.cal.owner ? [[calSet.cal.owner, "owner"] as [string, string]] : []),
       ...Object.entries(calSet.cal.roles || {}).filter(([id]) => id !== calSet.cal.owner)]
    : [];
  const addMember = async () => {
    const id = nm.id.trim();
    if (!id || !calSet) return;
    await setMemberRole(calSet.cal.id, id, nm.role);
    setNm({ id: "", role: "editor" });
    Alert.alert("Member added", `${id.slice(0, 16)}… is now ${nm.role}. They'll appear once the change syncs.`);
    setCalSet(null);
  };
  const removeMember = async (id: string) => {
    if (!calSet) return;
    await setMemberRole(calSet.cal.id, id, "remove");
    setCalSet(null);
  };
  const copyIdentity = async () => { await Clipboard.setStringAsync(me); Alert.alert("Copied", "Your identity is on the clipboard — share it so an owner can add you."); };
  const removeCalendar = () => {
    if (!calSet) return;
    const c = calSet.cal;
    Alert.alert(
      "Delete calendar",
      `Remove "${displayName(c)}" from this device? A shared calendar can't be deleted for others — this just stops it syncing here. You can rejoin with the invite link.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          if (currentCalId === c.id) setCurrentCalId("");
          setCalSet(null);
          await deleteCalendar(c.id);
        } },
      ],
    );
  };
  const colorFor = useCallback((id: string) => colorForId(id), []);
  // An event's colour IS its calendar's colour — the calendar is the event's identity here.
  // (A Frequencies-style app maps a custom-field value to colour on its own side; scala shows
  // the field value as a badge but keeps the event the calendar's colour — no per-event override.)
  const evColor = useCallback((ev: any) => colorForId(ev && ev.calendarId), []);
  // Expand recurrence occurrences for the selected day (non-recurring events pass through once).
  const dayEvents = useMemo(() => {
    const ds = new Date(selected); ds.setHours(0, 0, 0, 0);
    const de = new Date(selected); de.setHours(23, 59, 59, 999);
    return expandEvents(visibleEvents, ds.getTime(), de.getTime()).filter((o) => sameDay(new Date(o.startTime), selected));
  }, [visibleEvents, selected]);
  // Day timeline: split the selected day into all-day events + an hour-bucketed schedule.
  // Rows run from a little before the first event to a little after the last (default 8–20),
  // so a venue day reads as a per-hour agenda without scrolling through empty small hours.
  const dayTimeline = useMemo(() => {
    const allDay = dayEvents.filter((e) => e.allDay);
    const timed = dayEvents.filter((e) => !e.allDay).sort((a, b) => a.startTime - b.startTime);
    let lo = 8, hi = 20;
    for (const e of timed) {
      const sh = new Date(e.startTime).getHours();
      const eh = new Date(e.endTime).getHours() + (new Date(e.endTime).getMinutes() > 0 ? 1 : 0);
      lo = Math.min(lo, sh); hi = Math.max(hi, Math.min(23, eh));
    }
    const hours: { hour: number; items: CalEvent[] }[] = [];
    for (let h = lo; h <= hi; h++) hours.push({ hour: h, items: timed.filter((e) => new Date(e.startTime).getHours() === h) });
    return { allDay, hours, hasTimed: timed.length > 0 };
  }, [dayEvents]);
  // Week strip (mobile week view): Mon–Sun of the selected day's week + their event dots.
  const weekDays = useMemo(() => {
    const mon = new Date(selected); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
  }, [selected]);
  const weekOccurrences = useMemo(
    () => expandEvents(visibleEvents, weekDays[0].getTime(), weekDays[6].getTime() + 864e5 - 1),
    [visibleEvents, weekDays],
  );
  // Occurrences across the visible month (± a week for grid spillover) → month-grid dots.
  const monthEvents = useMemo(() => {
    const ws = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getTime() - 7 * 864e5;
    const we = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999).getTime() + 7 * 864e5;
    return expandEvents(visibleEvents, ws, we);
  }, [visibleEvents, cursor]);
  // Agenda: occurrences grouped by day. Default = next 90 days from today; a search widens the
  // window (−30d … +365d) and filters by title/location/description across all calendars.
  const agenda = useMemo(() => {
    const now = new Date(); const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    const q = query.trim().toLowerCase();
    const start = q ? now.getTime() - 30 * 864e5 : t0.getTime();
    const end = q ? now.getTime() + 365 * 864e5 : t0.getTime() + 90 * 864e5;
    let occ = expandEvents(visibleEvents, start, end);
    if (q) occ = occ.filter((o) => `${o.title || ""} ${o.location || ""} ${o.description || ""} ${Object.values((o as any).fields || {}).join(" ")}`.toLowerCase().includes(q));
    occ.sort((a, b) => a.startTime - b.startTime);
    const groups: { key: string; date: Date; items: CalEvent[] }[] = [];
    for (const o of occ) {
      const d = new Date(o.startTime); const key = d.toDateString();
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, date: d, items: [] }; groups.push(g); }
      g.items.push(o);
    }
    return groups;
  }, [visibleEvents, query]);

  // Feed the home-screen agenda widget: the next 24h of events, grouped by day with Today/Tomorrow
  // dividers. If the next 24h is quiet, fall back to the next few upcoming so it's never empty.
  // Local-only, refreshed whenever events/calendars change — updates offline.
  const widgetItems = useMemo(() => {
    const now = Date.now();
    const soon = now + 24 * 3600e3;
    const up = expandEvents(visibleEvents, now, now + 30 * 864e5)
      .filter((o) => o.endTime >= now)
      .sort((a, b) => a.startTime - b.startTime);
    let picked = up.filter((o) => o.startTime <= soon);
    if (picked.length === 0) picked = up.slice(0, 3);
    picked = picked.slice(0, 12);
    const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const t0 = startOfDay(now);
    const dayLabel = (t: number) => {
      const diff = Math.round((startOfDay(t) - t0) / 864e5);
      if (diff === 0) return "Today";
      if (diff === 1) return "Tomorrow";
      return new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    };
    const rows: any[] = [];
    let lastDay = -1;
    for (const o of picked) {
      const ongoing = o.startTime < now && o.endTime > now;   // happening right now
      const groupT = ongoing ? now : o.startTime;             // show current events under Today
      const day = startOfDay(groupT);
      if (day !== lastDay) { rows.push({ type: "header", label: dayLabel(groupT) }); lastDay = day; }
      const cal = cals.find((c) => c.id === o.calendarId);
      const d = new Date(o.startTime);
      rows.push({
        type: "event",
        title: o.title || "(untitled)",
        timeLabel: o.allDay ? "All day" : ongoing ? "Now" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
        calendar: cal ? displayName(cal) : "",
        color: evColor(o),
      });
    }
    return rows;
  }, [visibleEvents, cals, displayName, evColor]);
  useEffect(() => { updateWidgetAgenda(widgetItems); }, [widgetItems]);

  const openNew = () => {
    if (writable.length === 0) { Alert.alert("No calendar", "Create or join a calendar first."); setDrawer(true); return; }
    // Read-only on every calendar → don't open a locked editor; say why (the fold would drop the
    // write anyway — a closed calendar only takes writes from its owner/editors).
    if (addableCals.length === 0) {
      Alert.alert("Read-only", "You can only view your calendars. Ask the owner for an editor role, or create your own calendar.");
      return;
    }
    // #5: default to the calendar you last tapped, among the ones you can actually add to.
    const calId = addableCals.find((c) => c.id === currentCalId)?.id || addableCals[0].id;
    setModal({
      open: true, calId,
      draft: { title: "", startTime: atHour(selected, 9).getTime(), endTime: atHour(selected, 10).getTime() },
    });
  };
  // Series-based v1: editing an occurrence edits the MASTER (found by id in `events`),
  // so the editor shows the real start date + recurrence rule and changes apply to the series.
  const openEdit = (occ: CalEvent) => {
    const m = events.find((e) => e.id === occ.id) || occ;
    setModal({
      open: true, editing: m, calId: m.calendarId,
      draft: {
        id: m.id, title: m.title, startTime: m.startTime, endTime: m.endTime, description: m.description,
        location: m.location, url: m.url, allDay: m.allDay, reminderMin: m.reminderMin, recur: m.recur, fields: m.fields,
        attachments: m.attachments,   // ADR 0017 — surface received attachments in the editor (was dropped → section never showed)
      },
    });
  };

  // A Keycard sign was cancelled or failed → the create was aborted (nothing saved). Cancel is
  // silent (editor stays open). A real tap failure gets a friendly message + a Retry that re-runs
  // the same action (so a flaky NFC tap doesn't lose the edit).
  const onKeycardAbort = (e: any, retry?: () => void) => {
    const raw = String((e && e.message) || e || "");
    if (raw.includes("cancelled")) return; // user cancelled — keep the editor open
    const friendly = /pin/i.test(raw) ? "Wrong PIN, or the card moved mid-tap."
      : /pairing/i.test(raw) ? "Pairing failed — check the pairing password."
      : /node-null|no link|CardIO|Error sending|transceive|timeout|Tag was lost/i.test(raw) ? "The card connection dropped — hold it steady over the NFC spot and try again."
      : raw;
    Alert.alert("Couldn't save", friendly + "\n\nNothing was saved.",
      retry ? [{ text: "Discard", style: "cancel" }, { text: "Retry", onPress: retry }] : [{ text: "OK" }]);
  };
  const saveEvent = async (d: EventDraft) => {
    const common = {
      title: d.title, startTime: d.startTime, endTime: d.endTime, description: d.description,
      location: d.location, url: d.url, allDay: d.allDay, reminderMin: d.reminderMin, recur: d.recur, fields: d.fields,
      attachments: d.attachments,   // ADR 0017 — preserve attachment refs through edits
    };
    try {
      if (modal.editing) await updateEvent({ ...modal.editing, ...common });
      else await createEvent(modal.calId, common);
      setModal((m) => ({ ...m, open: false }));
    } catch (e: any) { onKeycardAbort(e, () => saveEvent(d)); }
  };
  const removeEvent = async () => {
    if (!modal.editing) return;
    try { await deleteEvent(modal.editing); setModal((m) => ({ ...m, open: false })); } catch (e: any) { onKeycardAbort(e, () => removeEvent()); }
  };
  // Duplicate the event being edited → a new event with the same fields (same time; move/edit after).
  const dupBusy = useRef(false);
  const duplicateEvent = async () => {
    if (!modal.editing || dupBusy.current) return;   // guard against double-fire → multiple copies
    dupBusy.current = true;
    const s = modal.editing; const cid = modal.calId;
    setModal((m) => ({ ...m, open: false }));         // close NOW so it can't be tapped again
    const copy = {
      title: (s.title || "(untitled)") + " (copy)", startTime: s.startTime, endTime: s.endTime,
      allDay: s.allDay, description: s.description, location: s.location, url: s.url,
      reminderMin: s.reminderMin, recur: s.recur, fields: (s as any).fields, attachments: s.attachments,
    };
    try {
      await createEvent(cid, copy as any);
      await refresh();
      ToastAndroid.show("Event duplicated", ToastAndroid.SHORT);   // explicit success
    } catch (e: any) {
      const raw = String((e && e.message) || e || "");
      if (!raw.includes("cancelled")) Alert.alert("Couldn't duplicate", raw + "\n\nNothing was saved."); // explicit failure
    } finally { dupBusy.current = false; }
  };
  // ── drag-drop: press-hold a day-list event and drop it on a month-grid day to move it ──
  const cellRects = useRef<Record<string, CellRect>>({});
  const onCellLayout = useCallback((r: CellRect) => { cellRects.current[r.date.toISOString()] = r; }, []);
  const dragXY = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [dragEv, setDragEv] = useState<CalEvent | null>(null);
  const [dropDate, setDropDate] = useState<Date | null>(null);
  const lastDrop = useRef<string>("");   // guard: only setState when the hovered cell changes
  const hitTestCell = (x: number, y: number): Date | null => {
    for (const k in cellRects.current) {
      const r = cellRects.current[k];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.date;
    }
    return null;
  };
  // Move an event's series master to `day`, preserving time-of-day + duration (mirrors desktop).
  const moveEvent = async (occ: CalEvent, day: Date) => {
    const m = events.find((e) => e.id === occ.id) || occ;   // edit the master (recurrence-safe)
    const st = new Date(m.startTime);
    if (sameDay(st, day)) return;                            // dropped on its own day — no-op
    const dur = m.endTime - m.startTime;
    const ns = new Date(day.getFullYear(), day.getMonth(), day.getDate(), st.getHours(), st.getMinutes(), 0, 0);
    const up = { ...m, startTime: ns.getTime(), endTime: ns.getTime() + dur };
    try {
      await updateEvent(up);
      await refresh();
      ToastAndroid.show("Moved to " + ns.toLocaleDateString(undefined, { month: "short", day: "numeric" }), ToastAndroid.SHORT);
    } catch (e: any) { onKeycardAbort(e, () => moveEvent(occ, day)); }
  };
  // A per-card long-press→pan gesture. Runs on the JS thread (no reanimated installed).
  const makeDragGesture = (occ: CalEvent) =>
    Gesture.Pan()
      .activateAfterLongPress(250)
      .onStart((e) => { setDragEv(occ); lastDrop.current = ""; setDropDate(null); dragXY.setValue({ x: e.absoluteX, y: e.absoluteY }); })
      .onUpdate((e) => {
        dragXY.setValue({ x: e.absoluteX, y: e.absoluteY });
        const d = hitTestCell(e.absoluteX, e.absoluteY);
        const key = d ? d.toISOString() : "";
        if (key !== lastDrop.current) { lastDrop.current = key; setDropDate(d); }
      })
      .onEnd((e) => {
        const d = hitTestCell(e.absoluteX, e.absoluteY);
        if (d) moveEvent(occ, d);
        setDragEv(null); setDropDate(null); lastDrop.current = "";
      })
      .onFinalize(() => { setDragEv(null); setDropDate(null); lastDrop.current = ""; });
  // ADR 0017: fetch a sealed attachment from Logos Storage, decrypt it with the calendar key, save.
  const openAttachment = async (att: Attachment) => {
    const cal = cals.find((c) => c.id === modal.calId);
    if (!cal?.encryptionKey) { Alert.alert("Attachment", "This calendar has no key — can't decrypt."); return; }
    if (!att.storageCid) { Alert.alert("Attachment", "Not uploaded yet (no CID)."); return; }
    if (!codexStorage.available()) { Alert.alert("Attachment", "Storage module not in this build."); return; }
    try {
      Alert.alert("Attachment", `Fetching ${att.name || att.storageCid.slice(0, 12)}…`);
      await codexStorage.init({ "bootstrap-node": [codexBoot.trim()] });   // ride our own Loam Storage network
      const dir = await codexStorage.filesDir();
      const sealedPath = `${dir}/attach-dl/${att.storageCid}.sealed`;
      await codexStorage.downloadToFile(att.storageCid, sealedPath, { local: false });
      const sealed = toByteArray(await codexStorage.readFileB64(sealedPath));
      const plain = openSealed(cal.encryptionKey, sealed);
      if (!plain) { Alert.alert("Attachment ❌", "Decrypt failed (wrong calendar key?)."); return; }
      // Save the decrypted file into the device's public Downloads so the user actually has it.
      const savedAt = await codexStorage.saveToDownloads(att.name || att.storageCid, att.mime || "application/octet-stream", fromByteArray(plain));
      Alert.alert("Attachment ✅", `Saved ${att.name || "file"} (${plain.length} bytes)\nto ${savedAt}`);
    } catch (e: any) {
      Alert.alert("Attachment ❌", `[${e?.code ?? "?"}] ${e?.message ?? e}`);
    }
  };

  // Custom-field editing for the NEW-calendar form (mirrors settings' addField/removeField, staged
  // in newCalSchema and written into the single cal.meta on Create). Reuses the `nf` input.
  const addNewCalField = () => {
    const def = buildFieldDef();
    if (!def) return;
    if (newCalSchema.some((f) => f.key === def.key)) { Alert.alert("Field exists", `"${def.key}" is already defined.`); return; }
    setNewCalSchema((v) => [...v, def]);
    setNf({ key: "", label: "", type: "text", options: "" });
  };
  const removeNewCalField = (key: string) => setNewCalSchema((v) => v.filter((f) => f.key !== key));
  const doCreateCal = async () => {
    try {
      const cal = await createCalendar(newCalName || "My calendar", "#89b4fa", newCalDesc, newCalIdentity || undefined,
        { schema: newCalSchema, ...tierMeta(newCalTier) });
      setNewCalOpen(false);
      setNewCalName(""); setNewCalDesc(""); setNewCalSchema([]); setNewCalTier("closed");
      setNf({ key: "", label: "", type: "text", options: "" });
      setCurrentCalId(cal.id); setLastInvite(buildInvite(cal));
      // Fire-and-forget: the calendar is already saved locally. Awaiting node bring-up here stalled
      // ~10s offline and, if it threw, surfaced a false "nothing was saved" + duplicate-creating Retry.
      startSyncing(undefined, setStatus).catch(() => {});
      setQr({ value: buildInvite(cal), title: cal.name }); // show the QR right away
    } catch (e: any) { onKeycardAbort(e, () => doCreateCal()); }
  };
  const showShare = (cal: Calendar) => { setLastInvite(buildInvite(cal)); setQr({ value: buildInvite(cal), title: cal.name }); };
  const copyInvite = async (link: string) => { await Clipboard.setStringAsync(link); Alert.alert("Copied", "Invite link copied to clipboard."); };
  const onScanned = async (data: string) => {
    setScanning(false);
    const cal = await joinFromInvite(data.trim(), joinIdentity || undefined);
    if (!cal) { Alert.alert("Not a Scala invite", "That QR isn't a scala://join link."); return; }
    startSyncing(undefined, setStatus).catch(() => {});   // fire-and-forget (offline-safe): the join is already persisted
    Alert.alert("Joined", `Syncing "${cal.name}"`);
  };
  const doJoin = async () => {
    const cal = await joinFromInvite(invite.trim(), joinIdentity || undefined);
    if (!cal) { Alert.alert("Bad invite", "Expected a scala://join?cal=…&key=… link"); return; }
    setInvite(""); startSyncing(undefined, setStatus).catch(() => {});   // fire-and-forget (offline-safe): the join is already persisted
    Alert.alert("Joined", `Syncing "${cal.name}"`);
  };
  const toggleShared = async (v: boolean) => { setShared(v); await setSharedNode(v); Alert.alert(v ? "Shared node ON" : "Shared node OFF", "Restart Scala to apply."); };
  const shiftMonth = (delta: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <SafeAreaView style={s.root} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <KeycardTapOverlay />
        <KeycardPinGate />


        {/* header */}
        <View style={s.header}>
          <Pressable onPress={() => setDrawer(true)} hitSlop={12}><Text style={s.menu}>☰</Text></Pressable>
          <Pressable onPress={() => shiftMonth(-1)} hitSlop={12}><Text style={s.nav}>‹</Text></Pressable>
          <Pressable onPress={() => { const n = new Date(); setCursor(n); setSelected(n); }} style={{ flex: 1 }}>
            <Text style={s.month}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</Text>
          </Pressable>
          <Pressable onPress={() => shiftMonth(1)} hitSlop={12}><Text style={s.nav}>›</Text></Pressable>
        </View>
        <Pressable onPress={() => setDbg({ ...getDebug(), t: Date.now() })}>
          <Text style={s.status}>{status} · {cals.length} calendar(s) · <Text style={{ textDecorationLine: "underline" }}>debug</Text></Text>
        </Pressable>

        {/* SharedNodeStatus renders BOTH the peer dot AND the SDK SharedNodeBanner (Loam not
            running / not approved / connected-but-0-peers peer-drop) — don't add a second banner. */}
        <SharedNodeStatus appName="Scala" style={{ marginHorizontal: 14 }} />

        {/* view toggle + search */}
        <View style={s.viewBar}>
          <View style={s.segment}>
            {(["month", "week", "day", "agenda"] as const).map((m) => (
              <Pressable key={m} onPress={() => setViewMode(m)} style={[s.segBtn, viewMode === m && s.segBtnOn]}>
                <Text style={[s.segT, viewMode === m && s.segTOn]}>{m === "month" ? "Month" : m === "week" ? "Week" : m === "day" ? "Day" : "Agenda"}</Text>
              </Pressable>
            ))}
          </View>
          {viewMode === "agenda" && (
            <TextInput style={s.searchIn} value={query} onChangeText={setQuery} placeholder="Search events…" placeholderTextColor={C.sub} autoCapitalize="none" returnKeyType="search" />
          )}
        </View>

        {viewMode === "month" ? (<>
        <View style={s.grid}>
          <MonthGrid
            month={cursor.getMonth()} year={cursor.getFullYear()}
            events={monthEvents} selected={selected} colorFor={colorFor} onSelect={setSelected}
            onCellLayout={onCellLayout} dropDate={dropDate}
          />
        </View>

        <View style={s.dayHead}>
          <Text style={s.dayTitle}>{selected.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text>
          {dayEvents.length > 0 && <Text style={s.sub}>Hold an event, then drag it onto a day to move it.</Text>}
        </View>
        <ScrollView style={{ flex: 1 }} scrollEnabled={!dragEv}>
          {dayEvents.length === 0 && <Text style={[s.sub, { padding: 16 }]}>No events. Tap + to add one.</Text>}
          {dayEvents.map((ev) => (
            <GestureDetector key={`${ev.id}-${ev.startTime}`} gesture={makeDragGesture(ev)}>
              <Pressable style={[s.event, dragEv?.id === ev.id && { opacity: 0.4 }]} onPress={() => openEdit(ev)}>
                <View style={[s.dot, { backgroundColor: evColor(ev) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.evTitle}>{ev.title}{ev.recur ? "  ↻" : ""}</Text>
                  <Text style={s.sub}>
                    {ev.allDay
                      ? "All day"
                      : `${new Date(ev.startTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} – ${new Date(ev.endTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                    {ev.location ? ` · ${ev.location}` : ""}
                    {ev.description ? ` · ${ev.description}` : ""}
                  </Text>
                  <EventBadges ev={ev} />
                </View>
              </Pressable>
            </GestureDetector>
          ))}
          <View style={{ height: 90 }} />
        </ScrollView>
        </>) : viewMode === "week" ? (<>
        <View style={s.weekStrip}>
          {weekDays.map((d) => {
            const isToday = sameDay(d, new Date());
            const isSel = sameDay(d, selected);
            const dots = weekOccurrences.filter((o) => sameDay(new Date(o.startTime), d)).slice(0, 3).map((o) => evColor(o));
            return (
              <Pressable key={d.toISOString()} style={[s.weekCell, isSel && s.weekCellOn]} onPress={() => setSelected(d)}>
                <Text style={s.weekDow}>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(d.getDay() + 6) % 7]}</Text>
                <View style={[s.weekDateCircle, isToday && { backgroundColor: C.today }]}>
                  <Text style={[s.weekDate, isToday && { color: C.bg, fontWeight: "700" }]}>{d.getDate()}</Text>
                </View>
                <View style={s.weekDots}>{dots.map((c, i) => <View key={i} style={[s.weekDot, { backgroundColor: c }]} />)}</View>
              </Pressable>
            );
          })}
        </View>
        <View style={s.dayHead}>
          <Text style={s.dayTitle}>{selected.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text>
        </View>
        <ScrollView style={{ flex: 1 }}>
          {dayEvents.length === 0 && <Text style={[s.sub, { padding: 16 }]}>No events. Tap + to add one.</Text>}
          {dayEvents.map((ev) => (
            <Pressable key={`${ev.id}-${ev.startTime}`} style={s.event} onPress={() => openEdit(ev)}>
              <View style={[s.dot, { backgroundColor: evColor(ev) }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.evTitle}>{ev.title}{ev.recur ? "  ↻" : ""}</Text>
                <Text style={s.sub}>{ev.allDay ? "All day" : `${new Date(ev.startTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} – ${new Date(ev.endTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}{ev.location ? ` · ${ev.location}` : ""}</Text>
              </View>
            </Pressable>
          ))}
          <View style={{ height: 90 }} />
        </ScrollView>
        </>) : viewMode === "day" ? (<>
        <View style={s.dayHead}>
          <Text style={s.dayTitle}>{selected.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 90 }}>
          {dayTimeline.allDay.length > 0 && (
            <View style={s.allDayBand}>
              {dayTimeline.allDay.map((ev) => (
                <Pressable key={`${ev.id}-ad`} onPress={() => openEdit(ev)} style={[s.allDayChip, { borderLeftColor: evColor(ev) }]}>
                  <Text style={s.allDayChipT} numberOfLines={1}>{ev.title || "(untitled)"}{ev.recur ? "  ↻" : ""}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {!dayTimeline.hasTimed && dayTimeline.allDay.length === 0 && (
            <Text style={[s.sub, { padding: 16 }]}>No events. Tap + to add one.</Text>
          )}
          {dayTimeline.hasTimed && dayTimeline.hours.map(({ hour, items }) => {
            const isNowHour = sameDay(selected, new Date()) && new Date().getHours() === hour;
            return (
              <View key={hour} style={s.hourRow}>
                <Text style={[s.hourLabel, isNowHour && { color: C.today, fontWeight: "700" }]}>{String(hour).padStart(2, "0")}:00</Text>
                <View style={s.hourLine}>
                  {items.length === 0 ? <View style={s.hourEmpty} /> : items.map((ev) => (
                    <Pressable key={`${ev.id}-${ev.startTime}`} onPress={() => openEdit(ev)} style={[s.hourEvent, { borderLeftColor: evColor(ev) }]}>
                      <Text style={s.evTitle} numberOfLines={1}>{ev.title}{ev.recur ? "  ↻" : ""}</Text>
                      <Text style={s.sub} numberOfLines={1}>
                        {new Date(ev.startTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} – {new Date(ev.endTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        {ev.location ? ` · ${ev.location}` : ""}
                      </Text>
                      <EventBadges ev={ev} />
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
        </>) : (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {agenda.length === 0 && <Text style={[s.sub, { padding: 16 }]}>{query.trim() ? "No matching events." : "No upcoming events in the next 90 days."}</Text>}
          {agenda.map((g) => (
            <View key={g.key}>
              <View style={s.dayHead}><Text style={s.dayTitle}>{g.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text></View>
              {g.items.map((ev) => (
                <Pressable key={`${ev.id}-${ev.startTime}`} style={s.event} onPress={() => openEdit(ev)}>
                  <View style={[s.dot, { backgroundColor: evColor(ev) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.evTitle}>{ev.title}{ev.recur ? "  ↻" : ""}</Text>
                    <Text style={s.sub}>
                      {ev.allDay
                        ? "All day"
                        : `${new Date(ev.startTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} – ${new Date(ev.endTime).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                      {ev.location ? ` · ${ev.location}` : ""}
                    </Text>
                    <EventBadges ev={ev} />
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
          <View style={{ height: 90 }} />
        </ScrollView>
        )}

        <Pressable style={s.fab} onPress={openNew}><Text style={s.fabT}>+</Text></Pressable>

        {/* left drawer: calendars */}
        <Drawer open={drawer} onClose={() => setDrawer(false)}>
          <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "bottom"]}>
            <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <View style={s.drawerHead}>
                <Text style={s.drawerTitle}>Calendars</Text>
                <Pressable onPress={() => setDrawer(false)} hitSlop={10}><Text style={s.back}>‹ Back</Text></Pressable>
              </View>

              <View style={s.rowBetween}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={s.pLabel}>Shared node</Text>
                  <Text style={s.sub}>Device-wide Logos Delivery. Restart to apply.</Text>
                </View>
                <Switch value={shared} onValueChange={toggleShared} trackColor={{ true: C.primary, false: C.border }} thumbColor="#fff" />
              </View>

              {/* Identities live here (device-wide, not per-calendar): manage software/Keycard
                  identities, set the default, and share an address so an owner can grant a role. */}
              <Text style={s.pLabel}>Your identities</Text>
              <IdentitiesPanel />

              {/* DEV: Codex fetch-client debugger — modal with live step-by-step progress + Copy logs. */}
              <Text style={s.pLabel}>Codex storage (dev)</Text>
              <Pressable style={s.calRow} onPress={() => setCodexDbg(true)}>
                <Text style={s.calName}>🧪 Codex fetch debug</Text>
                <Text style={s.share}>Open</Text>
              </Pressable>

              <Text style={s.pLabel}>Your calendars</Text>
              {cals.length === 0 && <Text style={s.sub}>None yet.</Text>}
              {cals.map((c) => (
                <Pressable key={c.id} onPress={() => { setCurrentCalId(c.id); setDrawer(false); }} style={s.calRow}>
                  {/* Tap the dot to show/hide this calendar in the combined views (local only). */}
                  <Pressable onPress={() => toggleCalVisible(c.id)} hitSlop={10} style={{ paddingRight: 2 }}>
                    <View style={[s.dot, hiddenCals.has(c.id)
                      ? { backgroundColor: "transparent", borderWidth: 2, borderColor: C.sub }
                      : { backgroundColor: colorForId(c.id) }]} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={[s.calName, hiddenCals.has(c.id) && { color: C.sub }]}>{displayName(c)}</Text>
                      {hiddenCals.has(c.id) && <Text style={s.roleBadge}>hidden</Text>}
                      {currentCalId === c.id && <Text style={[s.roleBadge, { color: C.accent, borderColor: C.accent }]}>active</Text>}
                      {!!aliasMap[c.id] && <Text style={s.roleBadge}>alias</Text>}
                      {c.rolesConfigured && <Text style={s.roleBadge}>{roleOf(c)}</Text>}
                      {!canAddTo(c) && <Text style={[s.roleBadge, { color: "#f9e2af", borderColor: "#f9e2af" }]}>read-only</Text>}
                      {kcFor[c.id] && <Text style={[s.roleBadge, { color: C.accent, borderColor: C.accent }]}>🔑 tap to edit</Text>}
                      <SyncChip calId={c.id} />
                    </View>
                    {!!c.description && <Text style={s.sub} numberOfLines={2}>{c.description}</Text>}
                  </View>
                  <Pressable onPress={() => openCalSettings(c)} hitSlop={8}><Text style={s.share}>Edit</Text></Pressable>
                  {c.encryptionKey ? <Pressable onPress={() => showShare(c)} hitSlop={8}><Text style={s.share}>Share</Text></Pressable> : <Text style={s.sub}>local</Text>}
                </Pressable>
              ))}

              <Pressable style={[s.smBtn, { marginTop: 4, alignItems: "center" }]} onPress={() => { setNewCalName(""); setNewCalDesc(""); setNewCalSchema([]); setNewCalTier("closed"); setNf({ key: "", label: "", type: "text", options: "" }); setNewCalOpen(true); }}>
                <Text style={s.smBtnT}>+ New calendar</Text>
              </Pressable>

              <Text style={s.pLabel}>Join a calendar</Text>
              <View style={s.row}>
                <TextInput style={[s.input, { flex: 1 }]} value={invite} onChangeText={setInvite} placeholder="scala://join?…" placeholderTextColor={C.sub} autoCapitalize="none" />
                <Pressable style={s.smBtn} onPress={doJoin}><Text style={s.smBtnT}>Join</Text></Pressable>
              </View>
              {identities.length > 1 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <Text style={[s.sub, { marginRight: 2 }]}>author as</Text>
                  {identities.map((m) => (
                    <Pressable key={m.id} onPress={() => setJoinIdentity(m.id)}
                      style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, backgroundColor: joinIdentity === m.id ? "#89b4fa" : "#45475a" }}>
                      <Text style={{ color: joinIdentity === m.id ? "#1e1e2e" : "#cdd6f4", fontSize: 12, fontWeight: "600" }}>{m.label}{m.kind === "keycard" ? " 🔑" : ""}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Pressable style={[s.smBtn, { marginTop: 8, alignItems: "center" }]} onPress={() => setScanning(true)}>
                <Text style={s.smBtnT}>Scan QR code</Text>
              </Pressable>

              {!!lastInvite && (
                <View style={{ marginTop: 12 }}>
                  <Text style={s.sub}>Last invite:</Text>
                  <TextInput style={[s.input, { marginTop: 6 }]} value={lastInvite} editable={false} multiline selectTextOnFocus />
                  <View style={[s.row, { marginTop: 8 }]}>
                    <Pressable style={[s.smBtn, { flex: 1, alignItems: "center" }]} onPress={() => copyInvite(lastInvite)}>
                      <Text style={s.smBtnT}>Copy</Text>
                    </Pressable>
                    <Pressable style={[s.smBtn, { flex: 1, alignItems: "center", backgroundColor: C.accent }]} onPress={() => setQr({ value: lastInvite, title: "Invite" })}>
                      <Text style={[s.smBtnT, { color: C.bg }]}>Show QR</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </Drawer>

        {/* #7: per-calendar settings — shared name/description (cal.meta) + a LOCAL alias. */}
        <Modal visible={!!calSet} animationType="slide" transparent onRequestClose={() => setCalSet(null)}>
          <KeyboardAvoidingView style={s.sheetBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={s.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={s.drawerTitle}>Calendar settings</Text>
                <Text style={s.pLabel}>Name (shared)</Text>
                <TextInput style={s.input} value={calSet?.name || ""} onChangeText={(t) => setCalSet((v) => v && { ...v, name: t })} placeholderTextColor={C.sub} />
                <Text style={s.pLabel}>Description (shared)</Text>
                <TextInput style={[s.input, { height: 64 }]} value={calSet?.desc || ""} onChangeText={(t) => setCalSet((v) => v && { ...v, desc: t })} placeholder="What this calendar is for" placeholderTextColor={C.sub} multiline />
                <Text style={s.pLabel}>Local alias (only on this phone)</Text>
                <TextInput style={s.input} value={calSet?.alias || ""} onChangeText={(t) => setCalSet((v) => v && { ...v, alias: t })} placeholder={calSet?.cal.name} placeholderTextColor={C.sub} />

                {/* Which identity signs MY events on this calendar (rebind). Owner is fixed. */}
                <Text style={s.pLabel}>Authored by</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {identities.map((m) => (
                    <Pressable key={m.id} onPress={async () => { if (calSet) { await setCalendarIdentity(calSet.cal.id, m.id); setCalSetIdentity(m.id); } }}
                      style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: calSetIdentity === m.id ? C.primary : C.surface, borderWidth: 1, borderColor: calSetIdentity === m.id ? C.primary : C.border }}>
                      <Text style={{ color: calSetIdentity === m.id ? "#1e1e2e" : C.text, fontWeight: "600", fontSize: 13 }}>{m.label}{m.kind === "keycard" ? " 🔑" : ""}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[s.sub, { marginTop: 4 }]}>Signs your new events here. The owner is fixed — a non-owner needs a role to write.</Text>

                {/* #8: custom fields — define the calendar's schema (empty = a plain calendar). */}
                <Text style={s.pLabel}>Custom fields</Text>
                {calSet?.schema.length === 0 && <Text style={[s.sub, { marginBottom: 6 }]}>None — a plain calendar. Add fields to capture more per event.</Text>}
                {calSet?.schema.map((f) => (
                  <View key={f.key} style={s.fieldRow}>
                    <Text style={{ color: C.text, flex: 1 }}>{f.label || f.key} <Text style={{ color: C.sub, fontSize: 12 }}>· {f.type}</Text></Text>
                    <Pressable onPress={() => removeField(f.key)} hitSlop={8}><Text style={{ color: C.danger, fontSize: 18 }}>×</Text></Pressable>
                  </View>
                ))}
                <View style={s.row2}>
                  <TextInput style={[s.input, { flex: 1 }]} value={nf.key} onChangeText={(t) => setNf((v) => ({ ...v, key: t }))} placeholder="key" placeholderTextColor={C.sub} autoCapitalize="none" />
                  <TextInput style={[s.input, { flex: 1 }]} value={nf.label} onChangeText={(t) => setNf((v) => ({ ...v, label: t }))} placeholder="Label" placeholderTextColor={C.sub} />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {FIELD_TYPES.map((t) => (
                      <Pressable key={t} onPress={() => setNf((v) => ({ ...v, type: t }))} style={[s.typeChip, nf.type === t && s.typeChipOn]}>
                        <Text style={[s.typeChipT, nf.type === t && { color: C.bg }]}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                {nf.type === "enum" && (
                  <TextInput style={[s.input, { marginTop: 6 }]} value={nf.options} onChangeText={(t) => setNf((v) => ({ ...v, options: t }))} placeholder="options, comma-separated (e.g. Draft, Confirmed, Cancelled)" placeholderTextColor={C.sub} autoCapitalize="none" />
                )}
                <Pressable style={[s.smBtn, { marginTop: 8, alignItems: "center", backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }]} onPress={addField}><Text style={[s.smBtnT, { color: C.text }]}>+ Add field</Text></Pressable>

                {/* #3: sharing & roles — who can edit. Identity = an address; share yours to be added. */}
                <Text style={s.pLabel}>Sharing &amp; roles</Text>
                {/* Access — one 3-way tier (ADR 0019 ladder: Closed→Open→Collaborative) instead of
                    independent Open/Collaborative toggles, so "collaborative + closed" can't happen.
                    Picking a tier writes the valid {open,collab} pair. Owner/editor only. */}
                {canManage && (
                  <AccessTierSelector
                    value={tierOf(calSet?.cal)}
                    onChange={async (t) => { if (calSet) { const m = tierMeta(t); await updateCalendarMeta(calSet.cal.id, m); setCalSet((s2) => s2 && { ...s2, cal: { ...s2.cal, open: m.open, collab: m.collab } }); } }}
                    C={C} s={s}
                  />
                )}
                <Text style={[s.sub, { marginBottom: 6, marginTop: 8 }]}>
                  {calSet ? `Your role: ${roleOf(calSet.cal)}${roleOf(calSet.cal) === "viewer" ? " — read-only." : "."}` : ""}
                </Text>
                {members.map(([id, role]) => (
                  <View key={id} style={s.fieldRow}>
                    <Text style={{ color: C.text, flex: 1, fontFamily: "monospace", fontSize: 12 }} numberOfLines={1}>
                      {id === me ? "you" : id.replace(/^scala-/, "").slice(0, 12)} <Text style={{ color: C.sub }}>· {role}</Text>
                    </Text>
                    {canManage && role !== "owner" && <Pressable onPress={() => removeMember(id)} hitSlop={8}><Text style={{ color: C.danger, fontSize: 18 }}>×</Text></Pressable>}
                  </View>
                ))}
                {canManage && (
                  <>
                    <TextInput style={[s.input, { marginTop: 6 }]} value={nm.id} onChangeText={(t) => setNm((v) => ({ ...v, id: t }))} placeholder="Paste a member's identity" placeholderTextColor={C.sub} autoCapitalize="none" />
                    <View style={[s.row2, { marginTop: 6, alignItems: "center" }]}>
                      {(["editor", "viewer"] as const).map((r) => (
                        <Pressable key={r} onPress={() => setNm((v) => ({ ...v, role: r }))} style={[s.typeChip, nm.role === r && s.typeChipOn]}>
                          <Text style={[s.typeChipT, nm.role === r && { color: C.bg }]}>{r}</Text>
                        </Pressable>
                      ))}
                      <Pressable style={[s.smBtn, { flex: 1, alignItems: "center", backgroundColor: C.accent }]} onPress={addMember}><Text style={[s.smBtnT, { color: C.bg }]}>Add member</Text></Pressable>
                    </View>
                  </>
                )}

                <Text style={s.pLabel}>iCalendar</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable style={[s.smBtn, { flex: 1, alignItems: "center", backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }]} onPress={exportCalIcs}><Text style={[s.smBtnT, { color: C.text }]}>Export .ics</Text></Pressable>
                  <Pressable style={[s.smBtn, { flex: 1, alignItems: "center", backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }]} onPress={importCalIcs}><Text style={[s.smBtnT, { color: C.text }]}>Import .ics</Text></Pressable>
                </View>
                <Text style={[s.sub, { marginTop: 4 }]}>Export saves to Downloads. Import reads an .ics from the clipboard.</Text>

                <Pressable style={[s.smBtn, { marginTop: 18, alignItems: "center", backgroundColor: C.accent }]} onPress={saveCalSettings}><Text style={[s.smBtnT, { color: C.bg }]}>Save</Text></Pressable>
                <Pressable style={[s.smBtn, { marginTop: 8, alignItems: "center", backgroundColor: "transparent" }]} onPress={() => setCalSet(null)}><Text style={[s.smBtnT, { color: C.sub }]}>Cancel</Text></Pressable>
                <Pressable style={[s.smBtn, { marginTop: 8, alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: C.danger }]} onPress={removeCalendar}><Text style={[s.smBtnT, { color: C.danger }]}>Delete calendar</Text></Pressable>
                <View style={{ height: 20 }} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={newCalOpen} transparent animationType="slide" onRequestClose={() => setNewCalOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "90%" }}>
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
                <Text style={{ color: C.text, fontSize: 18, fontWeight: "700", marginBottom: 14 }}>New calendar</Text>
                <TextInput style={s.input} value={newCalName} onChangeText={setNewCalName} placeholder="Name" placeholderTextColor={C.sub} autoFocus />
                <TextInput style={[s.input, { marginTop: 10 }]} value={newCalDesc} onChangeText={setNewCalDesc} placeholder="Description (optional)" placeholderTextColor={C.sub} />
                <Text style={[s.pLabel, { marginTop: 14 }]}>Author as</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  {identities.map((m) => (
                    <Pressable key={m.id} onPress={() => setNewCalIdentity(m.id)}
                      style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: newCalIdentity === m.id ? C.primary : C.surface, borderWidth: 1, borderColor: newCalIdentity === m.id ? C.primary : C.border }}>
                      <Text style={{ color: newCalIdentity === m.id ? "#1e1e2e" : C.text, fontWeight: "600" }}>{m.label}{m.kind === "keycard" ? " 🔑" : ""}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[s.sub, { marginTop: 8 }]}>This identity owns the calendar and signs its events. A Keycard calendar asks for your PIN + a tap.</Text>

                {/* Custom fields — same editor as settings; staged into the single cal.meta so the
                    calendar is complete on Create (a Keycard create is one tap, not create-then-edit). */}
                <Text style={s.pLabel}>Custom fields</Text>
                {newCalSchema.length === 0 && <Text style={[s.sub, { marginBottom: 6 }]}>None — a plain calendar. Add fields to capture more per event.</Text>}
                {newCalSchema.map((f) => (
                  <View key={f.key} style={s.fieldRow}>
                    <Text style={{ color: C.text, flex: 1 }}>{f.label || f.key} <Text style={{ color: C.sub, fontSize: 12 }}>· {f.type}</Text></Text>
                    <Pressable onPress={() => removeNewCalField(f.key)} hitSlop={8}><Text style={{ color: C.danger, fontSize: 18 }}>×</Text></Pressable>
                  </View>
                ))}
                <View style={s.row2}>
                  <TextInput style={[s.input, { flex: 1 }]} value={nf.key} onChangeText={(t) => setNf((v) => ({ ...v, key: t }))} placeholder="key" placeholderTextColor={C.sub} autoCapitalize="none" />
                  <TextInput style={[s.input, { flex: 1 }]} value={nf.label} onChangeText={(t) => setNf((v) => ({ ...v, label: t }))} placeholder="Label" placeholderTextColor={C.sub} />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {FIELD_TYPES.map((t) => (
                      <Pressable key={t} onPress={() => setNf((v) => ({ ...v, type: t }))} style={[s.typeChip, nf.type === t && s.typeChipOn]}>
                        <Text style={[s.typeChipT, nf.type === t && { color: C.bg }]}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                {nf.type === "enum" && (
                  <TextInput style={[s.input, { marginTop: 6 }]} value={nf.options} onChangeText={(t) => setNf((v) => ({ ...v, options: t }))} placeholder="options, comma-separated (e.g. Draft, Confirmed, Cancelled)" placeholderTextColor={C.sub} autoCapitalize="none" />
                )}
                <Pressable style={[s.smBtn, { marginTop: 8, alignItems: "center", backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }]} onPress={addNewCalField}><Text style={[s.smBtnT, { color: C.text }]}>+ Add field</Text></Pressable>

                {/* Access — one 3-way tier (ADR 0019), chosen up front; same widget as settings. */}
                <Text style={s.pLabel}>Access</Text>
                <AccessTierSelector value={newCalTier} onChange={setNewCalTier} C={C} s={s} />

                <View style={{ flexDirection: "row", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
                  <Pressable style={[s.smBtn, { backgroundColor: C.surface }]} onPress={() => setNewCalOpen(false)}><Text style={s.smBtnT}>Cancel</Text></Pressable>
                  <Pressable style={s.smBtn} onPress={doCreateCal}><Text style={s.smBtnT}>Create</Text></Pressable>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
        <QRModal visible={!!qr} value={qr?.value || ""} title={qr?.title || "Invite"} onClose={() => setQr(null)} />
        <ScanModal visible={scanning} onScanned={onScanned} onClose={() => setScanning(false)} />

        {/* Debug panel — live connection, publish confirmation, receive stages, event log */}
        <Modal visible={!!dbg} animationType="slide" onRequestClose={() => setDbg(null)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "#0f1115" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 14 }}>
              <Text style={{ color: "#e8eaed", fontSize: 18, fontWeight: "700", flex: 1 }}>Sync debug</Text>
              <Pressable onPress={() => setDbg(null)} hitSlop={12}><Text style={{ color: "#6ea8fe", fontSize: 16 }}>Close</Text></Pressable>
            </View>
            <ScrollView style={{ flex: 1, paddingHorizontal: 14 }}>
              {dbg && (() => {
                const row = (k: string, v: any, warn = false) => (
                  <View style={{ flexDirection: "row", paddingVertical: 3 }} key={k}>
                    <Text style={{ color: "#9aa1ad", width: 130, fontFamily: "monospace", fontSize: 12 }}>{k}</Text>
                    <Text style={{ color: warn ? "#f38ba8" : "#e8eaed", flex: 1, fontFamily: "monospace", fontSize: 12 }}>{String(v)}</Text>
                  </View>
                );
                return (
                  <>
                    <Text style={{ color: "#89b4fa", marginTop: 8, marginBottom: 4, fontWeight: "700" }}>Node</Text>
                    {row("backend", `${dbg.backend} (${shared ? "shared service" : "embedded"})`)}
                    {row("mode", dbg.mode)}
                    {row("routes", dbg.routes)}
                    {row("peers / mesh", `${dbg.peers} / ${dbg.mesh}`)}
                    {row("store", dbg.store || "—")}

                    <Text style={{ color: "#89b4fa", marginTop: 12, marginBottom: 4, fontWeight: "700" }}>Publish (tx)</Text>
                    {row("attempted", dbg.tx.attempt)}
                    {row("sent OK", dbg.tx.sent)}
                    {row("failed", dbg.tx.fail, dbg.tx.fail > 0)}
                    {row("last error", dbg.tx.lastErr || "—", !!dbg.tx.lastErr)}

                    <Text style={{ color: "#89b4fa", marginTop: 12, marginBottom: 4, fontWeight: "700" }}>Receive (rx)</Text>
                    {row("raw", dbg.rx.raw)}
                    {row("opened", dbg.rx.opened)}
                    {row("open-fail", dbg.rx.openFail, dbg.rx.openFail > 0)}
                    {row("new / dup", `${dbg.rx.new} / ${dbg.rx.dup}`)}
                    {row("sample", dbg.sample || "—")}

                    <Text style={{ color: "#89b4fa", marginTop: 12, marginBottom: 4, fontWeight: "700" }}>Event log ({events.length})</Text>
                    {[...events].sort((a, b) => b.startTime - a.startTime).slice(0, 40).map((e) => (
                      <View key={e.id} style={{ paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: "#2a2e37" }}>
                        <Text style={{ color: "#e8eaed", fontSize: 12 }}>{e.title}</Text>
                        <Text style={{ color: "#9aa1ad", fontSize: 11, fontFamily: "monospace" }}>
                          {new Date(e.startTime).toLocaleString()} · by {(e.creatorId || "?").slice(0, 16)}
                        </Text>
                      </View>
                    ))}
                    <View style={{ height: 40 }} />
                  </>
                );
              })()}
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* Codex fetch debugger — live step-by-step log + editable target + Copy/Clear. */}
        <Modal visible={codexDbg} animationType="slide" onRequestClose={() => setCodexDbg(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: "#0f1115" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 14 }}>
              <Text style={{ color: "#e8eaed", fontSize: 18, fontWeight: "700", flex: 1 }}>Codex fetch debug</Text>
              <Pressable onPress={() => setCodexDbg(false)} hitSlop={12}><Text style={{ color: "#6ea8fe", fontSize: 16 }}>Close</Text></Pressable>
            </View>
            <View style={{ paddingHorizontal: 14, gap: 6 }}>
              <Text style={{ color: "#9aa1ad", fontSize: 12 }}>Bootstrap SPR (our Loam Storage node — empty = public logos.test)</Text>
              <TextInput style={[s.searchIn, { minHeight: 38 }]} value={codexBoot} onChangeText={setCodexBoot}
                placeholder="spr:… (our bootstrap node)" placeholderTextColor={C.sub} autoCapitalize="none" autoCorrect={false} multiline />
              <Text style={{ color: "#9aa1ad", fontSize: 12 }}>Peer multiaddr (optional direct dial; peerId from /p2p/)</Text>
              <TextInput style={[s.searchIn, { minHeight: 38 }]} value={codexAddr} onChangeText={setCodexAddr}
                placeholder="/ip4/<host>/tcp/8070/p2p/<peerId>" placeholderTextColor={C.sub} autoCapitalize="none" autoCorrect={false} multiline />
              <Text style={{ color: "#9aa1ad", fontSize: 12 }}>CID</Text>
              <TextInput style={s.searchIn} value={codexCid} onChangeText={setCodexCid}
                placeholder="CID to fetch" placeholderTextColor={C.sub} autoCapitalize="none" autoCorrect={false} />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4, alignItems: "center" }}>
                <Pressable style={[s.smBtn, { flex: 1, alignItems: "center", opacity: codexBusy ? 0.6 : 1 }]} disabled={codexBusy} onPress={() => void runCodexTest()}>
                  <Text style={s.smBtnT}>{codexBusy ? "Running…" : "Run fetch test"}</Text>
                </Pressable>
                <Pressable style={[s.smBtn, { alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: C.border }]}
                  onPress={async () => { await Clipboard.setStringAsync(codexLog.join("\n")); Alert.alert("Copied", "Debug log copied to clipboard."); }}>
                  <Text style={[s.smBtnT, { color: C.text }]}>Copy</Text>
                </Pressable>
                <Pressable style={[s.smBtn, { alignItems: "center", backgroundColor: "transparent", borderWidth: 1, borderColor: C.border }]} onPress={() => setCodexLog([])}>
                  <Text style={[s.smBtnT, { color: C.text }]}>Clear</Text>
                </Pressable>
              </View>
              {codexBusy && <ActivityIndicator color="#6ea8fe" style={{ marginTop: 6 }} />}
            </View>
            <ScrollView ref={codexScrollRef} onContentSizeChange={() => codexScrollRef.current?.scrollToEnd({ animated: true })}
              style={{ flex: 1, margin: 14, backgroundColor: "#0b0d12", borderRadius: 8 }} contentContainerStyle={{ padding: 10 }}>
              {codexLog.length === 0
                ? <Text style={{ color: "#6b7280", fontFamily: "monospace", fontSize: 12 }}>Tap “Run fetch test” to begin.</Text>
                : codexLog.map((l, i) => (
                  <Text key={i} selectable style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 17,
                    color: l.includes("✗") ? "#f38ba8" : (l.includes("✅") || l.includes("✓")) ? "#a6e3a1" : "#cdd6f4" }}>{l}</Text>
                ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>

        <EventModal
          visible={modal.open}
          initial={modal.draft}
          calendars={pickCals.map((c) => ({ id: c.id, name: c.name, color: colorForId(c.id) }))}
          calendarId={modal.calId}
          onPickCalendar={(id) => setModal((m) => ({ ...m, calId: id }))}
          canPickCalendar={!modal.editing}
          canEdit={modal.editing ? canEditEvent(cals.find((c) => c.id === modal.calId), modal.editing) : canAddTo(cals.find((c) => c.id === modal.calId))}
          readonlyReason={readonlyReason(cals.find((c) => c.id === modal.calId), modal.editing)}
          onSave={saveEvent}
          onDelete={modal.editing ? removeEvent : undefined}
          onDuplicate={modal.editing && canAddTo(cals.find((c) => c.id === modal.calId)) ? duplicateEvent : undefined}
          onClose={() => setModal((m) => ({ ...m, open: false }))}
          schema={cals.find((c) => c.id === modal.calId)?.schema || []}
          loadHistory={modal.editing ? () => getEventHistory(modal.calId, modal.editing!.id) : undefined}
          onOpenAttachment={openAttachment}
        />
      </SafeAreaView>
    </SafeAreaProvider>
    {/* Floating drag proxy — screen-coord positioned (sibling of SafeAreaProvider) so it tracks the finger. */}
    {dragEv && (
      <Animated.View
        pointerEvents="none"
        style={[s.dragProxy, { transform: [{ translateX: Animated.subtract(dragXY.x, 80) }, { translateY: Animated.subtract(dragXY.y, 22) }] }]}
      >
        <View style={[s.dot, { backgroundColor: evColor(dragEv) }]} />
        <Text style={[s.evTitle, { flexShrink: 1 }]} numberOfLines={1}>{dragEv.title || "(untitled)"}</Text>
      </Animated.View>
    )}
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  weekStrip: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  weekCell: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  weekCellOn: { backgroundColor: C.surface, borderColor: C.primary },
  weekDow: { color: C.sub, fontSize: 10, fontWeight: "600", marginBottom: 3 },
  weekDateCircle: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  weekDate: { color: C.text, fontSize: 13 },
  weekDots: { flexDirection: "row", gap: 2, marginTop: 3, height: 5 },
  weekDot: { width: 4, height: 4, borderRadius: 2 },
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 6 },
  menu: { color: C.text, fontSize: 22, width: 24 },
  nav: { color: C.primary, fontSize: 26, fontWeight: "700", width: 20, textAlign: "center" },
  month: { color: C.text, fontSize: 20, fontWeight: "700" },
  status: { color: C.sub, fontSize: 11, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 6 },
  grid: { paddingHorizontal: 12, paddingTop: 4 },
  viewBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 6 },
  segment: { flexDirection: "row", backgroundColor: C.surface, borderRadius: 9, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  segBtn: { paddingVertical: 6, paddingHorizontal: 16 },
  segBtnOn: { backgroundColor: C.primary },
  segT: { color: C.sub, fontSize: 13, fontWeight: "600" },
  segTOn: { color: C.bg },
  searchIn: { flex: 1, backgroundColor: C.surface, borderRadius: 9, borderWidth: 1, borderColor: C.border, color: C.text, paddingHorizontal: 12, paddingVertical: 6, fontSize: 13 },
  dayHead: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, borderTopWidth: 1, borderTopColor: C.border, marginTop: 6 },
  dayTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
  event: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.surface, borderRadius: 10, padding: 12, marginHorizontal: 12, marginTop: 8, borderWidth: 1, borderColor: C.border },
  dragProxy: { position: "absolute", top: 0, left: 0, width: 160, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.surface, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.primary, zIndex: 9999, elevation: 12, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  // Day timeline
  allDayBand: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  allDayChip: { backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%" },
  allDayChipT: { color: C.text, fontSize: 13, fontWeight: "600" },
  hourRow: { flexDirection: "row", paddingHorizontal: 12, minHeight: 44 },
  hourLabel: { color: C.sub, fontSize: 11, fontWeight: "600", width: 46, paddingTop: 8 },
  hourLine: { flex: 1, borderTopWidth: 1, borderTopColor: C.border, paddingBottom: 6 },
  hourEmpty: { height: 32 },
  hourEvent: { backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, padding: 10, marginTop: 6 },
  evTitle: { color: C.text, fontSize: 15, fontWeight: "600" },
  sub: { color: C.sub, fontSize: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  roleBadge: { fontSize: 10, fontWeight: "700", color: "#9399b2", borderColor: "#313244", borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, overflow: "hidden", textTransform: "uppercase" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#2a2a3c", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%" },
  fab: { position: "absolute", right: 20, bottom: 28, width: 60, height: 60, borderRadius: 30, backgroundColor: C.primary, alignItems: "center", justifyContent: "center", elevation: 6 },
  fabT: { color: C.bg, fontSize: 32, fontWeight: "700", marginTop: -2 },
  drawerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  drawerTitle: { color: C.text, fontSize: 20, fontWeight: "700" },
  back: { color: C.primary, fontSize: 15, fontWeight: "600" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  pLabel: { color: C.text, fontSize: 13, fontWeight: "700", marginTop: 18, marginBottom: 6 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  row2: { flexDirection: "row", gap: 8 },
  typeChip: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  typeChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipT: { color: C.sub, fontSize: 12, fontWeight: "600" },
  calRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  calName: { color: C.text, fontSize: 15, flex: 1 },
  share: { color: C.primary, fontSize: 13, fontWeight: "600" },
  input: { backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, color: C.text, paddingHorizontal: 12, paddingVertical: 10 },
  smBtn: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11 },
  smBtnT: { color: C.bg, fontWeight: "700" },
});
