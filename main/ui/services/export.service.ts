/**
 * Export Service
 * Handles SVG/JSON/cut-list export functionality for nesting results
 * Manages file save dialogs, format conversion, and file writing
 */

import type {
  UIConfig,
  DeepNestInstance,
  SelectableNestingResult,
  Part,
} from "../types/index.js";
import { message } from "../utils/ui-helpers.js";
import { foldReflectionTransform } from "../utils/dom-utils.js";
import { toSvgUnits } from "../utils/conversion.js";
import { isShaped, polygonPath } from "../utils/flaws.js";
import {
  fabricWidthTag,
  inFolder,
  patternSource,
} from "../utils/file-names.js";

/** v1.13.0: flaws on a sheet, in the export. */
const FLAW_COLOUR = "#c0392b";
const SVG_NS = "http://www.w3.org/2000/svg";
const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/** v1.5.0: line colours (hex) and width (drawing units) for the export. */
interface ExportStyle {
  scale: number;
  width: number;
  cut: string;
  sew: string;
  grain: string;
  border: string;
  line: (colour: string, dashed?: boolean) => string;
}

type Pt = { x: number; y: number };

/** v1.6.0: notches up to this size (mm) are left out of the sew line. */
const NOTCH_MAX_MM = 12;

/** v1.7.0: margin (mm) between the nested pieces and the cropped page edge. */
const CROP_MARGIN_MM = 10;

/** The bit of the global SvgParser the export uses. */
interface SvgParserLike {
  polygonify(element: SVGElement): Pt[];
}

/** Numbers in the export, trimmed to 3 decimals. */
function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** "14 Skirt Front C1OF" -> "14"; "INT1 Collar" -> "INT1"; else "". */
function pieceNumber(name: string): string {
  const m = /^\s*(INT ?\d+|\d+)/i.exec(name);
  return m ? m[1].replace(" ", "") : "";
}

/** A name made safe for an SVG id. */
function slug(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "piece";
}

function polygonArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return Math.abs(a / 2);
}

function pointInRing(ring: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToRing(ring: Pt[], p: Pt): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
      : 0;
    best = Math.min(
      best,
      Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)),
    );
  }
  return best;
}

/**
 * The point inside a polygon farthest from its edges (where a label has
 * the most room), found by refining a grid of cells (the "polylabel" idea).
 */
function distanceToSegment(a: Pt, b: Pt, p: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * v1.6.0: the outline with its notches taken out, for drawing the sew
 * line. Many patterns (commercial ones, the grading script) cut notches into
 * the cutting line as small triangles or slits; insetting those made the
 * sew line spike into the piece. A notch is a vertex whose two neighbours
 * are both within `maxSize` of it and of each other, on an edge that runs
 * on straight through it, so real points (collars, corners) are kept.
 */
export function withoutNotches(ring: Pt[], maxSize: number): Pt[] {
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const angle = (u: Pt, v: Pt) => {
    const lu = Math.hypot(u.x, u.y);
    const lv = Math.hypot(v.x, v.y);
    if (lu === 0 || lv === 0) return 0;
    const c = (u.x * v.x + u.y * v.y) / (lu * lv);
    return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
  };
  const dir = (a: Pt, b: Pt): Pt => ({ x: b.x - a.x, y: b.y - a.y });
  const tiny = maxSize / 25;
  let pts = ring.filter(
    (p, i) => dist(p, ring[(i + ring.length - 1) % ring.length]) > tiny,
  );
  let removed = true;
  while (removed && pts.length > 5) {
    removed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const before = pts[(i + n - 2) % n];
      const a = pts[(i + n - 1) % n];
      const tip = pts[i];
      const c = pts[(i + 1) % n];
      const after = pts[(i + 2) % n];
      if (
        dist(a, tip) > maxSize ||
        dist(tip, c) > maxSize ||
        dist(a, c) > maxSize ||
        angle(dir(tip, a), dir(tip, c)) > 120
      )
        continue;
      // The edge either side carries on in roughly the same direction.
      const edgeIn = dir(before, a);
      const edgeOut = dir(c, after);
      const across = dist(a, c) > tiny ? dir(a, c) : edgeOut;
      if (angle(edgeIn, across) > 35 || angle(across, edgeOut) > 35) continue;
      pts = pts.filter((_, k) => k !== i);
      // A slit leaves its two base points on top of each other.
      if (dist(a, c) <= tiny) pts = pts.filter((p) => p !== c);
      removed = true;
      break;
    }
  }
  return pts;
}

function poleOfInaccessibility(ring: Pt[], obstacles: [Pt, Pt][] = []): Pt {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  // Distance to the nearest edge or obstacle (the grain line), negative
  // outside the piece.
  const score = (p: Pt): number =>
    (pointInRing(ring, p) ? 1 : -1) *
    Math.min(
      distanceToRing(ring, p),
      ...obstacles.map(([a, b]) => distanceToSegment(a, b, p)),
    );
  let cell = Math.min(w, h) / 2 || 1;
  let best = { x: minX + w / 2, y: minY + h / 2 };
  let bestScore = score(best);
  let cells: Pt[] = [];
  for (let x = minX; x < minX + w; x += cell * 2) {
    for (let y = minY; y < minY + h; y += cell * 2) {
      cells.push({ x: x + cell, y: y + cell });
    }
  }
  for (let pass = 0; pass < 12 && cells.length; pass++) {
    const next: Pt[] = [];
    for (const c of cells) {
      const s = score(c);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
      // A cell can only beat the best if its centre score plus its
      // half-diagonal does.
      if (s + cell * Math.SQRT2 > bestScore) {
        const q = cell / 2;
        next.push(
          { x: c.x - q, y: c.y - q },
          { x: c.x + q, y: c.y - q },
          { x: c.x - q, y: c.y + q },
          { x: c.x + q, y: c.y + q },
        );
      }
    }
    cells = next.length > 4000 ? next.slice(0, 4000) : next;
    cell /= 2;
  }
  return best;
}

