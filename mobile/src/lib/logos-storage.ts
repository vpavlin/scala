// logos-storage.ts — thin TS client over the LogosStorage native module (libstorage / Codex fetch
// client, logos-storage-nim#1221). Manages one node ctx + typed calls. Fetch-only: the phone pulls
// blocks by CID (downloadToFile) — desktops/crib replicate (ADR 0017). All calls are promises;
// the native side blocks on libstorage's async callback and resolves when it completes.
//
// Gate 2 scope: enough to smoke-test on a device (init → start → spr/connect → download a CID) and to
// back a future CodexBlobBackend. Not yet wired into scala's attachment flow.
import { NativeModules } from "react-native";

const LS: any = (NativeModules as any).LogosStorage;

/** True if the native module is present in this build (absent on x86_64 emulator / non-arm64). */
export function available(): boolean {
  return !!LS;
}

let ctx: string | null = null;

export interface StorageConfig {
  "log-level"?: string;
  "data-dir": string; // a writable dir (e.g. <documentDir>/codex)
  network?: string; // "logos.test"
  "listen-port"?: number;
  "bootstrap-node"?: string[];
}

/** Create + start the node. Idempotent-ish: a second call returns the existing ctx. */
export async function init(cfg: StorageConfig): Promise<string> {
  if (!LS) throw new Error("LogosStorage native module unavailable in this build");
  if (ctx) return ctx;
  await LS.setup();
  const json = JSON.stringify({ "log-level": "WARN", network: "logos.test", ...cfg });
  ctx = (await LS.newNode(json)) as string;
  await LS.start(ctx);
  return ctx;
}

function need(): string {
  if (!ctx) throw new Error("storage node not started — call init() first");
  return ctx;
}

export async function version(): Promise<string> {
  return LS.version(need());
}

/** Node's signed peer record (spr) — the dialable address other nodes use to reach us. */
export async function spr(): Promise<string> {
  return LS.spr(need());
}

/** Diagnostics JSON (peerId, spr, connected peers). */
export async function debug(): Promise<string> {
  return LS.debug(need());
}

/** Connect to a peer (a bootstrap or a desktop/crib Codex node) by peerId + multiaddrs. */
export async function connect(peerId: string, addrs: string[]): Promise<void> {
  await LS.connect(need(), peerId, addrs);
}

/** True if the CID's blocks are already held locally. */
export async function exists(cid: string): Promise<boolean> {
  return (await LS.exists(need(), cid)) === "true";
}

/** Prefetch a CID into the local store (no file write); completes when fetched. */
export async function fetch(cid: string): Promise<void> {
  await LS.fetch(need(), cid);
}

/**
 * Fetch a CID and write its bytes to `filePath` (the BlobBackend.get path — the caller then reads
 * the file, e.g. via expo-file-system). local=false pulls from the network if not held locally.
 */
export async function downloadToFile(
  cid: string,
  filePath: string,
  opts?: { chunkSize?: number; local?: boolean },
): Promise<void> {
  await LS.downloadToFile(need(), cid, opts?.chunkSize ?? 65536, opts?.local ?? false, filePath);
}

/** Stop + close + destroy the node (best-effort). */
export async function shutdown(): Promise<void> {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  try { await LS.stop(c); } catch { /* */ }
  try { await LS.close(c); } catch { /* */ }
  try { await LS.destroy(c); } catch { /* */ }
}
