// v1.9.0: switch Settings → "Pairs & folds from cut codes" on or off.
// Settings are shared between test runs, so a test that depends on it
// sets it first. Tests written for Quantity and Mirror copy by hand
// turn it off.

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Waits until the app has started (DeepNest and the SVG parser loaded). */
export async function appReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const start = Date.now();
    const w = window as unknown as { DeepNest?: unknown; SvgParser?: unknown };
    while (!w.DeepNest || !w.SvgParser) {
      if (Date.now() - start > 20000) throw new Error("app not ready");
      await new Promise((r) => setTimeout(r, 50));
    }
  });
}

export async function setCutCodes(page: Page, on: boolean): Promise<void> {
  await appReady(page);
  await page.locator("#config_tab").click();
  await page.locator("#autoCutsFromCodes").setChecked(on);
  await page.locator("#home_tab").click();
}

// v1.10.0: switch Settings → "Ask before leaving an unsaved layout". Tests
// that go Back after a nest without saving turn it off.
export async function setAskBeforeLeaving(
  page: Page,
  on: boolean,
): Promise<void> {
  await appReady(page);
  await page.locator("#config_tab").click();
  await page.locator("#askBeforeLeavingNest").setChecked(on);
  await page.locator("#home_tab").click();
}

// v1.14.0: switch Settings → "Ask to save before replacing a project". A
// test that opens a project, or uses Clear all, over work it hasn't saved
// (and isn't about that question) turns it off. Set straight on the tick
// box, so it works whichever screen is showing, even under a pop-up; and
// checked against the setting itself, repeating until it has taken. (The
// tick box isn't filled in from the settings, nor listening, the moment
// the app is ready: a first version trusted the box and now and then did
// nothing.)
export async function setAskBeforeReplacing(
  page: Page,
  on: boolean,
): Promise<void> {
  await appReady(page);
  await expect(async () => {
    const now = await page.evaluate((want) => {
      const box = document.querySelector(
        "#askBeforeReplacing",
      ) as HTMLInputElement;
      box.checked = want;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      const w = window as unknown as {
        config: { getSync: (k: string) => unknown };
      };
      return w.config.getSync("askBeforeReplacing") !== false;
    }, on);
    expect(now).toBe(on);
  }).toPass({ timeout: 15000 });
}
