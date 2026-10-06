// scala:// join links, invite tickets (ADR 0022) and identity links — PURE helpers (no React Native,
// no Expo), so the node tests exercise exactly the code the app runs.
//
//   join link     scala://join?id=<calendarId>&key=<b64url(encryptionKey)>&name=<name>[&inv=<64 hex>]
//                 — MUST match the desktop core byte-for-byte; `inv` (optional) is a one-time ticket
//                 PRIVATE key: whoever opens the link first may claim the role it was offered for.
//   identity link loam://id?pub=<66 hex compressed secp256k1 key>  — or a plain 0x address.
import { fromByteArray, toByteArray } from "base64-js";
import { secp256k1 } from "@noble/curves/secp256k1";
import { utf8Bytes, utf8Decode } from "./utf8";
import { addressFor, fromHex, hex, identityFromPriv, signInviteClaim } from "./identity";

function b64urlEncode(s: string): string {
  return fromByteArray(utf8Bytes(s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s: string): string {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return utf8Decode(toByteArray(b));
}
// Robust query parse (RN Hermes has spotty URLSearchParams).
export function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of q.split("&")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, "%20"));
    } catch { /* skip malformed */ }
  }
  return out;
}
// A pasted invite can pick up line breaks, zero-width spaces or soft hyphens from the app it was
// copied out of. None of them can appear in a scala:// link (names are percent-encoded), and one
// inside a base64 value silently corrupts it, so they are removed before parsing.
export function cleanInviteLink(link: string): string {
  return link.replace(/[\s­​-‍⁠﻿]/g, "");
}

const CID_RE = /^[1-9A-HJ-NP-Za-km-z]{20,}$/;   // base58btc (Logos Storage CIDs start with zDv…)
const SPR_RE = /^spr:[A-Za-z0-9_-]{20,}$/;

/** True iff `h` is 64 hex chars that form a valid secp256k1 private key (1 ≤ k < n). */
export function isTicketPriv(h: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(h)) return false;
  try { secp256k1.getPublicKey(fromHex(h.toLowerCase()), true); return true; } catch { return false; }
}

export type ParsedInvite = {
  calendarId: string; key: string; name?: string;
  // Optional ADR-0020 bootstrap hint: the snapshot to fetch — `snapcid=<CID>` (plain), or the older
  // `snap=<base64url pointer JSON>` — and `stor`, the base64url SPR of the Storage node that has it.
  // When present, join bootstraps from the snapshot first, then RBSR-tails the delta.
  snap?: any; stor?: string;
  // ADR 0022: the invite ticket's private key (lowercase hex), when the link carries a valid one.
  inv?: string;
  // The link carried an `inv` that is not a valid ticket key (damaged/truncated). The calendar part
  // is still joinable; the app tells the user the role offer couldn't be read.
  invBad?: boolean;
};

export function parseInvite(link: string): ParsedInvite | null {
  try {
    const q = cleanInviteLink(link).split("?")[1] || "";
    const p = parseQuery(q);
    const id = p["id"] || "";
    const keyB64 = p["key"] || "";
    if (!id || !keyB64) return null;
    let snap: any; let stor: string | undefined;
    if (p["snapcid"] && CID_RE.test(p["snapcid"])) snap = { v: 1, cid: p["snapcid"] };
    else if (p["snap"]) { try { snap = JSON.parse(b64urlDecode(p["snap"])); } catch {} }
    if (!snap || typeof snap.cid !== "string" || !CID_RE.test(snap.cid)) snap = undefined; // must name a CID
    if (p["stor"]) { try { stor = b64urlDecode(p["stor"]); } catch {} }
    if (stor !== undefined && !SPR_RE.test(stor)) stor = undefined;          // must be a signed peer record
    const out: ParsedInvite = { calendarId: id, key: b64urlDecode(keyB64), name: p["name"] || undefined, snap, stor };
    if (p["inv"] !== undefined) {
      if (isTicketPriv(p["inv"])) out.inv = p["inv"].toLowerCase();
      else out.invBad = true;
    }
    return out;
  } catch {
    return null;
  }
}
/** The join link for a calendar; with `ticketPrivHex` it is an invite link (ADR 0022). */
export function buildInvite(cal: { id: string; name: string; encryptionKey?: string }, ticketPrivHex?: string): string {
  const key = b64urlEncode(cal.encryptionKey || "");
  const base = `scala://join?id=${encodeURIComponent(cal.id)}&key=${key}&name=${encodeURIComponent(cal.name)}`;
  return ticketPrivHex ? `${base}&inv=${ticketPrivHex.toLowerCase()}` : base;
}

