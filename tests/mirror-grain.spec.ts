/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// Regression test for §9.3.2.
//
// Guards the engine-state half of the Mirror-copy contract: copying a
// grain-locked piece must reflect its grain angle across the vertical
// axis (θ → 180−θ, folded to [0,180)), keep it Locked, default the new
// part's quantity to 1, and tag it as a mirror copy. This is the state
// the genetic algorithm and all three render paths key off; if the
// reflection is wrong the mirrored piece nests (and draws) with its
// grain off by 2θ — e.g. a 45° grain ends up along the weft.
//
// NOTE: the *render* fix that motivated this round (the nest preview
// was dropping the mirror flip, so a mirror-copy's grain drew along the
// weft even though the engine state was correct) is inherently visual
// and is verified by the manual smoke test in the design note — the
// only test harness here is Electron + Playwright e2e, which can't
// assert "looks flipped on screen" cheaply or run in the dev sandbox
// (renderer subprocesses get reaped — see the Phase 5e note).

import { _electron as electron, expect, test } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import path from "path";

test("mirrorCopyPart reflects the grain angle and locks the copy", async ({}, testInfo) => {
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"], // CI runs non-root: no Electron SUID sandbox
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

  await expect(mainWindow.locator("#parts tbody tr")).toHaveCount(3, {
    timeout: 15000,
  });

  // Mirror-copy the 45° piece. Find it by angle rather than index so the
  // test doesn't care about parts-array ordering, and round to absorb
  // floating-point noise from atan2.
  const result = await mainWindow.evaluate(() => {
    type Part = {
      sheet?: boolean;
      grainRule?: string;
      grainSource?: string;
      grainAngle?: number;
      quantity?: number;
      mirror?: boolean;
      isMirrorCopy?: boolean;
    };
    const dn = (
      window as unknown as {
        DeepNest: { parts: Part[]; mirrorCopyPart: (i: number) => number };
      }
    ).DeepNest;

    const srcIndex = dn.parts.findIndex(
      (p) => !p.sheet && Math.round(p.grainAngle ?? -1) === 45,
    );
    const countBefore = dn.parts.length;
    const newIndex = dn.mirrorCopyPart(srcIndex);
    const copy = dn.parts[newIndex];

    return {
      srcIndex,
      countBefore,
      countAfter: dn.parts.length,
      newIndex,
      copy: {
        grainAngle: copy?.grainAngle,
        grainRule: copy?.grainRule,
        quantity: copy?.quantity,
        mirror: copy?.mirror,
        isMirrorCopy: copy?.isMirrorCopy,
      },
    };
  });

  await testInfo.attach("mirror-copy-result.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });

  expect(result.srcIndex, "a 45° grain piece should exist").toBeGreaterThan(-1);
  expect(result.newIndex, "mirrorCopyPart returns the new index").toBe(
    result.countBefore,
  );
  expect(result.countAfter, "a new part was appended").toBe(
    result.countBefore + 1,
  );

  // The reflection: 180 − 45 = 135, folded into [0, 180).
  expect(
    Math.round(result.copy.grainAngle ?? -1),
    "grain angle reflected across the vertical axis",
  ).toBe(135);
  expect(result.copy.grainRule, "copy stays Locked to grain").toBe("lock");
  expect(result.copy.quantity, "copy quantity defaults to 1").toBe(1);
  expect(result.copy.mirror, "copy is flagged mirrored").toBe(true);
  expect(result.copy.isMirrorCopy, "copy is tagged as a mirror copy").toBe(
    true,
  );

  await setCutCodes(mainWindow, true);

  await electronApp.close();
});
