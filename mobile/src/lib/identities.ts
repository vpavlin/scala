// identities.ts — scala's binding into the generic loam-keycard identity registry.
//
// The whole multi-identity model (device/soft/keycard registry, per-container binding, default,
// authorEvent routing) now lives in loam-keycard (src/lib/loam-keycard/identity.ts, vendored). Here
// we only INJECT scala's own seams — its software-key signing (identity.ts) and its Keycard signer
// (loam-keycard/scala-signer) — and keep the calendar-flavoured names the app already imports.
//
// Storage prefix "scala" → identical keys to the pre-extraction module (scala.identities.* and
// scala-soft-<id>), so existing enrolments/bindings survive.
import * as Crypto from "expo-crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { getIdentity, identityFromPriv, signEvent as signEventSoft, hex, fromHex } from "./identity";
import { isKeycardIdentity, keycardAddress, keycardPubHex, signEventWithKeycard, loadEnrollment } from "./loam-keycard/scala-signer";
import { createIdentityRegistry, SoftKeySeam, KeycardIdentitySeam, LoamIdentitySeam } from "./loam-keycard/identity";
import { loamIdentityStatus, loamIdentity, loamSign, usingServiceBackend } from "./loam-transport";
import { signEventWithLoam } from "./loam-signer";
export type { IdentityMeta, IdKind } from "./loam-keycard/identity";
export { LOAM_CTX, LOAM_MAIN, isLoamBinding } from "./loam-keycard/identity";

// Hermes-safe secp256k1 scalar (expo-crypto RNG; reject out-of-range).
function freshPriv(): Uint8Array {
  for (let i = 0; i < 8; i++) { const p = Crypto.getRandomBytes(32); try { secp256k1.getPublicKey(p, true); return p; } catch { /* retry */ } }
  throw new Error("could not generate a key");
}

const soft: SoftKeySeam = {
  getDeviceKey: async () => { const id = await getIdentity(); return { priv: id.priv, address: id.address, pubHex: id.pubHex }; },
  keyFromPriv: (priv) => { const id = identityFromPriv(priv); return { priv: id.priv, address: id.address, pubHex: id.pubHex }; },
  freshPriv,
  signEvent: (key, ev) => signEventSoft(identityFromPriv(key.priv), ev),
  hex, fromHex,
};
const keycard: KeycardIdentitySeam = {
  loadEnrollment,
  isEnrolled: isKeycardIdentity,
  address: keycardAddress,
  pubHex: keycardPubHex,
  signEvent: signEventWithKeycard,
};

// Identities held by the Loam app (ADR 0022): `loam:ctx` (context = calendar id) / `loam:main` ("").
// Every call returns {error} when there is no shared Loam node or Loam is too old → the registry then
// reports no root, and the create/join flows offer the local identities exactly as before.
// Guarded on the backend already being the shared node: the hd calls would otherwise CHOOSE the backend
// (ensure()) before startSyncing has applied the shared-node preference.
const NOT_SHARED = "Scala isn't connected to the shared Loam node";
const loam: LoamIdentitySeam = {
  status: async () => {
    if (!usingServiceBackend()) return null;
    const r = await loamIdentityStatus();
    return r && !r.error ? { exists: !!r.exists, mainAddress: r.mainAddress, mainPubHex: r.mainPubHex } : null;
  },
  identity: async (contextId) => {
    if (!usingServiceBackend()) return { error: NOT_SHARED };
    const r: any = await loamIdentity(contextId);
    return r && !r.error && r.address ? { address: String(r.address).toLowerCase(), pubHex: String(r.pubHex || "").toLowerCase() } : { error: String(r?.error || "no answer") };
  },
  signEvent: (contextId, expected, ev) => signEventWithLoam(
    async (digestHex) => (usingServiceBackend() ? loamSign(contextId, digestHex) : { error: NOT_SHARED }), expected, ev),
};

const reg = createIdentityRegistry({ storagePrefix: "scala", soft, keycard, loam });

// Same surface the app already imports (calendar = container).
export const listIdentities = () => reg.listIdentities();
export const addSoftIdentity = (label: string) => reg.addSoftIdentity(label);
export const renameSoftIdentity = (id: string, label: string) => reg.renameSoftIdentity(id, label);
export const removeSoftIdentity = (id: string) => reg.removeSoftIdentity(id);
export const getDefaultIdentityId = () => reg.getDefaultIdentityId();
export const setDefaultIdentityId = (id: string) => reg.setDefaultIdentityId(id);
export const bindingFor = (calId: string) => reg.bindingFor(calId);
export const bindCalendar = (calId: string, identityId: string) => reg.bindContainer(calId, identityId);
export const identityForCalendar = (calId: string) => reg.identityForContainer(calId);
export const authorEvent = (calId: string, ev: any) => reg.authorEvent(calId, ev);
export const defaultAddress = () => reg.defaultAddress();
export const loamRootExists = () => reg.loamRootExists();
