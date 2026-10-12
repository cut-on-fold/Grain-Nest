/**
 * v1.8.0: one ranking for nest results, shared by the "best nests so far"
 * list, the nest shown on screen and the export warning: layouts that
 * place more pieces come first, then the least fabric. (Ranking by fabric
 * alone put layouts that left pieces out at the top, since they use less
 * fabric, while the engine showed a different, complete one.)
 */

import type {
  DeepNestInstance,
  Part,
  SelectableNestingResult,
} from "../types/index.js";

type SheetGroup = {
  sheet: number;
  sheetplacements: Array<{
    source: number;
    x: number;
    y: number;
    rotation: number;
  }>;
};

/**
 * §9.0.1 R6-A: minimum fabric length of one nest result, in SVG units —
 * per sheet, the furthest placed piece along the length (exact
 * rotation-aware DeepNest.placedBounds, measured from the sheet's own
 * origin), summed across sheets.
 */
export function minLengthSvg(
  deepNest: DeepNestInstance,
  nest: SelectableNestingResult,
): number | null {
  if (!nest || !nest.placements) return null;
  const warpDir =
    (deepNest as unknown as { warpDirection?: "horizontal" | "vertical" })
      .warpDirection ?? "horizontal";
  const isWarpH = warpDir !== "vertical";
  let totalSvg = 0;
  for (const sg of nest.placements as unknown as SheetGroup[]) {
    const sheetPart = deepNest.parts[sg.sheet];
    const sheetOrigin = sheetPart
      ? isWarpH
        ? sheetPart.bounds.x
        : sheetPart.bounds.y
      : 0;
    let maxExtent = 0;
    for (const p of sg.sheetplacements) {
      const part = deepNest.parts[p.source];
      if (!part || part.sheet) continue;
      const pb = deepNest.placedBounds(part, p);
      if (!pb) continue;
      const end = isWarpH
        ? pb.x + pb.width - sheetOrigin
        : pb.y + pb.height - sheetOrigin;
      if (end > maxExtent) maxExtent = end;
    }
    totalSvg += maxExtent;
  }
  return totalSvg;
}

/** How many pieces a nest result placed. */
export function piecesPlaced(nest: SelectableNestingResult): number {
  let n = 0;
  for (const sg of (nest.placements || []) as unknown as SheetGroup[]) {
    n += sg.sheetplacements.length;
  }
  return n;
}

/** How many pieces the nest should place (quantities, excluded left out). */
/**
 * How many copies of a part go into the nest: none when excluded or
 * skipped (v1.9.0), else the count worked out from its cut code, else
 * its Quantity. Matches DeepNest.start().
 */
export function copiesToNest(p: Part): number {
  if (p.excluded || p.autoSkip || p.outOfView) return 0;
  if (typeof p.nestQuantity === "number") return p.nestQuantity;
  return p.quantity || 1;
}

export function piecesToPlace(deepNest: DeepNestInstance): number {
  let total = 0;
  for (const p of deepNest.parts) {
    if (!p.sheet) total += copiesToNest(p);
  }
  return total;
}

/** A sorted copy: most pieces placed first, then least fabric. */
export function rankNests(
  deepNest: DeepNestInstance,
  nests: SelectableNestingResult[],
): SelectableNestingResult[] {
  return nests
    .map((n) => ({
      n,
      placed: piecesPlaced(n),
      length: minLengthSvg(deepNest, n) ?? Infinity,
    }))
    .sort((a, b) => b.placed - a.placed || a.length - b.length)
    .map((r) => r.n);
}

/**
 * Once any result places every piece, drop the ones that don't from
 * DeepNest.nests (in place, so everything holding the array sees it).
 * Returns true if anything was removed.
 */
export function dropIncompleteNests(deepNest: DeepNestInstance): boolean {
  const total = piecesToPlace(deepNest);
  const nests = deepNest.nests;
  if (!nests.some((n) => piecesPlaced(n) >= total)) return false;
  let removed = false;
  for (let i = nests.length - 1; i >= 0; i--) {
    if (piecesPlaced(nests[i]) < total) {
      nests.splice(i, 1);
      removed = true;
    }
  }
  return removed;
}
