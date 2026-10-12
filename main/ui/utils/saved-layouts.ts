/**
 * v1.10.0: saved layouts. A nest result kept in the project so it can be
 * opened and exported again without re-nesting.
 *
 * A layout records, for each sheet used, where each piece went. Pieces
 * are referred to by their session id (`grainnestId`, stamped here when
 * needed), so sorting or deleting rows doesn't muddle them; a mirrored
 * copy made for the nest (pairs from cut codes) is "that piece, mirrored
 * copy". In the project file the ids become positions in its parts list.
 *
 * Each piece's settings are fingerprinted when the layout is saved, so
 * opening it can say what changed since (seam allowance, fold, …).
 */

import type {
  DeepNestInstance,
  SelectableNestingResult,
} from "../types/index.js";
import type { Part } from "../../../index.d.ts";
import { minLengthSvg, piecesPlaced, piecesToPlace } from "./nest-rank.js";

/** A piece in a layout: the part's id, and whether it's its mirrored copy. */
export interface PieceRef {
  pid: number;
  copy?: boolean;
}

export interface LayoutPlacement {
  piece: PieceRef;
  x: number;
  y: number;
  rotation: number;
}

export interface LayoutSheet {
  sheet: number; // pid of the sheet
  placements: LayoutPlacement[];
}

/** What a piece looked like when the layout was saved. */
export interface PieceFingerprint {
  name: string;
  seam: number;
  mirror: boolean;
  fold: boolean;
  grain: string;
  angle: number;
  top: boolean;
  w: number;
  h: number;
  count: string;
}

export interface SavedLayout {
  id: string;
  name: string;
  /** Folder: the sheet's fabric ("main", "lining", … or ""). */
  fabric: string;
  savedAt: string;
  /** The "Nest for" job it was nested for. */
  job: string;
  /** v1.11.0: the view it was saved in (absent = All pieces). */
  view?: string;
  /** Fabric length used, in mm. */
  lengthMm: number;
  placed: number;
  total: number;
  /** Sheet utilisation (%), as the nest screen showed it. */
  utilisation?: number;
  sheets: LayoutSheet[];
  /** Every piece (and sheet) in the nest, by pid. */
  pieces: Record<string, PieceFingerprint>;
}

/** The engine's id counter (shared with DeepNest.mirrorCopyPart). */
type Engine = DeepNestInstance & {
  _partIdSeq?: number;
  savedLayouts?: SavedLayout[];
  lastNestLayout?: SavedLayout | null;
};

/** The part's session id, stamped the first time it's needed. */
export function pieceId(dn: DeepNestInstance, p: Part): number {
  const e = dn as Engine;
  if (!p.grainnestId) {
    e._partIdSeq = (e._partIdSeq || 0) + 1;
    p.grainnestId = e._partIdSeq;
  }
  return p.grainnestId;
}

/** The layouts kept in this project (created on first use). */
export function layoutsOf(dn: DeepNestInstance): SavedLayout[] {
  const e = dn as Engine;
  if (!e.savedLayouts) e.savedLayouts = [];
  return e.savedLayouts;
}

export function lastNestOf(dn: DeepNestInstance): SavedLayout | null {
  return (dn as Engine).lastNestLayout ?? null;
}

export function setLastNest(
  dn: DeepNestInstance,
  layout: SavedLayout | null,
): void {
  (dn as Engine).lastNestLayout = layout;
}

const round = (v: number | undefined, dp: number): number => {
  const f = Math.pow(10, dp);
  return Math.round((v || 0) * f) / f;
};

export function fingerprint(p: Part): PieceFingerprint {
  return {
    name: p.name || p.filename || "",
    seam: round(p.seamAllowance, 1),
    mirror: !!p.mirror,
    fold: !!p.cutOnFold,
    grain: p.grainRule || "",
    angle: round(p.grainAngle, 1),
    top: !!p.topFlip,
    w: round(p.bounds?.width, 1),
    h: round(p.bounds?.height, 1),
    count: [p.quantity, p.mirrorCount ?? "", p.fuseMode ?? ""].join("/"),
  };
}

