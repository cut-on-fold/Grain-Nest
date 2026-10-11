// v1.8.0: Save project and Export suggest names made from the imported
// pattern file, in the pattern's folder:
//   <pattern>.gnp, <pattern>_Nested_<Fabric>_<width>.svg and
//   <pattern>_Nested_<Fabric>_<width>_CutList.txt
// Run locally with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import { OpenDialogReturnValue } from "electron";
import path from "path";

test("Save and export suggest names from the pattern file", async () => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  const examples = path.resolve(__dirname, "..", "examples");
  const pattern = path.join(examples, "example-pattern.svg");

  await mainWindow.evaluate(async () => {
    const start = Date.now();
    const w = window as unknown as { DeepNest?: unknown; SvgParser?: unknown };
    while (!w.DeepNest || !w.SvgParser) {
      if (Date.now() - start > 20000) throw new Error("app not ready");
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  // Work in mm, so the width comes out in cm.
  await mainWindow.locator("#config_tab").click();
  await mainWindow.locator("#config").getByRole("radio").nth(1).check();
  await mainWindow.locator("#home_tab").click();

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

  // Every save dialog records the name it suggests, then is cancelled.
  await electronApp.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { suggested: string[] };
    g.suggested = [];
    (
      dialog as unknown as {
        showSaveDialogSync: (o: { defaultPath?: string }) => undefined;
      }
    ).showSaveDialogSync = (o) => {
      g.suggested.push(o.defaultPath || "");
      return undefined;
    };
  });
  const suggested = () =>
    electronApp.evaluate(
      () => (globalThis as unknown as { suggested: string[] }).suggested,
    );

  await mainWindow.click("id=saveproject");
  await expect.poll(async () => (await suggested()).length).toBe(1);
  expect((await suggested())[0]).toBe(
    path.join(examples, "example-pattern.gnp"),
  );

  // Main fabric, 150 cm wide, 3 m long; nest just the cuff.
  await mainWindow.selectOption("#nestjob", "all");
  await mainWindow.evaluate(() => {
    const dn = (
      window as unknown as {
        DeepNest: {
          parts: {
            name?: string;
            sheet?: boolean;
            excluded?: boolean;
            fabric?: string;
          }[];
          importsvg(a: null, b: null, s: string, c: null, d: boolean): void;
        };
      }
    ).DeepNest;
    dn.parts.forEach((p) => {
      p.excluded = !/^10 Cuff/.test(p.name || "");
    });
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
    sheet.excluded = false;
    sheet.fabric = "main";
  });
  await mainWindow.click("id=startnest");
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

  await mainWindow.click("id=export");
  await mainWindow.click("id=exportsvg");
  await expect.poll(async () => (await suggested()).length).toBe(2);
  await mainWindow.click("id=export");
  await mainWindow.click("id=exportcutlist");
  await expect.poll(async () => (await suggested()).length).toBe(3);
  const names = await suggested();
  expect(names[1]).toBe(
    path.join(examples, "example-pattern_Nested_Main_150cm.svg"),
  );
  expect(names[2]).toBe(
    path.join(examples, "example-pattern_Nested_Main_150cm_CutList.txt"),
  );
  await electronApp.close();
});
