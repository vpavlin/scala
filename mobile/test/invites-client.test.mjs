// Client side of invite tickets + Loam identities (ADR 0022), run against the REAL app modules:
//   • invite links: build/parse round-trip of `inv`, bad tickets rejected (calendar still joinable)
//   • identity links: loam://id?pub=… / bare key / 0x address parsing + validation
//   • the Loam event signer (loam-signer.ts) with a fake Loam: good, {error}, wrong identity
//   • end to end: owner makes an invite with the app helpers → claimant parses the link and claims
//     with the app helpers (signed by a Loam identity) → foldCalendar gives the claimant the role.
// Usage: node --experimental-strip-types --import ./register.mjs invites-client.test.mjs
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  buildInvite, parseInvite, isTicketPriv, newTicket, ticketAddress, invitePayload, claimPayload,
  buildIdentityLink, parseIdentityInput,
} from "../src/lib/invite-link.ts";
import { signEventWithLoam } from "../src/lib/loam-signer.ts";
import { identityFromPriv, signEvent, fromHex, hex } from "../src/lib/identity.ts";
import { foldCalendar, ET } from "../src/lib/engine.ts";

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log("  ok    " + m); } else { fail++; console.log("  FAIL  " + m); } };
const throwsAsync = async (fn, re) => { try { await fn(); return false; } catch (e) { return re.test(String(e?.message ?? e)); } };

const key = (n) => fromHex("00".repeat(31) + n);
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const cal = { id: "6f1c2a7e-0000-4000-8000-00000000cafe", name: "Family & friends", encryptionKey: "k1-uuid" + "k2-uuid" };

console.log("== invite links ==");
{
  const plain = buildInvite(cal);
  check(plain === `scala://join?id=${cal.id}&key=azEtdXVpZGsyLXV1aWQ&name=Family%20%26%20friends`, "plain join link unchanged (desktop byte format)");
  const p0 = parseInvite(plain);
  check(p0 && p0.calendarId === cal.id && p0.key === cal.encryptionKey && p0.name === cal.name, "plain link parses (id, key, name)");
  check(p0 && p0.inv === undefined && !p0.invBad, "plain link has no ticket");

  const t = newTicket((n) => key("2a").slice(0, n));
  const link = buildInvite(cal, t.priv);
  check(link === plain + "&inv=" + t.priv, "invite link = join link + &inv=<ticket priv>");
  const p1 = parseInvite(link);
  check(p1 && p1.inv === t.priv && !p1.invBad, "inv round-trips");
  check(p1 && ticketAddress(p1.inv) === t.ticket, "parsed ticket key → the same ticket address");
  const pU = parseInvite(plain + "&inv=" + t.priv.toUpperCase());
  check(pU && pU.inv === t.priv, "upper-case inv accepted and normalised");
  const pPasted = parseInvite(" " + link.slice(0, 40) + "\n​" + link.slice(40) + "­ ");
  check(pPasted && pPasted.inv === t.priv && pPasted.calendarId === cal.id, "pasted link with line break / zero-width / soft hyphen still parses");

  const bads = {
    "63 hex (truncated)": t.priv.slice(0, 63),
    "65 hex": t.priv + "0",
    "non-hex": "zz" + t.priv.slice(2),
    "zero key": "00".repeat(32),
    "curve order n": N.toString(16),
    "empty": "",
  };
  for (const [what, v] of Object.entries(bads)) {
    const p = parseInvite(plain + "&inv=" + v);
    check(p && p.calendarId === cal.id && p.inv === undefined && p.invBad === true, `bad inv rejected (${what}), calendar still joinable`);
  }
  check(isTicketPriv(t.priv) && !isTicketPriv("00".repeat(32)) && !isTicketPriv(N.toString(16)), "isTicketPriv: valid scalar only");
  check(parseInvite("scala://join?id=x&inv=" + t.priv) === null, "a link without key is still not an invite");
}

