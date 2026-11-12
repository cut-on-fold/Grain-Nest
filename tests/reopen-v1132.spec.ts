// v1.13.2: mirror copies and saved layouts through Save / Open project,
// and the other fixes of that version. A copy whose original is deleted
// stays its own shape; a copy made in a view is nested; a copy saved flat
// stays flat; a saved layout opens straight after Back; a quantity of 0
// goes back to 1; a layout still says a piece was deleted after reopening;
// a width with no unit is read as px. Run locally with CI=1.

import {
  _electron as electron,
  ElectronApplication,
  expect,
  test,
  Page,
} from "@playwright/test";
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
  excluded?: boolean;
  fabric?: string;
  quantity?: number;
  mirror?: boolean;
  cutOnFold?: boolean;
  isMirrorCopy?: boolean;
  autoCopy?: boolean;
  outOfView?: boolean;
  polygontree: Pt[];
  bounds: { x: number; y: number; width: number; height: number };
};
type DN = {
  parts: P[];
  nests: {
    placements: { sheetplacements: { source: number }[] }[];
  }[];
  importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
  mirrorCopyPart(i: number): number;
  foldPart(i: number): boolean;
  unfoldPart(i: number): boolean;
};

const asset = (name: string) => path.resolve(__dirname, "assets", name);

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  const page = await app.firstWindow();
  await appReady(page);
  // The delete question: yes.
  await page.evaluate(() => {
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
  });
  return { app, page };
}

async function importFiles(
  app: ElectronApplication,
  page: Page,
  files: string[],
): Promise<void> {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: f,
      canceled: false,
    });
  }, files);
  await page.click("id=import");
}

/** Save project, then Open project, through the real buttons. */
async function saveAndReopen(
  app: ElectronApplication,
  page: Page,
  name: string,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-1132-"));
  const file = path.join(dir, name);
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
  // Something only a fresh load can undo, to know the load has happened.
  await page.evaluate(() => {
    (window as unknown as { DeepNest: DN }).DeepNest.parts.forEach((p) => {
      (p as P & { stale?: boolean }).stale = true;
    });
  });
  await page.click("id=openproject");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as unknown as { DeepNest: DN }).DeepNest;
        return (
          d.parts.length > 0 &&
          d.parts.every((p) => !(p as P & { stale?: boolean }).stale)
        );
      }),
    )
    .toBe(true);
}

/** A sheet 150 cm wide and `lengthCm` long, for "main". */
async function addSheet(page: Page, lengthCm: number): Promise<void> {
  await page.evaluate((len) => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    const w = (len / 2.54) * 96;
    const h = (150 / 2.54) * 96;
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
    s.name = "Calico";
  }, lengthCm);
  await page.locator("#home_tab").click();
}

async function nest(page: Page): Promise<void> {
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
}

/** A piece's outline, moved to its own corner and rounded: its shape. */
function shapes(page: Page): Promise<Record<string, string>[]> {
  return page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    return d.parts
      .filter((p) => !p.sheet)
      .map((p) => ({
        name: p.name || "",
        copy: String(!!p.isMirrorCopy),
        mirror: String(!!p.mirror),
        fold: String(!!p.cutOnFold),
        size: `${Math.round(p.bounds.width)}x${Math.round(p.bounds.height)}`,
        shape: p.polygontree
          .map(
            (pt) =>
              `${Math.round(pt.x - p.bounds.x)},${Math.round(pt.y - p.bounds.y)}`,
          )
          .sort()
          .join(" "),
      }));
  });
}

const rowOf = (page: Page, i: number) =>
  page.locator("#partslist tbody tr").nth(i);

test("A mirror copy keeps its shape when its original is deleted", async () => {
  test.setTimeout(120000);
  const { app, page } = await launch();
  await setCutCodes(page, false);
  await importFiles(app, page, [asset("synthetic-mm.svg")]);
  const rows = page.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 20000 });

  // Rows: Big, Mid, Small. Mirror copy Small (not symmetrical, so a
  // mirror of anything else, or an unmirrored Small, shows).
  await rowOf(page, 2).getByText("Mirror copy").click();
  await expect(rows).toHaveCount(4);
  // And a copy of a copy of Big.
  await rowOf(page, 0).getByText("Mirror copy").click();
  await expect(rows).toHaveCount(5);
  await rowOf(page, 4).getByText("Mirror copy").click();
  await expect(rows).toHaveCount(6);
  const before = await shapes(page);
  expect(before.map((s) => s.name)).toEqual([
    "Big C2M",
    "Mid C1L",
    "Small C2I",
    "Small C2I",
    "Big C2M",
    "Big C2M",
  ]);
  expect(before[3].shape).not.toBe(before[2].shape);

  // Delete the original Small, and the middle of the Big chain.
  await rowOf(page, 2).locator("td").nth(3).click();
  await rowOf(page, 4).locator("td").nth(3).click();
  await page.locator("#partstools .button.delete").click();
  await expect(rows).toHaveCount(4);
  const left = await shapes(page);
  // Small's copy is a piece in its own right now; the shapes are untouched.
  expect(left[2]).toEqual({ ...before[3], copy: "false" });
  expect(left[3]).toEqual(before[5]);

  await saveAndReopen(app, page, "orphan.gnp");
  await expect(rows).toHaveCount(4);
  const back = await shapes(page);
  expect(back).toEqual(left);
  // The pieces that weren't touched kept their own settings.
  expect(back[0]).toEqual(before[0]);
  expect(back[1]).toEqual(before[1]);

  await setCutCodes(page, true);
  await app.close();
});

