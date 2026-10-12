// v1.11.0: views. Save as view makes a view of the selected pieces; the
// View menu above the saved layouts shows (and nests) only its pieces;
// layouts belong to their view; importing while a view is shown asks
// whether to add the new pieces; views survive Save / Open project; and
// deleting a view deletes its layouts. Run locally with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import { setAskBeforeLeaving, setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

type P = {
  name?: string;
  sheet?: boolean;
  excluded?: boolean;
  fabric?: string;
  grainnestId?: number;
  autoCopy?: boolean;
  autoCopyOf?: P;
  outOfView?: boolean;
};
type DN = {
  parts: P[];
  nests: {
    selected?: boolean;
    placements: { sheetplacements: { source: number }[] }[];
  }[];
  pieceViews?: { id: string; name: string; pids: number[] }[];
  importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
};

test("Views: save, show, nest, layouts, import, reload, delete", async () => {
  test.setTimeout(300000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const page = await electronApp.firstWindow();
  await setCutCodes(page, true);
  await setAskBeforeLeaving(page, false);
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
  const rows = page.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(11, { timeout: 20000 });

  // Select six pieces and save them as a view.
  for (const i of [0, 1, 2, 3, 4, 9]) {
    await rows.nth(i).locator("td").nth(3).click();
  }
  await page.click("id=saveview");
  const modal = page.locator(".gn-modal");
  await expect(modal).toContainText("6 pieces selected");
  await modal.locator("input.gn-modal-input").fill("View B – Top");
  await modal.locator("button[data-id=save]").click();
  await expect(modal).toHaveCount(0);

  // The view is shown: its six pieces only.
  const viewSelect = page.locator("#viewselect");
  await expect(viewSelect.locator("option:checked")).toHaveText(
    "View B – Top (6)",
  );
  await expect(rows).toHaveCount(6);
  await expect(page.locator("#layoutspanel .lp-empty")).toContainText(
    "in this view",
  );

  // A sheet (always shown) and a nest: only the view's pieces are placed.
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
  await page.selectOption("#nestjob", "all");
  await expect(rows).toHaveCount(7);
  await page.click("id=startnest");
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
  const outside = await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const view = d.pieceViews![0];
    const n = d.nests.find((x) => x.selected) || d.nests[0];
    const names: string[] = [];
    for (const sg of n.placements) {
      for (const pl of sg.sheetplacements) {
        const p = d.parts[pl.source];
        const real = (p.autoCopy && p.autoCopyOf) || p;
        if (!view.pids.includes(real.grainnestId!))
          names.push(real.name || "?");
      }
    }
    return names;
  });
  expect(outside).toEqual([]);

  // Save the layout: it belongs to the view.
  await page.click("id=savelayout");
  await modal.locator("button[data-id=save]").click();
  await page.click("id=back");
  await page.waitForTimeout(2500);
  const layoutRow = page.locator("#layoutspanel .lp-row", {
    hasText: "Navy twill_",
  });
  await expect(layoutRow).toHaveCount(1);
  await viewSelect.selectOption("");
  await expect(rows).toHaveCount(12);
  await expect(layoutRow).toHaveCount(0);
  await viewSelect.selectOption({ label: "View B – Top (6)" });
  await expect(layoutRow).toHaveCount(1);
  await expect(rows).toHaveCount(7);

  // Import more while the view is shown: asked; Don't add keeps them out.
  await page.click("id=import");
  await expect(modal).toContainText("Add the new pieces to View B – Top?");
  await modal.locator("button[data-id=no]").click();
  await expect(rows).toHaveCount(7);
  await viewSelect.selectOption("");
  await expect(rows).toHaveCount(23);
  await viewSelect.selectOption({ label: "View B – Top (6)" });

  // Save and reopen the project: the view and its layout come back.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-views-"));
  const file = path.join(dir, "views.gnp");
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
  expect(json.views).toHaveLength(1);
  expect(json.views[0].parts).toHaveLength(6);
  expect(json.layouts[0].view).toBe(json.views[0].id);
  await page.click("id=openproject");
  await expect(viewSelect.locator("option:checked")).toHaveText(
    "View B – Top (6)",
    { timeout: 20000 },
  );
  await expect(rows).toHaveCount(7);
  await expect(layoutRow).toHaveCount(1);

  // Delete the view: says its layout goes too.
  await viewSelect.selectOption("__delete");
  await expect(modal).toContainText("Its 1 saved layout is deleted too");
  await modal.locator("button[data-id=delete]").click();
  // v1.11.1: the menu stays, back on All pieces.
  await expect(viewSelect.locator("option:checked")).toHaveText(
    "All pieces (22)",
  );
  await expect(rows).toHaveCount(23);
  await expect(page.locator("#layoutspanel")).toContainText("No views yet");

  await setAskBeforeLeaving(page, true);
  await electronApp.close();
});
