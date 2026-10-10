// View filters: one custom-field value at a time, plus date-range presets for the agenda/search.
//
// View-only (nothing stored or synced). A field filter applies to every view; it is built from the
// visible calendars' schemas, so only enum options and yes/no fields can be picked (free-text
// fields are what search is for). The same logic runs in the desktop QML view
// (CalendarView.qml `filterChoices` / `matchesFieldFilter` / `rangeWindow`).

export interface FieldFilter { key: string; value: string }
export interface FilterChoice extends FieldFilter { label: string }
interface SchemaField { key: string; label?: string; type?: string; options?: string[] }

// Every pickable (field, value) across the given schemas, de-duplicated by key+value, in schema order.
export function filterChoices(schemas: (SchemaField[] | undefined)[]): FilterChoice[] {
  const out: FilterChoice[] = [];
  const seen = new Set<string>();
  const push = (key: string, value: string, label: string) => {
    const id = key + "\u0000" + value;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ key, value, label });
  };
  for (const schema of schemas) {
    for (const f of schema || []) {
      if (!f || !f.key) continue;
      const name = f.label || f.key;
      if (f.type === "enum") for (const o of f.options || []) { if (o) push(f.key, o, `${name}: ${o}`); }
      else if (f.type === "bool") push(f.key, "true", name);
    }
  }
  return out;
}

// Does an event match the filter? A yes/no field matches only when it's true.
export function matchesFieldFilter(ev: { fields?: Record<string, any> }, f: FieldFilter | null): boolean {
  if (!f) return true;
  const v = ev.fields ? ev.fields[f.key] : undefined;
  if (f.value === "true") return v === true || v === "true";
  return v != null && String(v) === f.value;
}

export type RangeId = "next7" | "next30" | "next90" | "past30" | "year" | "all";
export const RANGES: { id: RangeId; label: string }[] = [
  { id: "next7", label: "Next 7 days" },
  { id: "next30", label: "Next 30 days" },
  { id: "next90", label: "Next 90 days" },
  { id: "past30", label: "Past 30 days" },
  { id: "year", label: "This year" },
  { id: "all", label: "±1 year" },
];

// [start, end] in epoch ms for a preset, relative to `now` (local time; days start at midnight).
export function rangeWindow(id: RangeId, now: number): [number, number] {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const today = d.getTime();
  const day = (n: number) => { const x = new Date(today); x.setDate(x.getDate() + n); return x.getTime(); };
  switch (id) {
    case "next7": return [today, day(7) - 1];
    case "next30": return [today, day(30) - 1];
    case "past30": return [day(-30), day(1) - 1];
    case "year": { const y = new Date(today).getFullYear(); return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime() - 1]; }
    case "all": return [day(-365), day(366) - 1];
    case "next90":
    default: return [today, day(90) - 1];
  }
}
