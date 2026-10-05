// "Appear as" — which identity signs YOUR events on a calendar you create or join (ADR 0022).
// With a Loam root: a new identity just for this calendar (default; unlinkable to your other
// calendars) or your main identity (the one family and friends know), plus the local keys below.
// Without a Loam root: the local identity chips exactly as before.
import React from "react";
import { View, Text, Pressable } from "react-native";
import { LOAM_CTX, LOAM_MAIN } from "../lib/identities";

const C = { bg: "#1e1e2e", surface: "#2a2a3c", text: "#cdd6f4", sub: "#9399b2", primary: "#89b4fa", border: "#313244", crust: "#11111b" };

const LOAM_OPTS = [
  { id: LOAM_CTX, title: "A new identity just for this calendar", desc: "Recommended. Nobody can link it to your other calendars." },
  { id: LOAM_MAIN, title: "My main identity", desc: "The one your family and friends know." },
];

export function AppearAs({ loamRoot, value, onChange, identities, compact }: {
  loamRoot: boolean;
  value: string;
  onChange: (id: string) => void;
  identities: { id: string; kind: string; label: string }[];
  compact?: boolean;
}) {
  const chip = (m: { id: string; kind: string; label: string }) => {
    const sel = value === m.id;
    return (
      <Pressable key={m.id} onPress={() => onChange(m.id)}
        style={{ paddingVertical: compact ? 4 : 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: sel ? C.primary : C.surface, borderWidth: 1, borderColor: sel ? C.primary : C.border }}>
        <Text style={{ color: sel ? C.crust : C.text, fontSize: compact ? 12 : 13 }}>{m.label}{m.kind === "keycard" ? " 🔑" : ""}</Text>
      </Pressable>
    );
  };
  if (!loamRoot) {
    return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{identities.map(chip)}</View>;
  }
  return (
    <View>
      {LOAM_OPTS.map((o) => {
        const sel = value === o.id;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)}
            style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: sel ? C.primary : C.border, backgroundColor: sel ? C.surface : "transparent", marginBottom: 6 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: sel ? C.primary : C.border, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
              {sel ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary }} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 13 }}>{o.title}</Text>
              <Text style={{ color: C.sub, fontSize: 12 }}>{o.desc}</Text>
            </View>
          </Pressable>
        );
      })}
      {identities.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 2 }}>
          <Text style={{ color: C.sub, fontSize: 12, marginRight: 2 }}>or a key on this phone:</Text>
          {identities.map(chip)}
        </View>
      )}
    </View>
  );
}
