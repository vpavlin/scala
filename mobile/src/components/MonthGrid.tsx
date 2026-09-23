// Month grid: 6 weeks x 7 days, event dots per day, today + selected highlight.
import React, { useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { CalEvent } from "../lib/store";

const C = {
  text: "#cdd6f4", sub: "#9399b2", primary: "#89b4fa", surface: "#2a2a3c",
  border: "#313244", today: "#f9e2af", bg: "#1e1e2e", accent: "#a6e3a1",
};

export type CellRect = { x: number; y: number; w: number; h: number; date: Date };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export const MonthGrid = React.memo(function MonthGrid({
  month, year, events, selected, colorFor, onSelect, onCellLayout, dropDate,
}: {
  month: number; year: number;
  events: CalEvent[];
  selected: Date;
  colorFor: (calendarId: string) => string;
  onSelect: (d: Date) => void;
  onCellLayout?: (rect: CellRect) => void; // report a cell's window rect (for drag-drop hit-testing)
  dropDate?: Date | null;                  // the cell currently under a drag → highlight as a drop target
}) {
  const today = new Date();
  const cellRefs = useRef<Record<string, View | null>>({});
  // First cell = Monday on/before the 1st.
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Mon=0
  const start = new Date(year, month, 1 - offset);

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));

  const dotsFor = (d: Date) =>
    events
      .filter((e) => sameDay(new Date(e.startTime), d))
      .slice(0, 4)
      .map((e) => colorFor(e.calendarId));

  return (
    <View>
      <View style={s.weekRow}>
        {WEEKDAYS.map((w) => <Text key={w} style={s.weekday}>{w}</Text>)}
      </View>
      {[0, 1, 2, 3, 4, 5].map((wk) => (
        <View key={wk} style={s.weekRow}>
          {cells.slice(wk * 7, wk * 7 + 7).map((d) => {
            const inMonth = d.getMonth() === month;
            const isToday = sameDay(d, today);
            const isSel = sameDay(d, selected);
            const isDrop = !!dropDate && sameDay(d, dropDate);
            const dots = dotsFor(d);
            const key = d.toISOString();
            return (
              <Pressable
                key={key}
                ref={(n) => { cellRefs.current[key] = n as unknown as View | null; }}
                onLayout={() => onCellLayout && cellRefs.current[key]?.measureInWindow((x, y, w, h) => onCellLayout({ x, y, w, h, date: d }))}
                style={[s.cell, isSel && s.cellSel, isDrop && s.cellDrop]}
                onPress={() => onSelect(d)}
              >
                <Text style={[s.day, !inMonth && s.dayOut, isToday && s.dayToday]}>{d.getDate()}</Text>
                <View style={s.dots}>
                  {dots.map((c, i) => <View key={i} style={[s.dot, { backgroundColor: c }]} />)}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const s = StyleSheet.create({
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", color: C.sub, fontSize: 11, fontWeight: "600", paddingVertical: 6 },
  cell: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "flex-start", paddingTop: 6, borderRadius: 10, margin: 1 },
  cellSel: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.primary },
  cellDrop: { backgroundColor: "#2a3a2c", borderWidth: 2, borderColor: C.accent },
  day: { color: C.text, fontSize: 14 },
  dayOut: { color: "#4a4a5e" },
  dayToday: { color: C.today, fontWeight: "800" },
  dots: { flexDirection: "row", gap: 2, marginTop: 3, height: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