test("A mirror copy made while a view is shown is nested", async () => {
  test.setTimeout(180000);
  const { app, page } = await launch();
  await setCutCodes(page, false);
  await setAskBeforeLeaving(page, false);
  await importFiles(app, page, [asset("synthetic-mm.svg")]);
  const rows = page.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 20000 });

  // A view of Big and Mid.
  await rowOf(page, 0).locator("td").nth(3).click();
  await rowOf(page, 1).locator("td").nth(3).click();
  await page.click("id=saveview");
  const modal = page.locator(".gn-modal");
  await modal.locator("input.gn-modal-input").fill("Two pieces");
  await modal.locator("button[data-id=save]").click();
  await expect(rows).toHaveCount(2);

  await rowOf(page, 0).getByText("Mirror copy").click();
  await expect(rows).toHaveCount(3);
  await addSheet(page, 100);

  await nest(page);
  const placed = await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    return d.nests[0].placements
      .flatMap((sg) => sg.sheetplacements)
      .map((pl) => d.parts[pl.source].name)
      .sort();
  });
  expect(placed).toEqual(["Big C2M", "Big C2M", "Mid C1L"]);

  // And it's still in the view after Back.
  await page.click("id=back");
  await page.waitForTimeout(2500);
  const inView = await page.evaluate(() => {
    const d = (window as unknown as { DeepNest: DN }).DeepNest;
    return d.parts
      .filter((p) => !p.sheet && !p.autoCopy && !p.outOfView)
      .map((p) => p.name)
      .sort();
  });
  expect(inView).toEqual(["Big C2M", "Big C2M", "Mid C1L"]);
  await expect(rows.filter({ hasText: "Mirror copy" })).toHaveCount(3);

  await setCutCodes(page, true);
  await setAskBeforeLeaving(page, true);
  await app.close();
});

test("A mirror copy saved flat comes back flat", async () => {
  test.setTimeout(120000);
  const { app, page } = await launch();
  await setCutCodes(page, false);
  await importFiles(app, page, [asset("synthetic-mm.svg")]);
  const rows = page.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 20000 });

  // Mid on the fold, a copy of it, the copy unfolded; and a copy of Big
  // made before Big... has no fold line, so the second order is Mid again:
  // a second copy, unfolded, then left as it is.
  await rowOf(page, 1).getByText("Cut on fold").click();
  await rowOf(page, 1).getByText("Mirror copy").click();
  await expect(rows).toHaveCount(4);
  await expect(rowOf(page, 3).getByText("Unfold")).toHaveCount(1);
  await rowOf(page, 3).getByText("Unfold").click();
  await expect(rowOf(page, 3).getByText("Cut on fold")).toHaveCount(1);
  const before = await shapes(page);
  expect(before[1].fold).toBe("true");
  expect(before[3].fold).toBe("false");
  expect(before[3].size).not.toBe(before[1].size);

  await saveAndReopen(app, page, "flat-copy.gnp");
  await expect(rows).toHaveCount(4);
  expect(await shapes(page)).toEqual(before);

  // The other way round still works: a folded copy comes back folded.
  await rowOf(page, 3).getByText("Cut on fold").click();
  const folded = await shapes(page);
  expect(folded[3].fold).toBe("true");
  await saveAndReopen(app, page, "folded-copy.gnp");
  expect(await shapes(page)).toEqual(folded);

  await setCutCodes(page, true);
  await app.close();
});

