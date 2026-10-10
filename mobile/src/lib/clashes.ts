// Clash warnings: two timed occurrences in the same group whose times overlap.
//
// A view-only aid (nothing is stored or synced): the group is the calendar by default, so a
// venue's calendar warns when two nights are booked over each other. A caller can group by
// something else, e.g. a custom "venue" field, to warn across calendars. All-day and
// zero-length occurrences never clash. The same algorithm runs in the desktop QML view
// (CalendarView.qml `findClashes`), so both platforms warn about the same pairs.
import type { Occurrence } from "./recur";

// Identifies one occurrence of a (possibly recurring) event.
export function occKey(o: { seriesId: string; occ: number }): string {
  return `${o.seriesId}@${o.occ}`;
}

// Map occKey → the occurrences it overlaps, sorted by start. Occurrences with no clash are
// absent. `groupOf` returns the group an occurrence competes in; returning "" opts it out.
export function findClashes(
  occs: Occurrence[],
  groupOf: (o: Occurrence) => string = (o) => o.calendarId,
): Map<string, Occurrence[]> {
  const groups = new Map<string, Occurrence[]>();
  for (const o of occs) {
    if (o.allDay || !(o.endTime > o.startTime)) continue;
    const g = groupOf(o);
    if (!g) continue;
    const list = groups.get(g);
    if (list) list.push(o); else groups.set(g, [o]);
  }
  const out = new Map<string, Occurrence[]>();
  const add = (a: Occurrence, b: Occurrence) => {
    const k = occKey(a);
    const list = out.get(k);
    if (list) list.push(b); else out.set(k, [b]);
  };
  for (const list of groups.values()) {
    list.sort((a, b) => a.startTime - b.startTime || occKey(a).localeCompare(occKey(b)));
    // Sweep: each occurrence is compared with the later-starting ones until they start after it ends.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length && list[j].startTime < a.endTime; j++) {
        const b = list[j];
        if (occKey(a) === occKey(b)) continue;
        add(a, b);
        add(b, a);
      }
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.startTime - b.startTime);
  return out;
}
