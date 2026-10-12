// v1.9.1: after Stop then Back, starting a new nest shows Stop (it used to
// say Start when the delayed relabel from the last Stop landed late, so it
// took two clicks to stop), and the delayed clean-up from Back doesn't stop
// the new nest. Run locally with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import { setCutCodes } from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import path from "path";

test("Start after Stop and Back shows Stop and keeps nesting", async () => {
  test.setTimeout(180000);
  const electronApp = await electron.launch({
    args: ["main.js", "--no-sandbox"],
  });
  const mainWindow = await electronApp.firstWindow();
  await setCutCodes(mainWindow, true);
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
  await mainWindow.selectOption("#nestjob", "main");
  await mainWindow.evaluate(() => {
    const dn = (
      window as unknown as {
        DeepNest: {
          parts: { sheet?: boolean; excluded?: boolean }[];
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
  const nests = () =>
    mainWindow.evaluate(
      () =>
        (window as unknown as { DeepNest: { nests: unknown[] } }).DeepNest.nests
          .length,
    );
  const stop = mainWindow.locator("#stopnest");

  await mainWindow.click("id=startnest");
  await expect(stop).toHaveClass("button stop");
  await expect
    .poll(nests, { timeout: 120000, intervals: [1000] })
    .toBeGreaterThan(0);

  // Stop, then straight back to the pieces: the "Start" relabel from Stop
  // is still pending (3 s) when Back resets the button (2 s).
  await stop.click();
  await mainWindow.click("id=back");
  await mainWindow.waitForTimeout(3500);

  await mainWindow.click("id=startnest");
  await expect(stop).toHaveClass("button stop");
  await expect
    .poll(nests, { timeout: 120000, intervals: [1000] })
    .toBeGreaterThan(0);
  await mainWindow.waitForTimeout(3500);
  await expect(stop).toHaveClass("button stop");

  // Back then Start at once: Back's clean-up runs first, not 2 s into the
  // new nest (which used to reset it).
  await stop.click();
  await mainWindow.click("id=back");
  await mainWindow.click("id=startnest");
  await expect
    .poll(nests, { timeout: 120000, intervals: [1000] })
    .toBeGreaterThan(0);
  await mainWindow.waitForTimeout(3000);
  expect(await nests()).toBeGreaterThan(0);
  await expect(stop).toHaveClass("button stop");

  // One click stops it.
  await stop.click();
  await expect(stop).toHaveClass("button stop disabled");
  await electronApp.close();
});
