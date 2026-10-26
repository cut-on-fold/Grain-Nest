/**
 * v1.12.0: the sheets file (.gnsheets) — Grain-Nest's own small format for
 * handing it fabric pieces to nest on, e.g. from another app:
 *
 *   { "format": "grain-nest-sheets", "version": 1,
 *     "sheets": [{ "name": "Blue linen", "fabric": "main",
 *                  "widthMm": 1400, "lengthMm": 3000 }] }
 *
 * widthMm is selvedge to selvedge, lengthMm along the grain. fabric is one
 * of Grain-Nest's fabric ids (main, fused, interfacing, lining, ribbing) or
 * "". Keys Grain-Nest doesn't know are ignored, so other apps can add their
 * own. Pure functions, no DOM.
 */

import { SHEET_FABRICS } from "./nest-jobs.js";

export const SHEETS_FORMAT = "grain-nest-sheets";

export interface SheetSpec {
  name: string;
  /** A Grain-Nest fabric id, or "" for none. */
  fabric: string;
  widthMm: number;
  lengthMm: number;
}

export interface SheetsFileResult {
  sheets: SheetSpec[];
  /** Plain-language notes on what was left out or changed. */
  notes: string[];
  /** Set when the file can't be read at all. */
  error?: string;
}

const FABRIC_IDS = new Set(SHEET_FABRICS.map((f) => f.id as string));

const positive = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/** Reads a sheets file's text. */
export function parseSheetsFile(text: string): SheetsFileResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      sheets: [],
      notes: [],
      error: "it isn't a sheets file (not JSON)",
    };
  }
  const d = data as { format?: unknown; version?: unknown; sheets?: unknown };
  if (!d || typeof d !== "object" || d.format !== SHEETS_FORMAT) {
    return {
      sheets: [],
      notes: [],
      error: "it isn't a Grain-Nest sheets file",
    };
  }
  if (d.version !== 1) {
    return {
      sheets: [],
      notes: [],
      error: `it's version ${String(d.version)}, and this Grain-Nest reads version 1`,
    };
  }
  if (!Array.isArray(d.sheets)) {
    return { sheets: [], notes: [], error: "it has no list of sheets" };
  }
  const sheets: SheetSpec[] = [];
  const notes: string[] = [];
  d.sheets.forEach((raw: unknown, i: number) => {
    const s = (raw || {}) as Record<string, unknown>;
    const name = typeof s.name === "string" ? s.name.trim() : "";
    const label = name || `Sheet ${i + 1}`;
    const widthMm = positive(s.widthMm);
    const lengthMm = positive(s.lengthMm);
    if (widthMm === null || lengthMm === null) {
      notes.push(`${label} was left out: it needs a width and a length.`);
      return;
    }
    let fabric = typeof s.fabric === "string" ? s.fabric.trim() : "";
    if (!FABRIC_IDS.has(fabric)) {
      notes.push(
        `${label}: Grain-Nest doesn't know the fabric "${fabric}", so it has none.`,
      );
      fabric = "";
    }
    sheets.push({ name, fabric, widthMm, lengthMm });
  });
  return { sheets, notes };
}

/** "Main fabric", "" for none. */
export function fabricLabel(fabric: string): string {
  if (!fabric) return "";
  return SHEET_FABRICS.find((f) => f.id === fabric)?.label ?? fabric;
}

/** "140 × 300 cm" or "55.1 × 118.1 in" (width × length), in the display units. */
export function sheetSize(s: SheetSpec, units: string): string {
  if (units === "mm") {
    const cm = (mm: number) => Math.round(mm / 10);
    return `${cm(s.widthMm)} × ${cm(s.lengthMm)} cm`;
  }
  const inch = (mm: number) => Math.round((mm / 25.4) * 10) / 10;
  return `${inch(s.widthMm)} × ${inch(s.lengthMm)} in`;
}

/** A line for the confirmation: "Blue linen (Main fabric), 140 × 300 cm". */
export function describeSheet(s: SheetSpec, units: string): string {
  const fab = fabricLabel(s.fabric);
  return `${s.name || "Unnamed sheet"}${fab ? ` (${fab})` : ""}, ${sheetSize(s, units)}`;
}
