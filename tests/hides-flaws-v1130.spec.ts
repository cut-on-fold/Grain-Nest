// v1.13.0: nesting on a hide (a sheet that isn't a rectangle) and around
// flaws. A made-up hide drawn in mm has flaw-1 inside it and flaw-2 across
// its edge; ticked as a sheet, nothing is nested over either. Run locally
// with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  appReady,
  setAskBeforeLeaving,
  setCutCodes,
} from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

type Pt = { x: number; y: number };
type P = {
  name?: string;
  sheet?: boolean;
  polygontree: Pt[];
  fileFlaws?: Pt[][];
  appFlawPolys?: Pt[][];
};
type Placement = { source: number; x: number; y: number; rotation: number };
type DN = {
  parts: P[];
  nests: {
    selected?: boolean;
    placements: { sheet: number; sheetplacements: Placement[] }[];
  }[];
};

/**
 * Pieces on a sheet that overlap any of its flaws by more than a sliver
 * (touching is fine: with no space between pieces they may sit against a
 * flaw). Overlap measured with Clipper, which the app page loads.
 */
export async function piecesOnFlaws(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      DeepNest: DN;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ClipperLib: any;
      config: { getSync: (k: string) => number };
    };
    const d = w.DeepNest;
    const C = w.ClipperLib;
    const S = 10000;
    const perMm = (w.config.getSync("scale") || 72) / 25.4;
    const toC = (poly: Pt[]) =>
      poly.map((p) => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
    const overlapMm2 = (a: Pt[], b: Pt[]) => {
      const c = new C.Clipper();
      const out = new C.Paths();
      c.AddPath(toC(a), C.PolyType.ptSubject, true);
      c.AddPath(toC(b), C.PolyType.ptClip, true);
      c.Execute(
        C.ClipType.ctIntersection,
        out,
        C.PolyFillType.pftNonZero,
        C.PolyFillType.pftNonZero,
      );
      let area = 0;
      for (const p of out) area += Math.abs(C.Clipper.Area(p));
      return area / (S * S) / (perMm * perMm);
    };
    const n = d.nests.find((x) => x.selected) || d.nests[0];
    const hits: string[] = [];
    for (const sg of n.placements) {
      const sheet = d.parts[sg.sheet];
      const flaws = (sheet.fileFlaws || []).concat(sheet.appFlawPolys || []);
      for (const pl of sg.sheetplacements) {
        const part = d.parts[pl.source];
        const r = (pl.rotation * Math.PI) / 180;
        const placed = part.polygontree.map((p) => ({
          x: p.x * Math.cos(r) - p.y * Math.sin(r) + pl.x,
          y: p.x * Math.sin(r) + p.y * Math.cos(r) + pl.y,
        }));
        for (const f of flaws) {
          const mm2 = overlapMm2(placed, f);
          if (mm2 > 1) {
            hits.push(`${part.name || "?"} (${Math.round(mm2)} mm²)`);
            break;
          }
        }
      }
    }
    return hits;
  });
}

test("A hide with flaws drawn in the file", async () => {
  test.setTimeout(300000);
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  const page = await app.firstWindow();
  await appReady(page);
  await setCutCodes(page, false);
  await setAskBeforeLeaving(page, false);
  const files = [
    path.resolve(__dirname, "assets", "synthetic-hide.svg"),
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
  await expect(rows).toHaveCount(12, { timeout: 20000 });

  // The hide came in as one shape, with both flaws kept (not as pieces).
  const hide = await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const i = d.parts.findIndex((p) => p.name === "Calf side");
    return { i, flaws: (d.parts[i]?.fileFlaws || []).length };
  });
  expect(hide.i).toBeGreaterThanOrEqual(0);
  expect(hide.flaws).toBe(2);

  // Tick it as a sheet and nest.
  await rows
    .nth(hide.i)
    .locator("td")
    .nth(4)
    .locator("input[type=checkbox]")
    .check();
  await expect
    .poll(() =>
      page.evaluate(
        (i) => (window as unknown as { DeepNest: DN }).DeepNest.parts[i].sheet,
        hide.i,
      ),
    )
    .toBe(true);
  await page.click("id=startnest");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { DeepNest: DN }).DeepNest.nests.length,
        ),
      { timeout: 150000, intervals: [2000] },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(5000);
  await page.click("id=stopnest");
  expect(await piecesOnFlaws(page)).toEqual([]);

  // On a hide the nest screen shows area, not length.
  await expect(page.locator("#nestinfo")).toContainText(
    /used of [\d.]+ (m²|sq ft)/,
  );
  await expect(page.locator("#nestinfo")).toContainText("left over");
  await expect(page.locator("#nestinfo")).not.toContainText(
    "min fabric length",
  );

  // The export keeps the hide's outline and its flaws.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-hide-"));
  const out = path.join(dir, "hide.svg");
  await app.evaluate(({ dialog }, f) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => f;
  }, out);
  await page.click("id=export");
  await page.click("id=exportsvg");
  await expect.poll(() => fs.existsSync(out)).toBe(true);
  const svg = fs.readFileSync(out, "utf8");
  expect(svg).toContain('inkscape:label="Flaws"');
  expect((svg.match(/id="flaw-1-\d+"/g) || []).length).toBe(2);
  expect(svg).toMatch(/inkscape:label="Sheet border"[^>]*>\s*<path/);

  // Saved and reopened, the hide is still its shape with both flaws.
  await page.click("id=back");
  await page.waitForTimeout(2500);
  const project = path.join(dir, "hide.gnp");
  await app.evaluate(({ dialog }, f) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => f;
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [f];
  }, project);
  await page.click("id=saveproject");
  await expect.poll(() => fs.existsSync(project)).toBe(true);
  await page.click("id=openproject");
  await expect(rows).toHaveCount(12, { timeout: 20000 });
  const back = await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const h = d.parts.find((p) => p.name === "Calf side");
    return h
      ? {
          sheet: !!h.sheet,
          points: h.polygontree.length,
          flaws: (h.fileFlaws || []).length,
        }
      : null;
  });
  expect(back).toEqual({ sheet: true, points: expect.any(Number), flaws: 2 });
  expect(back!.points).toBeGreaterThan(10);

  await setCutCodes(page, true);
  await setAskBeforeLeaving(page, true);
  await app.close();
});