console.log("== tickets ==");
{
  let calls = 0;
  const t = newTicket((n) => { calls++; return calls === 1 ? new Uint8Array(n) : key("33").slice(0, n); });
  check(calls === 2 && t.ticket === identityFromPriv(key("33")).address, "newTicket retries an invalid scalar (all-zero) and uses the next draw");
  check(t.pub === identityFromPriv(key("33")).pubHex && t.priv === hex(key("33")), "newTicket returns priv/pub/ticket of the same key");
  let threw = false; try { newTicket((n) => new Uint8Array(n)); } catch { threw = true; }
  check(threw, "newTicket gives up (throws) on a broken RNG instead of returning a weak key");
}

console.log("== identity links ==");
{
  const A = identityFromPriv(key("41"));
  const l = buildIdentityLink(A.pubHex);
  check(l === "loam://id?pub=" + A.pubHex, "identity link format");
  const r = parseIdentityInput(l);
  check(r.address === A.address && r.pubHex === A.pubHex, "identity link → address computed from the key");
  check(parseIdentityInput(" " + l.toUpperCase().replace("LOAM://ID?PUB=", "loam://id?pub=") + "\n").address === A.address, "upper-case key + whitespace accepted");
  check(parseIdentityInput(A.pubHex).address === A.address, "a bare 66-hex key is accepted");
  check(parseIdentityInput(A.address.toUpperCase().replace("0X", "0x")).address === A.address, "a 0x address is accepted (normalised to lower case)");
  const bad = {
    "truncated key": "loam://id?pub=" + A.pubHex.slice(0, 64),
    "04 prefix": "loam://id?pub=04" + A.pubHex.slice(2),
    "not a curve point": "loam://id?pub=02" + "ff".repeat(32),
    "link without pub": "loam://id?x=1",
    "short address": A.address.slice(0, 41),
    "garbage": "hello",
    "empty": "",
  };
  for (const [what, v] of Object.entries(bad)) check("error" in parseIdentityInput(v), `rejected: ${what}`);
  // A one-character typo in the key changes the computed address or is refused — never the original.
  const typo = parseIdentityInput("loam://id?pub=" + A.pubHex.slice(0, 20) + (A.pubHex[20] === "a" ? "b" : "a") + A.pubHex.slice(21));
  check("error" in typo || typo.address !== A.address, "a typo in the key never yields the intended address");
}

// A fake Loam: a root-derived key per context, signing digests the way hd-root.ts does.
const fakeLoam = (priv) => async (digestHex) => {
  const id = identityFromPriv(priv);
  return { sig: secp256k1.sign(fromHex(digestHex), priv).toCompactHex(), pub: id.pubHex, address: id.address };
};
let wall = 1_760_000_000_000;
const mk = (type, payload) => ({ v: 1, id: `ev-${wall}`, type, hlc: { wall: wall++, ctr: 0, dev: "x" }, dev: "x", payload });

console.log("== Loam signer ==");
{
  const L = identityFromPriv(key("51"));
  const ev = await signEventWithLoam(fakeLoam(key("51")), { address: L.address, pubHex: L.pubHex }, mk(ET.EVENT_RSVP, { eventId: "e", status: "going" }));
  check(ev.dev === L.address && ev.hlc.dev === L.address && ev.pub === L.pubHex && /^[0-9a-f]{128}$/.test(ev.sig), "stamps author + pub + sig");
  check(await throwsAsync(() => signEventWithLoam(async () => ({ error: "no root" }), { address: L.address, pubHex: L.pubHex }, mk(ET.EVENT_RSVP, {})), /no root.*Nothing was saved/), "Loam {error} → clear error, nothing saved");
  check(await throwsAsync(() => signEventWithLoam(fakeLoam(key("52")), { address: L.address, pubHex: L.pubHex }, mk(ET.EVENT_RSVP, {})), /identity changed/), "Loam signing as a different identity → refused");
  check(await throwsAsync(() => signEventWithLoam(async (d) => ({ ...(await fakeLoam(key("51"))(d)), sig: "00".repeat(64) }), { address: L.address, pubHex: L.pubHex }, mk(ET.EVENT_RSVP, {})), /failed local verification/), "a bad signature from Loam → refused before storing");
}

