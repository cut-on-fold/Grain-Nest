// v1.13.1: hides as they really arrive. A flaw drawn with Inkscape's circle,
// ellipse or rectangle tool (or grouped, named only by its label, or not
// joined up) is still a flaw, and hidden shapes are left out, so a sheet
// file with a hidden reference outline nests on the sheet. Run locally with
// CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import {
  appReady,
  setAskBeforeLeaving,
  setCutCodes,
} from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import path from "path";

type Pt = { x: number; y: number };
type P = {
  name?: string;
  sheet?: boolean;
  polygontree: Pt[];
  fileFlaws?: Pt[][];
};
type DN = {
  parts: P[];
  nests: unknown[];
  sheetWithFlaws: (p: P) => Pt[] & { children?: Pt[][] };
};

const asset = (name: string) => path.resolve(__dirname, "assets", name);

test("Flaws drawn as a circle, ellipse, rectangle, group or open path", async () => {
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  const page = await app.firstWindow();
  await appReady(page);
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [f],
      canceled: false,
    });
  }, asset("synthetic-flaw-shapes.svg"));
  await page.click("id=import");
  const rows = page.locator("#partslist tbody tr");
  // One shape: the sheet. None of the flaws is a piece, and the hidden
  // circle isn't there at all.
  await expect(rows).toHaveCount(1, { timeout: 20000 });
  const got = await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    return {
      name: d.parts[0].name,
      flaws: (d.parts[0].fileFlaws || []).length,
    };
  });
  expect(got).toEqual({ name: "sheet", flaws: 6 });

  await rows
    .nth(0)
    .locator("td")
    .nth(4)
    .locator("input[type=checkbox]")
    .check();
  await expect(rows.nth(0).locator(".flawsbtn")).toContainText("(6)");
  await app.close();
});

test("A sheet file with a hidden reference outline round the sheet", async () => {
  test.setTimeout(240000);
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  const page = await app.firstWindow();
  await appReady(page);
  await setCutCodes(page, false);
  await setAskBeforeLeaving(page, false);
  const files = [
    asset("synthetic-traced-hide.svg"),
    path.resolve(__dirname, "..", "examples", "example-pattern.svg"),
  ];
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: f,
      canceled: false,
    });
  }, files);
  await page.click("id=import");
  const rows = page.locator("#partslist tbody tr");
  // The hide and the pattern's 11 pieces: the hidden hide-edge isn't one.
  await expect(rows).toHaveCount(12, { timeout: 20000 });

  const hide = await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const i = d.parts.findIndex((p) => p.name === "sheet");
    const p = d.parts[i];
    return {
      i,
      points: p.polygontree.length,
      flaws: (p.fileFlaws || []).length,
      // The outline used for nesting is the one drawn, point for point.
      nestPoints: d.sheetWithFlaws(p).length,
    };
  });
  expect(hide.i).toBeGreaterThanOrEqual(0);
  expect(hide.flaws).toBe(1);
  expect(hide.points).toBe(150);
  expect(hide.nestPoints).toBe(150);

  await rows
    .nth(hide.i)
    .locator("td")
    .nth(4)
    .locator("input[type=checkbox]")
    .check();
  await page.click("id=startnest");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { DeepNest: DN }).DeepNest.nests.length,
        ),
      { timeout: 25000, intervals: [1000] },
    )
    .toBeGreaterThan(0);
  await page.click("id=stopnest");
  await expect(page.locator("#nestinfo")).toContainText(
    /used of [\d.]+ (m²|sq ft)/,
  );

  await page.click("id=back");
  await page.waitForTimeout(2500);
  await setCutCodes(page, true);
  await setAskBeforeLeaving(page, true);
  await app.close();
});
