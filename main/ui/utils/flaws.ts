/**
 * v1.13.0: flaws on a sheet, added in the Flaws box — a mark, hole or bad
 * patch to keep pieces off. Measured as on the cutting table: from one of
 * the sheet's corners (on a hide, the corners of the box round it), how
 * far along the length and how far in from the edge to the middle of the
 * flaw, then its size. Round (one size across) or a rectangle (length
 * along × width across). Pure functions, no DOM.
 *
 * Flaws drawn in the file (flaw-1, flaw-2…) are read on import instead
 * (svgparser detectFlaws, DeepNest.getParts → part.fileFlaws).
 */

export type FlawCorner = "tl" | "tr" | "bl" | "br";

export interface SheetFlaw {
  corner: FlawCorner;
  /** Along the length (the drawing's x) from the corner, to the middle. */
  alongMm: number;
  /** In from the edge (the drawing's y) from the corner, to the middle. */
  inMm: number;
  shape: "round" | "rect";
  /** Round: across. Rectangle: its length along. */
  sizeMm: number;
  /** Rectangle: its width across. */
  widthMm?: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FLAW_CORNERS: { id: FlawCorner; label: string }[] = [
  { id: "tl", label: "top left corner" },
  { id: "tr", label: "top right corner" },
  { id: "bl", label: "bottom left corner" },
  { id: "br", label: "bottom right corner" },
];

/** Drawing units per mm, from Settings' scale (units per inch). */
export function unitsPerMm(scale: number): number {
  return (scale || 72) / 25.4;
}

/** The flaw's middle, in drawing units. */
export function flawCentre(f: SheetFlaw, box: Box, perMm: number): Pt {
  const along = f.alongMm * perMm;
  const inn = f.inMm * perMm;
  const right = f.corner === "tr" || f.corner === "br";
  const bottom = f.corner === "bl" || f.corner === "br";
  return {
    x: right ? box.x + box.width - along : box.x + along,
    y: bottom ? box.y + box.height - inn : box.y + inn,
  };
}

/** The flaw's outline in drawing units (a 24-sided circle or a rectangle). */
export function flawPolygon(f: SheetFlaw, box: Box, perMm: number): Pt[] {
  const c = flawCentre(f, box, perMm);
  if (f.shape === "rect") {
    const hw = (f.sizeMm * perMm) / 2;
    const hh = ((f.widthMm ?? f.sizeMm) * perMm) / 2;
    return [
      { x: c.x - hw, y: c.y - hh },
      { x: c.x + hw, y: c.y - hh },
      { x: c.x + hw, y: c.y + hh },
      { x: c.x - hw, y: c.y + hh },
    ];
  }
  const r = (f.sizeMm * perMm) / 2;
  const pts: Pt[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return pts;
}

/** An SVG path "d" for a polygon. */
export function polygonPath(pts: Pt[]): string {
  return (
    pts
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`,
      )
      .join(" ") + " Z"
  );
}

/** Whether a flaw is usable: sizes above zero, distances not negative. */
export function validFlaw(f: SheetFlaw): boolean {
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  return (
    ok(f.alongMm) &&
    ok(f.inMm) &&
    f.alongMm >= 0 &&
    f.inMm >= 0 &&
    ok(f.sizeMm) &&
    f.sizeMm > 0 &&
    (f.shape !== "rect" || (ok(f.widthMm) && (f.widthMm as number) > 0))
  );
}

/** A length in the display units: "40 cm", "1.4 m" or "15¾ in". */
export function lengthLabel(mm: number, units: string): string {
  if (units === "mm") {
    if (mm >= 1000) return `${Math.round(mm / 100) / 10} m`;
    return `${Math.round((mm / 10) * 10) / 10} cm`;
  }
  return `${Math.round((mm / 25.4) * 8) / 8} in`;
}

/** "Round, 4 cm across, 40 cm along, 35 cm in from the top left corner". */
export function describeFlaw(f: SheetFlaw, units: string): string {
  const L = (mm: number) => lengthLabel(mm, units);
  const corner =
    FLAW_CORNERS.find((c) => c.id === f.corner)?.label ?? "top left corner";
  const shape =
    f.shape === "rect"
      ? `rectangle ${L(f.sizeMm)} × ${L(f.widthMm ?? f.sizeMm)}`
      : `round, ${L(f.sizeMm)} across`;
  return `${shape}, ${L(f.alongMm)} along, ${L(f.inMm)} in from the ${corner}`;
}

/** Area of a polygon (always positive), in drawing units². */
export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

/**
 * Whether a sheet is shaped (a hide) rather than a rectangle: its outline
 * fills noticeably less than the box round it.
 */
export function isShaped(outline: Pt[], box: Box): boolean {
  const boxArea = box.width * box.height;
  if (!(boxArea > 0) || outline.length < 3) return false;
  return polygonArea(outline) < 0.98 * boxArea;
}

/** "0.92 m²" or "9.9 sq ft", from an area in mm². */
export function areaLabel(mm2: number, areaUnits: string): string {
  const m2 = mm2 / 1e6;
  if (areaUnits === "ft2") return `${(m2 * 10.7639).toFixed(1)} sq ft`;
  return `${m2.toFixed(2)} m²`;
}

interface AreaPart {
  sheet?: boolean;
  polygontree: Pt[];
  bounds: Box;
  fileFlaws?: Pt[][];
  appFlawPolys?: Pt[][];
}

interface AreaNest {
  placements: { sheet: number; sheetplacements: { source: number }[] }[];
}

/**
 * v1.13.0: for a layout on shaped sheets (hides): the area the pieces use,
 * the hides' total, the share used, and what's left once flaws are taken
 * off. Null when any sheet in it is a rectangle (the length is shown then).
 */
export function hideArea(
  nest: AreaNest | undefined,
  parts: AreaPart[],
  perMm: number,
  areaUnits: string,
): { used: string; total: string; percent: string; left: string } | null {
  if (!nest || !nest.placements || nest.placements.length === 0) return null;
  const toMm2 = (a: number) => a / (perMm * perMm);
  let used = 0;
  let total = 0;
  let flaws = 0;
  for (const sg of nest.placements) {
    const sheet = parts[sg.sheet];
    if (!sheet || !isShaped(sheet.polygontree, sheet.bounds)) return null;
    total += toMm2(polygonArea(sheet.polygontree));
    for (const f of (sheet.fileFlaws || []).concat(sheet.appFlawPolys || []))
      flaws += toMm2(polygonArea(f));
    for (const p of sg.sheetplacements) {
      const part = parts[p.source];
      if (part) used += toMm2(polygonArea(part.polygontree));
    }
  }
  return {
    used: areaLabel(used, areaUnits),
    total: areaLabel(total, areaUnits),
    percent: total > 0 ? String(Math.round((used / total) * 100)) : "0",
    left: areaLabel(Math.max(total - used - flaws, 0), areaUnits),
  };
}