/** The real part behind a placed part (a nest copy -> its piece). */
function realPart(p: Part): Part {
  return (p.autoCopy && (p.autoCopyOf as Part | undefined)) || p;
}

/** Copies of a part that go into the nest (see nest-rank copiesToNest). */
function inNest(p: Part): boolean {
  if (p.sheet || p.excluded || p.autoSkip || p.outOfView) return false;
  return typeof p.nestQuantity === "number" ? p.nestQuantity > 0 : true;
}

/**
 * A saved layout from a nest result on screen. `name` and `fabric` come
 * from the Save layout dialog.
 */
export function captureLayout(
  dn: DeepNestInstance,
  nest: SelectableNestingResult,
  name: string,
  fabric: string,
  scale: number,
): SavedLayout {
  const pieces: Record<string, PieceFingerprint> = {};
  const sheets: LayoutSheet[] = [];
  for (const sg of nest.placements) {
    const sheetPart = dn.parts[sg.sheet];
    if (!sheetPart) continue;
    const sid = pieceId(dn, sheetPart);
    pieces[sid] = fingerprint(sheetPart);
    const placements: LayoutPlacement[] = [];
    for (const pl of sg.sheetplacements) {
      const part = dn.parts[pl.source];
      if (!part) continue;
      const real = realPart(part);
      placements.push({
        piece: { pid: pieceId(dn, real), copy: part.autoCopy || undefined },
        x: pl.x,
        y: pl.y,
        rotation: pl.rotation,
      });
    }
    sheets.push({ sheet: sid, placements });
  }
  // Every piece that went into the nest, placed or not, so opening can
  // tell a piece that was left out from one added since.
  for (const p of dn.parts) {
    if (!inNest(p)) continue;
    const real = realPart(p);
    pieces[pieceId(dn, real)] = fingerprint(real);
  }
  const lengthSvg = minLengthSvg(dn, nest) ?? 0;
  return {
    id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    fabric,
    savedAt: new Date().toISOString(),
    job: (dn.nestJob as string | undefined) || "all",
    view:
      (dn as DeepNestInstance & { currentViewId?: string | null })
        .currentViewId || undefined,
    lengthMm: (lengthSvg / (scale || 96)) * 25.4,
    placed: piecesPlaced(nest),
    total: piecesToPlace(dn),
    utilisation: nest.utilisation,
    sheets,
    pieces,
  };
}

