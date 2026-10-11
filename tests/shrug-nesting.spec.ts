/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// Regression test for §9.0.1 R6-C. A real failing workflow, here with a
// drawn stand-in (tests/assets/synthetic-shrug.svg): import a large shrug
// piece (big, concave, curved outline; diagonal 135.18° grain), mirror-copy
// it, add a large fabric sheet, nest. Pre-fix this placed 1/2 at best (usually 0/2) and
// every individual's fitness was NaN. Guards all three R6-C root causes:
//   1. mirrorPolygontreeX preserves winding (signed-area assertion);
//   2. the material-overlap validators tolerate touch-position slivers
//      (both parts place — NFP positions are touch positions by nature);
//   3. fitness stays finite on sheets where only the first part placed
//      (no-NaN assertion over the worker's ipc responses).
// Run locally with CI=1 (video recording freezes the renderer timers).

import { _electron as electron, expect, test } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import path from "path";

test("shrug + mirror copy both place, windings agree, fitness finite", async ({}, testInfo) => {
  test.setTimeout(180000);

  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });

  const mainWindow = await electronApp.firstWindow();

  // Written for Quantity and Mirror copy by hand (v1.9.0).

  await setCutCodes(mainWindow, false);
  const consoleLines: string[] = [];
  mainWindow.on("console", (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`);
  });

  const shrug = path.resolve(__dirname, "assets", "synthetic-shrug.svg");

  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [p],
      canceled: false,
    });
  }, shrug);

  await mainWindow.click("id=import");
  await expect(mainWindow.locator("#partslist tbody tr")).not.toHaveCount(0, {
    timeout: 20000,
  });

  // ---- Import diagnostics: what did the file become?
  const importDump = await mainWindow.evaluate(() => {
    type Pt = { x: number; y: number };
    type Tree = Pt[] & { children?: Tree[] };
    type P = {
      name?: string;
      sheet?: boolean;
      filename?: string;
      quantity?: number;
      grainRule?: string;
      grainAngle?: number;
      grainSource?: string;
      bounds?: { x: number; y: number; width: number; height: number };
      polygontree?: Tree;
      svgelements?: Element[];
    };
    const dn = (
      window as unknown as {
        DeepNest: { parts: P[]; mirrorCopyPart(i: number): number };
      }
    ).DeepNest;
    const gapAt = (t: Tree) => {
      // distance between first and last point — a formally unclosed ring
      const a = t[0];
      const b = t[t.length - 1];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    return dn.parts.map((p, i) => ({
      i,
      name: p.name,
      sheet: !!p.sheet,
      quantity: p.quantity,
      grainRule: p.grainRule,
      grainAngle: p.grainAngle,
      grainSource: p.grainSource,
      bounds: p.bounds
        ? {
            x: Math.round(p.bounds.x),
            y: Math.round(p.bounds.y),
            w: Math.round(p.bounds.width),
            h: Math.round(p.bounds.height),
          }
        : null,
      ringPoints: p.polygontree ? p.polygontree.length : 0,
      ringGap: p.polygontree
        ? Math.round(gapAt(p.polygontree) * 100) / 100
        : null,
      holes: p.polygontree?.children ? p.polygontree.children.length : 0,
      elements: (p.svgelements || []).map(
        (e) =>
          e.tagName +
          ((e as Element).getAttribute?.("data-grainnest-grain") === "1"
            ? "[grain]"
            : ""),
      ),
    }));
  });

  await testInfo.attach("import-dump.json", {
    body: JSON.stringify({ importDump, consoleLines }, null, 2),
    contentType: "application/json",
  });

  // ---- The workflow: mirror copy the (only) piece, add a big sheet.
  const setup = await mainWindow.evaluate(() => {
    type Pt = { x: number; y: number };
    type P = { sheet?: boolean; polygontree?: Pt[] };
    const dn = (
      window as unknown as {
        DeepNest: {
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
      }
    ).DeepNest;
    // Shoelace signed area — the SIGN is the winding direction.
    const signedArea = (pts: Pt[]): number => {
      let a = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
      }
      return a / 2;
    };
    const pieceIdx = dn.parts.findIndex((p) => !p.sheet);
    const copyIdx = dn.mirrorCopyPart(pieceIdx);
    // Sheet: 100 in × 61.8 in at 96 dpi — a real fabric sheet ("Nested 160cm
    // fabric": 9600 × 5932.8 SVG units).
    const before = dn.parts.length;
    dn.importsvg(
      null,
      null,
      '<svg xmlns="http://www.w3.org/2000/svg" width="9600" height="5932.8"><rect x="0" y="0" width="9600" height="5932.8"/></svg>',
      null,
      false,
    );
    const sheetIdx = before;
    (dn.parts[sheetIdx] as P).sheet = true;
    return {
      pieceIdx,
      copyIdx,
      sheetIdx,
      totalParts: dn.parts.length,
      // §9.0.1 R6-C: mirroring must PRESERVE winding (mirrorPolygontreeX
      // reverses the ring after flipping). Same sign = same winding.
      pieceAreaSign: Math.sign(signedArea(dn.parts[pieceIdx].polygontree!)),
      copyAreaSign: Math.sign(signedArea(dn.parts[copyIdx].polygontree!)),
    };
  });

  // THE R6-C ROOT-CAUSE ASSERTION: the mirrored ring keeps its winding.
  expect(
    setup.copyAreaSign,
    "mirror copy's winding matches its source (reversed ring after flip)",
  ).toBe(setup.pieceAreaSign);

  // ---- One nest attempt. Click Start, poll until BOTH parts place
  // (piece + mirror copy — the expected "2 pieces"), then stop.
  await mainWindow.click("id=startnest");

  type NestRow = { sheets: number; placed: number; utilisation?: number };
  let nestSummary: NestRow[] = [];
  let bothPlaced = false;
  for (let tick = 0; tick < 15 && !bothPlaced; tick++) {
    await mainWindow.waitForTimeout(5000);
    nestSummary = await mainWindow.evaluate(() => {
      type Placement = { sheetplacements: unknown[] };
      type N = { placements: Placement[]; utilisation?: number };
      const dn = (window as unknown as { DeepNest: { nests: N[] } }).DeepNest;
      return dn.nests.map((n) => ({
        sheets: n.placements.length,
        placed: n.placements.reduce(
          (acc, s) => acc + s.sheetplacements.length,
          0,
        ),
        utilisation: n.utilisation,
      }));
    });
    bothPlaced = nestSummary.some((n) => n.placed === 2);
  }
  await mainWindow.click("id=stopnest").catch(() => {});

  const evidence = JSON.stringify(
    { setup, nestSummary, importDump, consoleLines },
    null,
    2,
  );
  fs.writeFileSync(path.join("test-results", "r6c-evidence.json"), evidence);
  await testInfo.attach("nest-summary.json", {
    body: evidence,
    contentType: "application/json",
  });

  // Pre-fix this was 1/2 (the second instance never placed on a near-empty
  // 100 in sheet); 2/2 proves the winding + overlap-tolerance fixes hold.
  expect(bothPlaced, "a nest places BOTH the shrug and its mirror copy").toBe(
    true,
  );

  // R6-C root cause 3: a blind GA can't converge. Every ipc fitness must
  // be a real number.
  const nanLines = consoleLines.filter((l) => /fitness: NaN/.test(l));
  expect(nanLines.length, "no NaN fitness in any engine response").toBe(0);

  await setCutCodes(mainWindow, true);

  await electronApp.close();
});
