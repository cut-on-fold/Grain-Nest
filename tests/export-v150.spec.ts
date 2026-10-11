/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// v1.5.0: the SVG export is laid out like the pattern files that go in —
// Inkscape layers, one named group per piece holding its cut, sew and
// grain lines and its name — with uniform line widths and the colours from
// Settings; names sit inside their pieces; the calibration square is on
// the page but clear of every piece.
//
// Uses examples/example-pattern.svg (the Test-Pattern-Grading layout). Run
// with UPDATE_EXAMPLES=1 to also write examples/example-export.svg.
// Run locally with CI=1 (video recording freezes the renderer timers).

import { _electron as electron, expect, test } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import path from "path";

test("SVG export: layers, named piece groups, line styles, names, calibration", async ({}, testInfo) => {
  test.setTimeout(240000);
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

  // Fold the "OF" pieces, mirror-copy the "C2" ones, add a 150 cm sheet.
  const total = await mainWindow.evaluate(() => {
    type P = { name?: string; sheet?: boolean; fabric?: string };
    const dn = (
      window as unknown as {
        DeepNest: {
          parts: P[];
          foldPart(i: number): boolean;
          mirrorCopyPart(i: number): number;
          importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
        };
      }
    ).DeepNest;
    const names = dn.parts.map((p) => p.name || "");
    names.forEach((n, i) => {
      if (/OF\b/.test(n)) dn.foldPart(i);
    });
    names.forEach((n, i) => {
      if (/\bC2[A-Z]\b/.test(n)) dn.mirrorCopyPart(i);
    });
    // 150 cm wide, 3 m long, at 96 units per inch
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
    sheet.name = "Main fabric";
    sheet.fabric = "main";
    return dn.parts.filter((p) => !p.sheet).length;
  });
  expect(total).toBe(17);
  await mainWindow.selectOption("#nestjob", "all");
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
      { timeout: 120000, intervals: [2000] },
    )
    .toBe(17);
  await mainWindow.click("id=stopnest");
  // Show the nest that places everything, then export it.
  await mainWindow.evaluate(() => {
    type N = {
      selected?: boolean;
      placements: { sheetplacements: unknown[] }[];
    };
    const dn = (window as unknown as { DeepNest: { nests: N[] } }).DeepNest;
    const full = dn.nests.find(
      (n) =>
        n.placements.reduce((a, s) => a + s.sheetplacements.length, 0) === 17,
    )!;
    dn.nests.forEach((n) => (n.selected = n === full));
  });

  const file = testInfo.outputPath("export.svg");
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => p;
  }, file);
  await mainWindow.click("id=export");
  await expect(mainWindow.locator("id=exportsvg")).toBeVisible();
  await mainWindow.click("id=exportsvg");
  await expect.poll(() => fs.existsSync(file), { timeout: 10000 }).toBe(true);
  const svg = fs.readFileSync(file, "utf8");
  await testInfo.attach("export.svg", {
    body: svg,
    contentType: "image/svg+xml",
  });
  if (process.env.UPDATE_EXAMPLES) {
    fs.writeFileSync(
      path.resolve(__dirname, "..", "examples", "example-export.svg"),
      svg,
    );
  }

  expect(svg).not.toMatch(/class="active"/);
  expect(svg).not.toMatch(/24c7ed/i); // old cyan grain style

  const report = await mainWindow.evaluate((text) => {
    const INK = "http://www.inkscape.org/namespaces/inkscape";
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:0;top:0;width:2000px;height:2000px;opacity:0";
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = document.importNode(
      parsed.documentElement,
      true,
    ) as unknown as SVGSVGElement;
    host.appendChild(root);
    document.body.appendChild(host);
    root.setAttribute("width", "2000");
    root.setAttribute("height", "2000");
    const label = (e: Element) => e.getAttributeNS(INK, "label") || "";
    const layers = Array.from(root.children).filter(
      (e) => e.getAttributeNS(INK, "groupmode") === "layer",
    );
    const sheetLayer = layers.find((l) => label(l).startsWith("Sheet 1"))!;
    const groups = Array.from(sheetLayer.children).filter(
      (g) => label(g) !== "Sheet border",
    );
    const styleOf = (e: Element) => e.getAttribute("style") || "";
    const pieces = groups.map((g) => {
      const kids = Array.from(g.children);
      const byLabel = (re: RegExp) => kids.find((k) => re.test(label(k)));
      const cut = byLabel(/^cut-/);
      const sew = byLabel(/^sew-/);
      const grain = byLabel(/^grain-/);
      const name = byLabel(/^name-/) as SVGTextElement | undefined;
      // Is every corner of the name's box inside the cut outline?
      let nameInside: boolean | null = null;
      const outline = cut?.querySelector(
        "path, polygon, polyline, rect",
      ) as SVGGeometryElement | null;
      if (name && outline) {
        const b = name.getBBox();
        const m = name.getScreenCTM()!;
        const inv = outline.getScreenCTM()!.inverse();
        nameInside = [
          [b.x, b.y],
          [b.x + b.width, b.y],
          [b.x, b.y + b.height],
          [b.x + b.width, b.y + b.height],
        ].every(([x, y]) => {
          const p = new DOMPoint(x, y).matrixTransform(m).matrixTransform(inv);
          return outline.isPointInFill(p);
        });
      }
      return {
        label: label(g),
        cut: !!cut,
        sew: !!sew,
        grain: !!grain,
        name: name ? name.textContent : null,
        nameTransform: name ? name.getAttribute("transform") : null,
        nameInside,
        cutStyles: cut
          ? Array.from(
              cut.querySelectorAll("path, line, polyline, polygon"),
            ).map(styleOf)
          : [],
        sewStyle: sew ? styleOf(sew) : "",
        grainStyle: grain ? styleOf(grain) : "",
      };
    });
    const cal = root.querySelector(
      "#calibration-square",
    ) as SVGRectElement | null;
    const sheetTop = new DOMMatrix(
      getComputedStyle(sheetLayer).transform === "none"
        ? undefined
        : getComputedStyle(sheetLayer).transform,
    );
    const vb = root.getAttribute("viewBox")!.split(/\s+/).map(Number);
    const out = {
      layers: layers.map(label),
      pieces,
      borderStyle: styleOf(
        sheetLayer.querySelector("g")!.firstElementChild as Element,
      ),
      borderX: Number(
        (
          sheetLayer.querySelector("g")!.firstElementChild as Element
        ).getAttribute("x"),
      ),
      calibration: cal
        ? {
            bottom:
              Number(cal.getAttribute("y")) +
              Number(cal.getAttribute("height")),
            right:
              Number(cal.getAttribute("x")) + Number(cal.getAttribute("width")),
          }
        : null,
      sheetLayerTransform: sheetLayer.getAttribute("transform"),
      sheetMatrixF: sheetTop.f,
      viewBox: vb,
    };
    host.remove();
    return out;
  }, svg);
  await testInfo.attach("report.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });

  // Layers: calibration strip, then the sheet named after the fabric sheet.
  expect(report.layers).toEqual(["Calibration", "Sheet 1 - Main fabric"]);

  // One named group per placed piece, each with cut / sew / grain / name.
  expect(report.pieces).toHaveLength(17);
  const labels = report.pieces.map((p) => p.label);
  expect(labels).toContain("1 Bodice Front C1MOF");
  expect(labels).toContain("2 Bodice Back C2M (mirrored)");
  expect(labels).toContain("INT1 Waistband Interfacing");
  for (const p of report.pieces) {
    expect(p.cut, `${p.label}: cut line`).toBe(true);
    expect(p.sew, `${p.label}: sew line`).toBe(true);
    expect(p.grain, `${p.label}: grain line`).toBe(true);
    expect(p.name, `${p.label}: name`).not.toBeNull();
    expect(p.nameInside, `${p.label}: name inside the piece`).toBe(true);
  }

  // Uniform 2 mm lines (at 96 units per inch) in the default colours.
  const w = "stroke-width:7.559";
  for (const p of report.pieces) {
    for (const s of p.cutStyles) {
      expect(s).toContain("stroke:#3b1f6e");
      expect(s).toContain(w);
    }
    expect(p.sewStyle).toContain("stroke:#4f8a26");
    expect(p.sewStyle).toContain("stroke-dasharray");
    expect(p.sewStyle).toContain(w);
    expect(p.grainStyle).toContain("stroke:#4f8a26");
    expect(p.grainStyle).not.toContain("stroke-dasharray");
    expect(p.grainStyle).toContain(w);
  }
  // v1.6.0: cyan, and half a line width (2 mm = 7.559) inside the sheet
  // edge so the whole line is on the page.
  expect(report.borderStyle).toContain("stroke:#00ffff");
  expect(report.borderX).toBeCloseTo(7.559 / 2, 2);

  // The long thin waist tie gets its name turned to run along it.
  const ties = report.pieces.filter((p) => p.label.startsWith("8 Waist Tie"));
  expect(ties).toHaveLength(2);

  // Calibration square: on the page, above the sheet (never over a piece).
  expect(report.calibration).not.toBeNull();
  const sheetY = Number(
    /translate\([^ ]+ ([^)]+)\)/.exec(report.sheetLayerTransform!)![1],
  );
  expect(report.calibration!.bottom).toBeLessThanOrEqual(sheetY + 0.001);
  expect(report.calibration!.right).toBeLessThanOrEqual(report.viewBox[2]);

  await setCutCodes(mainWindow, true);

  await electronApp.close();
});

