package xyz.vpavlin.scala.files

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * File helpers for Scala (attachments, snapshots, .ics export): the app's files dir, binary-safe
 * read/write as base64, and saving into the public Downloads. They used to live in the LogosStorage
 * module beside libstorage; Storage itself now runs in Loam (scala-sdk logos-storage.ts), so only
 * these remain, with no native library.
 */
class ScalaFilesModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "ScalaFiles"

  @ReactMethod
  fun fileSize(path: String, promise: Promise) {
    try { val f = java.io.File(path); promise.resolve(if (f.exists()) f.length().toDouble() else -1.0) }
    catch (t: Throwable) { promise.resolve(-1.0) }
  }

  // App-internal writable dir — the base for libstorage's data-dir (no expo-file-system dep needed).
  @ReactMethod
  fun filesDir(promise: Promise) {
    try { promise.resolve(reactApplicationContext.filesDir.absolutePath) }
    catch (t: Throwable) { promise.reject("files_dir", t.message ?: "failed") }
  }

  // Binary-safe file IO for attachments: downloaded blobs are SEALED bytes (not UTF-8), so read them
  // as base64, decrypt in JS with the calendar key, then write the plaintext back as base64.
  @ReactMethod
  fun readFileB64(path: String, promise: Promise) {
    Thread {
      try {
        val bytes = java.io.File(path).readBytes()
        promise.resolve(android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
      } catch (t: Throwable) { promise.reject("read_b64", t.message ?: "read failed") }
    }.start()
  }
  @ReactMethod
  fun writeFileB64(path: String, b64: String, promise: Promise) {
    Thread {
      try {
        val bytes = android.util.Base64.decode(b64, android.util.Base64.NO_WRAP)
        val f = java.io.File(path); f.parentFile?.mkdirs(); f.writeBytes(bytes)
        promise.resolve(path)
      } catch (t: Throwable) { promise.reject("write_b64", t.message ?: "write failed") }
    }.start()
  }

  // Save decrypted bytes into the device's public Downloads so the user actually gets the file (not
  // just an in-app preview). API 29+ uses MediaStore (no runtime permission, scoped storage); older
  // devices write the public Downloads dir directly (WRITE_EXTERNAL_STORAGE, declared maxSdk 32).
  // Resolves with a user-facing location string.
  @ReactMethod
  fun saveToDownloads(fileName: String, mime: String, b64: String, promise: Promise) {
    Thread {
      try {
        val bytes = android.util.Base64.decode(b64, android.util.Base64.NO_WRAP)
        val name = if (fileName.isNotBlank()) fileName else "attachment"
        val type = if (mime.isNotBlank()) mime else "application/octet-stream"
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
          val resolver = reactApplicationContext.contentResolver
          val cv = android.content.ContentValues().apply {
            put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name)
            put(android.provider.MediaStore.Downloads.MIME_TYPE, type)
            put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
          }
          val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)
            ?: throw java.io.IOException("could not create a Downloads entry")
          resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw java.io.IOException("could not open Downloads for write")
          cv.clear(); cv.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
          resolver.update(uri, cv, null, null)
          promise.resolve("Downloads/$name")
        } else {
          // Pre-Q: writing the PUBLIC Downloads dir needs the runtime WRITE_EXTERNAL_STORAGE grant.
          // We only declare it in the manifest — a headless native module can't prompt for it — so if
          // it isn't granted we'd throw and every export/attachment-save would silently "fail". Fall
          // back to the app-specific external dir (needs no permission) so the save always succeeds.
          val ctx = reactApplicationContext
          // Context.checkSelfPermission is API 23+ (minSdk is 24, and this branch is API < 29), so no
          // androidx/ContextCompat dependency is needed.
          val granted = ctx.checkSelfPermission(
            android.Manifest.permission.WRITE_EXTERNAL_STORAGE
          ) == android.content.pm.PackageManager.PERMISSION_GRANTED
          val dir = if (granted)
            android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
          else
            (ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS)
              ?: throw java.io.IOException("no external storage available"))
          dir.mkdirs()
          val f = java.io.File(dir, name); f.writeBytes(bytes)
          promise.resolve(f.absolutePath)
        }
      } catch (t: Throwable) { promise.reject("save_downloads", t.message ?: "save failed") }
    }.start()
  }

}
