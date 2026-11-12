/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// v1.3.0 (settings review):
//   - Settings keeps only what dressmaking needs; technical ones fold under
//     "Advanced"; laser options and every mention of lasers are gone, and
//     nests are scored on fabric only.
//   - SVG-only import (other formats used to be uploaded to Deepnest's
//     conversion website).
//   - Woven / Knit project switch: new pieces get 12 / 10 mm seams;
//     switching moves pieces still on the old default, leaves hand-set ones.
//   - Add a sheet: picking Interfacing or Fused fills in the 90 cm preset.
//   - Grain-Nest's own "new version" check compares versions correctly.
// Run locally with CI=1 (video recording freezes the renderer timers).

import { _electron as electron, expect, test } from "@playwright/test";
import { setAskBeforeReplacing } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { compareVersions } = require("../notification-service.js") as {
  compareVersions: (a: string, b: string) => number;
};

test("Grain-Nest update check compares versions", () => {
  expect(compareVersions("v1.3.0", "1.2.9")).toBeGreaterThan(0);
  expect(compareVersions("v1.10.0", "1.9.9")).toBeGreaterThan(0);
  expect(compareVersions("v1.3.0", "1.3.0")).toBe(0);
  expect(compareVersions("v1.2.0", "1.3.0")).toBeLessThan(0);
});

type P = { name?: string; sheet?: boolean; seamAllowance?: number };
type DN = { parts: P[]; fabricType: string; config(): Record<string, unknown> };

