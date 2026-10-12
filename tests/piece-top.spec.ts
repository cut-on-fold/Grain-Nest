/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// Phase R8-C: which end of a piece is its top.
//
// The fixture has five "house" pieces whose apex is the top of the piece,
// laid out like a PDF pattern: A upright, B upside down, C tilted 60°,
// D on its side (apex left), E on its other side (apex right, grain line
// drawn the other way). Lock to grain must place every piece with its top
// towards the LEFT of the sheet (the start of the fabric), once the two
// wrong guesses (B, E) are flipped with the per-row "Flip top" link and Bulk
// Apply. Mirroring (in place and as a copy, including the horizontal-grain
// case) must keep the same physical top, and the tops survive Save / Open.
// Run locally with CI=1 (video recording freezes the renderer timers).

import { _electron as electron, expect, test } from "@playwright/test";
import { setAskBeforeLeaving, setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

type Pt = { x: number; y: number };
type P = {
  name?: string;
  sheet?: boolean;
  selected?: boolean;
  grainAngle?: number;
  topFlip?: boolean;
  mirror?: boolean;
  polygontree: Pt[];
};
type DN = {
  parts: P[];
  nests: {
    placements: {
      sheetplacements: { source: number; rotation: number }[];
    }[];
  }[];
  mirrorPart(i: number): void;
  mirrorCopyPart(i: number): number;
  importsvg(a: null, b: null, svg: string, c: null, d: boolean): void;
};

test("Flip top sets which end of a piece leads in the nest", async ({}, testInfo) => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Written for Quantity and Mirror copy by hand (v1.9.0).
  await setCutCodes(mainWindow, false);
  // Goes Back without saving layouts (v1.10.0).
  await setAskBeforeLeaving(mainWindow, false);

  const svg = path.resolve(__dirname, "assets", "synthetic-top.svg");
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [p],
      canceled: false,
    });
  }, svg);
  await mainWindow.click("id=import");
  const rows = mainWindow.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(5, { timeout: 15000 });

  const state = () =>
    mainWindow.evaluate(() => {
      const dn = (window as unknown as { DeepNest: DN }).DeepNest;
      return dn.parts.map((p) => ({
        name: p.name,
        sheet: !!p.sheet,
        grainAngle: p.grainAngle,
        topFlip: !!p.topFlip,
        mirror: !!p.mirror,
      }));
    });

  // Every piece's grain was detected, and the parts list shows the flip
  // link and a top arrow for each.
  let s = await state();
  expect(s.map((p) => p.name)).toEqual([
    "A Upright",
    "B Upside down",
    "C Tilted",
    "D Sideways",
    "E Sideways reversed grain",
  ]);
  expect(s.every((p) => typeof p.grainAngle === "number")).toBe(true);
  expect(s.every((p) => !p.topFlip)).toBe(true);
  await expect(mainWindow.locator("#partslist a.fliptop")).toHaveCount(5);
  await expect(mainWindow.locator("#partslist svg .toparrow")).toHaveCount(5);
  // B is drawn as it lies on the page (grain vertical, no turn) — upside down.
  await expect(rows.nth(1).locator("svg > g").first()).not.toHaveAttribute(
    "transform",
    /rotate/,
  );

  // ---- B: the per-row link. The thumbnail turns to stand it upright.
  await rows.nth(1).locator("a.fliptop").click();
  await expect(rows.nth(1).locator("svg > g").first()).toHaveAttribute(
    "transform",
    "rotate(180)",
  );
  // ---- E: Bulk Apply.
  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.parts.forEach((p, i) => (p.selected = i === 4));
  });
  await mainWindow.click("#partstools >> text=Flip top");
  s = await state();
  expect(s.map((p) => p.topFlip)).toEqual([false, true, false, false, true]);

  // ---- Mirroring keeps the physical top: C mirrored in place (slanted
  // grain), D mirror-copied (horizontal grain — the case where the folded
  // angle swaps ends). Then a big sheet.
  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.parts.forEach((p) => (p.selected = false));
    dn.mirrorPart(2);
    dn.mirrorCopyPart(3); // index 5
    dn.importsvg(
      null,
      null,
      '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect x="0" y="0" width="3000" height="2000"/></svg>',
      null,
      false,
    );
    dn.parts[6].sheet = true;
  });
  await mainWindow.selectOption("#nestjob", "all"); // nudge a re-render
  await expect(rows).toHaveCount(7);
  s = await state();
  expect(s[5].topFlip, "mirror copy of a horizontal-grain piece").toBe(true);

  // ---- A real nest: every piece's apex (its top) is its leftmost point.
  await mainWindow.click("id=startnest");
  type Placed = { source: number; apexLeftBy: number };
  let placed: Placed[] = [];
  for (let tick = 0; tick < 20 && placed.length < 6; tick++) {
    await mainWindow.waitForTimeout(3000);
    placed = await mainWindow.evaluate(() => {
      const dn = (window as unknown as { DeepNest: DN }).DeepNest;
      const best = dn.nests[0];
      if (!best) return [];
      return best.placements.flatMap((sg) =>
        sg.sheetplacements.map((pl) => {
          const poly = dn.parts[pl.source].polygontree;
          // The apex is the vertex farthest from the vertices' average.
          const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length;
          const cy = poly.reduce((a, p) => a + p.y, 0) / poly.length;
          let apex = poly[0];
          let far = -1;
          for (const p of poly) {
            const d = Math.hypot(p.x - cx, p.y - cy);
            if (d > far) {
              far = d;
              apex = p;
            }
          }
          const r = (pl.rotation * Math.PI) / 180;
          const rx = (p: { x: number; y: number }) =>
            p.x * Math.cos(r) - p.y * Math.sin(r);
          const others = poly.filter((p) => p !== apex).map(rx);
          return {
            source: pl.source,
            apexLeftBy: Math.min(...others) - rx(apex),
          };
        }),
      );
    });
  }
  await mainWindow.click("id=stopnest").catch(() => {});
  await testInfo.attach("placed.json", {
    body: JSON.stringify({ placed, state: s }, null, 2),
    contentType: "application/json",
  });
  expect(placed.map((p) => p.source).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  for (const p of placed) {
    expect(
      p.apexLeftBy,
      `${s[p.source].name}${p.source === 5 ? " (copy)" : ""}: top leads (leftmost)`,
    ).toBeGreaterThan(20);
  }
  await mainWindow.click("id=back");

  // ---- Save, scramble, reopen: tops and (mirrored) grain angles return.
  const before = await state();
  const savedPath = path.join(os.tmpdir(), "grainnest-r8c-test.gnp");
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
  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.parts.forEach((p) => (p.topFlip = false));
  });
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [p];
  }, savedPath);
  await mainWindow.click("id=openproject");
  await expect
    .poll(async () => (await state()).map((p) => p.topFlip), {
      timeout: 15000,
    })
    .toEqual(before.map((p) => p.topFlip));
  const after = await state();
  for (let i = 0; i < before.length; i++) {
    if (before[i].sheet) continue;
    expect(after[i].mirror, `${before[i].name} mirror`).toBe(before[i].mirror);
    expect(after[i].grainAngle, `${before[i].name} grain angle`).toBeCloseTo(
      before[i].grainAngle as number,
      6,
    );
  }

  await setCutCodes(mainWindow, true);

  await setAskBeforeLeaving(mainWindow, true);

  await electronApp.close();
});
