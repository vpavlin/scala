// Lanes view (mobile/src/lib/lanes.ts): lane order, rows per local day, field lanes.
// Usage: node --experimental-strip-types --import ./register.mjs lanes.test.mjs
import { buildLanes, NO_VALUE } from "../src/lib/lanes.ts";
import { expandEvents } from "../src/lib/recur.ts";

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log("  ok    " + m); } else { fail++; console.log("  FAIL  " + m); } };

const day0 = new Date(2026, 9, 10).getTime();           // local midnight, Sat 10 Oct 2026
const at = (d, h) => new Date(2026, 9, 10 + d, h).getTime();
const ev = (id, cal, d, h, extra = {}) => ({ id, calendarId: cal, title: id, startTime: at(d, h), endTime: at(d, h + 4), ...extra });
const cals = [{ id: "cross", name: "Cross Club" }, { id: "ankali", name: "Ankali" }];
const occ = (evs) => expandEvents(evs, day0, day0 + 14 * 864e5);

console.log("== by calendar ==");
{
  const g = buildLanes(occ([ev("a", "ankali", 0, 22), ev("b", "cross", 0, 21), ev("c", "cross", 2, 23), ev("x", "elsewhere", 1, 20)]),
    { kind: "calendar" }, day0, 7, cals);
  check(g.lanes.map((l) => l.label).join("|") === "Cross Club|Ankali|elsewhere", "calendars in list order, unknown calendar last");
  check(g.days.length === 7 && g.days[0].date === day0, "one row per day from the first day");
  check(g.days[0].cells[0].map((o) => o.id).join() === "b" && g.days[0].cells[1].map((o) => o.id).join() === "a", "day 0: b in Cross Club, a in Ankali");
  check(g.days[2].cells[0][0].id === "c", "day 2: c in Cross Club");
  check(g.days[1].cells[2][0].id === "x", "day 1: x in its own lane");
}

console.log("== by field ==");
{
  const g = buildLanes(occ([
    ev("p", "promo", 0, 22, { fields: { venue: "Ankali" } }),
    ev("q", "promo", 0, 20, { fields: { venue: "Fuchs2" } }),
    ev("r", "promo", 1, 21),
  ]), { kind: "field", key: "venue" }, day0, 3, cals, ["Cross Club", "Ankali"]);
  check(g.lanes.map((l) => l.id).join("|") === `Cross Club|Ankali|Fuchs2|${NO_VALUE}`, "schema options first, then other values, then no value");
  check(g.days[0].cells[1][0].id === "p" && g.days[0].cells[2][0].id === "q", "events land in their value's lane");
  check(g.days[1].cells[3][0].id === "r", "an event without the field goes to —");
}

console.log("== window and recurrence ==");
{
  const weekly = ev("res", "cross", 0, 22, { recur: { freq: "weekly", interval: 1 } });
  const g = buildLanes(occ([weekly, ev("late", "cross", 20, 22)]), { kind: "calendar" }, day0, 14, cals);
  const nights = g.days.filter((d) => d.cells[0].length).map((d) => new Date(d.date).getDate());
  check(nights.join(",") === "10,17", "a weekly residency fills each week's row; events after the window are left out");
  const two = buildLanes(occ([ev("e1", "cross", 0, 20), ev("e2", "cross", 0, 18)]), { kind: "calendar" }, day0, 1, cals);
  check(two.days[0].cells[0].map((o) => o.id).join() === "e2,e1", "a cell lists its events by start time");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
