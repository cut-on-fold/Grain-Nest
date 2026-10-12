/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// Round 8 / phase-r8a: choose which pieces go
// into a nest without deleting the rest.
//   1. The cut-code classifier sorts real piece names into nest jobs
//      by the cut-code rules (same M and I count = Fused; fewer I = Main + the I cut
//      separately in Interfacing; INT pieces = Interfacing; L / R codes).
//   2. In the app: the "Nest for" picker ticks exactly that job's pieces,
//      the per-row tick box and Bulk Exclude change it by hand, "Hide
//      excluded" hides unticked rows (Select all then covers only visible
//      rows), a real nest never places an excluded piece, and the ticks and
//      the picker position survive Save / Open project.
// Run locally with CI=1 (video recording freezes the renderer timers).

import { _electron as electron, expect, test } from "@playwright/test";
import { setAskBeforeLeaving, setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { jobsForName, parseCutCodes } from "../main/ui/utils/nest-jobs";

test("cut codes sort real piece names into the nest jobs", () => {
  const jobs = (n: string) => [...jobsForName(n)].sort().join(",");
  // Piece names as a real pattern exports them for nesting.
  expect(jobs("1 Upper Front C2M")).toBe("main");
  expect(jobs("2 Upper Back C1MOF")).toBe("main");
  expect(jobs("16 Hood Facing C2M C2I")).toBe("fused");
  expect(jobs("22 Back Neckline Facing C1MOF C1IOF")).toBe("fused");
  expect(jobs("6 Brim C2M C1I")).toBe("interfacing,main");
  expect(jobs("24 Zipper Flap C2M C1I")).toBe("interfacing,main");
  expect(jobs("INT1 Pocket Interfacing C2I")).toBe("interfacing");
  expect(jobs("INT 2 Back Vent")).toBe("interfacing");
  expect(jobs("9L Outer Hood Lining C2L")).toBe("lining");
  expect(jobs("8 Cuff C2R")).toBe("ribbing");
  expect(jobs("20 Dress Back Band C1ROF")).toBe("ribbing");
  // No / unknown codes belong to no job (only "All" includes them).
  expect(jobs("Front")).toBe("");
  expect(jobs("3 Collar C2C")).toBe("");
  // Codes must be whole tokens: "CC2M" or "ABC2M" aren't cut codes.
  expect(parseCutCodes("ABC2M")).toEqual({});
  expect(parseCutCodes("6 Brim C2M C1I")).toEqual({ M: 2, I: 1 });
});

test("nest jobs include/exclude pieces, nest skips excluded, survive save/load", async ({}, testInfo) => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({ args: ["main.js"] });
  const mainWindow = await electronApp.firstWindow();
  // Written for Quantity and Mirror copy by hand (v1.9.0).
  await setCutCodes(mainWindow, false);
  // Goes Back without saving layouts (v1.10.0).
  await setAskBeforeLeaving(mainWindow, false);

  const svg = path.resolve(__dirname, "assets", "synthetic-grain.svg");
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [p],
      canceled: false,
    });
  }, svg);
  await mainWindow.click("id=import");
  const rows = mainWindow.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 15000 });

  type P = {
    name?: string;
    sheet?: boolean;
    excluded?: boolean;
    selected?: boolean;
  };
  type DN = {
    parts: P[];
    mirrorCopyPart(i: number): number;
    importsvg(
      a: string | null,
      b: null,
      svg: string,
      c: null,
      d: boolean,
    ): void;
  };
  const state = () =>
    mainWindow.evaluate(() => {
      const dn = (window as unknown as { DeepNest: DN }).DeepNest;
      return dn.parts.map((p) => ({
        name: p.name,
        sheet: !!p.sheet,
        excluded: !!p.excluded,
      }));
    });

  // Name the pieces with real cut codes, mirror-copy the Front (a
  // "cut 2" piece is piece + mirror copy), and add a large fabric sheet.
  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.parts[0].name = "1 Front C2M";
    dn.parts[1].name = "16 Hood Facing C2M C2I";
    dn.parts[2].name = "6 Brim C2M C1I";
    dn.mirrorCopyPart(0); // index 3, inherits the name
    dn.importsvg(
      null,
      null,
      '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect x="0" y="0" width="3000" height="2000"/></svg>',
      null,
      false,
    );
    dn.parts[4].sheet = true;
  });
  // Nudge Ractive to re-render after the out-of-band mutations.
  await mainWindow.selectOption("#nestjob", "all");
  await expect(rows).toHaveCount(5);

  // ---- "Nest for: Main fabric": Front + its copy + Brim; the fused Hood
  // Facing is left out but stays in the list, greyed.
  await mainWindow.selectOption("#nestjob", "main");
  let s = await state();
  expect(s.map((p) => p.excluded)).toEqual([false, true, false, false, false]);
  await expect(mainWindow.locator("#partslist tbody tr.excluded")).toHaveCount(
    1,
  );
  await expect(mainWindow.locator("#toggleexcluded")).toHaveText(
    "Hide excluded (1)",
  );

  // ---- Fused job: only the Hood Facing. Interfacing job: only the Brim.
  await mainWindow.selectOption("#nestjob", "fused");
  s = await state();
  expect(s.map((p) => p.excluded)).toEqual([true, false, true, true, false]);
  await mainWindow.selectOption("#nestjob", "interfacing");
  s = await state();
  expect(s.map((p) => p.excluded)).toEqual([true, true, false, true, false]);

  // ---- Back to Main, hide excluded: the Hood Facing row disappears.
  await mainWindow.selectOption("#nestjob", "main");
  await mainWindow.click("#toggleexcluded");
  await expect(mainWindow.locator("#toggleexcluded")).toHaveText(
    "Show excluded (1)",
  );
  await expect(rows).toHaveCount(4);

  // ---- Untick the Brim by hand (2nd visible row — the Hood Facing row is
  // hidden, so visible rows are Front, Brim, Front copy, sheet): it hides too.
  // (plain click: the row hides itself the moment it is unticked)
  await rows.nth(1).locator("input.includetoggle").click();
  s = await state();
  expect(s[2].excluded, "Brim unticked").toBe(true);
  await expect(rows).toHaveCount(3);
  await expect(mainWindow.locator("#toggleexcluded")).toHaveText(
    "Show excluded (2)",
  );

  // ---- A real nest places only the included pieces (Front + copy).
  await mainWindow.click("id=startnest");
  let placedSources: number[] = [];
  for (let tick = 0; tick < 15 && placedSources.length < 2; tick++) {
    await mainWindow.waitForTimeout(3000);
    placedSources = await mainWindow.evaluate(() => {
      type N = {
        placements: { sheetplacements: { source: number }[] }[];
      };
      const dn = (window as unknown as { DeepNest: { nests: N[] } }).DeepNest;
      const best = dn.nests[0];
      if (!best) return [];
      return best.placements.flatMap((sg) =>
        sg.sheetplacements.map((pl) => pl.source),
      );
    });
  }
  await mainWindow.click("id=stopnest").catch(() => {});
  await testInfo.attach("placed-sources.json", {
    body: JSON.stringify({ placedSources, state: await state() }, null, 2),
    contentType: "application/json",
  });
  expect(
    placedSources.sort(),
    "only Front (0) and its copy (3) placed",
  ).toEqual([0, 3]);
  // "parts placed" counts included pieces only: 2/2, not 2/4.
  await expect(
    mainWindow.locator("#nestinfo .group").nth(1).locator("h1"),
  ).toHaveText("2/2", { timeout: 10000 });

  // Back to the parts list for the rest.
  await mainWindow.click("id=back");

  // ---- Save, then reopen: ticks and the picker position come back.
  const savedPath = path.join(os.tmpdir(), "grainnest-r8a-test.gnp");
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
    nestJob?: string;
    parts: { excluded?: boolean; sheet: boolean }[];
  };
  expect(saved.nestJob).toBe("main");
  expect(saved.parts.map((p) => !!p.excluded)).toEqual([
    false,
    true,
    true,
    false,
    false,
  ]);

  // Change things, then load the saved file over them.
  await mainWindow.selectOption("#nestjob", "all");
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [p];
  }, savedPath);
  await mainWindow.click("id=openproject");
  await expect
    .poll(async () => (await state()).map((p) => p.excluded), {
      timeout: 15000,
    })
    .toEqual([false, true, true, false, false]);
  await expect(mainWindow.locator("#nestjob")).toHaveValue("main");

  // ---- Bulk: with excluded rows hidden, Select all + Exclude touches only
  // the visible pieces; then Start nest refuses with nothing included.
  if (
    (await mainWindow.locator("#toggleexcluded").textContent())?.startsWith(
      "Hide",
    )
  ) {
    await mainWindow.click("#toggleexcluded");
  }
  await mainWindow.click("id=selectall");
  await mainWindow.click("#partstools >> text=Exclude");
  s = await state();
  expect(
    s.filter((p) => !p.sheet).every((p) => p.excluded),
    "every piece excluded",
  ).toBe(true);
  expect(s.find((p) => p.sheet)!.excluded, "sheet never excluded").toBe(false);
  await mainWindow.click("id=startnest");
  await expect(mainWindow.locator("#messagecontent")).toContainText(
    "No pieces are included",
  );

  await setCutCodes(mainWindow, true);

  await setAskBeforeLeaving(mainWindow, true);

  await electronApp.close();
});
