/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// v1.5.0 folding:
//   - "Mark fold": click a piece's edge in the import preview and it is cut
//     on the fold along that edge.
//   - A mirror copy of a cut-on-fold piece is cut on the fold too (it used
//     to be nested doubled but drawn and exported as the half).
//   - Mirror-then-fold gives the same piece as fold-then-mirror.
//   - Grain lines found in the file can be re-marked.
// Uses examples/example-pattern.svg. Run locally with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import path from "path";

type B = { x: number; y: number; width: number; height: number };
type P = {
  name?: string;
  bounds: B;
  cutOnFold?: boolean;
  foldLine?: unknown;
  mirror?: boolean;
  polygontree: { x: number; y: number }[];
};
type DN = {
  parts: P[];
  foldPart(i: number): boolean;
  mirrorPart(i: number): void;
  mirrorCopyPart(i: number): number;
};

test("Mark fold, folded mirror copies, mirror-then-fold, re-mark", async () => {
  test.setTimeout(120000);
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
  const rows = mainWindow.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(11, { timeout: 20000 });

  const index = (name: string) =>
    mainWindow.evaluate(
      (n) =>
        (window as unknown as { DeepNest: DN }).DeepNest.parts.findIndex(
          (p) => p.name === n,
        ),
      name,
    );
  const bounds = (i: number) =>
    mainWindow.evaluate(
      (k) => (window as unknown as { DeepNest: DN }).DeepNest.parts[k].bounds,
      i,
    );

  // Grain lines read from the file can be re-marked now.
  await expect(rows.first().locator("a.markgrain")).toHaveText("Re-mark");

  // ---- Mark fold: fold the cuff along its straight top edge, clicked in
  // the preview. v1.6.0: Mark fold zooms the preview in on the piece, so
  // its whole outline is on screen and bigger than before.
  const k = await index("10 Cuff C2R");
  const width = () =>
    mainWindow.evaluate(() => {
      const svg = document.querySelector("#import-0 svg") as SVGSVGElement;
      const frame = svg.querySelector("path") as SVGGraphicsElement;
      return frame.getScreenCTM()!.a;
    });
  const zoomBefore = await width();
  const before = await bounds(k);
  // v1.7.0: the piece is selected first; marking its fold unselects it.
  await mainWindow.evaluate((k) => {
    (
      window as unknown as { DeepNest: { parts: { selected?: boolean }[] } }
    ).DeepNest.parts[k].selected = true;
  }, k);
  await rows.nth(k).locator("a.markfold").click();
  await expect(mainWindow.locator("#grainmarker-banner")).toHaveClass(/active/);
  expect(await width()).toBeGreaterThan(zoomBefore * 2);
  const pick = await mainWindow.evaluate((k) => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    const svg = document.querySelector("#import-0 svg") as SVGSVGElement;
    const frame = svg.querySelector("path") as SVGGraphicsElement;
    const r = svg.getBoundingClientRect();
    const b = dn.parts[k].bounds;
    const ctm = frame.getScreenCTM()!;
    const corner = (x: number, y: number) =>
      new DOMPoint(x, y).matrixTransform(ctm);
    const a = corner(b.x, b.y);
    const c = corner(b.x + b.width, b.y + b.height);
    const top = corner(b.x + b.width / 2, b.y);
    const inView = [a, c].every(
      (p) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom,
    );
    return { x: top.x, y: top.y, inView, name: dn.parts[k].name };
  }, k);
  expect(pick.inView, "the whole cuff is in the preview").toBe(true);
  await mainWindow.mouse.click(pick.x, pick.y);
  await expect(mainWindow.locator("#grainmarker-banner")).not.toHaveClass(
    /active/,
  );
  const after = await bounds(k);
  expect(
    await mainWindow.evaluate(
      (k) =>
        !!(
          window as unknown as {
            DeepNest: { parts: { selected?: boolean }[] };
          }
        ).DeepNest.parts[k].selected,
      k,
    ),
    "the folded piece is unselected",
  ).toBe(false);
  expect(
    await mainWindow.evaluate(
      (k) =>
        !!(window as unknown as { DeepNest: DN }).DeepNest.parts[k].cutOnFold,
      k,
    ),
    `${pick.name} is cut on the fold`,
  ).toBe(true);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height * 2, 0);

  // ---- A mirror copy of a folded piece is folded too.
  const skirt = await index("6 Skirt Front C1MOF");
  const copy = await mainWindow.evaluate((k) => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.foldPart(k);
    const c = dn.mirrorCopyPart(k);
    const src = dn.parts[k];
    const cp = dn.parts[c];
    return {
      cutOnFold: !!cp.cutOnFold,
      foldLine: !!cp.foldLine,
      mirror: !!cp.mirror,
      width: cp.bounds.width,
      srcWidth: src.bounds.width,
    };
  }, skirt);
  expect(copy).toEqual({
    cutOnFold: true,
    foldLine: true,
    mirror: true,
    width: copy.srcWidth,
    srcWidth: copy.srcWidth,
  });

  // ---- Mirror then fold == fold then mirror (same doubled piece).
  const front = await index("1 Bodice Front C1MOF");
  const compare = await mainWindow.evaluate((k) => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    const a = dn.mirrorCopyPart(k); // mirrored copy, then fold it
    dn.foldPart(a);
    dn.foldPart(k); // fold the original, then a mirrored copy of it
    const b = dn.mirrorCopyPart(k);
    const round = (bb: B) =>
      [bb.x, bb.y, bb.width, bb.height].map((v) => Math.round(v));
    return {
      a: round(dn.parts[a].bounds),
      b: round(dn.parts[b].bounds),
      aFold: !!dn.parts[a].cutOnFold,
    };
  }, front);
  expect(compare.aFold).toBe(true);
  expect(compare.a).toEqual(compare.b);

  // ---- A mirror copy of a mirrored piece is the un-mirrored piece (flag
  // and outline agree), and a copy that's unmirrored isn't "(mirrored)".
  const back = await index("2 Bodice Back C2M");
  const mm = await mainWindow.evaluate((k) => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    const xs = (i: number) =>
      dn.parts[i].polygontree.map((p) => Math.round(p.x)).join(",");
    const original = xs(k);
    dn.mirrorPart(k);
    const c = dn.mirrorCopyPart(k);
    return { copyMirror: !!dn.parts[c].mirror, same: xs(c) === original };
  }, back);
  expect(mm).toEqual({ copyMirror: false, same: true });

  await setCutCodes(mainWindow, true);

  await electronApp.close();
});
