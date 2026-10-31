// v1.13.0: the nesting engine keeps a sheet's holes (flaws) as places a
// part can't go. A 1000 × 1000 sheet with a 300 × 300 hole in the middle:
// a 50 × 50 part may sit in a corner, never in the hole. (Before, every
// outline in the allowed area was turned the same way round, so the hole
// counted as allowed and a piece now and then landed on a flaw.)

import { _electron as electron, expect, test } from "@playwright/test";

test("A sheet's hole isn't somewhere a part can go", async () => {
  const app = await electron.launch({ args: ["main.js", "--no-sandbox"] });
  await app.firstWindow();
  let bg = null as Awaited<ReturnType<typeof app.firstWindow>> | null;
  await expect
    .poll(
      async () => {
        for (const w of app.windows()) {
          if (w.url().endsWith("background.html")) {
            const ready = await w
              .evaluate(
                () =>
                  !!(window as unknown as { grainnestEngine?: unknown })
                    .grainnestEngine,
              )
              .catch(() => false);
            if (ready) {
              bg = w;
              return true;
            }
          }
        }
        return false;
      },
      { timeout: 30000 },
    )
    .toBe(true);

  const allowed = await bg!.evaluate(() => {
    type Pt = { x: number; y: number };
    type Poly = Pt[] & { children?: Poly[] };
    const w = window as unknown as {
      grainnestEngine: {
        getInnerNfp(A: Poly, B: Poly, config: object): Poly[];
        innerNfpToClipperCoordinates(n: Poly[], config: object): unknown[];
      };
      ClipperLib: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const sq = (x: number, y: number, s: number): Poly => [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ];
    const config = { clipperScale: 10000000, curveTolerance: 0.3 };
    const sheet = sq(0, 0, 1000);
    sheet.children = [sq(350, 350, 300)];
    const part = sq(0, 0, 50);
    const nfp = w.grainnestEngine.getInnerNfp(sheet, part, config);
    const paths = w.grainnestEngine.innerNfpToClipperCoordinates(nfp, config);
    const C = w.ClipperLib;
    // Is the part's corner allowed at (x, y)? (a tiny square there overlaps
    // the allowed area, filled the way the placement fills it)
    const at = (x: number, y: number) => {
      const c = new C.Clipper();
      const out = new C.Paths();
      c.AddPaths(paths, C.PolyType.ptSubject, true);
      const s = config.clipperScale;
      c.AddPath(
        sq(x - 0.5, y - 0.5, 1).map((p) => ({ X: p.x * s, Y: p.y * s })),
        C.PolyType.ptClip,
        true,
      );
      c.Execute(
        C.ClipType.ctIntersection,
        out,
        C.PolyFillType.pftNonZero,
        C.PolyFillType.pftNonZero,
      );
      return out.length > 0;
    };
    return { corner: at(100, 100), hole: at(480, 480) };
  });
  expect(allowed).toEqual({ corner: true, hole: false });
  await app.close();
});
