// JS side of the CATCH-UP parity/convergence test: drives the ACTUAL mobile RBSR
// (../src/lib/catchup.ts) with the same input as catchup_cpp.cpp and prints the same shape.
// The "fp" string MUST equal the C++ side byte-for-byte (cross-platform wire invariant), and
// both peers must converge to the union. Run: node --experimental-strip-types --import ./register.mjs catchup_ts.mjs
import { buildInitial, respond } from "../src/lib/catchup";
import { readFileSync } from "node:fs";

const mk = (ids) => ids.map((id) => ({ id }));
const sortedIds = (v) => v.map((e) => e.id).sort().join(",");
const fpStr = (frame) => (frame.fps || []).join(",") + "|" + (frame.bounds || []).join(",");
const hasId = (v, id) => v.some((e) => e.id === id);

const input = JSON.parse(readFileSync(0, "utf8"));
const A = mk(input.a), B = mk(input.b);

const fp = fpStr(buildInitial(A, "A"));

let q = [{ to: "B", msg: buildInitial(A, "A") }, { to: "A", msg: buildInitial(B, "B") }];
let rounds = 0;
while (q.length && rounds < 100) {
  rounds++;
  const next = [];
  for (const { to, msg } of q) {
    const mine = to === "A" ? A : B;
    const sender = to === "A" ? B : A;   // serve + replies go back to the sender
    const dst = to === "A" ? "B" : "A";
    const step = respond(mine, msg, to);
    for (const e of step.serve) if (!hasId(sender, e.id)) sender.push(e);
    for (const r of step.replies) next.push({ to: dst, msg: r });
  }
  q = next;
}

process.stdout.write(JSON.stringify({ fp, a: sortedIds(A), b: sortedIds(B), rounds }) + "\n");
