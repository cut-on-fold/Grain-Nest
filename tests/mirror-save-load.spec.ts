/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// Regression test for §9.0.1 R6-B + R6-D.
//
// R6-B: bulk-made mirror copies must SAVE pointing at their true source —
// the old filename-recency guess collapsed every copy onto the last
// original (testing round 6: all 11 copies in a real .gnp said ofPartIndex 14).
// The loader must also RESCUE files already saved that way, by rewiring a
// copy to the unique non-mirror part carrying its (inherited) name.
// R6-D: a mirror copy inherits its source's seam allowance.

import { _electron as electron, expect, test } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

test("bulk mirror copies save exact source links; corrupted files rescue by name", async ({}, testInfo) => {
  const electronApp = await electron.launch({
    args: ["main.js"],
  });

  const mainWindow = await electronApp.firstWindow();

  // Written for Quantity and Mirror copy by hand (v1.9.0).

  await setCutCodes(mainWindow, false);

  const inputDir = path.resolve(__dirname, "assets");
  const files = [path.resolve(inputDir, "synthetic-grain.svg")];

  await electronApp.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: paths,
      canceled: false,
    });
  }, files);

  await mainWindow.click("id=import");
  await expect(mainWindow.locator("#partslist tbody tr")).toHaveCount(3, {
    timeout: 15000,
  });

  // Name the three originals, set a seam allowance on #0, then bulk-copy
  // #0 and #1 — both copies append AFTER all originals (the real pattern).
  const setup = await mainWindow.evaluate(() => {
    type P = {
      name?: string;
      sheet?: boolean;
      seamAllowance?: number;
      grainAngle?: number;
      isMirrorCopy?: boolean;
      mirrorOfId?: number;
      grainnestId?: number;
    };
    const dn = (
      window as unknown as {
        DeepNest: { parts: P[]; mirrorCopyPart(i: number): number };
      }
    ).DeepNest;
    dn.parts[0].name = "Front";
    dn.parts[1].name = "Pocket";
    dn.parts[2].name = "Backing";
    // Distinct custom allowances (imports default to 12 mm, so equality
    // with the default would prove nothing).
    dn.parts[0].seamAllowance = 7;
    dn.parts[1].seamAllowance = 3;
    const c0 = dn.mirrorCopyPart(0);
    const c1 = dn.mirrorCopyPart(1);
    return {
      copy0: {
        idx: c0,
        name: dn.parts[c0].name,
        seam: dn.parts[c0].seamAllowance,
        mirrorOfId: dn.parts[c0].mirrorOfId,
      },
      copy1: {
        idx: c1,
        name: dn.parts[c1].name,
        seam: dn.parts[c1].seamAllowance,
        mirrorOfId: dn.parts[c1].mirrorOfId,
      },
      srcIds: [dn.parts[0].grainnestId, dn.parts[1].grainnestId],
      angles: [dn.parts[0].grainAngle, dn.parts[1].grainAngle],
    };
  });

  // R6-D: each copy carries ITS OWN source's seam allowance.
  expect(setup.copy0.seam, "copy inherits source 0's allowance").toBe(7);
  expect(setup.copy1.seam, "copy inherits source 1's allowance").toBe(3);
  // R6-B in-memory link: each copy points at ITS OWN source's id.
  expect(setup.copy0.mirrorOfId).toBe(setup.srcIds[0]);
  expect(setup.copy1.mirrorOfId).toBe(setup.srcIds[1]);

  // ---- Save via the real Save button with a stubbed save dialog.
  const savedPath = path.join(os.tmpdir(), "grainnest-r6b-test.gnp");
  if (fs.existsSync(savedPath)) fs.unlinkSync(savedPath);
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => p;
  }, savedPath);
  await mainWindow.click("id=saveproject");
  await expect
    .poll(() => fs.existsSync(savedPath), { timeout: 5000 })
    .toBe(true);

  const saved = JSON.parse(fs.readFileSync(savedPath, "utf8")) as {
    parts: Array<{
      name?: string;
      source: { kind: string; ofPartIndex?: number };
      seamAllowance?: number;
    }>;
  };
  const savedCopies = saved.parts
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.source.kind === "mirror-copy");
  expect(savedCopies.length, "two mirror-copy entries saved").toBe(2);
  const ofFront = savedCopies.find(({ p }) => p.name === "Front");
  const ofPocket = savedCopies.find(({ p }) => p.name === "Pocket");
  // THE R6-B ASSERTION: distinct, correct sources — not both the last part.
  expect(ofFront!.p.source.ofPartIndex, "Front copy links to part 0").toBe(0);
  expect(ofPocket!.p.source.ofPartIndex, "Pocket copy links to part 1").toBe(1);
  expect(ofFront!.p.seamAllowance, "seam allowance saved on the copy").toBe(7);

  // ---- Corrupt the file the way the old bug did: every copy points at
  // the LAST original (index 2, "Backing"), names kept.
  const corrupted = JSON.parse(fs.readFileSync(savedPath, "utf8"));
  for (const part of corrupted.parts) {
    if (part.source.kind === "mirror-copy") part.source.ofPartIndex = 2;
  }
  const corruptedPath = path.join(os.tmpdir(), "grainnest-r6b-corrupted.gnp");
  fs.writeFileSync(corruptedPath, JSON.stringify(corrupted));

  // ---- Load it via the real Open button with a stubbed open dialog.
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [p];
  }, corruptedPath);
  await mainWindow.click("id=openproject");
  await expect(mainWindow.locator("#partslist tbody tr")).toHaveCount(5, {
    timeout: 15000,
  });

  const restored = await mainWindow.evaluate(() => {
    type P = {
      name?: string;
      isMirrorCopy?: boolean;
      grainAngle?: number;
      seamAllowance?: number;
      mirror?: boolean;
    };
    const dn = (window as unknown as { DeepNest: { parts: P[] } }).DeepNest;
    return dn.parts
      .filter((p) => p.isMirrorCopy)
      .map((p) => ({
        name: p.name,
        grainAngle: p.grainAngle,
        seam: p.seamAllowance,
        mirror: p.mirror,
      }));
  });

  await testInfo.attach("restored-copies.json", {
    body: JSON.stringify({ setup, restored }, null, 2),
    contentType: "application/json",
  });

  expect(restored.length, "both copies restored").toBe(2);
  const front = restored.find((p) => p.name === "Front");
  const pocket = restored.find((p) => p.name === "Pocket");
  expect(front, "rescued copy of Front exists").toBeTruthy();
  expect(pocket, "rescued copy of Pocket exists").toBeTruthy();
  // THE RESCUE ASSERTION: each copy rebuilt from its name-matched original,
  // not from "Backing" (whose mirrored grain angle is 90). Front's grain is
  // 0° (mirrors to 0), Pocket's is 45° (mirrors to 135).
  expect(front!.grainAngle, "Front copy has Front's grain, not Backing's").toBe(
    setup.angles[0],
  );
  expect(
    pocket!.grainAngle,
    "Pocket copy has Pocket's mirrored grain, not Backing's",
  ).toBe(135);
  expect(front!.seam, "seam allowance survives the round-trip").toBe(7);
  expect(front!.mirror, "copy is mirrored").toBe(true);

  await setCutCodes(mainWindow, true);

  await electronApp.close();
});
