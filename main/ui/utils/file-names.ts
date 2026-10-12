/**
 * v1.8.0: suggested names for Save project and Export, made from the
 * pattern file that was imported:
 *   project:  <pattern>.gnp
 *   SVG:      <pattern>_Nested_<Fabric>_<width>.svg   e.g. Coat_Nested_Main_58in.svg
 *   cut list: <pattern>_Nested_<Fabric>_<width>_CutList.txt
 * The width is the fabric width (selvedge to selvedge) in the display
 * units: inches ("58in") or centimetres ("150cm"). A layout over several
 * sheets lists each fabric and width once.
 */

import type {
  DeepNestInstance,
  SelectableNestingResult,
} from "../types/index.js";

/** Short fabric names for file names (the sheet's Fabric drop-down). */
const FABRIC_NAMES: Record<string, string> = {
  main: "Main",
  fused: "Fused",
  interfacing: "Interfacing",
  lining: "Lining",
  ribbing: "Ribbing",
};

/** Characters that aren't safe in file names on a Mac or elsewhere. */
function safe(text: string): string {
  return text
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

/** The first imported pattern's name and folder, if any. */
export function patternSource(deepNest: DeepNestInstance): {
  base: string;
  dir: string | null;
} | null {
  const imp = deepNest.imports.find((im) => im.filename) as
    | { filename: string; dirpath?: string | null }
    | undefined;
  if (!imp) return null;
  const base = safe(withoutExtension(imp.filename));
  return base ? { base, dir: imp.dirpath || null } : null;
}

/**
 * "58in" or "150cm": a sheet's width (its height in the drawing, selvedge
 * to selvedge) in the display units.
 */
export function widthTag(
  heightSvg: number,
  units: string,
  scale: number,
): string {
  const inches = heightSvg / (scale || 96);
  return units === "mm"
    ? `${Math.round(inches * 2.54)}cm`
    : `${Math.round(inches * 10) / 10}in`;
}

/** "Main_58in" for each different sheet fabric and width in a layout. */
export function fabricWidthTag(
  deepNest: DeepNestInstance,
  nest: SelectableNestingResult,
  units: string,
  scale: number,
): string {
  const tags: string[] = [];
  for (const sg of (nest.placements || []) as unknown as {
    sheet: number;
  }[]) {
    const sheet = deepNest.parts[sg.sheet] as
      | { fabric?: string; bounds?: { height: number } }
      | undefined;
    if (!sheet || !sheet.bounds) continue;
    const fabric = FABRIC_NAMES[sheet.fabric || ""] || "Fabric";
    const tag = `${fabric}_${widthTag(sheet.bounds.height, units, scale)}`;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.join("_");
}

/** Joins a folder and a file name, if there's a folder. */
export function inFolder(dir: string | null, name: string): string {
  if (!dir) return name;
  return dir.replace(/[/\\]+$/, "") + "/" + name;
}
