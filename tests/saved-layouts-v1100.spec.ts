// v1.10.0: saved layouts. Save layout keeps the layout on screen in the
// project; Back asks about an unsaved one and keeps it as "Last nest (not
// saved)"; a saved layout opens straight onto the nest screen, survives
// Save / Open project, and says which pieces changed since. Also the
// "Don't ask again" on the pieces-without-a-code question. Run locally
// with CI=1.

import { _electron as electron, expect, test, Page } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

type DN = {
  parts: {
    name?: string;
    sheet?: boolean;
    excluded?: boolean;
    fabric?: string;
    seamAllowance?: number;
    autoCopy?: boolean;
  }[];
  nests: unknown[];
  importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
};

async function setTick(page: Page, id: string, on: boolean): Promise<void> {
  await page.locator("#config_tab").click();
  await page.locator(`#${id}`).setChecked(on);
  await page.locator("#home_tab").click();
}

async function nestFor(page: Page): Promise<void> {
  await page.click("id=startnest");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { DeepNest: DN }).DeepNest.nests.length,
        ),
      {
        timeout: 120000,
        intervals: [1000],
      },
    )
    .toBeGreaterThan(0);
  await page.click("id=stopnest");
}

test("Save, leave, reopen and reload saved layouts", async () => {
  test.setTimeout(300000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const page = await electronApp.firstWindow();
  await setCutCodes(page, true);
  await setTick(page, "askBeforeLeavingNest", true);
  await setTick(page, "warnUncodedPieces", true);
  const pattern = path.resolve(
    __dirname,
    "..",
    "examples",
    "example-pattern.svg",
  );
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [p],
      canceled: false,
    });
  }, pattern);
  await page.click("id=import");
  await expect(page.locator("#partslist tbody tr")).toHaveCount(11, {
    timeout: 20000,
  });
  await page.selectOption("#nestjob", "main");
  await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const w = (300 / 2.54) * 96;
    const h = 58 * 96;
    d.importsvg(
      null,
      null,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}"/></svg>`,
      null,
      false,
    );
    const s = d.parts[d.parts.length - 1];
    s.sheet = true;
    s.excluded = false;
    s.fabric = "main";
    s.name = "Navy twill";
  });
  await expect(page.locator("#layoutspanel")).toHaveCount(0);

  // Nest, Save layout: the name is the sheet's name and width.
  await nestFor(page);
  await page.click("id=savelayout");
  const modal = page.locator(".gn-modal");
  // Units are shared between test runs: inches or cm.
  await expect(modal.locator("input.gn-modal-input")).toHaveValue(
    /^Navy twill_(58in|147cm)$/,
  );
  await expect(modal.locator("select.gn-modal-select")).toHaveValue("main");
  await modal.locator("button[data-id=save]").click();
  await expect(modal).toHaveCount(0);

  // Saved, so Back doesn't ask; the layout is listed under Main fabric.
  await page.click("id=back");
  await expect(page.locator(".gn-modal")).toHaveCount(0);
  const panel = page.locator("#layoutspanel");
  await expect(panel.locator(".lp-folder")).toContainText("Main fabric (1)");
  const saved = panel.locator(".lp-row", { hasText: "Navy twill_" });
  await expect(saved).toContainText("10/10");

  // A second nest, not saved: Back asks; Leave keeps it as Last nest.
  await page.waitForTimeout(2500);
  await nestFor(page);
  await page.click("id=back");
  await expect(modal).toContainText("Leave without saving?");
  await modal.locator("button[data-id=leave]").click();
  await expect(panel.locator(".lp-row.unsaved")).toContainText(
    "Last nest (not saved)",
  );

  // Open the saved layout: straight onto the nest screen, ready to export.
  await page.waitForTimeout(2500);
  await saved.getByText("Open").click();
  await expect(page.locator("#nest")).toHaveClass("active");
  await expect(page.locator("#export")).toHaveClass("button export");
  await expect(page.locator("#nestsvg g.part.active")).toHaveCount(10);
  await expect(page.locator("#nestbanner")).toHaveCount(0);
  // Opened from the list, so Back doesn't ask.
  await page.click("id=back");
  await expect(page.locator(".gn-modal")).toHaveCount(0);
  await page.waitForTimeout(2500);

  // Save and reopen the project: both layouts come back.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-layouts-"));
  const file = path.join(dir, "layouts.gnp");
  await electronApp.evaluate(({ dialog }, f) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => f;
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [f];
  }, file);
  await page.click("id=saveproject");
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(json.layouts).toHaveLength(1);
  expect(json.lastNest).toBeTruthy();
  expect(json.nests).toEqual([]);
  await page.click("id=openproject");
  await expect(page.locator("#partslist tbody tr")).toHaveCount(12, {
    timeout: 20000,
  });
  await expect(saved).toHaveCount(1);
  await expect(panel.locator(".lp-row.unsaved")).toHaveCount(1);

  // Change a piece's seam allowance: opening says so.
  await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const p = d.parts.find((q) => q.name === "2 Bodice Back C2M");
    if (p) p.seamAllowance = 15;
  });
  await saved.getByText("Open").click();
  const banner = page.locator("#nestbanner");
  await expect(banner).toContainText("2 Bodice Back C2M");
  await expect(banner).toContainText("seam allowance 12 → 15 mm");
  await expect(banner).toContainText("Re-nest with the new pieces");
  await banner.getByText("Keep as saved").click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator("#nestsvg g.part.active")).toHaveCount(10);
  await page.click("id=back");
  await page.waitForTimeout(2500);
  await expect(saved.locator(".warn")).toHaveCount(1);

  // v1.11.0: a piece left out by hand (same fabric) shows in the banner,
  // and opening the layout doesn't tick it back in.
  const cuffRow = page.locator("#partslist tbody tr", {
    has: page.locator('input.partname[value="7 Skirt Back C2M"]'),
  });
  await cuffRow.locator("input.includetoggle").uncheck();
  await saved.getByText("Open").click();
  await expect(banner).toContainText("7 Skirt Back C2M: left out of the nest");
  await banner.getByText("Keep as saved").click();
  await page.click("id=back");
  await page.waitForTimeout(2500);
  await expect(cuffRow.locator("input.includetoggle")).not.toBeChecked();

  // Delete it.
  await saved.getByText("Delete").click();
  await modal.locator("button[data-id=delete]").click();
  await expect(saved).toHaveCount(0);

  await setCutCodes(page, true);
  await electronApp.close();
});