/**
 * Places worth trying for a label: the single roomiest point plus the
 * roomiest points of a coarse grid over the piece, best first.
 */
function candidateCentres(ring: Pt[], obstacles: [Pt, Pt][]): Pt[] {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  const n = 14;
  const scored: { p: Pt; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = {
        x: minX + ((i + 0.5) * w) / n,
        y: minY + ((j + 0.5) * h) / n,
      };
      if (!pointInRing(ring, p)) continue;
      const d = Math.min(
        distanceToRing(ring, p),
        ...obstacles.map(([a, b]) => distanceToSegment(a, b, p)),
      );
      scored.push({ p, d });
    }
  }
  scored.sort((a, b) => b.d - a.d);
  return [
    poleOfInaccessibility(ring, obstacles),
    ...scored.slice(0, 12).map((s) => s.p),
  ];
}

/**
 * Does a w × h box centred on `c`, turned by `angle` degrees, fit inside
 * the ring without touching any obstacle (kept `pad` clear)?
 */
function rectInside(
  ring: Pt[],
  c: Pt,
  w: number,
  h: number,
  angle: number,
  obstacles: [Pt, Pt][] = [],
  pad = 0,
): boolean {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Obstacles, in the box's own frame: no sample along them may come
  // within `pad` of the box.
  for (const [a, b] of obstacles) {
    for (let i = 0; i <= 40; i++) {
      const x = a.x + ((b.x - a.x) * i) / 40 - c.x;
      const y = a.y + ((b.y - a.y) * i) / 40 - c.y;
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      if (Math.abs(u) <= w / 2 + pad && Math.abs(v) <= h / 2 + pad)
        return false;
    }
  }
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    for (const [u, v] of [
      [-w / 2 + (w * i) / steps, -h / 2],
      [-w / 2 + (w * i) / steps, h / 2],
      [-w / 2, -h / 2 + (h * i) / steps],
      [w / 2, -h / 2 + (h * i) / steps],
    ]) {
      const p = { x: c.x + u * cos - v * sin, y: c.y + u * sin + v * cos };
      if (!pointInRing(ring, p)) return false;
    }
  }
  return true;
}

let measureContext: CanvasRenderingContext2D | null = null;
/** Width of `text` in sans-serif at `size` drawing units. */
function measureText(text: string, size: number): number {
  if (!measureContext) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return text.length * size * 0.6;
  measureContext.font = `100px sans-serif`;
  return (measureContext.measureText(text).width / 100) * size;
}

/**
 * File filter options for the save dialog
 */
interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Save dialog options
 */
interface SaveDialogOptions {
  title: string;
  defaultPath?: string;
  filters: FileFilter[];
}

/**
 * Dialog interface for Electron's dialog module
 */
interface ElectronDialog {
  showSaveDialogSync(options: SaveDialogOptions): string | undefined;
}

/**
 * Remote interface for Electron's remote module
 */
interface ElectronRemote {
  getGlobal(name: string): string | undefined;
}

/**
 * File system interface for Node.js fs module
 */
interface FileSystem {
  writeFileSync(path: string, data: string): void;
}

/**
 * Config getter interface
 */
interface ConfigGetter {
  getSync<K extends keyof UIConfig>(
    key?: K,
  ): K extends keyof UIConfig ? UIConfig[K] : UIConfig;
}

/**
 * Placement within a sheet (matches index.d.ts SheetPlacement)
 */
interface PartPlacement {
  id: number;
  filename: string;
  source: number;
  x: number;
  y: number;
  rotation: number;
}

/**
 * Sheet with placements (matches NestingResult.placements structure)
 */
interface SheetGroup {
  sheet: number;
  sheetid: number;
  sheetplacements: PartPlacement[];
}

/**
 * Export file formats
 */
export type ExportFormat = "svg" | "json" | "cutlist";

/**
 * File filters for export dialogs
 */
const SVG_FILE_FILTERS: FileFilter[] = [{ name: "SVG", extensions: ["svg"] }];

const CUTLIST_FILE_FILTERS: FileFilter[] = [
  { name: "Text", extensions: ["txt"] },
];

/**
 * Export Service class
 * Handles export operations for nesting results to various formats
 * Follows the pattern from main/deepnest.js ES6 class structure
 */
export class ExportService {
  /** Electron dialog for file save dialogs */
  private dialog: ElectronDialog | null = null;

  /** Electron remote for accessing global variables */
  private remote: ElectronRemote | null = null;

  /** Node.js file system module */
  private fs: FileSystem | null = null;

  /** Configuration getter */
  private config: ConfigGetter | null = null;

  /** DeepNest instance for accessing parts and nests */
  private deepNest: DeepNestInstance | null = null;

  /** Flag to track if export is busy */
  private isExporting = false;

  /**
   * Create a new ExportService instance
   * Dependencies are injected for testability
   */
  constructor(options?: {
    dialog?: ElectronDialog;
    remote?: ElectronRemote;
    fs?: FileSystem;
    config?: ConfigGetter;
    deepNest?: DeepNestInstance;
  }) {
    if (options) {
      this.dialog = options.dialog || null;
      this.remote = options.remote || null;
      this.fs = options.fs || null;
      this.config = options.config || null;
      this.deepNest = options.deepNest || null;
    }
  }

  /**
   * Set the dialog module for file save dialogs
   * @param dialog - Electron dialog module
   */
  setDialog(dialog: ElectronDialog): void {
    this.dialog = dialog;
  }

  /**
   * Set the remote module for accessing globals
   * @param remote - Electron remote module
   */
  setRemote(remote: ElectronRemote): void {
    this.remote = remote;
  }

  /**
   * Set the file system module
   * @param fs - Node.js fs module
   */
  setFileSystem(fs: FileSystem): void {
    this.fs = fs;
  }

  /**
   * Set the configuration getter
   * @param config - Configuration object with getSync method
   */
  setConfig(config: ConfigGetter): void {
    this.config = config;
  }

