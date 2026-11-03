/**
 * withScalaFiles — re-applies the ScalaFiles native module (files dir, base64 read/write, save to
 * Downloads) on every `expo prebuild`: copies native/scalafiles/android/java/** into the generated
 * project and registers ScalaFilesPackage in MainApplication. No native library: Logos Storage runs
 * in Loam (scala-sdk logos-storage.ts); this replaced withLogosStorage (libstorage in Scala) in 0.9.120.
 */
const { withDangerousMod, withMainApplication } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE_IMPORT = "xyz.vpavlin.scala.files.ScalaFilesPackage";

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

const withNativeFiles = (config) =>
  withDangerousMod(config, ["android", async (cfg) => {
    const javaSrc = path.join(cfg.modRequest.projectRoot, "native", "scalafiles", "android", "java");
    if (fs.existsSync(javaSrc)) copyDir(javaSrc, path.join(cfg.modRequest.platformProjectRoot, "app/src/main/java"));
    return cfg;
  }]);

const withPackageRegistered = (config) =>
  withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes(PACKAGE_IMPORT)) {
      src = src.replace(/PackageList\(this\)\.packages\.apply\s*\{/,
        `PackageList(this).packages.apply {\n          // Scala file helpers — manual RN module.\n          add(${PACKAGE_IMPORT}())`);
      cfg.modResults.contents = src;
    }
    return cfg;
  });

module.exports = function withScalaFiles(config) {
  return withPackageRegistered(withNativeFiles(config));
};
