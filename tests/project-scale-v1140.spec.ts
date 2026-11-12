// v1.14.0: a project remembers the SVG scale it was saved at. Reopened
// with a different Settings → Advanced "SVG scale", its pieces, sheets,
// fold and saved layouts are brought to the new scale, so every real size
// is what it was. Run locally with CI=1.

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
  cutOnFold?: boolean;
  polygontree: Pt[];
  bounds: { x: number; y: number; width: number; height: number };
};
type DN = {
  parts: P[];
  nests: unknown[];
  importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
  placedBounds?: unknown;
};
type W = {
  DeepNest: DN;
  config: { getSync: (k: string) => number | string };
};

/** The Advanced "SVG scale" setting, in units per inch. */
async function getScale(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number((window as unknown as W).config.getSync("scale")),
  );
}

async function setScale(page: Page, perInch: number): Promise<void> {
  // The box is in the folded-away Advanced settings, so set it directly
  // and send the change the form listens for.
  await page.evaluate((v) => {
    const w = window as unknown as W;
    const box = document.querySelector("#inputscale") as HTMLInputElement;
    box.value = String(w.config.getSync("units") === "mm" ? v / 25.4 : v);
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }, perInch);
  await expect.poll(() => getScale(page)).toBeCloseTo(perInch, 3);
}

/** Each row's real size in mm, at the scale now set. */
function sizesMm(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const w = window as unknown as W;
    const perMm = Number(w.config.getSync("scale")) / 25.4;
    const out: Record<string, string> = {};
    w.DeepNest.parts.forEach((p, i) => {
      out[`${i} ${p.name || (p.sheet ? "sheet" : "")}`] =
        `${Math.round(p.bounds.width / perMm)} x ${Math.round(p.bounds.height / perMm)}` +
        (p.cutOnFold ? " folded" : "");
    });
    return out;
  });
}

async function saveAndReopen(
  app: ElectronApplication,
  page: Page,
  between: () => Promise<void>,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-1140-"));
  const file = path.join(dir, "scale.gnp");
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
  await between();
  await page.evaluate(() => {
    (window as unknown as W).DeepNest.parts.forEach((p) => {
      (p as P & { stale?: boolean }).stale = true;
    });
  });
  await page.click("id=openproject");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as unknown as W).DeepNest;
        return (
          d.parts.length > 0 &&
          d.parts.every((p) => !(p as P & { stale?: boolean }).stale)
        );
      }),
    )
    .toBe(true);
}

test("A project keeps its real sizes when the SVG scale setting changes", async () => {
  test.setTimeout(240000);
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  const page = await app.firstWindow();
  await appReady(page);
  await setCutCodes(page, false);
  await setAskBeforeLeaving(page, false);
  const was = await getScale(page);
  try {
    await setScale(page, 96);
    await app.evaluate(
      ({ dialog }, f) => {
        dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
          filePaths: [f],
          canceled: false,
        });
      },
      path.resolve(__dirname, "assets", "synthetic-mm.svg"),
    );
    await page.click("id=import");
    const rows = page.locator("#partslist tbody tr");
    await expect(rows).toHaveCount(3, { timeout: 20000 });

    // Mid on the fold (its fold line is kept in drawing units), and a
    // sheet 1000 x 500 mm made the way Add a sheet makes one.
    await rows.nth(1).getByText("Cut on fold").click();
    await page.evaluate(() => {
      const w = window as unknown as W;
      const perMm = Number(w.config.getSync("scale")) / 25.4;
      const width = 1000 * perMm;
      const height = 500 * perMm;
      w.DeepNest.importsvg(
        null,
        null,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}"/></svg>`,
        null,
        false,
      );
      const s = w.DeepNest.parts[w.DeepNest.parts.length - 1];
      s.sheet = true;
      s.excluded = false;
      s.fabric = "main";
      s.name = "Calico";
    });
    await page.locator("#home_tab").click();

    // A saved layout, to check its placements move with the pieces.
    await page.click("id=startnest");
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as unknown as W).DeepNest.nests.length),
        { timeout: 120000, intervals: [1000] },
      )
      .toBeGreaterThan(0);
    await page.click("id=stopnest");
    await page.click("id=savelayout");
    const modal = page.locator(".gn-modal");
    await modal.locator("button[data-id=save]").click();
    await expect(modal).toHaveCount(0);
    await page.click("id=back");
    await page.waitForTimeout(2500);

    const before = await sizesMm(page);
    expect(before["0 Big C2M"]).toBe("100 x 100");
    expect(before["1 Mid C1L"]).toBe("120 x 80 folded");
    expect(before["3 Calico"]).toBe("1000 x 500");

    // Save at 96, reopen at 72: the same real sizes.
    await saveAndReopen(app, page, () => setScale(page, 72));
    expect(await sizesMm(page)).toEqual(before);

    // The saved layout opens with every piece on the sheet, as saved.
    const saved = page.locator("#layoutspanel .lp-row", { hasText: "Calico" });
    await saved.getByText("Open").click();
    await expect(page.locator("#nest")).toHaveClass("active");
    await expect(page.locator("#nestbanner")).toHaveCount(0);
    const onSheet = await page.evaluate(() => {
      const sheet = document.querySelector(
        "#nestsvg .sheet",
      ) as SVGGraphicsElement;
      const s = sheet.getBoundingClientRect();
      return Array.from(
        document.querySelectorAll("#nestsvg g.part.active"),
      ).map((g) => {
        const r = (g as SVGGraphicsElement).getBoundingClientRect();
        return (
          r.left >= s.left - 1 &&
          r.right <= s.right + 1 &&
          r.top >= s.top - 1 &&
          r.bottom <= s.bottom + 1
        );
      });
    });
    expect(onSheet).toEqual([true, true, true]);
    await page.click("id=back");
    await page.waitForTimeout(2500);

    // And back again: saved at 72, reopened at 96.
    await saveAndReopen(app, page, () => setScale(page, 96));
    expect(await sizesMm(page)).toEqual(before);
  } finally {
    // Settings are shared between test runs.
    await setScale(page, was);
    await setCutCodes(page, true);
    await setAskBeforeLeaving(page, true);
    await app.close();
  }
});
