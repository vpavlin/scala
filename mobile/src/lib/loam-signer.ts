// Sign one scala event with an identity HELD BY LOAM (loam-keycard ADR 0001, scala ADR 0022).
// Loam signs a 32-byte digest in this app's namespace; here we map scala's event onto it exactly like
// the Keycard shim (loam-keycard/scala-signer.ts): stamp the author, digest the canonical form, stamp
// pub/sig, and prove the result verifies BEFORE anything is stored. The sign call is injected so the
// node tests run this exact code with a fake Loam.
import { sha256 } from "@noble/hashes/sha256";
import { canonicalMessage, hex, addressFor, fromHex, verifyEvent } from "./identity";
import { utf8Bytes } from "./utf8";

export type LoamSignFn = (digestHex: string) => Promise<{ sig: string; pub: string; address: string } | { error: string }>;

export async function signEventWithLoam(sign: LoamSignFn, expected: { address: string; pubHex: string }, ev: any): Promise<any> {
  ev.dev = expected.address;
  if (ev.hlc) ev.hlc.dev = expected.address;
  const digest = sha256(utf8Bytes(canonicalMessage(ev)));
  const r = await sign(hex(digest));
  if (!r || "error" in r) {
    throw new Error(`Loam couldn't sign this change (${r && "error" in r ? r.error : "no answer"}). Open Loam and try again. Nothing was saved.`);
  }
  const pub = String(r.pub || "").toLowerCase();
  // The identity Loam signs with must be the one this calendar is bound to. A different one means Loam's
  // root changed (restored/recreated) since the calendar was set up: the event would carry a different
  // author than the one holding the role, so refuse instead of saving something that silently vanishes.
  let live = "";
  try { live = addressFor(fromHex(pub)); } catch { /* malformed */ }
  if (live !== expected.address || String(r.address || "").toLowerCase() !== expected.address) {
    throw new Error(
      `Loam signed as ${(live || r.address || "?").slice(0, 10)}… but this calendar uses ${expected.address.slice(0, 10)}…. ` +
      "Your Loam identity changed since you set this calendar up. Nothing was saved.",
    );
  }
  ev.pub = pub;
  ev.sig = String(r.sig || "").toLowerCase();
  if (!verifyEvent(ev)) {
    throw new Error("Loam's signature failed local verification — the change would be rejected on sync, so nothing was saved.");
  }
  return ev;
}
