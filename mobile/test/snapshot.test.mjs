// snapshot.test.mjs — scala's snapshot reader/format (ADR 0020). Pure + seam-based, so it runs under
// the same register.mjs/expo-stub harness as parity.ts. Proves: epoch grid, cut = HLC<boundary,
// deterministic bytes (shuffled + key-reordered → identical), parse round-trip, and ingest that
// re-verifies + drops a forged event. Run: node --experimental-strip-types --import ./register.mjs snapshot.test.mjs
import assert from "node:assert";
import {
  epochBoundary, boundaryHlc, selectCut, serializeSnapshot, parseSnapshot, ingestSnapshot,
} from "../src/lib/snapshot.ts";

const mk = (id, wall, dev, payload) => ({ v: 1, id, type: "event.put", hlc: { wall, ctr: 0, dev }, dev, payload, pub: "02aa", sig: "beef" });
const log = [
  mk("e3", 300, "A", { title: "c", nested: { b: 2, a: 1 }, arr: [3, 1, 2] }),
  mk("e1", 10, "A", { title: "a", n: 1, flag: true }),
  mk("e2", 120, "B", { z: null, title: "b" }),
  mk("e4", 999, "B", { title: "d" }),
  mk("e5", 1000, "A", { title: "excluded-on-boundary" }),
];
const dec = (b) => new TextDecoder().decode(b);
const reorder = (v) => Array.isArray(v) ? v.map(reorder)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder(v[k])])) : v;

// 1) epoch grid + cut = HLC strictly before boundary, canonically ordered
assert.equal(epochBoundary(1500, 1000), 1000);
assert.equal(epochBoundary(999, 1000), 0);
assert.deepEqual(selectCut(log, 1000).map((e) => e.id), ["e1", "e2", "e3", "e4"]);

// 2) determinism: shuffled array + reversed keys ⇒ identical serialized bytes (→ same CID)
const cut = selectCut(log, 1000);
const s1 = serializeSnapshot(cut, boundaryHlc(1000));
const s2 = serializeSnapshot(selectCut([...log].reverse().map(reorder), 1000), boundaryHlc(1000));
assert.equal(dec(s1), dec(s2), "same cut ⇒ identical bytes regardless of array/key order");

// 3) parse round-trips
const p = parseSnapshot(s1);
assert.equal(p.count, 4);
assert.deepEqual(p.events.map((e) => e.id), ["e1", "e2", "e3", "e4"]);
assert.deepEqual(p.coversUpToHlc, { wall: 1000, ctr: 0, dev: "" });

// 4) ingest: open passthrough, verify drops the forged e2, append to memory + observe clock
const merged = [];
const observed = [];
const r = await ingestSnapshot(s1, {
  open: (b) => b,
  verify: (e) => e.id !== "e2", // pretend e2's signature is bad
  append: async (e) => { merged.push(e.id); return true; },
  observe: (h) => observed.push(h.wall),
});
assert.equal(r.ingested, 3, "3 verified events ingested (e2 dropped)");
assert.deepEqual(merged.sort(), ["e1", "e3", "e4"]);
assert.deepEqual(r.coversUpToHlc, { wall: 1000, ctr: 0, dev: "" });
assert.ok(observed.length === 3, "clock observed each ingested hlc");

// 5) a wrong key (open returns null) throws rather than silently ingesting nothing
await assert.rejects(() => ingestSnapshot(s1, { open: () => null, verify: () => true, append: async () => true }), /cannot open/);

console.log("scala snapshot.test OK — epoch/cut/determinism/parse/ingest+verify-drop");
