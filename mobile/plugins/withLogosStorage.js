/**
 * withLogosStorage — re-applies the Logos Storage (Codex) fetch-client native module on every
 * `expo prebuild`. Expo CNG regenerates android/ from scratch, so these live outside it
 * (native/logosstorage/…) and are copied back in here (same shape as withScalaWidget / the
 * logosdelivery packaging):
 *   native/logosstorage/android/java/**.kt     -> app/src/main/java/**
 *   native/logosstorage/arm64-v8a/*.so         -> app/src/main/jniLibs/arm64-v8a/**
 * and registers LogosStoragePackage in MainApplication. The .so's are PREBUILT blobs
 * (libstorage.so = the Nim Codex node; liblogos_storage_jni.so = the JNI glue; libc++_shared.so),
 * mirroring liblogosdelivery — no app-time native build. See logos-storage-nim#1221.
 */
const { withDangerousMod, withMainApplication } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE_IMPORT = "xyz.vpavlin.scalastorage.LogosStoragePackage";

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 1) copy the Kotlin module + the prebuilt .so's into the generated project
const withNativeFiles = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const stage = path.join(root, "native", "logosstorage");
      const javaSrc = path.join(stage, "android", "java");
      const soSrc = path.join(stage, "arm64-v8a");
      if (fs.existsSync(javaSrc)) copyDir(javaSrc, path.join(androidRoot, "app/src/main/java"));
      if (fs.existsSync(soSrc)) copyDir(soSrc, path.join(androidRoot, "app/src/main/jniLibs/arm64-v8a"));
      return cfg;
    },
  ]);

// 2) register the RN package — manual module, not autolinkable
const withPackageRegistered = (config) =>
  withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes(PACKAGE_IMPORT)) {
      src = src.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        `PackageList(this).packages.apply {\n          // Logos Storage (Codex) fetch client — manual RN module.\n          add(${PACKAGE_IMPORT}())`
      );
      cfg.modResults.contents = src;
    }
    return cfg;
  });

module.exports = function withLogosStorage(config) {
  config = withNativeFiles(config);
  config = withPackageRegistered(config);
  return config;
};
