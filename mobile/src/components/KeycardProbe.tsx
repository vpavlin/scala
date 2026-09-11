// Identities UI: manage authoring identities (device / software / Keycard), pick the default for
// new calendars, plus the on-demand PIN modal and the "hold your card" tap overlay. All loam-keycard
// / identities imports are dynamic so a build without the native module can't crash startup.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Platform, Alert } from "react-native";
import { KeycardPinGate as UIPinGate, KeycardTapOverlay as UITapOverlay, KeycardEnrollModal, KeycardUIController, KeycardTheme } from "../lib/loam-keycard/ui";

// Bridge the reusable loam-keycard UI kit to scala's signer. Dynamic imports keep a build without
// the native module from crashing at startup. kcCtrl is module-stable so the kit's effects don't churn.
const kcCtrl: KeycardUIController = {
  setPinProvider: (fn) => { import("../lib/loam-keycard/scala-signer").then((s) => s.setPinProvider(fn)).catch(() => {}); },
  onState: (cb) => { let unsub = () => {}; import("../lib/loam-keycard/scala-signer").then((s) => { unsub = s.onKeycardState(cb); }).catch(() => {}); return () => unsub(); },
  abort: () => { import("../lib/loam-keycard/keycard").then((k) => k.abortKeycardSign()).catch(() => {}); },
  enroll: async (pin, pairing) => { const s = await import("../lib/loam-keycard/scala-signer"); return s.enrollKeycard(pin, pairing); },
};
const kcTheme: KeycardTheme = { overlay: "rgba(0,0,0,0.7)", card: "#1e1e2e", border: "#89b4fa", text: "#cdd6f4", sub: "#9399b2", accent: "#89b4fa", field: "#2a2a3c", cancelBg: "#45475a", onAccent: "#1e1e2e" };

