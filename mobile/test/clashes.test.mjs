// Clash warnings (mobile/src/lib/clashes.ts), the same cases the desktop findClashes must give.
// Usage: node --experimental-strip-types --import ./register.mjs clashes.test.mjs
import { findClashes, occKey } from "../src/lib/clashes.ts";
import { expandEvents } from "../src/lib/recur.ts";

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log("  ok    " + m); } else { fail++; console.log("  FAIL  " + m); } };

const H = 3600e3, D = 24 * H;
const T0 = Date.UTC(2026, 9, 10, 20); // a Saturday, 20:00 UTC
const ev = (id, cal, s, e, extra = {}) => ({ id, calendarId: cal, title: id, startTime: s, endTime: e, ...extra });
const occs = (evs) => expandEvents(evs, T0 - 2 * D, T0 + 30 * D);
const names = (m, id, at) => (m.get(`${id}@${at}`) || []).map((o) => o.id).sort().join(",");

console.log("== same calendar ==");
{
  const m = findClashes(occs([
    ev("a", "club", T0, T0 + 4 * H),
    ev("b", "club", T0 + 3 * H, T0 + 6 * H),     // overlaps a
    ev("c", "club", T0 + 6 * H, T0 + 7 * H),     // starts when b ends: no clash
    ev("d", "other", T0 + H, T0 + 2 * H),        // another calendar: no clash by default
  ]));
  check(names(m, "a", T0) === "b", "a clashes with b");
  check(names(m, "b", T0 + 3 * H) === "a", "b clashes with a (symmetric)");
  check(!m.has(`c@${T0 + 6 * H}`), "back-to-back is not a clash");
  check(!m.has(`d@${T0 + H}`), "other calendars don't clash by default");
}

console.log("== skipped occurrences ==");
{
  const m = findClashes(occs([
    ev("all", "club", T0, T0 + D, { allDay: true }),
    ev("zero", "club", T0 + H, T0 + H),
    ev("x", "club", T0 + H, T0 + 2 * H),
  ]));
  check(m.size === 0, "all-day and zero-length occurrences never clash");
}

console.log("== recurring ==");
{
  const weekly = ev("res", "club", T0, T0 + 5 * H, { recur: { freq: "weekly", interval: 1 } });
  const oneOff = ev("gig", "club", T0 + 7 * D + 2 * H, T0 + 7 * D + 4 * H);
  const m = findClashes(occs([weekly, oneOff]));
  check(names(m, "res", T0 + 7 * D) === "gig", "the second residency night clashes with the one-off gig");
  check(!m.has(`res@${T0}`), "the first night does not");
  check(occKey({ seriesId: "res", occ: T0 + 7 * D }) === `res@${T0 + 7 * D}`, "occKey is seriesId@occ");
}

console.log("== custom grouping (e.g. a venue field across calendars) ==");
{
  const byVenue = (o) => (o.fields && o.fields.venue) || "";
  const m = findClashes(occs([
    ev("p", "promoter-a", T0, T0 + 4 * H, { fields: { venue: "Cross Club" } }),
    ev("q", "promoter-b", T0 + 2 * H, T0 + 5 * H, { fields: { venue: "Cross Club" } }),
    ev("r", "promoter-b", T0 + 2 * H, T0 + 5 * H, { fields: { venue: "Ankali" } }),
    ev("s", "promoter-b", T0 + 2 * H, T0 + 5 * H),               // no venue: opted out
  ]), byVenue);
  check(names(m, "p", T0) === "q", "same venue clashes across calendars");
  check(!m.has(`r@${T0 + 2 * H}`) && !m.has(`s@${T0 + 2 * H}`), "other venue / no venue: no clash");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
