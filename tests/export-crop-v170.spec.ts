/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// v1.7.0: the exported page is cropped to the pieces nested on it (plus a
// 10 mm margin), so a few small pieces on wide fabric don't come out on a
// huge, mostly empty page. The sheet border goes round the pieces, and the
// layout is the one that was nested (no re-nesting, unlike the old Trim
// sheets button, which is gone). Run locally with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import path from "path";

test("Export crops the page to the nested pieces", async ({}, testInfo) => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Written for Quantity and Mirror copy by hand (v1.9.0).
  await setCutCodes(mainWindow, false);
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
  await mainWindow.click("id=import");
  await expect(mainWindow.locator("#partslist tbody tr")).toHaveCount(11, {
    timeout: 20000,
  });
  await expect(mainWindow.locator("#trimsheets")).toHaveCount(0);

  // Only the cuff and the pocket, on 3 m of 150 cm fabric. ("Nest for"
  // re-ticks pieces, so it's set first.)
  await mainWindow.selectOption("#nestjob", "all");
  await mainWindow.evaluate(() => {
    type P = { name?: string; sheet?: boolean; excluded?: boolean };
    const dn = (
      window as unknown as {
        DeepNest: {
          parts: P[];
          importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
        };
      }
    ).DeepNest;
    dn.parts.forEach((p) => {
      p.excluded = !/^(10 Cuff|5 Pocket)/.test(p.name || "");
    });
    const w = (300 / 2.54) * 96;
    const h = (150 / 2.54) * 96;
    dn.importsvg(
      null,
      null,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}"/></svg>`,
      null,
      false,
    );
    const sheet = dn.parts[dn.parts.length - 1];
    sheet.sheet = true;
    sheet.excluded = false;
  });
  await mainWindow.click("id=startnest");
  await expect
    .poll(
      () =>
        mainWindow.evaluate(() => {
          const dn = (
            window as unknown as {
              DeepNest: {
                nests: { placements: { sheetplacements: unknown[] }[] }[];
              };
            }
          ).DeepNest;
          return Math.max(
            0,
            ...dn.nests.map((n) =>
              n.placements.reduce((a, s) => a + s.sheetplacements.length, 0),
            ),
          );
        }),
      { timeout: 120000, intervals: [1000] },
    )
    .toBe(2);
  await mainWindow.click("id=stopnest");

  const file = testInfo.outputPath("export.svg");
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => p;
  }, file);
  await mainWindow.click("id=export");
  await mainWindow.click("id=exportsvg");
  await expect.poll(() => fs.existsSync(file), { timeout: 10000 }).toBe(true);
  const svg = fs.readFileSync(file, "utf8");
  await testInfo.attach("export.svg", {
    body: svg,
    contentType: "image/svg+xml",
  });

  const report = await mainWindow.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = document.importNode(doc.documentElement, true) as Element;
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;left:0;top:0;visibility:hidden";
    holder.appendChild(root);
    document.body.appendChild(holder);
    const svgEl = root as SVGSVGElement;
    const page = svgEl.getBoundingClientRect();
    const border = svgEl
      .querySelector('[id^="border-"] rect')!
      .getBoundingClientRect();
    const pieces = Array.from(svgEl.querySelectorAll('[id^="cut-"]')).map((e) =>
      e.getBoundingClientRect(),
    );
    const vb = svgEl.getAttribute("viewBox")!.split(/\s+/).map(Number);
    const sx = page.width / vb[2];
    // Pieces Gravity pushed against the fabric's edge sit on the border
    // (the edge of the fabric), so allow a line width.
    const tol = 8 * sx;
    const out = {
      pageMm: [vb[2], vb[3]].map((v) => (v / 96) * 25.4),
      piecesInBorder: pieces.every(
        (r) =>
          r.left >= border.left - tol &&
          r.right <= border.right + tol &&
          r.top >= border.top - tol &&
          r.bottom <= border.bottom + tol,
      ),
      borderWidthMm: ((border.width / sx / 96) * 25.4) | 0,
    };
    holder.remove();
    return out;
  }, svg);

  // Cuff 220 x 70 mm and pocket 150 x 140 mm: a page well under the
  // 3 m x 1.5 m sheet (it was the whole sheet before).
  expect(report.pageMm[0]).toBeLessThan(600);
  expect(report.pageMm[1]).toBeLessThan(600);
  expect(report.piecesInBorder).toBe(true);
  expect(report.borderWidthMm).toBeLessThan(600);
  await setCutCodes(mainWindow, true);
  await electronApp.close();
});