export function IdentitiesPanel() {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<{ id: string; kind: string; label: string; address: string }[]>([]);
  const [def, setDef] = useState("");
  const [kc, setKc] = useState({ enrolled: false, session: false, status: "" });
  const [setupKc, setSetupKc] = useState(false);
  const [newLabel, setNewLabel] = useState(""); const [adding, setAdding] = useState(false);
  const [renameId, setRenameId] = useState(""); const [renameLabel, setRenameLabel] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    try {
      const I = await import("../lib/identities");
      setIds(await I.listIdentities()); setDef(await I.getDefaultIdentityId());
      const s = await import("../lib/loam-keycard/scala-signer"); await s.loadEnrollment();
      setKc({ enrolled: s.isKeycardIdentity(), session: s.hasSession(), status: s.keycardStatusLine() });
    } catch { setMsg("identities unavailable"); }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, [refresh]);

  const wrap = (fn: () => Promise<string>) => async () => {
    setBusy(true);
    try { setMsg(await fn()); }
    catch (e: any) { const m = String(e?.message || e); setMsg(m.includes("cancelled") ? "cancelled" : "error: " + m); }
    finally { setBusy(false); refresh(); }
  };
  const setDefault = (id: string) => wrap(async () => { const I = await import("../lib/identities"); await I.setDefaultIdentityId(id); return "default identity updated"; })();
  const addSoft = wrap(async () => { const I = await import("../lib/identities"); const m = await I.addSoftIdentity(newLabel.trim() || "Identity"); setNewLabel(""); setAdding(false); return "added " + m.label; });
  const removeSoft = (id: string) => wrap(async () => { const I = await import("../lib/identities"); await I.removeSoftIdentity(id); return "removed"; })();
  const doRename = wrap(async () => { const I = await import("../lib/identities"); await I.renameSoftIdentity(renameId, renameLabel.trim() || "Identity"); setRenameId(""); return "renamed"; });
  const lock = wrap(async () => { const s = await import("../lib/loam-keycard/scala-signer"); s.lockKeycard(); return "locked"; });
  const forgetKc = wrap(async () => { const s = await import("../lib/loam-keycard/scala-signer"); await s.unenroll(); return "Keycard removed"; });

  // How many calendars this identity currently signs on this device — removing it orphans them.
  const countSignedBy = async (addr: string): Promise<number> => {
    try {
      const { store } = await import("../lib/store");
      const I = await import("../lib/identities");
      const regs = await store.getRegistry();
      let n = 0;
      for (const c of regs) { try { if ((await I.identityForCalendar(c.id)).address === addr) n++; } catch { /* skip */ } }
      return n;
    } catch { return 0; }
  };
  // Guarded removal: confirm, and warn when the identity signs calendars (orphans them).
  const confirmRemove = (m: { id: string; label: string; address: string }) => async () => {
    const n = await countSignedBy(m.address);
    const warn = n > 0
      ? `⚠️ "${m.label}" signs ${n} calendar${n === 1 ? "" : "s"} on this device. Removing it orphans them — you won't be able to author there until you rebind another identity (a calendar's ⚙ → "Signs as").`
      : "This soft identity's key is deleted from loam and cannot be recovered.";
    Alert.alert(`Remove "${m.label}"?`, warn, [
      { text: "Cancel", style: "cancel" },
      { text: n > 0 ? "Remove anyway" : "Remove", style: "destructive", onPress: () => removeSoft(m.id) },
    ]);
  };
  const confirmForget = () => {
    const kcm = ids.find((m) => m.kind === "keycard");
    (async () => {
      const n = kcm ? await countSignedBy(kcm.address) : 0;
      const warn = n > 0
        ? `⚠️ Your Keycard signs ${n} calendar${n === 1 ? "" : "s"} on this device. Forgetting it orphans them until you rebind another identity (a calendar's ⚙ → "Signs as").`
        : "Forgets this Keycard on this device. The card itself is unchanged; re-enrol to use it again.";
      Alert.alert("Forget Keycard?", warn, [
        { text: "Cancel", style: "cancel" },
        { text: n > 0 ? "Forget anyway" : "Forget", style: "destructive", onPress: forgetKc },
      ]);
    })();
  };

  const defLabel = ids.find((m) => m.id === def)?.label || "—";
  return (
    <View style={st.box}>
      <Pressable style={st.hdr} onPress={() => setOpen((o) => !o)} hitSlop={6}>
        <Text style={st.h}>👤 Identities</Text>
        <Text style={st.hdrSum}>{open ? "▾" : `${ids.length} · default ${defLabel}  ▸`}</Text>
      </Pressable>
      {!open ? null : (<>
      {ids.map((m) => (
        <View key={m.id} style={st.idRow}>
          {renameId === m.id ? (<>
            <TextInput style={[st.in, { flex: 1, marginBottom: 0 }]} value={renameLabel} onChangeText={setRenameLabel} autoFocus placeholderTextColor="#6c7086" />
            <Pressable onPress={doRename} disabled={busy} hitSlop={8}><Text style={st.save}>save</Text></Pressable>
            <Pressable onPress={() => setRenameId("")} hitSlop={8}><Text style={st.forget}>✕</Text></Pressable>
          </>) : (<>
            <Pressable style={{ flex: 1 }} onPress={() => setDefault(m.id)} disabled={busy}>
              <Text style={st.idLabel}>{m.id === def ? "★ " : "  "}{m.label} <Text style={st.badge}>{m.kind === "keycard" ? "🔑 keycard" : m.kind}</Text></Text>
              <Text style={st.addr}>{m.address.slice(0, 14)}…{m.address.slice(-4)}</Text>
            </Pressable>
            {m.kind === "soft" ? <Pressable onPress={() => { setRenameId(m.id); setRenameLabel(m.label); }} disabled={busy} hitSlop={8}><Text style={st.editIcon}>✎</Text></Pressable> : null}
            {m.kind === "soft" ? <Pressable onPress={confirmRemove(m)} disabled={busy} hitSlop={8}><Text style={st.forget}>✕</Text></Pressable> : null}
          </>)}
        </View>
      ))}
      <Text style={st.hint}>★ = default for new calendars. Tap an identity to make it the default.</Text>

      {adding ? (
        <View style={st.row}>
          <TextInput style={[st.in, { flex: 1 }]} placeholder="new identity name" placeholderTextColor="#6c7086" value={newLabel} onChangeText={setNewLabel} />
          <Pressable style={[st.btn, st.ghost, busy && st.dim]} disabled={busy} onPress={addSoft}><Text style={st.btnT}>Add</Text></Pressable>
        </View>
      ) : <Pressable style={[st.btn, st.ghost]} onPress={() => setAdding(true)}><Text style={st.btnT}>+ software identity</Text></Pressable>}

      <View style={st.kcBox}>
        <Text style={st.kcH}>🔑 Keycard — {kc.status}</Text>
        {!kc.enrolled ? <Pressable style={st.btn} onPress={() => setSetupKc(true)}><Text style={st.btnT}>Set up Keycard</Text></Pressable> : null}
        {kc.enrolled ? (
          <View style={st.row}>
            {kc.session ? <Pressable style={[st.btn, st.ghost]} onPress={lock}><Text style={st.btnT}>Lock</Text></Pressable> : <Text style={st.hint}>edit a card-bound calendar → asks for your PIN</Text>}
            <Pressable onPress={confirmForget} hitSlop={8}><Text style={st.forget}>forget</Text></Pressable>
          </View>
        ) : null}
      </View>
      {msg ? <Text style={st.r} selectable>{msg}</Text> : null}

      {/* Enroll — the reusable loam-keycard UI kit modal (PIN prominent, pairing under Advanced). */}
      <KeycardEnrollModal
        ctrl={kcCtrl} theme={kcTheme}
        visible={!kc.enrolled && setupKc}
        onClose={() => setSetupKc(false)}
        onResult={(addr) => { setMsg("✅ Keycard set up (" + addr.slice(0, 10) + "…)"); refresh(); }}
        onError={(e: any) => setMsg("error: " + String(e?.message || e))}
      />
      </>)}
    </View>
  );
}

