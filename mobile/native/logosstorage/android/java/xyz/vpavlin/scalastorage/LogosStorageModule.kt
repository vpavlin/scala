package xyz.vpavlin.scalastorage

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import org.json.JSONObject
import java.math.BigInteger

/**
 * RN bridge to libstorage (Codex) for Android — a fetch-only light client (logos-storage-nim#1221).
 * Mirrors LogosMessagingModule. The native calls block until libstorage's async callback fires
 * (handled in liblogos_storage_jni.so), so each @ReactMethod runs on a background thread and
 * resolves/rejects from there — never stalling RN's native-modules queue.
 *
 * Wrapped calls return a JSON string {"ok":true,"msg":"..."} | {"ok":false,"err":"..."}; we resolve
 * msg or reject err. storageNew returns the node ptr (Long, 0 = failure). storageVersion is sync.
 */
class LogosStorageModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    @Volatile private var libsLoaded = false

    // Lazy (on setup()) so merely registering the module on a non-arm64 build (x86_64 emulator,
    // which ships no libstorage.so) does NOT crash at startup — the error surfaces only if used.
    @Synchronized
    fun ensureLibsLoaded() {
      if (libsLoaded) return
      System.loadLibrary("c++_shared")       // libstorage references libc++ (boringssl/leveldb are C++)
      System.loadLibrary("storage")           // the Nim Codex node (libstorage.so)
      System.loadLibrary("logos_storage_jni") // the JNI glue
      libsLoaded = true
    }
  }

  override fun getName() = "LogosStorage"

  // ── JNI (implemented in logos_storage_ffi.c / liblogos_storage_jni.so) ──
  external fun storageSetup()
  external fun storageNew(configJson: String): Long
  external fun storageVersion(ctx: Long): String
  external fun storageStart(ctx: Long): String
  external fun storageStop(ctx: Long): String
  external fun storageClose(ctx: Long): String
  external fun storageDestroy(ctx: Long): String
  external fun storageSpr(ctx: Long): String
  external fun storageDebug(ctx: Long): String
  external fun storageConnect(ctx: Long, peerId: String, addrs: Array<String>): String
  external fun storageExists(ctx: Long, cid: String): String
  external fun storageFetch(ctx: Long, cid: String): String
  external fun storageDownloadInit(ctx: Long, cid: String, chunkSize: Long, local: Boolean): String
  external fun storageDownloadStream(ctx: Long, cid: String, chunkSize: Long, local: Boolean, filePath: String): String

  // Run a blocking native call off the RN queue; resolve msg / reject err from the JSON result.
  private fun bg(promise: Promise, tag: String, block: () -> String) {
    Thread {
      try {
        val o = JSONObject(block())
        if (o.optBoolean("ok", false)) promise.resolve(o.optString("msg", ""))
        else promise.reject(tag, o.optString("err", "storage error"))
      } catch (t: Throwable) {
        promise.reject(tag, t.message ?: "storage call failed")
      }
    }.start()
  }

  @ReactMethod
  fun setup(promise: Promise) {
    try { ensureLibsLoaded() } catch (t: Throwable) {
      promise.reject("loadlib", "Logos Storage native library unavailable: ${t.message}"); return
    }
    storageSetup()
    promise.resolve(null)
  }

  @ReactMethod
  fun newNode(configJson: String, promise: Promise) {
    Thread {
      try {
        val ptr = storageNew(configJson)
        if (ptr == 0L) promise.reject("storage_new", "node creation failed (config rejected?)")
        else promise.resolve(BigInteger.valueOf(ptr).toString())
      } catch (t: Throwable) { promise.reject("storage_new", t.message ?: "storage_new failed") }
    }.start()
  }

  @ReactMethod
  fun version(ctx: String, promise: Promise) {
    try { promise.resolve(storageVersion(BigInteger(ctx).toLong())) }
    catch (t: Throwable) { promise.reject("storage_version", t.message ?: "failed") }
  }

  @ReactMethod fun start(ctx: String, promise: Promise) = bg(promise, "storage_start") { storageStart(BigInteger(ctx).toLong()) }
  @ReactMethod fun stop(ctx: String, promise: Promise) = bg(promise, "storage_stop") { storageStop(BigInteger(ctx).toLong()) }
  @ReactMethod fun close(ctx: String, promise: Promise) = bg(promise, "storage_close") { storageClose(BigInteger(ctx).toLong()) }
  @ReactMethod fun destroy(ctx: String, promise: Promise) = bg(promise, "storage_destroy") { storageDestroy(BigInteger(ctx).toLong()) }
  @ReactMethod fun spr(ctx: String, promise: Promise) = bg(promise, "storage_spr") { storageSpr(BigInteger(ctx).toLong()) }
  @ReactMethod fun debug(ctx: String, promise: Promise) = bg(promise, "storage_debug") { storageDebug(BigInteger(ctx).toLong()) }
  @ReactMethod fun exists(ctx: String, cid: String, promise: Promise) = bg(promise, "storage_exists") { storageExists(BigInteger(ctx).toLong(), cid) }
  @ReactMethod fun fetch(ctx: String, cid: String, promise: Promise) = bg(promise, "storage_fetch") { storageFetch(BigInteger(ctx).toLong(), cid) }

  @ReactMethod
  fun connect(ctx: String, peerId: String, addrs: ReadableArray, promise: Promise) {
    val arr = Array(addrs.size()) { i -> addrs.getString(i) ?: "" }
    bg(promise, "storage_connect") { storageConnect(BigInteger(ctx).toLong(), peerId, arr) }
  }

  @ReactMethod
  fun downloadInit(ctx: String, cid: String, chunkSize: Double, local: Boolean, promise: Promise) =
    bg(promise, "storage_download_init") { storageDownloadInit(BigInteger(ctx).toLong(), cid, chunkSize.toLong(), local) }

  // Fetch a CID to a file on disk (the BlobBackend.get path — JS then reads filePath).
  @ReactMethod
  fun downloadToFile(ctx: String, cid: String, chunkSize: Double, local: Boolean, filePath: String, promise: Promise) =
    bg(promise, "storage_download_stream") { storageDownloadStream(BigInteger(ctx).toLong(), cid, chunkSize.toLong(), local, filePath) }

  @ReactMethod fun addListener(eventName: String) { /* no-op (RN event-emitter contract) */ }
  @ReactMethod fun removeListeners(count: Int) { /* no-op */ }
}