  /**
   * Set the DeepNest instance
   * @param deepNest - DeepNest instance for accessing parts and nests
   */
  setDeepNest(deepNest: DeepNestInstance): void {
    this.deepNest = deepNest;
  }

  /**
   * Get the currently selected nesting result
   * @returns Selected nesting result or null if none selected
   */
  private getSelectedNest(): SelectableNestingResult | null {
    if (!this.deepNest) {
      return null;
    }

    const selected = this.deepNest.nests.filter((n) => n.selected);
    if (selected.length === 0) {
      return null;
    }

    return selected[selected.length - 1];
  }

  /**
   * Export the selected nest result to JSON file
   * Saves to the NEST_DIRECTORY as exports.json
   * @returns True if export was successful
   */
  exportToJson(): boolean {
    if (!this.remote || !this.fs || !this.deepNest) {
      return false;
    }

    const nestDirectory = this.remote.getGlobal("NEST_DIRECTORY");
    if (!nestDirectory) {
      return false;
    }

    const filePath = nestDirectory + "exports.json";

    const selected = this.getSelectedNest();
    if (!selected) {
      return false;
    }

    const fileData = JSON.stringify(selected);
    this.fs.writeFileSync(filePath, fileData);

    return true;
  }

  /**
   * §9.3.7: show save dialog and write a plain-text cut-list summary
   * (pieces with counts + per-sheet stats + total fabric length) for
   * the currently-selected nest. Plain text so it's universally
   * openable and printable.
   */
  exportToCutList(): boolean {
    if (!this.dialog || !this.fs || !this.deepNest) {
      message("Export dependencies not available", true);
      return false;
    }
    const selected = this.getSelectedNest();
    if (!selected) {
      message("Select a nest result before exporting the cut list.", true);
      return false;
    }
    let fileName = this.dialog.showSaveDialogSync({
      title: "Export Grain-Nest cut list",
      defaultPath: this.suggestedExportPath(selected, "_CutList.txt"),
      filters: CUTLIST_FILE_FILTERS,
    });
    if (fileName === undefined) return false;
    if (!fileName.toLowerCase().endsWith(".txt")) fileName += ".txt";
    const text = this.buildCutListText(selected);
    this.fs.writeFileSync(fileName, text);
    return true;
  }

  /**
   * v1.8.0: "<pattern>_Nested_<Fabric>_<width><ending>", next to the
   * pattern file when its folder is known (see utils/file-names.ts).
   */
  suggestedExportPath(
    nest: SelectableNestingResult,
    ending: string,
  ): string | undefined {
    if (!this.deepNest || !this.config) return undefined;
    const src = patternSource(this.deepNest);
    const cfg = this.config.getSync() as unknown as UIConfig;
    const tag = fabricWidthTag(
      this.deepNest,
      nest,
      cfg.units,
      Number(cfg.scale) || 96,
    );
    const name = `${src ? src.base : "grain-nest"}_Nested${tag ? "_" + tag : ""}${ending}`;
    return inFolder(src ? src.dir : null, name);
  }

