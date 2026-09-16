// Signs an unsigned roles/authorization fixture with deterministic per-author test
// keys (A..F), using the REAL mobile signer (identity.ts) — the same sigs the C++
// desktop engine verifies. Two markers let a fixture exercise the always-require-
// signature rule of the fold:
//   "_unsigned": true  → sign, then STRIP sig+pub  → event has no signature → dropped
//   "_tamper":   true  → sign, then MUTATE payload → signature no longer matches → dropped
// Also rewrites symbolic member payloads (member:"B") to that author's address.
// Usage: node --experimental-strip-types --import ./register.mjs sign_roles.mjs <src.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { signEvent, identityFromPriv, fromHex } from "../src/lib/identity.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = process.argv[2] ? join(here, process.argv[2]) : join(here, "roles.src.json");
const outPath = process.argv[3] ? join(here, process.argv[3]) : join(here, "roles.json");
const src = JSON.parse(readFileSync(srcPath, "utf8"));

const PRIV = { A: "01", B: "02", C: "03", D: "04", E: "05", F: "06" }; // small valid secp256k1 scalars
const idOf = {};
for (const n of Object.keys(PRIV)) idOf[n] = identityFromPriv(fromHex("00".repeat(31) + PRIV[n]));
const addr = (n) => (idOf[n] ? idOf[n].address : n);

for (const e of src.log) {
  if (e.type === "member.set" && e.payload && idOf[e.payload.member]) e.payload.member = addr(e.payload.member);
  const author = e.dev; // symbolic (A..F)
  if (!idOf[author]) throw new Error("no test key for author " + author);
  const unsigned = e._unsigned === true;
  const tamper = e._tamper === true;
  delete e._unsigned;
  delete e._tamper;
  signEvent(idOf[author], e); // sets e.dev/e.hlc.dev=address, e.pub, e.sig
  if (unsigned) { delete e.sig; delete e.pub; }          // → isSigned()==false → fold drops it
  if (tamper) { e.payload = { ...e.payload, title: (e.payload.title || "") + " (tampered)" }; } // sig no longer matches → verify fails → dropped
}
writeFileSync(outPath, JSON.stringify(src, null, 2) + "\n");
console.error(`signed ${src.log.length} role fixture events → ${process.argv[3] || "roles.json"} (owner A=${addr("A").slice(0, 12)}…)`);

// Emit the resolved test addresses so the harness can assert the expected roles/owner
// without re-deriving keys. stdout is JSON; stderr (above) is the human log.
process.stdout.write(JSON.stringify({ A: addr("A"), B: addr("B"), C: addr("C"), D: addr("D"), E: addr("E"), F: addr("F") }) + "\n");