console.log("== end to end: invite → claim → role ==");
{
  const O = identityFromPriv(key("61"));                      // owner (device key)
  const M = identityFromPriv(key("62"));                      // claimant's Loam identity for this calendar
  const X = identityFromPriv(key("63"));                      // someone else who got the same link later
  const log = [];
  log.push(signEvent(O, mk(ET.CAL_META, { name: cal.name, color: "#89b4fa", open: false })));
  // Owner: "Invite as editor" (calendar.ts createInviteTicket = newTicket + invitePayload + buildInvite).
  const tE = newTicket((n) => key("71").slice(0, n));
  log.push(signEvent(O, mk(ET.MEMBER_INVITE, invitePayload(tE.ticket, "editor"))));
  const linkE = buildInvite(cal, tE.priv);
  // And a viewer invite that gets revoked before anyone uses it.
  const tV = newTicket((n) => key("72").slice(0, n));
  log.push(signEvent(O, mk(ET.MEMBER_INVITE, invitePayload(tV.ticket, "viewer"))));
  const linkV = buildInvite(cal, tV.priv);
  log.push(signEvent(O, mk(ET.MEMBER_INVITE, invitePayload(tV.ticket, "revoke"))));
  let f = foldCalendar(cal.id, log);
  check(f.invites[tE.ticket] === "editor" && !(tV.ticket in f.invites), "owner sees the editor invite pending; the revoked one is gone");

  // Claimant: parse the link, claim as their Loam identity (calendar.ts processPendingClaims = claimPayload + Loam-signed event).
  const p = parseInvite(linkE);
  const claim = await signEventWithLoam(fakeLoam(key("62")), { address: M.address, pubHex: M.pubHex }, mk(ET.MEMBER_CLAIM, claimPayload(p.calendarId, p.inv, M.address)));
  log.push(claim);
  f = foldCalendar(cal.id, log);
  check(f.roles[M.address] === "editor", "claimant gets the offered role (editor)");
  check(!(tE.ticket in f.invites), "the ticket is no longer pending");
  // Being an editor means their events count on a closed calendar.
  log.push(await signEventWithLoam(fakeLoam(key("62")), { address: M.address, pubHex: M.pubHex }, mk(ET.EVENT_PUT, { id: "evM", title: "Dinner" })));
  f = foldCalendar(cal.id, log);
  check(f.events.some((e) => e.id === "evM" && e.creatorId === M.address), "the claimant's event is accepted on the closed calendar");

  // Someone else opening the same link later: their claim is ignored.
  const p2 = parseInvite(linkE);
  log.push(signEvent(X, mk(ET.MEMBER_CLAIM, claimPayload(p2.calendarId, p2.inv, X.address))));
  // And a claim of the revoked viewer ticket.
  const pv = parseInvite(linkV);
  log.push(signEvent(X, mk(ET.MEMBER_CLAIM, claimPayload(pv.calendarId, pv.inv, X.address))));
  f = foldCalendar(cal.id, log);
  check(!(X.address in f.roles), "a second claim of a used ticket, and a claim of a revoked one, give no role");
  check(Object.keys(f.roles).length === 1, "exactly one member holds a role");

  // A claim signed for a DIFFERENT calendar id doesn't count here.
  const tW = newTicket((n) => key("73").slice(0, n));
  log.push(signEvent(O, mk(ET.MEMBER_INVITE, invitePayload(tW.ticket, "viewer"))));
  log.push(signEvent(X, mk(ET.MEMBER_CLAIM, claimPayload("another-calendar", tW.priv, X.address))));
  f = foldCalendar(cal.id, log);
  check(!(X.address in f.roles) && f.invites[tW.ticket] === "viewer", "a claim bound to another calendar is rejected; the ticket stays pending");
  // Owner adds someone by identity link (member.set with the computed address).
  const added = parseIdentityInput(buildIdentityLink(X.pubHex));
  log.push(signEvent(O, mk(ET.MEMBER_SET, { member: added.address, role: "viewer" })));
  f = foldCalendar(cal.id, log);
  check(f.roles[X.address] === "viewer", "add by identity link → member.set gives that identity the role");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
