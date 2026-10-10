// View filters (mobile/src/lib/filters.ts): field choices, matching, date-range presets.
// Usage: node --experimental-strip-types --import ./register.mjs filters.test.mjs
import { filterChoices, matchesFieldFilter, rangeWindow, RANGES } from "../src/lib/filters.ts";

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log("  ok    " + m); } else { fail++; console.log("  FAIL  " + m); } };

console.log("== choices ==");
{
  const club = [
    { key: "status", label: "Status", type: "enum", options: ["Draft", "Confirmed", "Cancelled"] },
    { key: "door", label: "Door price", type: "number" },
    { key: "sold", label: "Sold out", type: "bool" },
  ];
  const promoter = [
    { key: "status", label: "Status", type: "enum", options: ["Confirmed", "Hold"] },
    { key: "venue", type: "enum", options: ["Cross Club", ""] },
  ];
  const c = filterChoices([club, undefined, promoter]);
  const labels = c.map((x) => x.label);
  check(labels.join("|") === "Status: Draft|Status: Confirmed|Status: Cancelled|Sold out|Status: Hold|venue: Cross Club",
    "enum options and yes/no fields, deduplicated, in schema order (got " + labels.join("|") + ")");
  check(!labels.some((l) => l.startsWith("Door")), "number fields are not offered");
  check(c.find((x) => x.label === "Sold out").value === "true", "a yes/no field filters on true");
}

console.log("== matching ==");
{
  const ev = { fields: { status: "Confirmed", sold: true, capacity: 300 } };
  check(matchesFieldFilter(ev, null), "no filter matches everything");
  check(matchesFieldFilter(ev, { key: "status", value: "Confirmed" }), "enum value matches");
  check(!matchesFieldFilter(ev, { key: "status", value: "Draft" }), "other enum value doesn't");
  check(matchesFieldFilter(ev, { key: "sold", value: "true" }), "true yes/no field matches");
  check(!matchesFieldFilter({ fields: { sold: false } }, { key: "sold", value: "true" }), "false yes/no field doesn't");
  check(!matchesFieldFilter({}, { key: "status", value: "Confirmed" }), "event without fields doesn't");
  check(matchesFieldFilter(ev, { key: "capacity", value: "300" }), "values compare as strings");
}

console.log("== ranges ==");
{
  const now = new Date(2026, 9, 10, 15, 30).getTime(); // Sat 10 Oct 2026, 15:30 local
  const midnight = new Date(2026, 9, 10).getTime();
  const [s7, e7] = rangeWindow("next7", now);
  check(s7 === midnight && e7 === new Date(2026, 9, 17).getTime() - 1, "next 7 days starts today at midnight, ends before day 8");
  const [sp, ep] = rangeWindow("past30", now);
  check(sp === new Date(2026, 8, 10).getTime() && ep === new Date(2026, 9, 11).getTime() - 1, "past 30 days includes today");
  const [sy, ey] = rangeWindow("year", now);
  check(sy === new Date(2026, 0, 1).getTime() && ey === new Date(2027, 0, 1).getTime() - 1, "this year is Jan 1 to Dec 31");
  check(RANGES.every((r) => { const [a, b] = rangeWindow(r.id, now); return a < b; }), "every preset is a non-empty window");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
