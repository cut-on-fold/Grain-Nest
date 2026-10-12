// v1.9.0: pairs and folds from cut codes. With the setting on (the
// default), each piece stays one row and its copies are worked out when a
// nest starts: C2M = one as drawn + one mirrored, C1MOF = folded, and the
// count follows "Nest for". Run locally with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import { OpenDialogReturnValue } from "electron";
import path from "path";
import { setAskBeforeLeaving, setCutCodes } from "./helpers/cut-codes";

type Cut = { asDrawn: number; mirrored: number; fold: boolean } | null;

test("Cut-code rules: pairs, folds, fusing and overrides", async () => {
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Goes Back without saving layouts (v1.10.0).
  await setAskBeforeLeaving(mainWindow, false);
  await mainWindow.evaluate(async () => {
    const start = Date.now();
    while (!(window as unknown as { DeepNest?: unknown }).DeepNest) {
      if (Date.now() - start > 20000) throw new Error("app not ready");
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  const r = await mainWindow.evaluate(async () => {
    const mod = (await import(
      // @ts-expect-error -- built file, loaded in the app window
      "../build/ui/utils/auto-cuts.js"
    )) as {
      cutsFor(p: object, job: string, bulk: boolean): Cut;
      jobsForPiece(p: object, bulk: boolean): Set<string>;
      parseCuts(name: string): Record<string, { count: number; fold: boolean }>;
    };
    const c = (name: string, job: string, bulk = true, extra = {}) =>
      mod.cutsFor({ name, ...extra }, job, bulk);
    const jobs = (name: string, bulk = true, extra = {}) =>
      [...mod.jobsForPiece({ name, ...extra }, bulk)].sort();
    return {
      parse: mod.parseCuts("16 Hood Facing C2M C1IOF"),
      pair: c("2 Back C2M", "main"),
      three: c("Front C3M", "main"),
      fold: c("1 Front C1MOF", "main"),
      none: c("Belt loop", "main"),
      zero: c("2 Back C2M", "main", true, { mirrorCount: 0 }),
      allMirrored: c("2 Back C2M", "main", true, { mirrorCount: 2 }),
      lining: c("9 Lining C2M C2L", "lining"),
      liningInMain: c("9 Lining C2M C2L", "main"),
      ribbing: c("Cuff C2R", "main"),
      // Equal main & interfacing: bulk-fused by default…
      bulkFused: c("5 Pocket C2M C2I", "fused"),
      bulkMain: c("5 Pocket C2M C2I", "main"),
      bulkInt: c("5 Pocket C2M C2I", "interfacing"),
      bulkJobs: jobs("5 Pocket C2M C2I"),
      // …or cut separately, by the Settings default.
      sepMain: c("5 Pocket C2M C2I", "main", false),
      sepInt: c("5 Pocket C2M C2I", "interfacing", false),
      sepJobs: jobs("5 Pocket C2M C2I", false),
      // Fewer interfacing: separate unless the piece says otherwise.
      fewerMain: c("Collar C2M C1I", "main"),
      fewerInt: c("Collar C2M C1I", "interfacing"),
      oneFused: c("Collar C2M C1I", "fused", true, { fuseMode: "one" }),
      oneMain: c("Collar C2M C1I", "main", true, { fuseMode: "one" }),
      oneInt: c("Collar C2M C1I", "interfacing", true, { fuseMode: "one" }),
      oneJobs: jobs("Collar C2M C1I", true, { fuseMode: "one" }),
      intPiece: c("INT1 Waistband Interfacing", "interfacing"),
      intPieceMain: c("INT1 Waistband Interfacing", "main"),
    };
  });

  expect(r.parse).toEqual({
    M: { count: 2, fold: false },
    I: { count: 1, fold: true },
  });
  expect(r.pair).toEqual({ asDrawn: 1, mirrored: 1, fold: false });
  expect(r.three).toEqual({ asDrawn: 2, mirrored: 1, fold: false });
  expect(r.fold).toEqual({ asDrawn: 1, mirrored: 0, fold: true });
  expect(r.none).toBeNull();
  expect(r.zero).toEqual({ asDrawn: 2, mirrored: 0, fold: false });
  expect(r.allMirrored).toEqual({ asDrawn: 0, mirrored: 2, fold: false });
  expect(r.lining).toEqual({ asDrawn: 1, mirrored: 1, fold: false });
  expect(r.liningInMain).toEqual({ asDrawn: 1, mirrored: 1, fold: false });
  expect(r.ribbing).toEqual({ asDrawn: 0, mirrored: 0, fold: false });
  expect(r.bulkFused).toEqual({ asDrawn: 1, mirrored: 1, fold: false });
  expect(r.bulkMain).toEqual({ asDrawn: 0, mirrored: 0, fold: false });
  expect(r.bulkInt).toEqual({ asDrawn: 0, mirrored: 0, fold: false });
  expect(r.bulkJobs).toEqual(["fused"]);
  expect(r.sepMain).toEqual({ asDrawn: 1, mirrored: 1, fold: false });
  expect(r.sepInt).toEqual({ asDrawn: 1, mirrored: 1, fold: false });
  expect(r.sepJobs).toEqual(["interfacing", "main"]);
  expect(r.fewerMain).toEqual({ asDrawn: 1, mirrored: 1, fold: false });
  expect(r.fewerInt).toEqual({ asDrawn: 1, mirrored: 0, fold: false });
  // One fused: the fused piece is the one as drawn, the plain main piece
  // its mirror, and no interfacing is left to cut on its own.
  expect(r.oneFused).toEqual({ asDrawn: 1, mirrored: 0, fold: false });
  expect(r.oneMain).toEqual({ asDrawn: 0, mirrored: 1, fold: false });
  expect(r.oneInt).toEqual({ asDrawn: 0, mirrored: 0, fold: false });
  expect(r.oneJobs).toEqual(["fused", "main"]);
  expect(r.intPiece).toEqual({ asDrawn: 1, mirrored: 0, fold: false });
  expect(r.intPieceMain).toEqual({ asDrawn: 0, mirrored: 0, fold: false });
  await setAskBeforeLeaving(mainWindow, true);
  await electronApp.close();
});

type Row = {
  name?: string;
  sheet?: boolean;
  excluded?: boolean;
  cutOnFold?: boolean;
  mirror?: boolean;
  nestQuantity?: number;
  autoCopy?: boolean;
  autoSkip?: boolean;
  isMirrorCopy?: boolean;
};

test("A nest makes the pairs and folds from the cut codes", async () => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Goes Back without saving layouts (v1.10.0).
  await setAskBeforeLeaving(mainWindow, false);
  const pattern = path.resolve(
    __dirname,
    "..",
    "examples",
    "example-pattern.svg",
  );
  await mainWindow.evaluate(async () => {
    const start = Date.now();
    const w = window as unknown as { DeepNest?: unknown; SvgParser?: unknown };
    while (!w.DeepNest || !w.SvgParser) {
      if (Date.now() - start > 20000) throw new Error("app not ready");
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  // The setting is on by default (settings are shared between test runs,
  // so make sure it's on here).
  const defaultOn = await mainWindow.evaluate(async () => {
    const mod = (await import(
      // @ts-expect-error -- built file, loaded in the app window
      "../build/ui/services/config.service.js"
    )) as { DEFAULT_CONFIG: { autoCutsFromCodes?: boolean } };
    return mod.DEFAULT_CONFIG.autoCutsFromCodes;
  });
  expect(defaultOn).toBe(true);
  await setCutCodes(mainWindow, true);

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

  // A coded piece shows its count and a Mirrored choice instead of a
  // Quantity box, and no Mirror copy button; a fold piece says "on fold".
  const back = mainWindow.locator("#partslist tbody tr", {
    has: mainWindow.locator('input.partname[value="2 Bodice Back C2M"]'),
  });
  await expect(back.locator(".autoqty")).toHaveText("2");
  await expect(back.locator("select.mirrorcount")).toHaveValue("auto");
  await expect(back.getByText("Mirror copy")).toHaveCount(0);
  const front = mainWindow.locator("#partslist tbody tr", {
    has: mainWindow.locator('input.partname[value="1 Bodice Front C1MOF"]'),
  });
  await expect(front.locator(".autonote")).toHaveText("on fold");
  const pocket = mainWindow.locator("#partslist tbody tr", {
    has: mainWindow.locator('input.partname[value="5 Pocket C2M C2I"]'),
  });
  await expect(pocket.locator("select.fusemode")).toHaveValue("all");

  // Main fabric 150 cm x 4 m; nest for Main fabric.
  await mainWindow.selectOption("#nestjob", "main");
  await mainWindow.evaluate(() => {
    const dn = (
      window as unknown as {
        DeepNest: {
          parts: Row[];
          importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
        };
      }
    ).DeepNest;
    const w = (400 / 2.54) * 96;
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

  const state = await mainWindow.evaluate(async () => {
    const dn = (window as unknown as { DeepNest: { parts: Row[] } }).DeepNest;
    const rank = (await import(
      // @ts-expect-error -- built file, loaded in the app window
      "../build/ui/utils/nest-rank.js"
    )) as { piecesToPlace(dn: unknown): number };
    const by = (n: string) => dn.parts.find((p) => p.name === n && !p.autoCopy);
    const copies = dn.parts.filter((p) => p.autoCopy);
    return {
      toPlace: rank.piecesToPlace(dn),
      copies: copies.map((p) => p.name).sort(),
      copiesMirrored: copies.every((p) => p.mirror && p.nestQuantity === 1),
      copiesAtEnd: dn.parts.slice(-copies.length).every((p) => p.autoCopy),
      backQty: by("2 Bodice Back C2M")?.nestQuantity,
      frontFolded: by("1 Bodice Front C1MOF")?.cutOnFold,
      frontQty: by("1 Bodice Front C1MOF")?.nestQuantity,
      skirtFolded: by("6 Skirt Front C1MOF")?.cutOnFold,
      pocketIn: !by("5 Pocket C2M C2I")?.excluded,
    };
  });
  // Main: two fold pieces (1 each) and four pairs; the pocket and neck
  // facing (equal main & interfacing) are bulk-fused, not main fabric.
  expect(state.toPlace).toBe(10);
  expect(state.copies).toEqual([
    "2 Bodice Back C2M",
    "3 Sleeve C2M",
    "7 Skirt Back C2M",
    "8 Waist Tie C2M",
  ]);
  expect(state.copiesMirrored).toBe(true);
  expect(state.copiesAtEnd).toBe(true);
  expect(state.backQty).toBe(1);
  expect(state.frontFolded).toBe(true);
  expect(state.frontQty).toBe(1);
  expect(state.skirtFolded).toBe(true);
  expect(state.pocketIn).toBe(false);

  await expect
    .poll(
      () =>
        mainWindow.evaluate(
          () =>
            (window as unknown as { DeepNest: { nests: unknown[] } }).DeepNest
              .nests.length,
        ),
      { timeout: 120000, intervals: [1000] },
    )
    .toBeGreaterThan(0);
  await mainWindow.click("id=stopnest");

  // Back to the pieces: the copies go, the folds stay.
  await mainWindow.click("id=back");
  await expect
    .poll(() =>
      mainWindow.evaluate(
        () =>
          (
            window as unknown as { DeepNest: { parts: Row[] } }
          ).DeepNest.parts.filter((p) => p.autoCopy).length,
      ),
    )
    .toBe(0);
  await expect(front.getByText("Unfold")).toBeVisible();

  // Mirrored 0: both backs cut the same way, no copy.
  await back.locator("select.mirrorcount").selectOption("0");
  const zero = await mainWindow.evaluate(async () => {
    const dn = (window as unknown as { DeepNest: { parts: Row[] } }).DeepNest;
    const mod = (await import(
      // @ts-expect-error -- built file, loaded in the app window
      "../build/ui/utils/auto-cuts.js"
    )) as {
      applyAutoCuts(dn: unknown, job: string, bulk: boolean): unknown;
      clearAutoCuts(dn: unknown): void;
    };
    mod.applyAutoCuts(dn, "main", true);
    const back = dn.parts.filter((p) => p.name === "2 Bodice Back C2M");
    const out = back.map((p) => ({ q: p.nestQuantity, copy: !!p.autoCopy }));
    mod.clearAutoCuts(dn);
    return out;
  });
  expect(zero).toEqual([{ q: 2, copy: false }]);
  await setAskBeforeLeaving(mainWindow, true);
  await electronApp.close();
});

test("With the setting off, Quantity and Mirror copy work as before", async () => {
  test.setTimeout(120000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  // Goes Back without saving layouts (v1.10.0).
  await setAskBeforeLeaving(mainWindow, false);
  const pattern = path.resolve(
    __dirname,
    "..",
    "examples",
    "example-pattern.svg",
  );
  await mainWindow.evaluate(async () => {
    const start = Date.now();
    const w = window as unknown as { DeepNest?: unknown; SvgParser?: unknown };
    while (!w.DeepNest || !w.SvgParser) {
      if (Date.now() - start > 20000) throw new Error("app not ready");
      await new Promise((r) => setTimeout(r, 50));
    }
  });
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

  await mainWindow.locator("#config_tab").click();
  await mainWindow.locator("#autoCutsFromCodes").uncheck();
  await mainWindow.locator("#home_tab").click();
  try {
    const back = mainWindow.locator("#partslist tbody tr", {
      has: mainWindow.locator('input.partname[value="2 Bodice Back C2M"]'),
    });
    await expect(back.locator(".autoqty")).toHaveCount(0);
    await expect(back.locator('input[type="number"]').first()).toBeVisible();
    await back.getByText("Mirror copy").click();
    await expect(mainWindow.locator("#partslist tbody tr")).toHaveCount(12);

    // Turned back on, the manual copy is hidden (the code counts it) and
    // nests none.
    await mainWindow.locator("#config_tab").click();
    await mainWindow.locator("#autoCutsFromCodes").check();
    await mainWindow.locator("#home_tab").click();
    await expect(mainWindow.locator("#partslist tbody tr")).toHaveCount(11);
  } finally {
    // Settings are shared between test runs: leave it on.
    await mainWindow.locator("#config_tab").click();
    await mainWindow.locator("#autoCutsFromCodes").check();
  }
  await setAskBeforeLeaving(mainWindow, true);
  await electronApp.close();
});
