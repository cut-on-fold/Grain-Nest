/*eslint no-empty-pattern: ["error", { "allowObjectPatternsAsParameters": true }]*/
// v1.1.1: reopening a project and redrawing thumbnails.
//   1. A millimetre-unit SVG reopened from a .gnp came back 3.78x too big
//      (the saved, already-scaled SVG was unit-scaled a second time).
//   2. A project saved while the list was sorted reopened with each name
//      next to another piece's thumbnail and size.
//   3. Flip top / Mirror / Mirror copy / Nest -> Back left rows holding two
//      thumbnails, sometimes of different pieces.
// Run locally with CI=1 (video recording freezes the renderer timers).

import { _electron as electron, expect, test } from "@playwright/test";
import { setAskBeforeLeaving, setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

type P = {
  name?: string;
  sheet?: boolean;
  bounds: { width: number; height: number };
};
type DN = {
  parts: P[];
  mirrorCopyPart(i: number): number;
  importsvg(a: null, b: null, svg: string, c: null, d: boolean): void;
};

test("reopened projects keep size and row order; one thumbnail per row", async ({}, testInfo) => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Written for Quantity and Mirror copy by hand (v1.9.0).
  await setCutCodes(mainWindow, false);
  // Goes Back without saving layouts (v1.10.0).
  await setAskBeforeLeaving(mainWindow, false);

  const svg = path.resolve(__dirname, "assets", "synthetic-mm.svg");
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [p],
      canceled: false,
    });
  }, svg);
  await mainWindow.click("id=import");
  const rows = mainWindow.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 15000 });

  // What each row shows, keyed by the piece it belongs to.
  const rowView = () =>
    mainWindow.evaluate(() => {
      const dn = (window as unknown as { DeepNest: DN }).DeepNest;
      return Array.from(document.querySelectorAll("#partslist tbody tr")).map(
        (tr, i) => ({
          dataName: dn.parts[i].name ?? "",
          shownName: (tr.querySelector("input.partname") as HTMLInputElement)
            .value,
          size: (tr.children[3] as HTMLElement).innerText.replace(/\s+/g, " "),
          svgCount: tr.querySelectorAll("svg").length,
          thumb: tr.querySelector("svg")?.getAttribute("viewBox") ?? "",
          w: dn.parts[i].bounds.width,
          h: dn.parts[i].bounds.height,
        }),
      );
    });
  const byName = (v: Awaited<ReturnType<typeof rowView>>) =>
    Object.fromEntries(v.map((r) => [r.dataName, r]));

  // ---- Rename one piece (so only its saved position, not its name from
  // the file, can find it again), then sort by Size so the saved order
  // differs from the file order.
  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.parts.find((p) => p.name === "Small C2I")!.name = "Small renamed";
  });
  await mainWindow.click("#partslist thead th[data-sort-field=area]");
  const before = await rowView();
  expect(before.map((r) => r.dataName)).toEqual([
    "Small renamed",
    "Mid C1L",
    "Big C2M",
  ]);

  // ---- Save, Clear all, Open.
  const savedPath = path.join(os.tmpdir(), "grainnest-v111-reload.gnp");
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
  await electronApp.evaluate(({ dialog }) => {
    (
      dialog as unknown as { showMessageBoxSync: () => number }
    ).showMessageBoxSync = () => 0;
  });
  await mainWindow.evaluate(() => {
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
  });
  await mainWindow.click("id=clearall");
  await expect(rows).toHaveCount(0);
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [p];
  }, savedPath);
  await mainWindow.click("id=openproject");
  await expect(rows).toHaveCount(3, { timeout: 15000 });

  const after = await rowView();
  await testInfo.attach("rows.json", {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: "application/json",
  });
  expect(
    after.map((r) => r.dataName),
    "saved order",
  ).toEqual(before.map((r) => r.dataName));
  const b = byName(before);
  for (const r of after) {
    // 1. Same size as before saving (not 3.78x).
    expect(r.w, `${r.dataName} width`).toBeCloseTo(
      b[r.dataName.replace("Small C2I", "Small renamed")].w,
      3,
    );
    expect(r.h, `${r.dataName} height`).toBeCloseTo(
      b[r.dataName.replace("Small C2I", "Small renamed")].h,
      3,
    );
    // 2. The row shows this piece's own name, size and thumbnail.
    expect(r.shownName).toBe(r.dataName);
    expect(r.size, `${r.dataName} size label`).toBe(
      b[r.dataName.replace("Small C2I", "Small renamed")].size,
    );
    expect(r.thumb, `${r.dataName} thumbnail`).toBe(
      b[r.dataName.replace("Small C2I", "Small renamed")].thumb,
    );
    expect(r.svgCount).toBe(1);
  }

  // ---- 3. Flip / mirror / mirror copy, then a nest and Back: every row
  // keeps exactly one thumbnail, and it is its own piece's.
  // The reported case: Cut on fold on one piece, then Flip top on another.
  await rows.nth(1).locator("a.mirror", { hasText: "Cut on fold" }).click();
  await rows.nth(0).locator("a.fliptop").click();
  expect((await rowView()).map((r) => r.svgCount)).toEqual([1, 1, 1]);
  await rows.nth(0).locator("a.fliptop").click(); // back as it was
  const unflipped = (await rowView())[0].thumb;
  await rows.nth(0).locator("a.fliptop").click();
  expect(
    (await rowView())[0].thumb,
    "thumbnail redrawn after Flip top",
  ).not.toBe(unflipped);
  await rows
    .nth(1)
    .locator("a.mirror", { hasText: /^Mirror$/ })
    .click();
  await rows.nth(1).locator("a.fliptop").click();
  await rows.nth(2).locator("a.mirror", { hasText: "Mirror copy" }).click();
  await expect(rows).toHaveCount(4);
  await rows.nth(0).locator("a.fliptop").click();
  let v = await rowView();
  expect(v.map((r) => r.svgCount)).toEqual([1, 1, 1, 1]);
  const settled = byName(v.slice(0, 3));

  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.importsvg(
      null,
      null,
      '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect x="0" y="0" width="3000" height="2000"/></svg>',
      null,
      false,
    );
    dn.parts[dn.parts.length - 1].sheet = true;
  });
  await mainWindow.selectOption("#nestjob", "all"); // nudge a re-render
  await expect(rows).toHaveCount(5);
  await mainWindow.click("id=startnest");
  await mainWindow.waitForTimeout(4000);
  await mainWindow.click("id=stopnest").catch(() => {});
  await mainWindow.click("id=back");
  await expect(rows).toHaveCount(5);
  v = await rowView();
  expect(v.map((r) => r.svgCount)).toEqual([1, 1, 1, 1, 1]);
  for (const r of v.slice(0, 3)) {
    expect(r.thumb, `${r.dataName} thumbnail after Back`).toBe(
      settled[r.dataName].thumb,
    );
  }

  // ---- 4. A project saved by the old code (positions counted in the
  // sorted list order, no `exact`) reopens with each name on its own piece,
  // matched by the names detected from the file. (Undo the rename first,
  // so the names match the file, and save afresh.)
  await mainWindow.evaluate(() => {
    const dn = (window as unknown as { DeepNest: DN }).DeepNest;
    dn.parts.find((p) => p.name === "Small renamed")!.name = "Small C2I";
  });
  await mainWindow.click("id=saveproject");
  await mainWindow.waitForTimeout(1000);
  const saved = JSON.parse(fs.readFileSync(savedPath, "utf8")) as {
    parts: {
      source: { kind: string; indexInImport?: number; exact?: boolean };
    }[];
  };
  let counter = 0;
  for (const sp of saved.parts) {
    if (sp.source.kind !== "import") continue;
    sp.source.indexInImport = counter++;
    delete sp.source.exact;
  }
  const oldPath = path.join(os.tmpdir(), "grainnest-v111-oldformat.gnp");
  fs.writeFileSync(oldPath, JSON.stringify(saved));
  const openFile = async (p: string) => {
    await electronApp.evaluate(({ dialog }, f) => {
      (
        dialog as unknown as { showOpenDialogSync: () => string[] }
      ).showOpenDialogSync = () => [f];
    }, p);
    await mainWindow.click("id=openproject");
  };
  await openFile(oldPath);
  await expect
    .poll(async () => (await rowView()).map((r) => r.dataName))
    // + the mirror copy of Big and the sheet added above
    .toEqual(["Small C2I", "Mid C1L", "Big C2M", "Big C2M", ""]);
  v = (await rowView()).slice(0, 3);
  for (const r of v) {
    expect(
      r.h,
      `${r.dataName} has its own shape (height; Mid is folded)`,
    ).toBeCloseTo(b[r.dataName.replace("Small C2I", "Small renamed")].h, 3);
  }

  // ---- 5. A deleted piece stays deleted after save + reopen.
  await mainWindow.evaluate(() => {
    const dn = (
      window as unknown as {
        DeepNest: DN & { parts: (P & { selected?: boolean })[] };
      }
    ).DeepNest;
    dn.parts.forEach((p) => (p.selected = p.name === "Mid C1L"));
  });
  await mainWindow.selectOption("#nestjob", "all"); // nudge a re-render
  await mainWindow.click("#partstools a.delete");
  await expect(rows).toHaveCount(4);
  const delPath = path.join(os.tmpdir(), "grainnest-v111-deleted.gnp");
  if (fs.existsSync(delPath)) fs.unlinkSync(delPath);
  await electronApp.evaluate(({ dialog }, p) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => p;
  }, delPath);
  await mainWindow.click("id=saveproject");
  await expect.poll(() => fs.existsSync(delPath), { timeout: 5000 }).toBe(true);
  await openFile(delPath);
  await expect
    .poll(async () => (await rowView()).map((r) => r.dataName), {
      timeout: 15000,
    })
    .toEqual(["Small C2I", "Big C2M", "Big C2M", ""]);
  v = (await rowView()).slice(0, 2);
  for (const r of v) {
    expect(r.h, `${r.dataName} after delete`).toBeCloseTo(
      b[r.dataName.replace("Small C2I", "Small renamed")].h,
      3,
    );
    expect(r.svgCount).toBe(1);
  }

  await setCutCodes(mainWindow, true);

  await setAskBeforeLeaving(mainWindow, true);

  await electronApp.close();
});
