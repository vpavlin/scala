// Signs the invite-ticket fixture (ADR 0022) with deterministic test keys, using the REAL mobile signer
// (identity.ts) — the same signatures the C++ engine verifies. Authors A..G and tickets T1..T7 are
// symbolic. Markers on member.claim: _sigTicket (sign the claim with ANOTHER ticket's key) and _highS
// (replace the claim signature by its high-S twin: valid for OpenSSL, rejected by noble — both folds
// must reject it). Prints the resolved addresses as JSON on stdout.
// Usage: node --experimental-strip-types --import ./register.mjs sign_invites.mjs invites.src.json invites.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { signEvent, identityFromPriv, fromHex, signInviteClaim } from "../src/lib/identity.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(readFileSync(join(here, process.argv[2]), "utf8"));
const key = (n) => fromHex("00".repeat(31) + n);
const AUTH = { A: "01", B: "02", C: "03", D: "04", E: "05", F: "06", G: "07" };
const TICK = { T1: "21", T2: "22", T3: "23", T4: "24", T5: "25", T6: "26", T7: "27" };
const id = Object.fromEntries(Object.entries(AUTH).map(([n, k]) => [n, identityFromPriv(key(k))]));
const tk = Object.fromEntries(Object.entries(TICK).map(([n, k]) => [n, identityFromPriv(key(k))]));
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

for (const e of src.log) {
  const p = e.payload;
  if (e.type === "member.set" && id[p.member]) p.member = id[p.member].address;
  if (e.type === "member.invite") p.ticket = tk[p.ticket].address;
  if (e.type === "member.claim") {
    const member = id[p.member].address;
    const signWith = e._sigTicket || p.ticket;
    const c = signInviteClaim(key(TICK[signWith]), src.calId, member);
    // The claim names the CLAIMED ticket and its real public key; with _sigTicket the signature comes
    // from a different ticket's key, so only the signature check can reject it.
    p.ticketPub = tk[p.ticket].pubHex;
    p.ticket = tk[p.ticket].address;
    p.member = member;
    p.ticketSig = c.ticketSig;
    if (e._highS) {
      const s = BigInt("0x" + c.ticketSig.slice(64));
      p.ticketSig = c.ticketSig.slice(0, 64) + (N - s).toString(16).padStart(64, "0");
    }
  }
  delete e._sigTicket; delete e._highS;
  signEvent(id[e.dev], e);
}
writeFileSync(join(here, process.argv[3]), JSON.stringify(src, null, 2) + "\n");
console.log(JSON.stringify({ ...Object.fromEntries(Object.entries(id).map(([n, v]) => [n, v.address])), ...Object.fromEntries(Object.entries(tk).map(([n, v]) => [n, v.address])) }));
