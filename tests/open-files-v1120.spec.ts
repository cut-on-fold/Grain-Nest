// v1.12.0: files the Mac sends Grain-Nest (macOS's open-file event, as
// double-clicking, Open With or `open -a Grain-Nest file` give). A sheets
// file sent while the app is still starting waits and then adds its sheets;
// an SVG imports as Import does; a .gnp opens as Open project does; other
// files are refused; on the nest screen it goes Back first. Run locally
// with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { appReady, setAskBeforeLeaving } from "./helpers/cut-codes";
import fs from "fs";
import os from "os";
import path from "path";

type P = {
  name?: string;
  sheet?: boolean;
  fabric?: string;
  bounds?: { width: number; height: number };
};
type DN = { parts: P[]; nests: unknown[] };

const sendFile = (app: ElectronApplication, file: string) =>
  app.evaluate(({ app }, f) => {
    app.emit("open-file", { preventDefault() {} }, f);
  }, file);

test("Opening files the Mac sends", async () => {
  test.setTimeout(240000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-open-"));
  const sheetsFile = path.join(dir, "Fabrics.gnsheets");
  fs.writeFileSync(
    sheetsFile,
    JSON.stringify({
      format: "grain-nest-sheets",
      version: 1,
      from: "another app",
      sheets: [
        {
          name: "Blue linen",
          fabric: "main",
          widthMm: 1400,
          lengthMm: 3000,
          colour: "blue",
        },
        { name: "Silk", fabric: "lining", widthMm: 1100, lengthMm: 1500 },
        { name: "Denim", fabric: "denim", widthMm: 1500, lengthMm: 2000 },
        { name: "No length", fabric: "main", widthMm: 1400 },
      ],
    }),
  );

  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  // Sent straight away, before the page has loaded: it waits.
  await sendFile(electronApp, sheetsFile);
  const page = await electronApp.firstWindow();
  await appReady(page);
  const modal = page.locator(".gn-modal");
  await expect(modal).toContainText("Added 3 sheets", { timeout: 20000 });
  await expect(modal).toContainText("Blue linen (Main fabric)");
  await expect(modal).toContainText("Silk (Lining)");
  await expect(modal).toContainText('doesn\'t know the fabric "denim"');
  await expect(modal).toContainText("No length was left out");
  await modal.locator("button[data-id=ok]").click();
  await expect(modal).toHaveCount(0);

  const sheets = await page.evaluate(() =>
    (window as unknown as { DeepNest: DN }).DeepNest.parts
      .filter((p) => p.sheet)
      .map((p) => ({
        name: p.name,
        fabric: p.fabric || "",
        // the length runs across, the bolt width up (warp horizontal)
        ratio: p.bounds ? p.bounds.height / p.bounds.width : 0,
      })),
  );
  expect(sheets.map((s) => [s.name, s.fabric])).toEqual([
    ["Blue linen", "main"],
    ["Silk", "lining"],
    ["Denim", ""],
  ]);
  expect(sheets[0].ratio).toBeCloseTo(1400 / 3000, 3);
  expect(sheets[1].ratio).toBeCloseTo(1100 / 1500, 3);

  // An SVG pattern imports as Import does.
  const rows = page.locator("#partslist tbody tr");
  const pattern = path.resolve(
    __dirname,
    "..",
    "examples",
    "example-pattern.svg",
  );
  await sendFile(electronApp, pattern);
  await expect(rows).toHaveCount(14, { timeout: 20000 });

  // Another kind of file is refused.
  await sendFile(electronApp, path.resolve(__dirname, "assets", "not-svg.dxf"));
  await expect(page.locator("#messagecontent")).toContainText(
    "wasn't opened",
  );

  // A project file opens as Open project does.
  const project = path.join(dir, "opened.gnp");
  await electronApp.evaluate(({ dialog }, f) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => f;
  }, project);
  await page.click("id=saveproject");
  await expect.poll(() => fs.existsSync(project)).toBe(true);
  await sendFile(electronApp, pattern);
  await expect(rows).toHaveCount(25, { timeout: 20000 });
  await sendFile(electronApp, project);
  await expect(rows).toHaveCount(14, { timeout: 20000 });

  // On the nest screen it goes Back first, then opens the file.
  await setAskBeforeLeaving(page, false);
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
  await sendFile(electronApp, sheetsFile);
  await expect(modal).toContainText("Added 3 sheets", { timeout: 20000 });
  await expect(page.locator("#main")).toHaveClass(/active/);
  await modal.locator("button[data-id=ok]").click();

  await setAskBeforeLeaving(page, true);
  await electronApp.close();
});