// ── invite tickets ────────────────────────────────────────────────────────────
/** A fresh one-time ticket key. `randomBytes` MUST be a Hermes-safe RNG (expo-crypto getRandomBytes). */
export function newTicket(randomBytes: (n: number) => Uint8Array): { priv: string; ticket: string; pub: string } {
  for (let i = 0; i < 8; i++) {
    const p = randomBytes(32);
    try { const id = identityFromPriv(p); return { priv: hex(p), ticket: id.address, pub: id.pubHex }; } catch { /* out of range — retry */ }
  }
  throw new Error("could not generate an invite ticket");
}
/** The ticket's address (what member.invite names) for a ticket private key. */
export function ticketAddress(ticketPrivHex: string): string {
  return identityFromPriv(fromHex(ticketPrivHex.toLowerCase())).address;
}
/** member.invite payload. role "revoke" withdraws a pending ticket. */
export function invitePayload(ticket: string, role: "editor" | "viewer" | "revoke"): { ticket: string; role: string } {
  return { ticket, role };
}
/** member.claim payload: redeem `ticketPrivHex` for `member` (YOUR address on this calendar). */
export function claimPayload(calId: string, ticketPrivHex: string, member: string): { ticket: string; ticketPub: string; member: string; ticketSig: string } {
  const c = signInviteClaim(fromHex(ticketPrivHex.toLowerCase()), calId, member);
  return { ticket: c.ticket, ticketPub: c.ticketPub, member, ticketSig: c.ticketSig };
}

// ── identity links ────────────────────────────────────────────────────────────
/** loam://id?pub=<66 hex> for a compressed public key. */
export function buildIdentityLink(pubHex: string): string { return `loam://id?pub=${pubHex.toLowerCase()}`; }

/**
 * Parse what someone pasted to add a member: a `loam://id?pub=…` link, a bare 66-hex compressed
 * public key, or a 0x address. With a key the address is COMPUTED (a typo can't grant a role to
 * nobody: a damaged key is not a curve point and is rejected).
 */
export function parseIdentityInput(raw: string): { address: string; pubHex?: string } | { error: string } {
  const s = cleanInviteLink(raw || "");
  if (!s) return { error: "Paste an identity link (loam://id?pub=…) or an address (0x…)." };
  let pub: string | null = null;
  if (/^loam:\/\/id\b/i.test(s)) {
    pub = parseQuery(s.split("?")[1] || "")["pub"] || "";
    if (!pub) return { error: "That identity link has no pub= key." };
  } else if (/^(02|03)[0-9a-f]{64}$/i.test(s)) {
    pub = s;
  }
  if (pub !== null) {
    if (!/^(02|03)[0-9a-f]{64}$/i.test(pub)) return { error: "The key in that identity link is not 66 hex characters starting 02/03 — it may be cut off." };
    const pubHex = pub.toLowerCase();
    try { secp256k1.ProjectivePoint.fromHex(pubHex); } catch { return { error: "The key in that identity link is not a valid public key — it may be damaged." }; }
    return { address: addressFor(fromHex(pubHex)), pubHex };
  }
  if (/^0x[0-9a-f]{40}$/i.test(s)) return { address: s.toLowerCase() };
  return { error: "Not an identity. Expected loam://id?pub=<66 hex> or a 0x address (42 characters)." };
}
