// v1.12.1: the main window opens at the size and place it was left at,
// and at 90% of the screen when there's nothing saved or the saved place
// is off every screen. Run locally with CI=1.

import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import fs from "fs";
import path from "path";

const launch = () => electron.launch({ args: ["main.js", "--no-sandbox"] });

const bounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().endsWith("index.html"),
    );
    return w ? w.getBounds() : null;
  });

test("The window remembers its size and place", async () => {
  test.setTimeout(120000);
  let app = await launch();
  await app.firstWindow();
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  const stateFile = path.join(userData, "window-state.json");
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().endsWith("index.html"),
    )!;
    w.setBounds({ x: 40, y: 50, width: 900, height: 640 });
  });
  await app.close();

  const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  expect(saved).toMatchObject({ width: 900, height: 640 });

  // Reopened: the same size and place.
  app = await launch();
  await app.firstWindow();
  await expect
    .poll(() => bounds(app))
    .toMatchObject({ x: 40, y: 50, width: 900, height: 640 });
  await app.close();

  // Saved somewhere no screen is: back to 90% of the screen.
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ x: -20000, y: -20000, width: 900, height: 640 }),
  );
  app = await launch();
  await app.firstWindow();
  const b = await bounds(app);
  const area = await app.evaluate(
    ({ screen }) => screen.getPrimaryDisplay().workAreaSize,
  );
  expect(b!.width).toBe(Math.ceil(area.width * 0.9));
  await app.close();

  // Leave nothing behind for the other tests.
  fs.rmSync(stateFile, { force: true });
});
