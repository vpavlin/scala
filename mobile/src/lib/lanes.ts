// Lanes view: days down the side, one column ("lane") per calendar or per value of an enum
// field (e.g. one lane per venue), so a promoter sees every room's nights side by side.
//
// View-only. Lanes appear in a stable order: calendars in list order; field values in schema
// order, then any other values seen on events, then "—" for events without the field. The same
// algorithm runs in the desktop QML view (CalendarView.qml `buildLanes`).
import type { Occurrence } from "./recur";

export type LaneBy = { kind: "calendar" } | { kind: "field"; key: string };
export interface Lane { id: string; label: string }
export interface LaneDay { date: number; cells: Occurrence[][] } // cells[i] belongs to lanes[i]
export interface LaneGrid { lanes: Lane[]; days: LaneDay[] }

export const NO_VALUE = "—";

// `cals` gives order + names for calendar lanes; `options` the schema order of a field's values.
export function laneOf(o: Occurrence, by: LaneBy): string {
  if (by.kind === "calendar") return o.calendarId;
  const v = o.fields ? o.fields[by.key] : undefined;
  return v == null || v === "" ? NO_VALUE : String(v);
}

export function buildLanes(
  occs: Occurrence[],
  by: LaneBy,
  firstDay: number,        // local midnight of the first row
  nDays: number,
  cals: { id: string; name: string }[],
  options: string[] = [],
): LaneGrid {
  const lanes: Lane[] = [];
  const index = new Map<string, number>();
  const addLane = (id: string, label: string) => { if (!index.has(id)) { index.set(id, lanes.length); lanes.push({ id, label }); } };
  if (by.kind === "calendar") {
    for (const c of cals) addLane(c.id, c.name || "(unnamed)");
  } else {
    for (const o of options) if (o) addLane(o, o);
  }
  const dayStart = (n: number) => { const d = new Date(firstDay); d.setDate(d.getDate() + n); return d.getTime(); };
  const end = dayStart(nDays);
  const inWindow = occs.filter((o) => o.startTime >= firstDay && o.startTime < end).sort((a, b) => a.startTime - b.startTime);
  let hasNoValue = false;
  for (const o of inWindow) {
    const id = laneOf(o, by);
    if (id === NO_VALUE) { hasNoValue = true; continue; }
    addLane(id, id); // a calendar not in `cals` (or a value not in `options`) is labelled by itself
  }
  if (hasNoValue) addLane(NO_VALUE, NO_VALUE);

  const days: LaneDay[] = [];
  for (let i = 0; i < nDays; i++) days.push({ date: dayStart(i), cells: lanes.map(() => []) });
  for (const o of inWindow) {
    // Row = the local day the occurrence starts on.
    const d = new Date(o.startTime); d.setHours(0, 0, 0, 0);
    const row = days.findIndex((x) => x.date === d.getTime());
    const col = index.get(laneOf(o, by));
    if (row >= 0 && col !== undefined) days[row].cells[col].push(o);
  }
  return { lanes, days };
}