/** "1.38 m" / "54.3 in", as the nest screen shows lengths. */
export function formatLengthMm(mm: number, units: string): string {
  if (units === "mm") {
    return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(0)} mm`;
  }
  return `${(mm / 25.4).toFixed(1)} in`;
}

function partById(dn: DeepNestInstance, pid: number): Part | undefined {
  return dn.parts.find((p) => p.grainnestId === pid && !p.autoCopy);
}

/** What changed for one piece, in words ("seam allowance 12 → 15 mm"). */
function describeChange(
  was: PieceFingerprint,
  now: PieceFingerprint,
): string[] {
  const out: string[] = [];
  if (was.seam !== now.seam)
    out.push(`seam allowance ${was.seam} → ${now.seam} mm`);
  if (was.fold !== now.fold)
    out.push(now.fold ? "now on the fold" : "unfolded");
  if (was.mirror !== now.mirror)
    out.push(now.mirror ? "mirrored" : "unmirrored");
  if (was.grain !== now.grain || was.angle !== now.angle)
    out.push("grain changed");
  if (was.top !== now.top) out.push("turned end to end");
  if (was.count !== now.count) out.push("number to cut changed");
  if (
    out.length === 0 &&
    (Math.abs(was.w - now.w) > 0.5 || Math.abs(was.h - now.h) > 0.5)
  )
    out.push("size changed");
  return out;
}

/**
 * What's different now from when the layout was saved, one line per
 * piece ("2 Bodice Back: seam allowance 12 → 15 mm"). Call after the
 * layout's job has been applied, so "added" means added for that fabric.
 */
export function layoutChanges(
  dn: DeepNestInstance,
  layout: SavedLayout,
): string[] {
  const changes: string[] = [];
  for (const [pidText, was] of Object.entries(layout.pieces)) {
    const part = partById(dn, Number(pidText));
    if (!part) {
      changes.push(`${was.name}: deleted`);
      continue;
    }
    const now = fingerprint(part);
    const what = describeChange(was, now);
    if (now.name !== was.name) what.unshift(`renamed from ${was.name}`);
    if (!part.sheet && part.excluded) what.push("left out of the nest");
    if (what.length) changes.push(`${now.name}: ${what.join(", ")}`);
  }
  for (const p of dn.parts) {
    if (p.autoCopy || !inNest(p)) continue;
    const pid = p.grainnestId;
    if (pid === undefined || !layout.pieces[pid]) {
      changes.push(`${p.name || p.filename || "a piece"}: added since`);
    }
  }
  return changes;
}

/**
 * The layout as a nest result the nest screen and export can use, with
 * placements pointing at today's parts. `copyOf` finds (or makes) the
 * mirrored copy of a piece. Pieces deleted since are left out.
 */
export function layoutToNest(
  dn: DeepNestInstance,
  layout: SavedLayout,
  copyOf: (part: Part) => Part | undefined,
): SelectableNestingResult {
  let nextId = 900000;
  const placements: SelectableNestingResult["placements"] = [];
  layout.sheets.forEach((ls, sheetNo) => {
    const sheetPart = partById(dn, ls.sheet);
    if (!sheetPart) return;
    const sheetIndex = dn.parts.indexOf(sheetPart);
    const sheetplacements = [];
    for (const lp of ls.placements) {
      const real = partById(dn, lp.piece.pid);
      if (!real) continue;
      const part = lp.piece.copy ? copyOf(real) : real;
      if (!part) continue;
      sheetplacements.push({
        filename: part.filename || "",
        id: nextId++,
        rotation: lp.rotation,
        source: dn.parts.indexOf(part),
        x: lp.x,
        y: lp.y,
      });
    }
    placements.push({
      sheet: sheetIndex,
      sheetid: sheetNo,
      sheetplacements,
    } as SelectableNestingResult["placements"][number]);
  });
  return {
    area: 0,
    fitness: 0,
    index: 0,
    mergedLength: 0,
    selected: true,
    utilisation: layout.utilisation ?? 0,
    placements,
  } as SelectableNestingResult;
}

// ---------------------------------------------------------------------
// Project file: pids <-> positions in the saved parts list.
// ---------------------------------------------------------------------

/** A layout in the .gnp file: ids replaced by saved part positions. */
export type SavedLayoutFile = SavedLayout;

function remap(
  layout: SavedLayout,
  map: (pid: number) => number | undefined,
): SavedLayout | null {
  const sheets: LayoutSheet[] = [];
  for (const ls of layout.sheets) {
    const sheet = map(ls.sheet);
    if (sheet === undefined) continue;
    const placements: LayoutPlacement[] = [];
    for (const lp of ls.placements) {
      const pid = map(lp.piece.pid);
      if (pid === undefined) continue;
      placements.push({ ...lp, piece: { ...lp.piece, pid } });
    }
    sheets.push({ sheet, placements });
  }
  if (sheets.length === 0) return null;
  const pieces: Record<string, PieceFingerprint> = {};
  for (const [k, v] of Object.entries(layout.pieces)) {
    const m = map(Number(k));
    if (m !== undefined) pieces[m] = v;
  }
  return { ...layout, sheets, pieces };
}

/** For saving: session ids -> positions in the saved parts list. */
export function layoutForFile(
  layout: SavedLayout,
  savedIndexOfPid: Map<number, number>,
): SavedLayoutFile | null {
  return remap(layout, (pid) => savedIndexOfPid.get(pid));
}

/** For loading: saved positions -> the restored parts' session ids. */
export function layoutFromFile(
  dn: DeepNestInstance,
  layout: SavedLayoutFile,
  partAtSavedIndex: (i: number) => Part | undefined,
): SavedLayout | null {
  return remap(layout, (i) => {
    const p = partAtSavedIndex(i);
    return p ? pieceId(dn, p) : undefined;
  });
}
