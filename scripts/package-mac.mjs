/* global process, console, Buffer */
// v1.12.0: packages Grain-Nest.app (Apple Silicon) into out/Grain-Nest-darwin-arm64/.
//
// With the Developer ID secrets in the environment (CSC_LINK, a base64 .p12;
// CSC_KEY_PASSWORD; APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID) the app is
// signed with the hardened runtime and notarised, and Gatekeeper is asked whether it
// accepts it. Without them it is signed ad hoc as before (Apple Silicon refuses to
// run unsigned code), and the first launch needs right-click → Open.
//
// The Info.plist says which files Grain-Nest opens: its projects (.gnp) and sheets
// files (.gnsheets) as their owner, SVG patterns as an alternative (Open With).
//
// Off a Mac (to check the bundle on Linux) it packages without signing.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const onMac = process.platform === "darwin";
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });

const env = (name) => (process.env[name] || "").trim() || null;
const cert = env("CSC_LINK");
const certPassword = env("CSC_KEY_PASSWORD") || "";
const appleId = env("APPLE_ID");
const applePassword = env("APPLE_APP_SPECIFIC_PASSWORD");
const teamId = env("APPLE_TEAM_ID");
if (cert && !(appleId && applePassword && teamId)) {
  throw new Error(
    "The certificate is there but not all three APPLE_* secrets, so it can't be notarised",
  );
}
const signing = onMac && !!cert;

// What stays out of the app: the same list the old electron-packager command had.
const ignore = [
  /\.github/,
  /\.vscode/,
  /\.husky/,
  /\.claude/,
  /^\/out/,
  /^\/docs/,
  /^\/tests/,
  /^\/scripts/,
  /^\/build-resources/,
  /^\/helper_scripts/,
  /^\/examples/,
  /^\/playwright-report/,
  /^\/test-results/,
  /renovate\.json/,
  /\.readthedocs\.yaml/,
  /CHANGELOG\.md/,
  /CLAUDE\.md/,
  /\.gitignore/,
  /\.gitattributes/,
  /test\.log/,
  /\.command$/,
  /setup-mac\.sh/,
  /^\/grainnest/,
  /\.tsbuildinfo$/,
];

const docType = (name, role, rank, types) => ({
  CFBundleTypeName: name,
  CFBundleTypeRole: role,
  LSHandlerRank: rank,
  LSItemContentTypes: types,
  CFBundleTypeIconFile: "electron.icns",
});
const ownType = (id, description, ext) => ({
  UTTypeIdentifier: id,
  UTTypeDescription: description,
  UTTypeConformsTo: ["public.json", "public.data"],
  UTTypeIconFile: "electron.icns",
  UTTypeTagSpecification: { "public.filename-extension": [ext] },
});
const extendInfo = {
  CFBundleDocumentTypes: [
    docType("Grain-Nest project", "Editor", "Owner", ["com.grainnest.project"]),
    docType("Grain-Nest sheets", "Editor", "Owner", ["com.grainnest.sheets"]),
    docType("SVG pattern", "Viewer", "Alternate", ["public.svg-image"]),
  ],
  UTExportedTypeDeclarations: [
    ownType("com.grainnest.project", "Grain-Nest project", "gnp"),
    ownType("com.grainnest.sheets", "Grain-Nest sheets", "gnsheets"),
  ],
};

// The Developer ID certificate goes into a keychain of its own for this run.
let keychain = null;
let identity = null;
function importCertificate() {
  keychain = path.join(os.tmpdir(), "grain-nest-signing.keychain-db");
  const kcPassword = crypto.randomBytes(24).toString("hex");
  const p12 = path.join(os.tmpdir(), "grain-nest-signing.p12");
  fs.writeFileSync(
    p12,
    fs.existsSync(cert) ? fs.readFileSync(cert) : Buffer.from(cert, "base64"),
  );
  fs.rmSync(keychain, { force: true });
  run("security", ["create-keychain", "-p", kcPassword, keychain]);
  run("security", ["set-keychain-settings", "-lut", "21600", keychain]);
  run("security", ["unlock-keychain", "-p", kcPassword, keychain]);
  run("security", [
    "import", p12, "-k", keychain, "-P", certPassword, "-f", "pkcs12",
    "-T", "/usr/bin/codesign", "-T", "/usr/bin/security",
  ]);
  fs.rmSync(p12, { force: true });
  run("security", [
    "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s",
    "-k", kcPassword, keychain,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  const existing = out("security", ["list-keychains", "-d", "user"])
    .split("\n")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  run("security", ["list-keychains", "-d", "user", "-s", keychain, ...existing]);
  const found = out("security", ["find-identity", "-v", "-p", "codesigning", keychain]);
  const m = found.match(/"(Developer ID Application: [^"]+)"/);
  if (!m) throw new Error("No Developer ID Application identity in the certificate");
  identity = m[1];
  console.log(`Signing as ${identity}`);
}

const entitlements = path.resolve("build-resources", "entitlements.mac.plist");
const app = path.join("out", "Grain-Nest-darwin-arm64", "Grain-Nest.app");

try {
  if (signing) importCertificate();
  else if (onMac) console.log("No Developer ID certificate: signing ad hoc (right-click → Open the first time)");
  else console.log("Not on a Mac: packaging without signing (for checking the bundle only)");

  await packager({
    dir: ".",
    name: "Grain-Nest",
    platform: "darwin",
    arch: "arm64",
    icon: "icon.icns",
    appBundleId: "com.grainnest.app",
    out: "out",
    overwrite: true,
    ignore,
    extendInfo,
    ...(signing
      ? {
          osxSign: {
            identity,
            keychain,
            optionsForFile: () => ({ hardenedRuntime: true, entitlements }),
          },
          osxNotarize: { appleId, appleIdPassword: applePassword, teamId },
        }
      : {}),
  });

  if (signing) {
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
    run("xcrun", ["stapler", "validate", app]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
    console.log("Signed with the Developer ID and notarised");
  } else if (onMac) {
    run("codesign", ["--force", "--deep", "--sign", "-", app]);
    run("codesign", ["--verify", "--deep", "--strict", app]);
    console.log("Signed ad hoc");
  }
} finally {
  if (keychain) {
    try {
      run("security", ["delete-keychain", keychain]);
    } catch {
      // the runner is thrown away anyway
    }
  }
}