// The implicit-unlock PIN gate + "hold your card" overlay are now the reusable loam-keycard UI kit,
// wired to scala's signer via kcCtrl (mounted at App root).
export function KeycardPinGate() { return <UIPinGate ctrl={kcCtrl} theme={kcTheme} />; }
export function KeycardTapOverlay() { return <UITapOverlay ctrl={kcCtrl} theme={kcTheme} />; }

const st = StyleSheet.create({
  box: { margin: 8, padding: 12, backgroundColor: "#2a2a3c", borderRadius: 8 },
  hdr: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hdrSum: { color: "#9399b2", fontSize: 12 },
  h: { color: "#cdd6f4", fontWeight: "600", marginBottom: 8 },
  idRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#45475a" },
  idLabel: { color: "#cdd6f4", fontSize: 14 },
  badge: { color: "#89b4fa", fontSize: 11 },
  addr: { color: "#6c7086", fontSize: 11, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  hint: { color: "#9399b2", fontSize: 11, marginTop: 6, marginBottom: 8 },
  in: { backgroundColor: "#1e1e2e", color: "#cdd6f4", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  row2: { flexDirection: "row", gap: 12, marginTop: 18 },
  btn: { flex: 1, backgroundColor: "#89b4fa", borderRadius: 6, padding: 10, alignItems: "center" },
  ghost: { flex: 0, paddingHorizontal: 16, backgroundColor: "#45475a" },
  dim: { opacity: 0.5 },
  btnT: { color: "#1e1e2e", fontWeight: "700" },
  forget: { color: "#f38ba8", fontSize: 13, paddingHorizontal: 10 },
  editIcon: { color: "#9399b2", fontSize: 14, paddingHorizontal: 8 },
  save: { color: "#a6e3a1", fontSize: 13, fontWeight: "700", paddingHorizontal: 8 },
  kcBox: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#45475a" },
  kcH: { color: "#9399b2", fontSize: 12, marginBottom: 8 },
  r: { color: "#a6e3a1", marginTop: 10, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontSize: 12 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#1e1e2e", borderRadius: 16, padding: 30, alignItems: "center", borderWidth: 1, borderColor: "#89b4fa", minWidth: 260 },
  big: { fontSize: 48 },
  tapT: { color: "#cdd6f4", fontSize: 16, marginTop: 12, textAlign: "center" },
  cardSub: { color: "#9399b2", fontSize: 12.5, marginTop: 8, textAlign: "center", lineHeight: 17, maxWidth: 240 },
  advT: { color: "#89b4fa", fontSize: 12.5, marginTop: 12, textDecorationLine: "underline" },
  pinIn: { backgroundColor: "#2a2a3c", color: "#cdd6f4", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, marginTop: 16, width: 200, textAlign: "center", fontSize: 20, letterSpacing: 4 },
  cancel: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 6, backgroundColor: "#45475a", marginTop: 8 },
  cancelT: { color: "#cdd6f4", fontWeight: "600" },
  unlock: { paddingVertical: 10, paddingHorizontal: 28, borderRadius: 6, backgroundColor: "#89b4fa", marginTop: 8 },
});