test("settings tidy-up, SVG-only import, woven/knit seams, 90 cm preset", async () => {
  test.setTimeout(120000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Opens its project over changes it hasn't saved: no save question.
  await setAskBeforeReplacing(mainWindow, false);
  await mainWindow.waitForSelector("#import");

  // ---- Settings page: removed settings gone, Advanced fold, new settings.
  const settings = await mainWindow.evaluate(() => {
    const form = document.getElementById("configform")!;
    const keys = Array.from(form.querySelectorAll("[data-config]")).map((el) =>
      el.getAttribute("data-config"),
    );
    const advanced = Array.from(
      form.querySelectorAll("details.advanced [data-config]"),
    ).map((el) => el.getAttribute("data-config"));
    return {
      keys,
      advanced,
      laser: /laser/i.test(document.body.innerText + form.innerHTML),
      explainPanels: Array.from(
        document.querySelectorAll(".config_explain"),
      ).map((el) => el.id),
    };
  });
  for (const gone of [
    "simplify",
    "threads",
    "useSvgPreProcessor",
    "dxfImportScale",
    "dxfExportScale",
    "mergeLines",
    "timeRatio",
    "useQuantityFromFileName",
  ]) {
    expect(settings.keys, `${gone} removed`).not.toContain(gone);
  }
  expect(settings.advanced.sort()).toEqual(
    [
      "curveTolerance",
      "endpointTolerance",
      "mutationRate",
      "populationSize",
      "rotations",
      "scale",
    ].sort(),
  );
  for (const kept of [
    "units",
    "spacing",
    "placementType",
    "defaultSeamAllowanceMm",
    "defaultSeamAllowanceKnitMm",
    "exportWithSheetBoundboarders",
    "exportScalingBox",
    "exportScalingBoxSizeInches",
  ]) {
    expect(settings.keys, `${kept} present`).toContain(kept);
  }
  expect(settings.laser, "no mention of lasers anywhere").toBe(false);
  expect(settings.explainPanels).not.toContain("explain_timeRatio");
  await expect(mainWindow.locator("#presetSelect")).toHaveCount(0);
  await expect(mainWindow.locator("#exportdxf, #exportjson")).toHaveCount(0);

  // Fabric-only scoring, and the sheet border on by default.
  const cfg = await mainWindow.evaluate(() => ({
    ui: (
      window as unknown as { config: { getSync(): Record<string, unknown> } }
    ).config.getSync(),
    engine: (window as unknown as { DeepNest: DN }).DeepNest.config(),
  }));
  expect(cfg.ui).toMatchObject({
    mergeLines: false,
    timeRatio: 0,
    exportWithSheetBoundboarders: true,
    defaultSeamAllowanceMm: 12,
    defaultSeamAllowanceKnitMm: 10,
  });
  expect(cfg.engine).toMatchObject({ mergeLines: false, timeRatio: 0 });

  // Inch-stored settings show in the display units (4 in = 101.6 mm) and
  // save back in inches.
  await mainWindow.click("#config_tab");
  const unitsNow = (cfg.ui as { units: string }).units;
  await expect(mainWindow.locator("#exportScalingBoxSize")).toHaveValue(
    unitsNow === "mm" ? "101.6" : "4",
  );
  await mainWindow.fill(
    "#exportScalingBoxSize",
    unitsNow === "mm" ? "127" : "5",
  );
  await mainWindow.locator("#exportScalingBoxSize").blur();
  await expect
    .poll(() =>
      mainWindow.evaluate(() =>
        (
          window as unknown as { config: { getSync(k: string): number } }
        ).config.getSync("exportScalingBoxSizeInches"),
      ),
    )
    .toBeCloseTo(5, 3);
  await mainWindow.fill(
    "#exportScalingBoxSize",
    unitsNow === "mm" ? "101.6" : "4",
  );
  await mainWindow.locator("#exportScalingBoxSize").blur();
  await mainWindow.click("#home_tab");

  // ---- SVG-only import: anything else is refused with a message.
  await electronApp.evaluate(
    ({ dialog }, p) => {
      dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
        filePaths: [p],
        canceled: false,
      });
    },
    path.resolve(__dirname, "assets", "not-svg.dxf"),
  );
  await mainWindow.click("id=import");
  await expect(mainWindow.locator("#messagecontent")).toContainText(
    "SVG files only",
  );
  await expect(mainWindow.locator("#partslist tbody tr")).toHaveCount(0);

  // ---- Woven / Knit.
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
  const seams = () =>
    mainWindow.evaluate(() =>
      (window as unknown as { DeepNest: DN }).DeepNest.parts
        .filter((p) => !p.sheet)
        .map((p) => p.seamAllowance),
    );
  expect(await seams()).toEqual([12, 12, 12]);
  // A hand-set seam on the third piece.
  await rows.nth(2).locator("input.seamallowance").fill("15");
  await rows.nth(2).locator("input.seamallowance").blur();
  await mainWindow.selectOption("#fabrictype", "knit");
  expect(await seams()).toEqual([10, 10, 15]);
  await expect(mainWindow.locator("#messagecontent")).toContainText(
    "Knit project",
  );
  // New pieces in a knit project get 10 mm.
  await mainWindow.click("id=import");
  await expect(rows).toHaveCount(6, { timeout: 15000 });
  expect(await seams()).toEqual([10, 10, 15, 10, 10, 10]);

  // Saved with the project.
  const savedPath = path.join(os.tmpdir(), "grainnest-v130.gnp");
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
  expect(JSON.parse(fs.readFileSync(savedPath, "utf8")).fabricType).toBe(
    "knit",
  );
  await mainWindow.selectOption("#fabrictype", "woven");
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [p];
  }, savedPath);
  await mainWindow.click("id=openproject");
  await expect(mainWindow.locator("#fabrictype")).toHaveValue("knit");
  await expect
    .poll(seams, { timeout: 15000 })
    .toEqual([10, 10, 15, 10, 10, 10]);

  // ---- Add a sheet: Interfacing fills in the 90 cm preset.
  await mainWindow.click("id=addsheet");
  await mainWindow.selectOption("#sheetfabric", "interfacing");
  await expect(mainWindow.locator("#sheetpreset")).toHaveValue("90");
  const height = Number(await mainWindow.inputValue("#sheetheight"));
  const units = await mainWindow.evaluate(() =>
    (
      window as unknown as { config: { getSync(k: string): string } }
    ).config.getSync("units"),
  );
  expect(height).toBeCloseTo(units === "mm" ? 900 : 900 / 25.4, 1); // 90 cm
  // Another preset already chosen is left alone.
  await mainWindow.selectOption("#sheetpreset", "147");
  await mainWindow.selectOption("#sheetfabric", "fused");
  await expect(mainWindow.locator("#sheetpreset")).toHaveValue("147");
  await mainWindow.click("id=cancelsheet");

  await setAskBeforeReplacing(mainWindow, true);
  await electronApp.close();
});
