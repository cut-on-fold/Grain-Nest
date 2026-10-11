// v1.8.0: "best nests so far" ranks layouts that place more pieces first,
// then by least fabric; once any layout places every piece the others are
// dropped; the nest shown is the top of that list; and exporting a layout
// that left pieces out asks first. Run locally with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import { OpenDialogReturnValue } from "electron";
import path from "path";

type Nest = {
  placements: { sheet: number; sheetplacements: { source: number }[] }[];
  selected?: boolean;
};

test("Ranking: complete layouts first, incomplete ones dropped", async () => {
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  await mainWindow.evaluate(async () => {
    const start = Date.now();
    while (!(window as unknown as { DeepNest?: unknown }).DeepNest) {
      if (Date.now() - start > 20000) throw new Error("app not ready");
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  const result = await mainWindow.evaluate(async () => {
    const mod = (await import(
      // @ts-expect-error -- built file, loaded in the app window
      "../build/ui/utils/nest-rank.js"
    )) as {
      rankNests(dn: unknown, nests: unknown[]): { id: string }[];
      dropIncompleteNests(dn: unknown): boolean;
    };
    // Three pieces (one with quantity 2) and a sheet; each placement's
    // "length" is its x, so the fabric used is the furthest x.
    const parts = [
      { sheet: true, bounds: { x: 0, y: 0 } },
      { quantity: 2 },
      { quantity: 1 },
      { quantity: 1, excluded: true },
    ];
    const nest = (id: string, xs: number[]) => ({
      id,
      placements: [
        {
          sheet: 0,
          sheetplacements: xs.map((x, i) => ({
            source: 1 + (i % 2),
            x,
            y: 0,
            rotation: 0,
          })),
        },
      ],
    });
    const dn = {
      parts,
      placedBounds: (_p: unknown, pl: { x: number }) => ({
        x: pl.x,
        y: 0,
        width: 0,
        height: 0,
      }),
      nests: [
        nest("partial-short", [10, 20]), // 2 of 3 pieces, 20 long
        nest("full-long", [10, 20, 90]), // all 3, 90 long
        nest("full-short", [10, 20, 60]), // all 3, 60 long
      ],
    };
    const order = mod.rankNests(dn, dn.nests).map((n) => n.id);
    const dropped = mod.dropIncompleteNests(dn);
    const left = (dn.nests as { id: string }[]).map((n) => n.id);
    // With nothing complete, nothing is dropped.
    const dn2 = { ...dn, nests: [nest("a", [5]), nest("b", [5, 6])] };
    const dropped2 = mod.dropIncompleteNests(dn2);
    return { order, dropped, left, dropped2, left2: dn2.nests.length };
  });

  expect(result.order).toEqual(["full-short", "full-long", "partial-short"]);
  expect(result.dropped).toBe(true);
  expect(result.left.sort()).toEqual(["full-long", "full-short"]);
  expect(result.dropped2).toBe(false);
  expect(result.left2).toBe(2);
  await electronApp.close();
});

test("Export warns when the layout leaves pieces out", async () => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
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

  // A 60 cm square of fabric: far too small for all 11 pieces.
  await mainWindow.selectOption("#nestjob", "all");
  await mainWindow.evaluate(() => {
    const dn = (
      window as unknown as {
        DeepNest: {
          parts: { sheet?: boolean; excluded?: boolean }[];
          importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
        };
      }
    ).DeepNest;
    const w = (60 / 2.54) * 96;
    dn.importsvg(
      null,
      null,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}"><rect x="0" y="0" width="${w}" height="${w}"/></svg>`,
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
        mainWindow.evaluate(
          () =>
            (window as unknown as { DeepNest: { nests: Nest[] } }).DeepNest
              .nests.length,
        ),
      { timeout: 120000, intervals: [1000] },
    )
    .toBeGreaterThan(0);
  await mainWindow.click("id=stopnest");

  // The nest shown is the top of the list.
  const shownIsTop = await mainWindow.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#nestlist .nest"));
    return rows.length > 0 && rows[0].classList.contains("active");
  });
  expect(shownIsTop).toBe(true);

  // Export: a warning names the missing pieces; Cancel stops the export.
  const messages: string[] = [];
  mainWindow.on("dialog", (d) => {
    messages.push(d.message());
    void d.dismiss();
  });
  let saveAsked = false;
  await electronApp.evaluate(({ dialog }) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string | undefined }
    ).showSaveDialogSync = () => {
      (globalThis as unknown as { saveAsked: boolean }).saveAsked = true;
      return undefined;
    };
  });
  await mainWindow.click("id=export");
  await mainWindow.click("id=exportsvg");
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toMatch(/only fits \d+ of 11 pattern pieces/);
  saveAsked = await electronApp.evaluate(
    () => !!(globalThis as unknown as { saveAsked?: boolean }).saveAsked,
  );
  expect(saveAsked, "cancelled, so no save dialog").toBe(false);
  await electronApp.close();
});