test("Flaws added in the Flaws box, kept through Save / Open project", async () => {
  test.setTimeout(300000);
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  const page = await app.firstWindow();
  await appReady(page);
  await setCutCodes(page, false);
  await setAskBeforeLeaving(page, false);
  const pattern = path.resolve(
    __dirname,
    "..",
    "examples",
    "example-pattern.svg",
  );
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [f],
      canceled: false,
    });
  }, pattern);
  await page.click("id=import");
  const rows = page.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(11, { timeout: 20000 });

  // A 150 × 100 cm sheet of fabric.
  const metric = await page.evaluate(
    () =>
      (
        window as unknown as { config: { getSync: (k: string) => string } }
      ).config.getSync("units") === "mm",
  );
  const val = (cm: number) =>
    String(metric ? cm : Math.round((cm / 2.54) * 1000) / 1000);
  await page.click("id=addsheet");
  await page.fill("#sheetname", "Linen");
  await page.fill("#sheetwidth", metric ? "1500" : val(150));
  await page.fill("#sheetheight", metric ? "1000" : val(100));
  await page.click("id=confirmsheet");
  await page.selectOption("#nestjob", "all");
  await expect(rows).toHaveCount(12);

  // Two flaws: round in the middle, a rectangle near the top.
  await rows.nth(11).locator(".flawsbtn").click();
  const box = page.locator(".gn-flaws");
  await expect(box).toContainText("Flaws on Linen");
  await box.locator(".fl-along").fill(val(60));
  await box.locator(".fl-in").fill(val(50));
  await box.locator(".fl-size").fill(val(30));
  await box.locator(".fl-add").click();
  await box.locator(".fl-corner").selectOption("tr");
  await box.locator(".fl-shape").selectOption("rect");
  await box.locator(".fl-along").fill(val(40));
  await box.locator(".fl-in").fill(val(10));
  await box.locator(".fl-size").fill(val(40));
  await box.locator(".fl-width").fill(val(8));
  await box.locator(".fl-add").click();
  await expect(box.locator(".fl-item")).toHaveCount(2);
  await expect(box.locator(".fl-item").nth(0)).toContainText("round");
  await expect(box.locator(".fl-item").nth(1)).toContainText(
    "from the top right corner",
  );
  await box.locator(".fl-done").click();
  await expect(rows.nth(11).locator(".flawsbtn")).toHaveText("Flaws… (2)");

  // Where the first flaw is: 60 cm along, 50 cm in, from the top left.
  const centre = await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const f = d.parts[11].appFlawPolys![0];
    return {
      x: f.reduce((s, p) => s + p.x, 0) / f.length,
      y: f.reduce((s, p) => s + p.y, 0) / f.length,
      scale: (
        window as unknown as { config: { getSync: (k: string) => number } }
      ).config.getSync("scale"),
    };
  });
  const perCm = (centre.scale || 72) / 2.54;
  expect(centre.x / perCm).toBeCloseTo(60, 0);
  expect(centre.y / perCm).toBeCloseTo(50, 0);

  await page.click("id=startnest");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { DeepNest: DN }).DeepNest.nests.length,
        ),
      { timeout: 150000, intervals: [2000] },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(5000);
  await page.click("id=stopnest");
  expect(await piecesOnFlaws(page)).toEqual([]);
  await page.click("id=back");
  await page.waitForTimeout(2500);

  // Save and reopen: the flaws come back.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-flaws-"));
  const file = path.join(dir, "flaws.gnp");
  await app.evaluate(({ dialog }, f) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => f;
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [f];
  }, file);
  await page.click("id=saveproject");
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  await page.click("id=openproject");
  await expect(rows).toHaveCount(12, { timeout: 20000 });
  await expect(rows.nth(11).locator(".flawsbtn")).toHaveText("Flaws… (2)");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { DeepNest: DN }).DeepNest.parts[11].appFlawPolys!
          .length,
    ),
  ).toBe(2);

  await setCutCodes(page, true);
  await setAskBeforeLeaving(page, true);
  await app.close();
});
