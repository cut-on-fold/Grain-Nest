// v1.9.0: switch Settings → "Pairs & folds from cut codes" on or off.
// Settings are shared between test runs, so a test that depends on it
// sets it first. Tests written for Quantity and Mirror copy by hand
// turn it off.

import type { Page } from "@playwright/test";

export async function setCutCodes(page: Page, on: boolean): Promise<void> {
  await page.evaluate(async () => {
    const start = Date.now();
    const w = window as unknown as { DeepNest?: unknown; SvgParser?: unknown };
    while (!w.DeepNest || !w.SvgParser) {
      if (Date.now() - start > 20000) throw new Error("app not ready");
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  await page.locator("#config_tab").click();
  await page.locator("#autoCutsFromCodes").setChecked(on);
  await page.locator("#home_tab").click();
}
