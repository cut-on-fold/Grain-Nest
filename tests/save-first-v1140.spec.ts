// v1.14.0: "Save this project first?". A project from Finder, the Open
// project button and Clear all replace what's on screen; with unsaved work
// there they ask first (Save project… / Don't save / Cancel). Nothing is
// asked when the screen is empty or nothing has changed since the last
// Save or Open, and an SVG from Finder just adds its pieces. Run locally
// with CI=1.

import {
  _electron as electron,
  ElectronApplication,
  expect,
  test,
  Page,
} from "@playwright/test";
import {
  appReady,
  setAskBeforeReplacing,
  setCutCodes,
} from "./helpers/cut-codes";
import { OpenDialogReturnValue } from "electron";
import fs from "fs";
import os from "os";
import path from "path";

type DN = { parts: { name?: string; quantity?: number }[] };

const asset = (name: string) => path.resolve(__dirname, "assets", name);

const sendFile = (app: ElectronApplication, file: string) =>
  app.evaluate(({ app }, f) => {
    app.emit("open-file", { preventDefault() {} }, f);
  }, file);

const names = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { DeepNest: DN }).DeepNest.parts.map(
      (p) => `${p.name} x${p.quantity}`,
    ),
  );

/** Where Save project writes and Open project reads. */
async function useFile(app: ElectronApplication, file: string) {
  await app.evaluate(({ dialog }, f) => {
    (
      dialog as unknown as { showSaveDialogSync: () => string }
    ).showSaveDialogSync = () => f;
    (
      dialog as unknown as { showOpenDialogSync: () => string[] }
    ).showOpenDialogSync = () => [f];
  }, file);
}

test("Unsaved work asks before a project replaces it", async () => {
  test.setTimeout(180000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-save-first-"));
  const one = path.join(dir, "One.gnp");
  const two = path.join(dir, "Two.gnp");
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  const page = await app.firstWindow();
  await appReady(page);
  await setCutCodes(page, false);
  await setAskBeforeReplacing(page, true);
  const modal = page.locator(".gn-modal");
  const rows = page.locator("#partslist tbody tr");
  const quantity = (i: number) => rows.nth(i).locator("input.rowquantity");
  const setQuantity = async (i: number, n: number) => {
    await quantity(i).fill(String(n));
    await quantity(i).press("Tab");
  };

  // Project One: the three pieces as they come. Saved.
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async (): Promise<OpenDialogReturnValue> => ({
      filePaths: [f],
      canceled: false,
    });
  }, asset("synthetic-mm.svg"));
  await page.click("id=import");
  await expect(rows).toHaveCount(3, { timeout: 20000 });
  await useFile(app, one);
  await page.click("id=saveproject");
  await expect.poll(() => fs.existsSync(one)).toBe(true);
  const asOne = await names(page);

  // Project Two: Big x4. Saved; then nothing has changed, so opening One
  // from Finder asks nothing.
  await setQuantity(0, 4);
  await useFile(app, two);
  await page.click("id=saveproject");
  await expect.poll(() => fs.existsSync(two)).toBe(true);
  const asTwo = await names(page);
  expect(asTwo[0]).toBe("Big C2M x4");
  await sendFile(app, one);
  await expect.poll(() => names(page)).toEqual(asOne);
  await expect(modal).toHaveCount(0);

  // Just opened: still nothing to ask.
  await sendFile(app, two);
  await expect.poll(() => names(page)).toEqual(asTwo);
  await expect(modal).toHaveCount(0);

  // A change (Big x7), then One arrives from Finder: it asks, by name.
  await setQuantity(0, 7);
  const changed = await names(page);
  await sendFile(app, one);
  await expect(modal).toContainText("Save this project first?");
  await expect(modal).toContainText("Opening One.gnp replaces");

  // Cancel: everything as it was, One not opened.
  await modal.locator("button[data-id=cancel]").click();
  await expect(modal).toHaveCount(0);
  expect(await names(page)).toEqual(changed);

  // Esc is Cancel too.
  await sendFile(app, one);
  await expect(modal).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  expect(await names(page)).toEqual(changed);

  // Save project…: the change is written to Two, then One opens.
  await useFile(app, two);
  await sendFile(app, one);
  await modal.locator("button[data-id=save]").click();
  await expect.poll(() => names(page)).toEqual(asOne);
  expect(fs.readFileSync(two, "utf8")).toContain('"quantity": 7');

  // Don't save: a change to One is dropped, Two opens with Big x7.
  await setQuantity(1, 5);
  await sendFile(app, two);
  await modal.locator("button[data-id=discard]").click();
  await expect.poll(() => names(page)).toEqual(changed);
  expect(fs.readFileSync(one, "utf8")).not.toContain('"quantity": 5');

  // Save project… but cancelling the file dialog counts as Cancel.
  await setQuantity(1, 6);
  const now = await names(page);
  await app.evaluate(({ dialog }) => {
    (
      dialog as unknown as { showSaveDialogSync: () => undefined }
    ).showSaveDialogSync = () => undefined;
  });
  await sendFile(app, one);
  await modal.locator("button[data-id=save]").click();
  await expect(modal).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await names(page)).toEqual(now);

  // The Open project button asks the same way.
  await useFile(app, one);
  await page.click("id=openproject");
  await expect(modal).toContainText("Opening another project replaces");
  await modal.locator("button[data-id=discard]").click();
  await expect.poll(() => names(page)).toEqual(asOne);

  await setCutCodes(page, true);
  await app.close();
});

