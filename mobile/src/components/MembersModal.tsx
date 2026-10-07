// Members screen for one calendar (ADR 0022) — owner/editors only. Lists the owner, members with a
// role ("you" marked), and pending invite tickets; invites someone by a one-time ticket link (QR +
// copy), revokes a pending ticket, removes a member, or adds someone by their identity link/address.
// Every action reports its outcome (toast on success, Alert on failure) and is guarded against
// double-fire (busy ref; the button shows a spinner state while the write is in flight).
import React, { useRef, useState } from "react";
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert, ToastAndroid, KeyboardAvoidingView, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Calendar } from "../lib/store";
import { createInviteTicket, inviteLinkFor, revokeInvite, setMemberRole } from "../lib/calendar";
import { parseIdentityInput, buildIdentityLink } from "../lib/invite-link";
import { shortAddr } from "../lib/identity";

const C = {
  bg: "#1e1e2e", surface: "#2a2a3c", text: "#cdd6f4", sub: "#9399b2", faint: "#6c7086",
  primary: "#89b4fa", border: "#313244", accent: "#a6e3a1", danger: "#f38ba8", crust: "#11111b",
};

export function MembersModal({ cal, me, myPubHex, onShowQr, onWriteError, onClose }: {
  cal: Calendar | null;          // null = closed
  me: string;                    // the address that authors on THIS calendar (its bound identity)
  myPubHex: string;              // its public key ("" if unknown) — for "copy my identity link"
  onShowQr: (link: string, title: string) => void;
  onWriteError: (e: any, retry?: () => void) => void; // the app's "Couldn't save" (Keycard-aware) alert
  onClose: () => void;
}) {
  const busy = useRef(false);
  const [working, setWorking] = useState<string>("");   // label of the action in flight ("" = idle)
  const [addInput, setAddInput] = useState("");
  const [addRole, setAddRole] = useState<"editor" | "viewer">("editor");

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setWorking(label);
    try { await fn(); } finally { busy.current = false; setWorking(""); }
  };

  if (!cal) return null;
  const calName = cal.name || "calendar";
  const members: [string, string][] = [
    ...(cal.owner ? [[cal.owner, "owner"] as [string, string]] : []),
    ...Object.entries(cal.roles || {}).filter(([a]) => a !== cal.owner),
  ];
  const invites = Object.entries(cal.invites || {});
  const youTag = (a: string) => (a === me ? "  (you)" : "");

  const invite = (role: "editor" | "viewer") => run("invite-" + role, async () => {
    try {
      const { link } = await createInviteTicket(cal.id, role);
      ToastAndroid.show(`Invite created — whoever opens it first becomes ${role}`, ToastAndroid.SHORT);
      onShowQr(link, `Invite to ${calName} as ${role}`);
    } catch (e: any) { onWriteError(e, () => invite(role)); }
  });
  const showInviteLink = (ticket: string, role: string) => run("link-" + ticket, async () => {
    const link = await inviteLinkFor(cal.id, ticket);
    if (!link) { Alert.alert("Link not on this phone", "This invite was made on another device, so its link isn't here. Revoke it and make a new one if it was lost."); return; }
    onShowQr(link, `Invite to ${calName} as ${role}`);
  });
  const revoke = (ticket: string) => Alert.alert(
    "Revoke invite",
    `Revoke the unused invite ${shortAddr(ticket)}? Its link will stop working. If someone already used it, this does nothing — remove them instead.`,
    [{ text: "Cancel", style: "cancel" },
     { text: "Revoke", style: "destructive", onPress: () => run("revoke-" + ticket, async () => {
       try { await revokeInvite(cal.id, ticket); ToastAndroid.show("Invite revoked", ToastAndroid.SHORT); }
       catch (e: any) { onWriteError(e); }
     }) }],
  );
  const remove = (addr: string) => Alert.alert(
    "Remove member",
    `Remove ${shortAddr(addr)} from "${calName}"? They lose their role here (they keep any local copy).`,
    [{ text: "Cancel", style: "cancel" },
     { text: "Remove", style: "destructive", onPress: () => run("remove-" + addr, async () => {
       try { await setMemberRole(cal.id, addr, "remove"); ToastAndroid.show(`Removed ${shortAddr(addr)}`, ToastAndroid.SHORT); }
       catch (e: any) { onWriteError(e); }
     }) }],
  );
  const addByIdentity = () => run("add", async () => {
    const r = parseIdentityInput(addInput);
    if ("error" in r) { Alert.alert("Can't add that", r.error); return; }
    if (r.address === cal.owner) { Alert.alert("Already the owner", "That identity owns this calendar."); return; }
    if ((cal.roles || {})[r.address] === addRole) { Alert.alert("Nothing to change", `${shortAddr(r.address)} is already ${addRole}.`); return; }
    try {
      await setMemberRole(cal.id, r.address, addRole);
      setAddInput("");
      ToastAndroid.show(`${shortAddr(r.address)} is now ${addRole}`, ToastAndroid.SHORT);
    } catch (e: any) { onWriteError(e); }
  });
  const copyMine = async () => {
    const v = myPubHex ? buildIdentityLink(myPubHex) : me;
    await Clipboard.setStringAsync(v);
    ToastAndroid.show(myPubHex ? "Your identity link for this calendar is copied" : "Your address for this calendar is copied", ToastAndroid.SHORT);
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={s.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.h}>Members</Text>
            <Text style={s.sub} numberOfLines={1}>{calName}</Text>

            <View style={[s.row, { marginTop: 10 }]}>
              <Text style={[s.sub, { flex: 1 }]} numberOfLines={1}>You appear here as <Text style={s.mono}>{shortAddr(me)}</Text></Text>
              <Pressable onPress={copyMine} hitSlop={8}><Text style={s.link}>Copy my identity</Text></Pressable>
            </View>

            <Text style={s.label}>People</Text>
            {members.length === 0 && <Text style={s.sub}>Nobody yet — the calendar is still syncing.</Text>}
            {members.map(([addr, role]) => (
              <View key={addr} style={s.item}>
                <Text style={[s.mono, { flex: 1 }]} numberOfLines={1}>{shortAddr(addr)}<Text style={{ color: C.accent }}>{youTag(addr)}</Text></Text>
                <Text style={s.badge}>{role}</Text>
                {role !== "owner" && (
                  <Pressable onPress={() => remove(addr)} hitSlop={8} disabled={!!working}>
                    <Text style={{ color: working === "remove-" + addr ? C.faint : C.danger, fontSize: 13 }}>Remove</Text>
                  </Pressable>
                )}
              </View>
            ))}

            <Text style={s.label}>Pending invites</Text>
            {invites.length === 0 && <Text style={s.sub}>None. An invite link works once: whoever opens it first gets the role.</Text>}
            {invites.map(([ticket, role]) => (
              <View key={ticket} style={s.item}>
                <Text style={[s.mono, { flex: 1 }]} numberOfLines={1}>ticket {shortAddr(ticket)}</Text>
                <Text style={s.badge}>{role}</Text>
                <Pressable onPress={() => showInviteLink(ticket, role)} hitSlop={8} disabled={!!working}><Text style={s.link}>Link</Text></Pressable>
                <Pressable onPress={() => revoke(ticket)} hitSlop={8} disabled={!!working}>
                  <Text style={{ color: working === "revoke-" + ticket ? C.faint : C.danger, fontSize: 13 }}>Revoke</Text>
                </Pressable>
              </View>
            ))}

            <View style={[s.row, { marginTop: 12 }]}>
              {(["editor", "viewer"] as const).map((r) => (
                <Pressable key={r} style={[s.btn, r === "editor" ? s.btnPrimary : s.btnSecondary, { flex: 1 }]} onPress={() => invite(r)} disabled={!!working}>
                  <Text style={[s.btnT, { color: r === "editor" ? C.crust : C.text }]}>{working === "invite-" + r ? "Creating…" : `Invite as ${r}`}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Add by identity</Text>
            <TextInput style={s.input} value={addInput} onChangeText={setAddInput} placeholder="loam://id?pub=… or 0x…" placeholderTextColor={C.sub} autoCapitalize="none" autoCorrect={false} />
            <View style={[s.row, { marginTop: 8 }]}>
              {(["editor", "viewer"] as const).map((r) => (
                <Pressable key={r} onPress={() => setAddRole(r)} style={[s.chip, addRole === r && s.chipOn]}>
                  <Text style={[s.chipT, addRole === r && { color: C.crust }]}>{r}</Text>
                </Pressable>
              ))}
              <Pressable style={[s.btn, s.btnSecondary, { flex: 1 }]} onPress={addByIdentity} disabled={!!working || !addInput.trim()}>
                <Text style={[s.btnT, { color: addInput.trim() ? C.text : C.faint }]}>{working === "add" ? "Adding…" : "Add"}</Text>
              </Pressable>
            </View>
            <Text style={[s.sub, { marginTop: 4 }]}>Paste the identity link someone shared with you. The address is computed from their key, so a damaged link is refused.</Text>

            <Pressable style={[s.btn, { marginTop: 18, backgroundColor: "transparent" }]} onPress={onClose}><Text style={[s.btnT, { color: C.sub }]}>Close</Text></Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderColor: C.border, padding: 16, maxHeight: "88%" },
  h: { color: C.text, fontSize: 18, fontWeight: "500" },
  sub: { color: C.sub, fontSize: 12 },
  label: { color: C.text, fontSize: 13, fontWeight: "500", marginTop: 16, marginBottom: 4 },
  mono: { color: C.text, fontFamily: "monospace", fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  badge: { fontSize: 10, color: C.sub, borderColor: C.border, borderWidth: 1, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1, overflow: "hidden", textTransform: "uppercase" },
  link: { color: C.primary, fontSize: 13 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  btn: { borderRadius: 9, paddingVertical: 11, alignItems: "center" },
  btnPrimary: { backgroundColor: C.primary },
  btnSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border },
  btnT: { fontSize: 14, fontWeight: "500" },
  chip: { borderRadius: 9, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipT: { color: C.sub, fontSize: 12 },
});