test("Settings: export line width and colours", async () => {
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Written for Quantity and Mirror copy by hand (v1.9.0).
  await setCutCodes(mainWindow, false);
  await expect(mainWindow.locator("#exportCutColour")).toHaveCount(1);
  // Wait until the app has started (settings loaded into the form).
  await expect
    .poll(() =>
      mainWindow.evaluate(
        () =>
          typeof (window as unknown as { config?: { getSync?: unknown } })
            .config?.getSync === "function",
      ),
    )
    .toBe(true);
  // Defaults shown in the form.
  await expect(mainWindow.locator("#exportLineWidthMm")).toHaveValue("2");
  await expect(mainWindow.locator("#exportCutColour")).toHaveValue("#3b1f6e");
  await expect(mainWindow.locator("#exportSewColour")).toHaveValue("#4f8a26");
  await expect(mainWindow.locator("#exportGrainColour")).toHaveValue("#4f8a26");
  await expect(mainWindow.locator("#exportBorderColour")).toHaveValue(
    "#00ffff",
  );
  // v1.7.0: Gravity packing by default; Squeeze is gone.
  await expect(mainWindow.locator('select[name="placementType"]')).toHaveValue(
    "gravity",
  );
  await expect(
    mainWindow.locator(
      'select[name="placementType"] option[value="convexhull"]',
    ),
  ).toHaveCount(0);
  // Changing them saves them.
  const saved = await mainWindow.evaluate(() => {
    const set = (id: string, v: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = v;
      el.dispatchEvent(new Event("change"));
    };
    set("exportLineWidthMm", "1.5");
    set("exportCutColour", "#ff0000");
    const cfg = (
      window as unknown as { config: { getSync(k: string): unknown } }
    ).config;
    return [cfg.getSync("exportLineWidthMm"), cfg.getSync("exportCutColour")];
  });
  expect(saved).toEqual(["1.5", "#ff0000"]);
  // Put them back for the other tests.
  await mainWindow.evaluate(() => {
    const set = (id: string, v: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = v;
      el.dispatchEvent(new Event("change"));
    };
    set("exportLineWidthMm", "2");
    set("exportCutColour", "#3b1f6e");
  });
  await setCutCodes(mainWindow, true);
  await electronApp.close();
});
