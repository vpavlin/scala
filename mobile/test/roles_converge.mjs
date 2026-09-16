// Convergence check for the ROLES scenario: authorization resolves in a single HLC-ordered
// fold pass (a grant must be seen before the grantee acts), so the outcome MUST be independent
// of the order events arrive over the wire. Fold roles.json under many shuffled + duplicated
// arrival orders (via mergeEvents) — every result must be byte-identical to the canonical fold.
// Usage: node --experimental-strip-types --import ./register.mjs roles_converge.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foldCalendar, mergeEvents, eventFromJson } from "../src/lib/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, "roles.json"), "utf8"));
const log = fx.log.map(eventFromJson);

const norm = (o) =>
  JSON.stringify(o, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  );

const gold = norm(foldCalendar(fx.calId, log));
const seeded = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff); };
const rnd = seeded(7);
let trials = 0, fails = 0;
for (let t = 0; t < 300; t++) {
  const sh = [...log];
  for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
  const withDups = [...sh, sh[t % sh.length], sh[(t * 3) % sh.length]];
  const got = norm(foldCalendar(fx.calId, mergeEvents(withDups)));
  trials++;
  if (got !== gold) { fails++; if (fails <= 2) process.stderr.write(`  DIVERGED trial ${t}\n    want ${gold}\n    got  ${got}\n`); }
}
process.stderr.write(`roles convergence: ${trials - fails}/${trials} shuffled+duplicated orders identical\n`);
process.exit(fails === 0 ? 0 : 1);