test("Pieces without a code: Don't ask again, then a reminder banner", async () => {
  test.setTimeout(240000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const page = await electronApp.firstWindow();
  await setCutCodes(page, true);
  await setTick(page, "warnUncodedPieces", true);
  await setTick(page, "askBeforeLeavingNest", false);
  const pattern = path.resolve(
    __dirname,
    "..",
    "examples",
    "example-pattern.svg",
  );
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [p],
      canceled: false,
    });
  }, pattern);
  await page.click("id=import");
  await expect(page.locator("#partslist tbody tr")).toHaveCount(11, {
    timeout: 20000,
  });
  await page.selectOption("#nestjob", "all");
  await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const p = d.parts.find((q) => q.name === "8 Waist Tie C2M");
    if (p) p.name = "8 Waist Tie";
    const w = (400 / 2.54) * 96;
    const h = 58 * 96;
    d.importsvg(
      null,
      null,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}"/></svg>`,
      null,
      false,
    );
    const s = d.parts[d.parts.length - 1];
    s.sheet = true;
    s.excluded = false;
  });

  await page.click("id=startnest");
  const modal = page.locator(".gn-modal");
  await expect(modal).toContainText("Pieces without a cut code");
  await expect(modal.locator("li")).toHaveText(["8 Waist Tie"]);
  await modal.locator("input.gn-modal-tick").check();
  await modal.locator("button[data-id=nest]").click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { DeepNest: DN }).DeepNest.nests.length,
        ),
      { timeout: 120000, intervals: [1000] },
    )
    .toBeGreaterThan(0);
  await page.click("id=stopnest");
  await page.click("id=back");
  await page.waitForTimeout(2500);

  // Not asked again; the nest screen names the piece instead.
  await page.click("id=startnest");
  await expect(page.locator("#nestbanner")).toContainText("8 Waist Tie");
  await expect(page.locator(".gn-modal")).toHaveCount(0);
  await page.click("id=stopnest");
  await page.click("id=back");
  await page.waitForTimeout(2500);
  await page.locator("#config_tab").click();
  await expect(page.locator("#warnUncodedPieces")).not.toBeChecked();
  await page.locator("#warnUncodedPieces").check();
  await page.locator("#askBeforeLeavingNest").check();
  await electronApp.close();
});
