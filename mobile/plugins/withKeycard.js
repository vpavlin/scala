// Adds NFC support for react-native-keycard: NFC permission + the HCE feature the lib requires.
// Mirrors choppu's app.plugin.ts. Runs during `expo prebuild`.
const { withAndroidManifest } = require("@expo/config-plugins");
module.exports = function withKeycard(config) {
  return withAndroidManifest(config, (cfg) => {
    const m = cfg.modResults.manifest;
    m["uses-permission"] = m["uses-permission"] || [];
    if (!m["uses-permission"].some((p) => p.$ && p.$["android:name"] === "android.permission.NFC"))
      m["uses-permission"].push({ $: { "android:name": "android.permission.NFC" } });
    m["uses-feature"] = m["uses-feature"] || [];
    // NOT required: Keycard is optional. required="true" made app stores (F-Droid) hide Scala on any
    // device without NFC, e.g. most tablets. Without NFC, Keycard enrolment just isn't available.
    const nfc = m["uses-feature"].find((f) => f.$ && f.$["android:name"] === "android.hardware.nfc.hce");
    if (nfc) nfc.$["android:required"] = "false";
    else m["uses-feature"].push({ $: { "android:name": "android.hardware.nfc.hce", "android:required": "false" } });
    return cfg;
  });
};