test("A saved layout opens straight after Back", async () => {
  test.setTimeout(240000);
  const { app, page } = await launch();
  await setCutCodes(page, true);
  await setAskBeforeLeaving(page, true);
  await importFiles(app, page, [
    path.resolve(__dirname, "..", "examples", "example-pattern.svg"),
  ]);
  await expect(page.locator("#partslist tbody tr")).toHaveCount(11, {
    timeout: 20000,
  });
  await page.selectOption("#nestjob", "main");
  await addSheet(page, 300);
  await nest(page);
  await page.click("id=savelayout");
  const modal = page.locator(".gn-modal");
  await modal.locator("button[data-id=save]").click();
  await expect(modal).toHaveCount(0);

  // Back, and Open at once (Back's tidy-up is still two seconds off).
  await page.click("id=back");
  const saved = page.locator("#layoutspanel .lp-row", { hasText: "Calico" });
  await saved.getByText("Open").click();
  await expect(page.locator("#nest")).toHaveClass("active");
  await expect(page.locator("#nestsvg g.part.active")).toHaveCount(10);
  await expect(page.locator("#export")).toHaveClass("button export");
  // Still there once the two seconds have passed.
  await page.waitForTimeout(2500);
  await expect(page.locator("#nestsvg g.part.active")).toHaveCount(10);
  await expect(page.locator("#export")).toHaveClass("button export");

  await page.click("id=back");
  await page.waitForTimeout(2500);
  await app.close();
});

test("A quantity of 0 or an empty box goes back to 1", async () => {
  test.setTimeout(60000);
  const { app, page } = await launch();
  await setCutCodes(page, false);
  await importFiles(app, page, [asset("synthetic-mm.svg")]);
  const rows = page.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 20000 });
  const box = rowOf(page, 0).locator("input.rowquantity");
  const quantity = () =>
    page.evaluate(
      () => (window as unknown as { DeepNest: DN }).DeepNest.parts[0].quantity,
    );

  for (const typed of ["0", "", "-2"]) {
    await box.fill(typed);
    await box.press("Tab");
    await expect(box).toHaveValue("1");
    expect(await quantity()).toBe(1);
  }
  await box.fill("3");
  await box.press("Tab");
  await expect(box).toHaveValue("3");
  expect(await quantity()).toBe(3);

  await setCutCodes(page, true);
  await app.close();
});

test("A saved layout still says a piece was deleted after reopening", async () => {
  test.setTimeout(240000);
  const { app, page } = await launch();
  await setCutCodes(page, false);
  await setAskBeforeLeaving(page, true);
  await importFiles(app, page, [asset("synthetic-mm.svg")]);
  const rows = page.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 20000 });
  await addSheet(page, 100);
  await nest(page);
  await page.click("id=savelayout");
  const modal = page.locator(".gn-modal");
  await modal.locator("button[data-id=save]").click();
  await expect(modal).toHaveCount(0);
  await page.click("id=back");
  await page.waitForTimeout(2500);
  const saved = page.locator("#layoutspanel .lp-row", { hasText: "Calico" });
  await expect(saved).toContainText("3/3");

  // Delete Small, then save and reopen the project.
  await rowOf(page, 2).locator("td").nth(3).click();
  await page.locator("#partstools .button.delete").click();
  await expect(rows).toHaveCount(3);
  await saveAndReopen(app, page, "layout-piece-gone.gnp");
  await expect(rows).toHaveCount(3);

  // The panel marks it and counts what it can still place; the banner
  // names the piece.
  await expect(saved).toContainText("2/3");
  await expect(saved.locator(".warn")).toHaveCount(1);
  await saved.getByText("Open").click();
  await expect(page.locator("#nest")).toHaveClass("active");
  await expect(page.locator("#nestbanner")).toContainText("Small C2I: deleted");
  await expect(page.locator("#nestsvg g.part.active")).toHaveCount(2);

  // Saved and reopened a second time, it says the same.
  await page.click("id=back");
  await page.waitForTimeout(2500);
  await saveAndReopen(app, page, "layout-piece-gone-2.gnp");
  await expect(saved).toContainText("2/3");
  await expect(saved.locator(".warn")).toHaveCount(1);

  await setCutCodes(page, true);
  await app.close();
});

test("A width with no unit is read as px", async () => {
  test.setTimeout(60000);
  const { app, page } = await launch();
  await setCutCodes(page, false);
  await importFiles(app, page, [
    asset("synthetic-mm.svg"),
    asset("synthetic-unitless.svg"),
  ]);
  const rows = page.locator("#partslist tbody tr");
  await expect(rows).toHaveCount(4, { timeout: 20000 });
  const sizes = await page.evaluate(() => {
    const w = window as unknown as {
      DeepNest: DN;
      config: { getSync: (k: string) => number };
    };
    const perMm = (Number(w.config.getSync("scale")) || 72) / 25.4;
    const mm = (name: string) => {
      const p = w.DeepNest.parts.find((q) => q.name === name);
      return p ? Math.round((p.bounds.width / perMm) * 10) / 10 : -1;
    };
    return { withUnit: mm("Big C2M"), noUnit: mm("Square C1M") };
  });
  // Both are the same 100 mm square.
  expect(sizes.withUnit).toBeCloseTo(100, 0);
  expect(sizes.noUnit).toBeCloseTo(100, 0);

  await setCutCodes(page, true);
  await app.close();
});