  /**
   * §9.3.7: build the plain-text cut-list summary. Pure function over
   * the nest result + current deepNest.parts + current units config.
   * No side effects.
   */
  buildCutListText(nestResult: SelectableNestingResult): string {
    if (!this.deepNest || !this.config) {
      return "";
    }
    const parts = this.deepNest.parts;
    const cfg = this.config.getSync() as unknown as UIConfig;
    const units = cfg.units;
    const scale = cfg.scale || 72;

    // Convert SVG units → user units (mm or inch). scale = SVG units
    // per inch, so dividing by scale gives inches; *25.4 for mm.
    const toUserUnits = (svgUnits: number): number =>
      units === "mm" ? (svgUnits / scale) * 25.4 : svgUnits / scale;

    // Format helper: mm shown to 0 decimals, inch to 1.
    const fmtLen = (svgUnits: number): string => {
      const v = toUserUnits(svgUnits);
      if (units === "mm") {
        // For metric, prefer m for anything ≥1000mm so a long bolt
        // doesn't read "3450 mm".
        if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)} m`;
        return `${v.toFixed(0)} mm`;
      }
      return `${v.toFixed(1)} in`;
    };

    // ---- Pieces section: group placements by filename, count
    // total and how many are mirrored (either part.mirror=true OR
    // it's a mirror-copy part). Sheets excluded.
    const pieceGroups = new Map<string, { total: number; mirrored: number }>();
    const sheetGroups = nestResult.placements;
    for (const sg of sheetGroups) {
      for (const placement of sg.sheetplacements) {
        const part = parts[placement.source];
        if (!part || part.sheet) continue;
        // §9.3.12: itemise by piece name when set (front, back, …) so
        // multiple pieces from one SVG don't merge under the filename.
        const name =
          part.name || part.filename || `(piece ${placement.source + 1})`;
        const entry = pieceGroups.get(name) ?? {
          total: 0,
          mirrored: 0,
        };
        entry.total += 1;
        if (part.mirror) entry.mirrored += 1;
        pieceGroups.set(name, entry);
      }
    }

    // §9.3.10: pick the length axis from the project's warp direction.
    // Warp horizontal (default) → length is the horizontal extent;
    // warp vertical → length is the vertical extent. The OTHER axis
    // is the bolt-width direction.
    const isWarpHorizontal = this.deepNest.warpDirection !== "vertical";

    // ---- Per-sheet stats. For each sheet, compute the bounding box
    // extent of placed pieces along the length axis ("length used").
    // §9.0.1 R6-A: the EXACT rotation-aware placed bounds (shared
    // DeepNest.placedBounds), measured from the sheet's own origin. The old
    // unrotated `p.x + bounds.width` shortcut disagreed with the nest-view
    // stat and with reality (testing round 6) — and the clamp below used to
    // mask the overshoot ("160.0 of 160.0").
    const sheetStats = sheetGroups.map((sg, i) => {
      const sheetPart = parts[sg.sheet];
      const sheetW = sheetPart ? sheetPart.bounds.width : 0;
      const sheetH = sheetPart ? sheetPart.bounds.height : 0;
      const lengthSpec = isWarpHorizontal ? sheetW : sheetH;
      const boltWidthSpec = isWarpHorizontal ? sheetH : sheetW;
      const sheetOrigin = sheetPart
        ? isWarpHorizontal
          ? sheetPart.bounds.x
          : sheetPart.bounds.y
        : 0;
      let lengthUsed = 0;
      for (const p of sg.sheetplacements) {
        const part = parts[p.source];
        if (!part || part.sheet) continue;
        const pb = this.deepNest!.placedBounds(part, p);
        if (!pb) continue;
        const placedEnd = isWarpHorizontal
          ? pb.x + pb.width - sheetOrigin
          : pb.y + pb.height - sheetOrigin;
        if (placedEnd > lengthUsed) lengthUsed = placedEnd;
      }
      // Don't allow length-used to overshoot the sheet (rounding
      // safety — placement coords are sometimes slightly off the
      // last pixel).
      if (lengthUsed > lengthSpec) lengthUsed = lengthSpec;
      return {
        index: i + 1,
        boltWidthSvg: boltWidthSpec,
        lengthSpecSvg: lengthSpec,
        lengthUsedSvg: lengthUsed,
        utilisation: nestResult.utilisation, // shared across the nest;
        // per-sheet utilisation isn't tracked separately yet
        piecesPlaced: sg.sheetplacements.filter((p) => !parts[p.source]?.sheet)
          .length,
      };
    });

    const lines: string[] = [];
    lines.push("Grain-Nest cut list");
    lines.push(
      `Generated: ${new Date().toISOString().replace("T", " ").substring(0, 19)}`,
    );
    lines.push("=".repeat(42));
    lines.push("");
    lines.push("PIECES");
    if (pieceGroups.size === 0) {
      lines.push("  (none placed)");
    } else {
      // Sort by filename for stable output.
      const sorted = Array.from(pieceGroups.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      // §9.3.7 (testing round 2): list mirrored pieces on their own
      // line rather than as a "(N mirrored)" suffix — clearer when
      // checking off a cut layout. e.g. a piece cut 2 + 1 reversed reads
      //   sleeve.svg                    ×2
      //   sleeve.svg (mirrored)         ×1
      for (const [name, info] of sorted) {
        const normal = info.total - info.mirrored;
        if (normal > 0) {
          lines.push(`  ${name.padEnd(30)}×${normal}`);
        }
        if (info.mirrored > 0) {
          lines.push(`  ${`${name} (mirrored)`.padEnd(30)}×${info.mirrored}`);
        }
      }
    }
    lines.push("");

    for (const s of sheetStats) {
      // Always display "bolt-width × length-specified" regardless of
      // warp direction — the order tracks the physical fabric (bolt
      // width is the fixed manufactured dimension; length is what
      // you're buying yardage of).
      lines.push(
        `SHEET ${s.index} of ${sheetStats.length}  ` +
          `(${fmtLen(s.boltWidthSvg)} wide × ${fmtLen(s.lengthSpecSvg)} long fabric)`,
      );
      lines.push(`  Pieces placed:   ${s.piecesPlaced}`);
      lines.push(
        `  Length used:     ${fmtLen(s.lengthUsedSvg)}  ` +
          `(of ${fmtLen(s.lengthSpecSvg)} specified)`,
      );
      // §9.0.1 R6-A: utilisation arrives already ×100 from the nest worker
      // (background.js stores e.g. 71.51, the nest view prints it raw); the
      // old `* 100` here printed "7151%" (testing round 6).
      lines.push(`  Utilisation:     ${s.utilisation.toFixed(2)}%`);
      lines.push("");
    }

    lines.push("TOTAL FABRIC NEEDED");
    let totalLengthSvg = 0;
    for (const s of sheetStats) {
      const areaUnits =
        units === "mm"
          ? ((s.boltWidthSvg / scale) *
              25.4 *
              ((s.lengthUsedSvg / scale) * 25.4)) /
            1_000_000 // mm² → m²
          : ((s.boltWidthSvg / scale) * (s.lengthUsedSvg / scale)) / 144; // in² → ft²
      const areaUnit = units === "mm" ? "m²" : "ft²";
      lines.push(
        `  Sheet ${s.index}: ${fmtLen(s.boltWidthSvg)} wide × ` +
          `${fmtLen(s.lengthUsedSvg)} long = ${areaUnits.toFixed(2)} ${areaUnit}`,
      );
      totalLengthSvg += s.lengthUsedSvg;
    }
    lines.push("");
    if (sheetStats.length > 1) {
      lines.push(
        `  Total length to buy (across all sheets): ${fmtLen(totalLengthSvg)}`,
      );
    } else if (sheetStats.length === 1) {
      lines.push(`  Total length to buy: ${fmtLen(totalLengthSvg)}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  /**
   * Show save dialog and export to SVG
   * @returns True if export was successful
   */
  exportToSvg(): boolean {
    if (!this.dialog || !this.fs) {
      message("Export dependencies not available", true);
      return false;
    }

    const selected = this.getSelectedNest();
    if (!selected) {
      return false;
    }

    let fileName = this.dialog.showSaveDialogSync({
      title: "Export SVG",
      defaultPath: this.suggestedExportPath(selected, ".svg"),
      filters: SVG_FILE_FILTERS,
    });

    if (fileName === undefined) {
      return false;
    }

    // Ensure .svg extension
    if (!fileName.toLowerCase().endsWith(".svg")) {
      fileName = fileName + ".svg";
    }

    const svgContent = this.generateSvgExport(selected);
    this.fs.writeFileSync(fileName, svgContent);

    return true;
  }

  /**
   * Generate SVG content from a nesting result
   * Core function that builds the SVG document from placements
   * @param nestResult - The nesting result to export
   * @returns SVG content as string
   */
  generateSvgExport(nestResult: SelectableNestingResult): string {
    if (!this.deepNest || !this.config) {
      throw new Error("DeepNest or config not available");
    }

    // v1.5.0: the export is laid out like the pattern files it came from —
    // Inkscape layers, one named group per piece holding that piece's cut
    // line, sew line, grain line and name — with uniform line widths and
    // the line colours from Settings.
    const style = this.exportStyle();
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttributeNS(XMLNS_NS, "xmlns:inkscape", INKSCAPE_NS);
    const ids = new Set<string>();
    const uniqueId = (base: string): string => {
      let id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
      ids.add(id);
      return id;
    };

    const parts = this.deepNest.parts;
    const sheets = nestResult.placements as SheetGroup[];
    const exportWithSheetBoundaries = !!this.config.getSync(
      "exportWithSheetBoundboarders",
    );
    // The gap is stored in inches (Settings shows it in mm or inches); it
    // used to be added as raw drawing units, i.e. ~1/96 of what was asked.
    const sheetGap = this.config.getSync("exportWithSheetsSpace")
      ? (Number(this.config.getSync("exportWithSheetsSpaceValue")) || 0) *
        style.scale
      : 0;

    // The calibration square sits in a strip above the first sheet, inside
    // the page (projection software shows only what's on the page) but
    // clear of every piece, on a layer of its own that can be hidden.
    const calibration = this.appendCalibrationLayer(svg, style, uniqueId);
    let svgWidth = calibration.width;
    let svgHeight = calibration.height;

    // v1.7.0: each sheet's page is cropped to the pieces nested on it (plus
    // a margin, kept within the fabric), so a few small pieces on wide
    // fabric don't come out on a huge, mostly empty page. Replaces the old
    // Trim sheets button, which shrank the sheet and threw the layout away.
    const margin = toSvgUnits(CROP_MARGIN_MM, style.scale, "mm");

    sheets.forEach((s, sheetIndex) => {
      const sheetPart = parts[s.sheet];
      // v1.13.0: a hide keeps its whole outline on the page (so the
      // projection lines up with it); rectangular fabric is cropped.
      const outline = sheetPart.polygontree as unknown as Pt[];
      const shaped = isShaped(outline, sheetPart.bounds);
      const sheetBounds = shaped
        ? { ...sheetPart.bounds }
        : this.piecesBox(s, sheetPart.bounds, margin);
      const sheetName = (sheetPart.name || "").trim();
      const layer = this.createLayer(
        uniqueId(`layer-sheet-${sheetIndex + 1}`),
        `Sheet ${sheetIndex + 1}` + (sheetName ? ` - ${sheetName}` : ""),
      );
      layer.setAttribute(
        "transform",
        `translate(${-sheetBounds.x} ${svgHeight - sheetBounds.y})`,
      );
      svg.appendChild(layer);

      if (exportWithSheetBoundaries) {
        const border = document.createElementNS(SVG_NS, "g");
        border.setAttribute("id", uniqueId(`border-${sheetIndex + 1}`));
        border.setAttributeNS(INKSCAPE_NS, "inkscape:label", "Sheet border");
        // v1.6.0: drawn half a line width inside the page's edge, so the
        // whole line is on the page. v1.7.0: round the nested pieces.
        const inset = style.width / 2;
        if (shaped) {
          const path = document.createElementNS(SVG_NS, "path");
          path.setAttribute("d", polygonPath(outline));
          path.setAttribute("style", style.line(style.border));
          border.appendChild(path);
          layer.appendChild(border);
        }
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", round(sheetBounds.x + inset));
        rect.setAttribute("y", round(sheetBounds.y + inset));
        rect.setAttribute(
          "width",
          round(Math.max(sheetBounds.width - 2 * inset, 0)),
        );
        rect.setAttribute(
          "height",
          round(Math.max(sheetBounds.height - 2 * inset, 0)),
        );
        rect.setAttribute("style", style.line(style.border));
        if (!shaped) {
          border.appendChild(rect);
          layer.appendChild(border);
        }
      }

      // v1.13.0: the sheet's flaws, in red, on a group of their own.
      const flawPolys = ((sheetPart.fileFlaws || []) as Pt[][]).concat(
        (sheetPart.appFlawPolys || []) as Pt[][],
      );
      if (flawPolys.length) {
        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("id", uniqueId(`flaws-${sheetIndex + 1}`));
        g.setAttributeNS(INKSCAPE_NS, "inkscape:label", "Flaws");
        flawPolys.forEach((f, i) => {
          const path = document.createElementNS(SVG_NS, "path");
          path.setAttribute("id", uniqueId(`flaw-${sheetIndex + 1}-${i + 1}`));
          path.setAttribute("d", polygonPath(f));
          path.setAttribute("style", style.line(FLAW_COLOUR));
          g.appendChild(path);
        });
        layer.appendChild(g);
      }

      s.sheetplacements.forEach((p) => {
        layer.appendChild(this.pieceGroup(parts[p.source], p, style, uniqueId));
      });

      svgWidth = Math.max(svgWidth, sheetBounds.width);
      svgHeight += sheetBounds.height;
      if (sheetIndex < sheets.length - 1) svgHeight += sheetGap;
    });

    this.applyDimensions(svg, svgWidth, svgHeight);
    return new XMLSerializer().serializeToString(svg);
  }

  /** v1.5.0: export line colours / width from Settings, in drawing units. */
  private exportStyle(): ExportStyle {
    const cfg = this.config!.getSync() as unknown as UIConfig;
    const scale = Number(cfg.scale) || 96;
    const widthMm = Number(cfg.exportLineWidthMm) || 2;
    const width = (widthMm * scale) / 25.4;
    const colour = (v: unknown, fallback: string): string =>
      typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
    return {
      scale,
      width,
      cut: colour(cfg.exportCutColour, "#3b1f6e"),
      sew: colour(cfg.exportSewColour, "#4f8a26"),
      grain: colour(cfg.exportGrainColour, "#4f8a26"),
      border: colour(cfg.exportBorderColour, "#00ffff"),
      line: (c: string, dashed = false): string =>
        `fill:none;stroke:${c};stroke-width:${round(width)};` +
        `stroke-linecap:round;stroke-linejoin:round` +
        (dashed
          ? `;stroke-dasharray:${round(width * 3)},${round(width * 2)}`
          : ""),
    };
  }

  private createLayer(id: string, label: string): SVGGElement {
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("id", id);
    layer.setAttributeNS(INKSCAPE_NS, "inkscape:groupmode", "layer");
    layer.setAttributeNS(INKSCAPE_NS, "inkscape:label", label);
    return layer;
  }

  /**
   * v1.5.0: one placed piece as a named group, like a piece group in the
   * pattern file: cut line, sew line, grain line and name inside it,
   * labelled "<name>", "sew-<n>", "grain-<n>" and "name-<n>" where <n> is
   * the piece number from its name (e.g. 14 for "14 Skirt Front C1OF").
   *
   * Frames: the group carries the placement (translate + rotate). The cut
   * and grain lines are the imported elements in their own frame, so they
   * get the mirror flip (and, for a cut-on-fold piece, the fold reflection)
   * on top; the sew line and the fold outline come from the nesting
   * polygon, which is already mirror- and fold-baked.
   */
  private pieceGroup(
    part: Part,
    placement: { x: number; y: number; rotation: number; id: number | string },
    style: ExportStyle,
    uniqueId: (base: string) => string,
  ): SVGGElement {
    const name = (part.name || "").trim();
    const num = pieceNumber(name) || `piece${String(placement.id)}`;
    const mirrored = !!part.mirror;
    const label =
      (name || `Piece ${String(placement.id)}`) +
      (mirrored ? " (mirrored)" : "");

    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("id", uniqueId(`group-${slug(label)}`));
    group.setAttributeNS(INKSCAPE_NS, "inkscape:label", label);
    group.setAttribute(
      "transform",
      `translate(${placement.x} ${placement.y}) rotate(${placement.rotation})`,
    );

    const mirrorTransform = part.mirror
      ? `translate(${2 * (part.bounds.x + part.bounds.width / 2)} 0) scale(-1 1)`
      : "";
    const isFold = !!(part.cutOnFold && part.foldLine);
    const isGrain = (e: Element): boolean =>
      e.getAttribute("data-grainnest-grain") === "1";
    const clone = (e: SVGElement, lineStyle: string): Element => {
      const node = e.cloneNode(false) as Element;
      if (node.tagName === "image") {
        const relPath = node.getAttribute("data-href");
        if (relPath) node.setAttribute("href", relPath);
        node.removeAttribute("data-href");
      } else {
        node.setAttribute("style", lineStyle);
      }
      node.removeAttribute("class"); // selection state ("active") etc.
      node.removeAttribute("id");
      node.removeAttributeNS(INKSCAPE_NS, "label");
      node.removeAttribute("inkscape:label");
      return node;
    };

    // Cut line: the outline plus any other marks attached to the piece
    // (notches, holes), all in the cut-line colour.
    const cut = document.createElementNS(SVG_NS, "g");
    cut.setAttribute("id", uniqueId(`cut-${num}`));
    cut.setAttributeNS(INKSCAPE_NS, "inkscape:label", `cut-${num}`);
    const marks = part.svgelements.filter((e) => !isGrain(e));
    const grains = part.svgelements.filter((e) => isGrain(e));
    if (isFold && part.foldLine) {
      // One seamless outline from the doubled polygon (no line along the
      // fold), plus the marks drawn on both halves.
      cut.appendChild(
        this.polygonPath(part.polygontree, style.line(style.cut)),
      );
      const own = document.createElementNS(SVG_NS, "g");
      const reflected = document.createElementNS(SVG_NS, "g");
      reflected.setAttribute(
        "transform",
        foldReflectionTransform(part.foldLine),
      );
      marks.slice(1).forEach((e) => {
        own.appendChild(clone(e, style.line(style.cut)));
        reflected.appendChild(clone(e, style.line(style.cut)));
      });
      if (mirrorTransform) own.setAttribute("transform", mirrorTransform);
      if (mirrorTransform)
        reflected.setAttribute(
          "transform",
          `${mirrorTransform} ${foldReflectionTransform(part.foldLine)}`,
        );
      if (own.childNodes.length) cut.appendChild(own);
      if (reflected.childNodes.length) cut.appendChild(reflected);
    } else {
      if (mirrorTransform) cut.setAttribute("transform", mirrorTransform);
      marks.forEach((e) => cut.appendChild(clone(e, style.line(style.cut))));
    }
    group.appendChild(cut);

    // Sew line: the nesting polygon inset by the seam allowance, dashed.
    const sew = this.sewLinePath(part, style);
    if (sew) {
      sew.setAttribute("id", uniqueId(`sew-${num}`));
      sew.setAttributeNS(INKSCAPE_NS, "inkscape:label", `sew-${num}`);
      group.appendChild(sew);
    }

    // Grain line: solid, so it reads apart from the dashed sew line.
    grains.forEach((e) => {
      const node = clone(e, style.line(style.grain));
      node.setAttribute("id", uniqueId(`grain-${num}`));
      node.setAttributeNS(INKSCAPE_NS, "inkscape:label", `grain-${num}`);
      if (mirrorTransform) node.setAttribute("transform", mirrorTransform);
      group.appendChild(node);
    });

    const text = this.pieceNameText(part, placement.rotation, name, style);
    if (text) {
      text.setAttribute("id", uniqueId(`name-${num}`));
      text.setAttributeNS(INKSCAPE_NS, "inkscape:label", `name-${num}`);
      group.appendChild(text);
    }
    return group;
  }

  /** A closed path through a polygon ring (and its holes). */
  private polygonPath(
    ring: { x: number; y: number }[] & {
      children?: { x: number; y: number }[][];
    },
    lineStyle: string,
  ): SVGPathElement {
    const rings = [ring, ...(ring.children || [])].filter(
      (r) => r && r.length >= 3,
    );
    const d = rings
      .map(
        (r) =>
          `M ${round(r[0].x)} ${round(r[0].y)} ` +
          r
            .slice(1)
            .map((pt) => `L ${round(pt.x)} ${round(pt.y)}`)
            .join(" ") +
          " Z",
      )
      .join(" ");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("style", lineStyle);
    return path;
  }

  /**
   * §9.3.9: the sew line — the nesting polygon inset by the piece's seam
   * allowance (mm). Null when there's no allowance or it swallows the piece.
   */
  private sewLinePath(part: Part, style: ExportStyle): SVGPathElement | null {
    const mm = part.seamAllowance;
    if (!this.deepNest || !mm || mm <= 0 || !part.polygontree) return null;
    const svgUnits = toSvgUnits(mm, style.scale, "mm");
    if (!(svgUnits > 0)) return null;
    // Notches in the cutting line aren't sewn, so the sew line ignores them.
    const outline = withoutNotches(
      part.polygontree,
      toSvgUnits(NOTCH_MAX_MM, style.scale, "mm"),
    );
    const insets = this.deepNest.polygonOffset(outline, -svgUnits);
    if (!insets || insets.length === 0) {
      console.warn(
        `[grainnest] sew line: ${mm}mm allowance collapses ${part.name || "a piece"} — skipped`,
      );
      return null;
    }
    const outer = insets[0] as { x: number; y: number }[] & {
      children?: { x: number; y: number }[][];
    };
    outer.children = insets.slice(1);
    return this.polygonPath(outer, style.line(style.sew, true));
  }

  /**
   * v1.7.0: the box round the pieces nested on one sheet, grown by
   * `margin` but kept within the sheet. The whole sheet if nothing on it
   * can be measured.
   */
  private piecesBox(
    sheet: SheetGroup,
    bounds: { x: number; y: number; width: number; height: number },
    margin: number,
  ): { x: number; y: number; width: number; height: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    sheet.sheetplacements.forEach((p) => {
      const part = this.deepNest!.parts[p.source];
      const b = part ? this.deepNest!.placedBounds(part, p) : null;
      if (!b) return;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    });
    if (!(maxX > minX && maxY > minY)) return { ...bounds };
    const x = Math.max(bounds.x, minX - margin);
    const y = Math.max(bounds.y, minY - margin);
    const right = Math.min(bounds.x + bounds.width, maxX + margin);
    const bottom = Math.min(bounds.y + bounds.height, maxY + margin);
    return { x, y, width: right - x, height: bottom - y };
  }

  /**
   * The piece's grain line(s) as segments in the same frame as its nesting
   * polygon (mirrored pieces flipped), so names can keep off them.
   */
  private grainSegments(part: Part): [Pt, Pt][] {
    const parser = (window as unknown as { SvgParser?: SvgParserLike })
      .SvgParser;
    if (!parser) return [];
    const cx = part.bounds.x + part.bounds.width / 2;
    const out: [Pt, Pt][] = [];
    part.svgelements
      .filter((e) => e.getAttribute("data-grainnest-grain") === "1")
      .forEach((e) => {
        let pts: Pt[] = [];
        try {
          pts = parser.polygonify(e) || [];
        } catch {
          pts = [];
        }
        if (pts.length < 2) return;
        const flip = (p: Pt): Pt =>
          part.mirror ? { x: 2 * cx - p.x, y: p.y } : { x: p.x, y: p.y };
        out.push([flip(pts[0]), flip(pts[pts.length - 1])]);
      });
    return out;
  }

  /**
   * v1.5.0: the piece name, placed where the piece has the most room (the
   * point deepest inside it) and kept clear of the cut line, so it no longer
   * spills over thin pieces or covers notches. Upright if it fits, else
   * turned to run along a tall thin piece; shrunk to fit; if even the
   * smallest size won't fit, just the piece number ("14"); else nothing.
   */
  private pieceNameText(
    part: Part,
    rotation: number,
    name: string,
    style: ExportStyle,
  ): SVGTextElement | null {
    if (!name || !this.deepNest || !part.polygontree) return null;
    const mmToUnits = style.scale / 25.4;
    // Keep text this far inside the cut line: clear of notches (~6 mm deep)
    // and of the sew line.
    const clearance = Math.max(8, (part.seamAllowance || 0) + 3) * mmToUnits;
    const inner = this.deepNest.polygonOffset(part.polygontree, -clearance);
    if (!inner || inner.length === 0) return null;
    const room = inner.reduce((a, b) =>
      polygonArea(b) > polygonArea(a) ? b : a,
    );
    if (room.length < 3) return null;
    const grains = this.grainSegments(part);
    const pad = 2 * mmToUnits;
    const label = name + (part.mirror ? " (mirrored)" : "");
    const number = pieceNumber(name);
    const maxSize = 16 * mmToUnits;
    const minSize = 4 * mmToUnits;
    const step = 0.5 * mmToUnits;
    // Best first: the full name clear of the grain line; then over it (a
    // name across the grain line beats no name); then just the number.
    const texts = number && number !== label ? [label, number] : [label];
    const attempts = texts.flatMap((text) =>
      grains.length
        ? [
            { text, obstacles: grains },
            { text, obstacles: [] as [Pt, Pt][] },
          ]
        : [{ text, obstacles: [] as [Pt, Pt][] }],
    );
    for (const { text, obstacles } of attempts) {
      // Try the roomiest spots and keep the one that takes the biggest text
      // (upright on the sheet, or turned a quarter to read up a tall thin
      // piece — angles are in the piece's frame, so cancel its rotation).
      let best: { size: number; centre: Pt; angle: number } | null = null;
      for (const centre of candidateCentres(room, obstacles)) {
        for (const turn of [0, -90]) {
          const angle = -rotation + turn;
          const fits = (size: number): boolean =>
            rectInside(
              room,
              centre,
              measureText(text, size),
              size,
              angle,
              obstacles,
              pad,
            );
          if (!fits(minSize)) continue;
          let lo = minSize;
          let hi = maxSize;
          if (fits(hi)) lo = hi;
          while (hi - lo > step) {
            const mid = (lo + hi) / 2;
            if (fits(mid)) lo = mid;
            else hi = mid;
          }
          // Prefer upright text unless turning it buys a clearly bigger size.
          const score = turn === 0 ? lo * 1.25 : lo;
          if (!best || score > best.size) best = { size: score, centre, angle };
        }
      }
      if (best) {
        const size = Math.min(
          maxSize,
          Math.abs(best.angle + rotation) < 1e-9 ? best.size / 1.25 : best.size,
        );
        const t = document.createElementNS(SVG_NS, "text");
        t.setAttribute(
          "transform",
          `translate(${round(best.centre.x)} ${round(best.centre.y)}) rotate(${round(best.angle)})`,
        );
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dominant-baseline", "central");
        t.setAttribute(
          "style",
          `font-family:sans-serif;font-size:${round(size)}px;fill:${style.cut};stroke:none`,
        );
        t.textContent = text;
        return t;
      }
    }
    return null;
  }

  /**
   * §9.3.8 / v1.5.0: the calibration square and its label on a layer of
   * their own, in a strip at the top of the page above the first sheet, so
   * they're on the page but never over a piece. Returns the strip's size
   * (0 × 0 when the square is switched off).
   */
  private appendCalibrationLayer(
    svg: SVGElement,
    style: ExportStyle,
    uniqueId: (base: string) => string,
  ): { width: number; height: number } {
    if (!this.config || !this.config.getSync("exportScalingBox")) {
      return { width: 0, height: 0 };
    }
    const cfg = this.config.getSync() as unknown as UIConfig;
    const sizeIn = Number(cfg.exportScalingBoxSizeInches) || 4;
    const size = style.scale * sizeIn;
    const margin = style.scale * 0.5;
    const labelSize = style.scale * 0.25;

    const layer = this.createLayer(
      uniqueId("layer-calibration"),
      "Calibration",
    );
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("id", uniqueId("calibration-square"));
    rect.setAttributeNS(INKSCAPE_NS, "inkscape:label", "calibration-square");
    rect.setAttribute("x", round(margin));
    rect.setAttribute("y", round(margin));
    rect.setAttribute("width", round(size));
    rect.setAttribute("height", round(size));
    rect.setAttribute("style", style.line(style.cut));
    layer.appendChild(rect);

    const mm = Math.round(sizeIn * 25.4 * 10) / 10;
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("id", uniqueId("calibration-label"));
    text.setAttributeNS(INKSCAPE_NS, "inkscape:label", "calibration-label");
    text.setAttribute("x", round(margin * 2 + size));
    text.setAttribute("y", round(margin + labelSize));
    text.setAttribute(
      "style",
      `font-family:sans-serif;font-size:${round(labelSize)}px;fill:${style.cut};stroke:none`,
    );
    const inches = Math.round(sizeIn * 100) / 100;
    text.textContent = `${inches} in (${mm} mm) square: measure to check the scale`;
    layer.appendChild(text);
    svg.appendChild(layer);

    return {
      width:
        margin * 2 + size + measureText(text.textContent, labelSize) + margin,
      height: margin * 2 + size,
    };
  }

  /**
   * Apply dimensions and viewBox to the SVG element
   * @param svg - SVG element
   * @param width - Content width in SVG units
   * @param height - Content height in SVG units
   */
  private applyDimensions(
    svg: SVGSVGElement,
    width: number,
    height: number,
  ): void {
    if (!this.config) {
      return;
    }

    let scale = this.config.getSync("scale");

    // Convert scale based on units
    const units = this.config.getSync("units");
    if (units === "mm") {
      scale /= 25.4;
    }

    // Set dimensions with unit suffix
    const unitSuffix = units === "inch" ? "in" : "mm";
    svg.setAttribute("width", `${round(width / scale)}${unitSuffix}`);
    svg.setAttribute("height", `${round(height / scale)}${unitSuffix}`);
    svg.setAttribute("viewBox", `0 0 ${round(width)} ${round(height)}`);
  }

  /**
   * Export to the specified format
   * @param format - Export format (svg, json or cutlist)
   * @returns Promise that resolves to true if export was successful
   */
  async export(format: ExportFormat): Promise<boolean> {
    if (this.isExporting) {
      return false;
    }

    this.isExporting = true;

    try {
      switch (format) {
        case "svg":
          return this.exportToSvg();
        case "json":
          return this.exportToJson();
        case "cutlist":
          return this.exportToCutList();
        default:
          message(`Unsupported export format: ${format}`, true);
          return false;
      }
    } finally {
      this.isExporting = false;
    }
  }

  /**
   * Check if export is currently in progress
   * @returns True if exporting
   */
  isExportInProgress(): boolean {
    return this.isExporting;
  }

  /**
   * Check if there is a selected nest result available for export
   * @returns True if a nest result is selected
   */
  hasSelectedNest(): boolean {
    return this.getSelectedNest() !== null;
  }

  /**
   * Get supported export formats
   * @returns Array of supported format strings
   */
  static getSupportedFormats(): ExportFormat[] {
    return ["svg", "json", "cutlist"];
  }

  /**
   * Get file filters for a specific format
   * @param format - Export format
   * @returns Array of file filters
   */
  static getFileFilters(format: ExportFormat): FileFilter[] {
    switch (format) {
      case "svg":
        return [...SVG_FILE_FILTERS];
      case "cutlist":
        return [...CUTLIST_FILE_FILTERS];
      default:
        return [];
    }
  }

  /**
   * Create and return a new ExportService instance
   * @param options - Optional configuration options
   * @returns New ExportService instance
   */
  static create(
    options?: ConstructorParameters<typeof ExportService>[0],
  ): ExportService {
    return new ExportService(options);
  }
}

/**
 * Factory function to create an export service
 * @param options - Optional configuration options
 * @returns New ExportService instance
 */
export function createExportService(
  options?: ConstructorParameters<typeof ExportService>[0],
): ExportService {
  return ExportService.create(options);
}
