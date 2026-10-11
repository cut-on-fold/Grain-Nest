/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// v1.2.0: named sheets chosen by "Nest for".
//   - Sheets get a name, a Fabric drop-down and a Nest tick box. Design
//     choices: a drop-down (not a word in the name); one job can use several
//     sheets; Fused has its own sheet.
//   - "Nest for <job>" ticks every sheet whose Fabric is that job and
//     unticks the rest; a job no sheet is set to leaves the sheet ticks
//     alone (and says so). A real nest only uses the ticked sheets.
//   - Name, fabric and tick survive Save / Open.
//   - Clicking a row's action buttons doesn't select the row.
// Run locally with CI=1 (video recording freezes the renderer timers).

import { _electron as electron, expect, test } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

type P = {
  name?: string;
  sheet?: boolean;
  excluded?: boolean;
  selected?: boolean;
  fabric?: string;
};
type DN = {
  parts: P[];
  nests: { placements: { sheet: number }[] }[];
  importsvg(a: null, b: null, svg: string, c: null, d: boolean): P[];
};

test("sheets: name, fabric, Nest for picks them, nest uses only ticked ones", async ({}, testInfo) => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Written for Quantity and Mirror copy by hand (v1.9.0).
  await setCutCodes(mainWindow, false);
  await electronApp.evaluate(
    ({ dialog }, p) => {
      dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
        filePaths: [p],
        canceled: false,
      });
    },
    path.resolve(__dirname, "assets", "synthetic-grain.svg"),
  );
  await mainWindow.click("id=import");
  const rows = mainWindow.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 15000 });

  // Pieces: one main, one lining, one fused.
  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.parts[0].name = "1 Front C2M";
    dn.parts[1].name = "11 Front Lining C2L";
    dn.parts[2].name = "16 Hood Facing C2M C2I";
  });

  // ---- Row action buttons don't select the row.
  await rows
    .nth(0)
    .locator("td.rowactions a", { hasText: "Mirror copy" })
    .click();
  await expect(rows).toHaveCount(4);
  const anySelected = await mainWindow.evaluate(() =>
    (window as unknown as { DeepNest: DN }).DeepNest.parts.some(
      (p) => p.selected,
    ),
  );
  expect(anySelected, "action buttons don't select their row").toBe(false);

  // ---- Add a sheet with the pop-up, naming it and choosing its fabric.
  await mainWindow.click("id=addsheet");
  await mainWindow.fill("#sheetname", "Navy twill");
  await mainWindow.selectOption("#sheetfabric", "main");
  await mainWindow.fill("#sheetwidth", "1500");
  await mainWindow.fill("#sheetheight", "1000");
  await mainWindow.click("id=confirmsheet");
  await expect(rows).toHaveCount(5);

  // Two lining sheets and one unassigned, set up from the table.
  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    for (let k = 0; k < 3; k++) {
      dn.importsvg(
        null,
        null,
        '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000"><rect x="0" y="0" width="1500" height="1000"/></svg>',
        null,
        false,
      );
      dn.parts[dn.parts.length - 1].sheet = true;
    }
  });
  await mainWindow.selectOption("#nestjob", "all"); // nudge a re-render
  await expect(rows).toHaveCount(8);
  // Sheets are rows 4..7; the sheet rows show a Fabric drop-down.
  await rows.nth(5).locator("input.partname").fill("Lining A");
  await rows.nth(5).locator("select.sheetfabric").selectOption("lining");
  await rows.nth(6).locator("input.partname").fill("Lining B");
  await rows.nth(6).locator("select.sheetfabric").selectOption("lining");

  const sheets = () =>
    mainWindow.evaluate(() =>
      (window as unknown as { DeepNest: DN }).DeepNest.parts
        .filter((p) => p.sheet)
        .map((p) => ({
          name: p.name ?? "",
          fabric: p.fabric ?? "",
          on: !p.excluded,
        })),
    );
  expect(await sheets()).toEqual([
    { name: "Navy twill", fabric: "main", on: true },
    { name: "Lining A", fabric: "lining", on: true },
    { name: "Lining B", fabric: "lining", on: true },
    { name: "", fabric: "", on: true },
  ]);

  // ---- Nest for Lining: both lining sheets ticked, the rest unticked.
  await mainWindow.selectOption("#nestjob", "lining");
  expect((await sheets()).map((s) => s.on)).toEqual([false, true, true, false]);
  await expect(mainWindow.locator("#messagecontent")).toContainText(
    "on 2 sheet(s)",
  );
  // Nest for Main: only the main sheet.
  await mainWindow.selectOption("#nestjob", "main");
  expect((await sheets()).map((s) => s.on)).toEqual([
    true,
    false,
    false,
    false,
  ]);
  // Nest for Fused: no sheet is set to Fused, so the ticks stay as they were.
  await mainWindow.selectOption("#nestjob", "fused");
  expect((await sheets()).map((s) => s.on)).toEqual([
    true,
    false,
    false,
    false,
  ]);
  await expect(mainWindow.locator("#messagecontent")).toContainText(
    "No sheet's Fabric is set to fused",
  );

  // ---- A real nest for Lining uses only the lining sheets.
  await mainWindow.selectOption("#nestjob", "lining");
  await mainWindow.click("id=startnest");
  let used: number[] = [];
  for (let tick = 0; tick < 15 && used.length === 0; tick++) {
    await mainWindow.waitForTimeout(2000);
    used = await mainWindow.evaluate(() => {
      const dn = (window as unknown as { DeepNest: DN }).DeepNest;
      const best = dn.nests[0];
      return best ? best.placements.map((pl) => pl.sheet) : [];
    });
  }
  await mainWindow.click("id=stopnest").catch(() => {});
  await testInfo.attach("used-sheets.json", {
    body: JSON.stringify(used),
    contentType: "application/json",
  });
  expect(used.length).toBeGreaterThan(0);
  const liningIdx = await mainWindow.evaluate(() =>
    (window as unknown as { DeepNest: DN }).DeepNest.parts
      .map((p, i) => (p.sheet && p.fabric === "lining" ? i : -1))
      .filter((i) => i >= 0),
  );
  for (const s of used) expect(liningIdx).toContain(s);
  await mainWindow.click("id=back");

  // ---- Untick every sheet: Start nest refuses.
  for (const r of [4, 5, 6, 7]) {
    const box = rows.nth(r).locator("input.includetoggle");
    if (await box.isChecked()) await box.click();
  }
  await mainWindow.click("id=startnest");
  await expect(mainWindow.locator("#messagecontent")).toContainText(
    "No sheets are ticked",
  );

  // ---- Save, scramble, reopen: names, fabrics and ticks come back.
  await rows.nth(5).locator("input.includetoggle").click(); // Lining A on
  const before = await sheets();
  const savedPath = path.join(os.tmpdir(), "grainnest-v120-sheets.gnp");
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
    dn.parts.forEach((p) => {
      if (p.sheet) {
        p.fabric = "";
        p.name = "x";
        p.excluded = false;
      }
    });
  });
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [p];
  }, savedPath);
  await mainWindow.click("id=openproject");
  await expect.poll(sheets, { timeout: 15000 }).toEqual(before);

  await setCutCodes(mainWindow, true);

  await electronApp.close();
});