test("Clear all, an SVG from Finder, and the Settings tick", async () => {
  test.setTimeout(120000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gn-save-first-"));
  const file = path.join(dir, "Kept.gnp");
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  const page = await app.firstWindow();
  await appReady(page);
  await setCutCodes(page, false);
  await setAskBeforeReplacing(page, true);
  const modal = page.locator(".gn-modal");
  const rows = page.locator("#partslist tbody tr");
  // The plain "Continue?" (used when there's nothing unsaved): count it.
  await page.evaluate(() => {
    const w = window as unknown as { confirm: () => boolean; asked: number };
    w.asked = 0;
    w.confirm = () => {
      w.asked++;
      return true;
    };
  });
  const plainAsked = () =>
    page.evaluate(() => (window as unknown as { asked: number }).asked);

  // An empty screen: an SVG from Finder comes straight in.
  await sendFile(app, asset("synthetic-mm.svg"));
  await expect(rows).toHaveCount(3, { timeout: 20000 });
  await expect(modal).toHaveCount(0);

  // Never saved, so it's unsaved work. A second SVG only adds pieces: no
  // question.
  await sendFile(app, asset("synthetic-unitless.svg"));
  await expect(rows).toHaveCount(4, { timeout: 20000 });
  await expect(modal).toHaveCount(0);

  // Clear all asks the save question (not the plain one). Cancel keeps it.
  await page.click("id=clearall");
  await expect(modal).toContainText("Save this project first?");
  await expect(modal).toContainText("Clear all replaces");
  await modal.locator("button[data-id=cancel]").click();
  await expect(rows).toHaveCount(4);
  expect(await plainAsked()).toBe(0);

  // Save project… from the question saves, then clears.
  await useFile(app, file);
  await page.click("id=clearall");
  await modal.locator("button[data-id=save]").click();
  await expect(rows).toHaveCount(0);
  expect(fs.existsSync(file)).toBe(true);

  // Reopened and untouched: Clear all asks only the plain "Continue?".
  await page.click("id=openproject");
  await expect(rows).toHaveCount(4, { timeout: 20000 });
  await expect(modal).toHaveCount(0);
  await page.click("id=clearall");
  await expect(rows).toHaveCount(0);
  await expect(modal).toHaveCount(0);
  expect(await plainAsked()).toBe(1);

  // With the Settings tick off, unsaved work is replaced without asking.
  await setAskBeforeReplacing(page, false);
  await sendFile(app, asset("synthetic-mm.svg"));
  await expect(rows).toHaveCount(3, { timeout: 20000 });
  await sendFile(app, file);
  await expect(rows).toHaveCount(4, { timeout: 20000 });
  await expect(modal).toHaveCount(0);

  await setAskBeforeReplacing(page, true);
  await setCutCodes(page, true);
  await app.close();
});
