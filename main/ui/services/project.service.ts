/**
 * Project Service (§9.3.3)
 *
 * Save / load Grain-Nest project files (.gnp — JSON internally).
 *
 * What gets persisted: the imports list (full serialised SVG of each
 * import, so the project is self-contained and survives the user
 * moving the source SVG file later), one entry per part in
 * deepNest.parts order, the nests result list. Per-part state covered:
 * quantity, sheet flag, grainRule, grainAngle, grainSource, mirror,
 * excluded (phase-r8a).
 *
 * Mirror copies and sheet rects need source-info beyond what import
 * provides; see the kind discriminator on each saved part.
 *
 */

import type {
  DeepNestInstance,
  RactiveInstance,
  PartsViewData,
  NestViewData,
} from "../types/index.js";
import type { Part, NestingResult } from "../../../index.d.ts";
import type { SheetFlaw } from "../utils/flaws.js";
import { message } from "../utils/ui-helpers.js";
import { inFolder, patternSource } from "../utils/file-names.js";
import {
  lastNestOf,
  layoutForFile,
  layoutFromFile,
  layoutsOf,
  pieceId,
  setLastNest,
  type SavedLayoutFile,
} from "../utils/saved-layouts.js";
import {
  clearViews,
  viewsForFile,
  viewsFromFile,
  type PieceViewFile,
} from "../utils/views.js";

/**
 * File system interface — minimal slice this service needs. Matches
 * Node.js `fs`.
 */
interface FileSystem {
  writeFileSync(path: string, data: string): void;
  readFileSync(path: string, encoding: string): string;
}

interface FileFilter {
  name: string;
  extensions: string[];
}

interface SaveDialogOptions {
  title: string;
  defaultPath?: string;
  filters: FileFilter[];
}

interface OpenDialogOptions {
  title: string;
  filters: FileFilter[];
  properties: "openFile"[];
}

interface ElectronDialog {
  showSaveDialogSync(options: SaveDialogOptions): string | undefined;
  showOpenDialogSync(options: OpenDialogOptions): string[] | undefined;
}

/**
 * The saved file's per-part source discriminator — what the loader
 * needs to know to recreate the part.
 */
type SavedPartSource =
  | {
      kind: "import";
      importIndex: number;
      indexInImport: number;
      /**
       * v1.1.1: indexInImport is the part's position in its import's
       * (saved) SVG, in file order.
       * Files without it counted positions in the (possibly sorted or
       * pruned) list order, which could point at the wrong piece.
       */
      exact?: boolean;
    }
  | { kind: "mirror-copy"; ofPartIndex: number }
  | { kind: "sheet-rect"; widthSvgUnits: number; heightSvgUnits: number };

/**
 * One part as it appears in the .gnp file.
 */
interface SavedPart {
  source: SavedPartSource;
  quantity: number;
  /** §9.3.12: user/detected piece name. Optional for back-compat. */
  name?: string;
  sheet: boolean;
  grainRule?: "free" | "lock" | "flipped" | "bias" | "custom";
  grainAngle?: number;
  grainSource?: "detected" | "manual" | "manual-required";
  /** phase-r8c: piece turned end-to-end (other grain end is the top). */
  topFlip?: boolean;
  mirror?: boolean;
  /** §9.3.2 behaviour 3: piece is cut on the fold (doubled). */
  cutOnFold?: boolean;
  /** §9.3.2 behaviour 3: fold line (piece coords, angle in radians). */
  foldLine?: { x0: number; y0: number; ang: number };
  /** v1.5.0: fold edge marked in the app ("Mark fold"). */
  markedFold?: { x0: number; y0: number; ang: number };
  /** §9.3.9: per-piece seam allowance in millimetres. */
  seamAllowance?: number;
  /** phase-r8a: left out of the nest (still in the list). Absent = included. */
  excluded?: boolean;
  /** v1.2.0: sheets only — the fabric this sheet is for. */
  fabric?: string;
  /** v1.13.0: sheets only — flaws added in the Flaws box. */
  flaws?: SheetFlaw[];
  /** v1.9.0: the piece's Fuse choice (main + interfacing codes). */
  fuseMode?: "all" | "one" | "separate";
  /** v1.9.0: how many are mirrored (absent = Auto, half). */
  mirrorCount?: number;
  /** v1.9.0: unfolded by hand, so an OF code doesn't re-fold it. */
  userUnfolded?: boolean;
}

/**
 * One import as it appears in the .gnp file. Sheets aren't here —
 * they're recreated from their saved width/height on load.
 */
interface SavedImport {
  filename: string;
  svg: string;
}

/**
 * Full saved file shape (schema version 1).
 */
interface ProjectFileV1 {
  grainnestProject: 1;
  savedAt: string;
  imports: SavedImport[];
  parts: SavedPart[];
  nests: NestingResult[];
  /**
   * §9.3.4 nap toggle. Optional for backwards-compat with .gnp files
   * written before nap shipped — loader defaults to false when absent.
   */
  nap?: boolean;
  /** v1.3.0: "knit" for knit projects; absent = woven. */
  fabricType?: "woven" | "knit";
  /** phase-r8a: last "Nest for" job picked. Absent = "all". */
  nestJob?: string;
  /**
   * §9.3.10 warp direction. Optional for backwards-compat with .gnp
   * files written before warp-direction shipped — loader defaults to
   * "horizontal" when absent (which matches brief §3.3).
   */
  warpDirection?: "horizontal" | "vertical";
  /** v1.10.0: saved layouts; pieces are positions in `parts`. */
  layouts?: SavedLayoutFile[];
  /** v1.10.0: the best layout of the last nest, not saved by name. */
  lastNest?: SavedLayoutFile;
  /** v1.11.0: views (pieces as positions in `parts`), and the one shown. */
  views?: PieceViewFile[];
  currentView?: string;
}

const PROJECT_FILE_FILTERS: FileFilter[] = [
  { name: "Grain-Nest Project", extensions: ["gnp"] },
];

const DEFAULT_SAVE_FILENAME = "grain-nest-project.gnp";

export interface ProjectServiceOptions {
  dialog: ElectronDialog;
  fs: FileSystem;
  deepNest: DeepNestInstance;
  partsRactive: RactiveInstance<PartsViewData> | null;
  nestRactive: RactiveInstance<NestViewData> | null;
  /**
   * Called after a successful load. The host can use this to refresh
   * derived UI state (zoom, scroll, dropdowns) that doesn't update
   * automatically from a ractive refresh alone.
   */
  onAfterLoad?: () => void;
}

/**
 * Project Save/Load service.
 */
export class ProjectService {
  private dialog: ElectronDialog;
  private fs: FileSystem;
  private deepNest: DeepNestInstance;
  private partsRactive: RactiveInstance<PartsViewData> | null;
  private nestRactive: RactiveInstance<NestViewData> | null;
  private onAfterLoad: (() => void) | null;

  constructor(options: ProjectServiceOptions) {
    this.dialog = options.dialog;
    this.fs = options.fs;
    this.deepNest = options.deepNest;
    this.partsRactive = options.partsRactive;
    this.nestRactive = options.nestRactive;
    this.onAfterLoad = options.onAfterLoad ?? null;
  }

  setPartsRactive(r: RactiveInstance<PartsViewData>): void {
    this.partsRactive = r;
  }

  setNestRactive(r: RactiveInstance<NestViewData>): void {
    this.nestRactive = r;
  }

  /**
   * Show a save dialog and persist the current state. Returns true on
   * success, false if the user cancelled or the write failed.
   */
  saveProject(): boolean {
    const filePath = this.dialog.showSaveDialogSync({
      title: "Save Grain-Nest project",
      defaultPath: this.suggestedProjectPath(),
      filters: PROJECT_FILE_FILTERS,
    });
    if (!filePath) return false;

    try {
      const data = this.buildSaveData();
      this.fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      this.rememberProject(filePath);
      return true;
    } catch (e) {
      const err = e as Error;
      message(`Could not save project: ${err.message}`, true);
      return false;
    }
  }

  /**
   * Show an open dialog and restore the chosen project file. Returns
   * true on success.
   */
  loadProject(): boolean {
    const paths = this.dialog.showOpenDialogSync({
      title: "Open Grain-Nest project",
      filters: PROJECT_FILE_FILTERS,
      properties: ["openFile"],
    });
    if (!paths || paths.length === 0) return false;
    return this.loadProjectFile(paths[0]);
  }

  /**
   * Restores a project file (Open project…, or v1.12.0 a .gnp the Mac
   * sends, e.g. by double-clicking it). Returns true on success.
   */
  loadProjectFile(filePath: string): boolean {
    const paths = [filePath];
    try {
      const raw = this.fs.readFileSync(paths[0], "utf8");
      const data = JSON.parse(raw) as ProjectFileV1;
      if (data.grainnestProject !== 1) {
        message(
          `Unrecognised project file version: ${data.grainnestProject}. ` +
            `This build supports version 1.`,
          true,
        );
        return false;
      }
      this.applyLoadData(data);
      this.rememberProject(paths[0]);
      if (this.onAfterLoad) this.onAfterLoad();
      return true;
    } catch (e) {
      const err = e as Error;
      message(`Could not load project: ${err.message}`, true);
      return false;
    }
  }

  /**
   * v1.8.0: the project file last opened or saved, with the pattern it
   * was for, so saving again suggests the same file.
   */
  private lastProject: { path: string; base: string } | null = null;

  private rememberProject(path: string): void {
    const src = patternSource(this.deepNest);
    this.lastProject = src ? { path, base: src.base } : null;
  }

  /**
   * v1.8.0: named after the pattern ("Coat.gnp", next to the pattern
   * file), or the project already opened or saved for it.
   */
  private suggestedProjectPath(): string {
    const src = patternSource(this.deepNest);
    if (!src) return DEFAULT_SAVE_FILENAME;
    if (this.lastProject && this.lastProject.base === src.base)
      return this.lastProject.path;
    return inFolder(src.dir, `${src.base}.gnp`);
  }

  // -------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------

  private buildSaveData(): ProjectFileV1 {
    const imports: SavedImport[] = this.deepNest.imports.map((im) => ({
      filename: im.filename,
      svg: new XMLSerializer().serializeToString(im.svg),
    }));

    // Per-import counter — for each non-sheet, non-mirror part, walk
    // through deepNest.parts in order and assign indexInImport by
    // counting how many we've already attributed to that import.
    const importCounter: Record<number, number> = {};

    // Track most-recent-prior non-mirror part index per filename, so
    // mirror copies can record which saved part they're a copy of.
    const mostRecentByFilename = new Map<string | null, number>();

    // v1.1.1: each import part's position among its import's surviving
    // parts, in file order (importPartIndex, stamped at import). Deleting a
    // piece also removes it from the import's SVG, so on reload the
    // re-imported parts come back in exactly this order — whatever order
    // the list is in now. (Counting in list order, as before, pointed
    // pieces of a sorted list at the wrong saved settings.)
    const fileOrderRank = new Map<Part, number>();
    // v1.3.0: grouped by the import itself (importRef), so the same file
    // imported twice keeps two separate sets of positions.
    const byFile = new Map<unknown, Part[]>();
    for (const p of this.deepNest.parts) {
      // v1.13.0: sheets from a file (a hide) are saved as part of it.
      if (p.isMirrorCopy || typeof p.importPartIndex !== "number") continue;
      const key = p.importRef ?? p.filename;
      byFile.set(key, [...(byFile.get(key) ?? []), p]);
    }
    for (const list of byFile.values()) {
      list
        .sort((a, b) => (a.importPartIndex ?? 0) - (b.importPartIndex ?? 0))
        .forEach((p, i) => fileOrderRank.set(p, i));
    }

    // v1.9.0: the copies made for a nest aren't saved (they're made again
    // at the next nest); they sit at the end, so other indices are kept.
    const toSave = this.deepNest.parts.filter((p) => !p.autoCopy);
    const parts: SavedPart[] = toSave.map((p, savedIdx) => {
      const common = {
        quantity: p.quantity,
        name: p.name,
        sheet: !!p.sheet,
        grainRule: p.grainRule,
        grainAngle: p.grainAngle,
        grainSource: p.grainSource,
        topFlip: p.sheet ? undefined : p.topFlip || undefined,
        mirror: p.mirror,
        cutOnFold: p.cutOnFold,
        foldLine: p.foldLine,
        markedFold: p.markedFold,
        seamAllowance: p.seamAllowance,
        // v1.2.0: sheets can be excluded too, and carry a fabric.
        excluded: p.excluded || undefined,
        fabric: p.sheet ? p.fabric || undefined : undefined,
        fuseMode: p.sheet ? undefined : p.fuseMode,
        mirrorCount: p.sheet ? undefined : p.mirrorCount,
        userUnfolded: p.sheet ? undefined : p.userUnfolded || undefined,
        // v1.13.0: flaws added in the Flaws box.
        flaws: p.sheet && p.flaws && p.flaws.length ? p.flaws : undefined,
      };

      // Sheet — has no entry in deepNest.imports (addSheet uses
      // filename=null). Capture dimensions so we can recreate via a
      // synthetic rect-SVG import on load.
      // v1.13.0: only a sheet made with Add a sheet (no file behind it);
      // a sheet from a file (a hide) keeps its shape through its import.
      if (p.sheet && typeof p.importPartIndex !== "number") {
        return {
          source: {
            kind: "sheet-rect",
            widthSvgUnits: p.bounds.width,
            heightSvgUnits: p.bounds.height,
          },
          ...common,
        };
      }

      // Mirror copy — record exactly which part it mirrors.
      // §9.0.1 R6-B: primary resolution is the id link stamped by
      // DeepNest.mirrorCopyPart (`copy.mirrorOfId` === source's
      // `grainnestId`). Saved-array order equals deepNest.parts order
      // here, so the source's in-memory index IS its saved index. The
      // old filename-recency guess below assumed every copy appends
      // right after its source — false for Bulk-Apply copies, which all
      // append after ALL originals (one shared filename), so every copy
      // saved as a copy of the LAST original (testing round 6: all 11
      // copies in a real .gnp pointed at part 14). Recency survives only as
      // a fallback for parts created before the id link existed.
      if (p.isMirrorCopy) {
        let srcIdx = -1;
        if (p.mirrorOfId != null) {
          // Match purely by id (a source can itself be a mirror copy —
          // copy-of-a-copy); `q !== p` only as belt-and-braces.
          srcIdx = this.deepNest.parts.findIndex(
            (q) => q !== p && !q.sheet && q.grainnestId === p.mirrorOfId,
          );
        }
        if (srcIdx < 0) {
          const prior = mostRecentByFilename.get(p.filename);
          if (prior !== undefined) srcIdx = prior;
        }
        if (srcIdx >= 0) {
          return {
            source: { kind: "mirror-copy", ofPartIndex: srcIdx },
            ...common,
          };
        }
        // Source not resolvable at all — fall through to the
        // import-origin path. (The mirror flag still survives in
        // `common`, so the visual flip is kept.)
      }

      // Import-origin part. Track most-recent so a later mirror copy
      // with the same filename can point at this one.
      mostRecentByFilename.set(p.filename, savedIdx);

      // Find the import by filename. If multiple imports share the
      // same filename, the per-importIndex counter handles it: we
      // start with the first matching import and roll forward as its
      // counter exceeds its production count. v1 simplification: we
      // don't actually know each import's production count without
      // re-parsing, so we always pick the first matching import and
      // increment that counter. This is correct as long as the same
      // filename isn't imported twice — fine for any realistic
      // sewing workflow.
      // v1.3.0: the part's own import when known (same file imported twice),
      // else the first import with its filename.
      const ownImport = p.importRef
        ? this.deepNest.imports.indexOf(p.importRef)
        : -1;
      const importIndex =
        ownImport >= 0
          ? ownImport
          : imports.findIndex((im) => im.filename === p.filename);
      if (importIndex === -1) {
        // Orphan: import was deleted but the part wasn't. Best we
        // can do is encode as a degenerate import with sheet=false
        // and let the loader skip it (it'll fail to find the
        // import). Surface via console rather than failing the save.

        console.warn(
          `[grainnest] saving orphan part with filename=${p.filename} — its source import was deleted; the part may not restore correctly`,
        );
        return {
          source: { kind: "import", importIndex: -1, indexInImport: 0 },
          ...common,
        };
      }
      const rank = fileOrderRank.get(p);
      if (rank !== undefined) {
        return {
          source: {
            kind: "import",
            importIndex,
            indexInImport: rank,
            exact: true,
          },
          ...common,
        };
      }
      // Fallback for parts without a stamped position (shouldn't happen
      // for anything imported by this version).
      const indexInImport = importCounter[importIndex] ?? 0;
      importCounter[importIndex] = indexInImport + 1;
      return {
        source: { kind: "import", importIndex, indexInImport },
        ...common,
      };
    });

    // v1.10.0: layouts refer to pieces by session id; in the file, by
    // their position in `parts`.
    const savedIndexOfPid = new Map<number, number>();
    toSave.forEach((p, i) => savedIndexOfPid.set(pieceId(this.deepNest, p), i));
    const layouts = layoutsOf(this.deepNest)
      .map((l) => layoutForFile(l, savedIndexOfPid))
      .filter((l): l is SavedLayoutFile => !!l);
    const last = lastNestOf(this.deepNest);
    const lastNest = last
      ? (layoutForFile(last, savedIndexOfPid) ?? undefined)
      : undefined;

    return {
      grainnestProject: 1,
      savedAt: new Date().toISOString(),
      imports,
      parts,
      // v1.10.0: nest results aren't kept any more (their piece numbers
      // went stale, e.g. the copies made for pairs); saved layouts are.
      nests: [],
      layouts,
      lastNest,
      ...viewsForFile(this.deepNest, savedIndexOfPid),
      nap: !!this.deepNest.nap,
      fabricType: this.deepNest.fabricType === "knit" ? "knit" : undefined,
      nestJob: this.deepNest.nestJob,
      warpDirection: this.deepNest.warpDirection ?? "horizontal",
    };
  }

  // -------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------

  private applyLoadData(data: ProjectFileV1): void {
    // Wipe current state. ractive.update("imports"/"parts") triggers
    // a re-render that drops the now-orphan import DIVs.
    this.resetWorkspace();

    // §9.3.4: restore nap before doing anything else so the checkbox-
    // resync in the onAfterLoad callback sees the right value.
    this.deepNest.nap = !!data.nap;
    // v1.3.0: woven (default) or knit project.
    this.deepNest.fabricType = data.fabricType === "knit" ? "knit" : "woven";
    // phase-r8a: restore the picker position only — the per-piece
    // `excluded` flags (applied below) decide what nests, so loading never
    // re-applies the job over hand-adjusted ticks.
    this.deepNest.nestJob = data.nestJob || "all";
    if (this.partsRactive) {
      (
        this.partsRactive as unknown as { set(k: string, v: unknown): void }
      ).set("nestJob", this.deepNest.nestJob);
    }
    // §9.3.10: the warp-direction picker was removed in round 2 — the
    // app now always nests warp-horizontal. Deliberately ignore any
    // saved value (an older .gnp may carry "vertical" from when the
    // control existed) so a reload can't strand a project in an
    // orientation the UI can no longer change.
    this.deepNest.warpDirection = "horizontal";

    // Pre-import: do every import in saved order so import-kind parts
    // can be looked up by (importIndex, indexInImport). Track the
    // offset where each import's parts land in deepNest.parts.
    const importOffsets: number[] = new Array(data.imports.length).fill(-1);
    const importCounts: number[] = new Array(data.imports.length).fill(0);
    for (let i = 0; i < data.imports.length; i++) {
      const im = data.imports[i];
      const before = this.deepNest.parts.length;
      this.deepNest.importsvg(
        im.filename,
        null,
        withoutRootSize(im.svg),
        null,
        false,
      );
      importOffsets[i] = before;
      importCounts[i] = this.deepNest.parts.length - before;
    }

    // v1.1.1 rescue for files saved before positions were exact: they
    // counted positions in list order, so a project saved while sorted (or
    // after deleting a piece) points at the wrong pieces. Each saved piece's
    // name usually still matches the name detected from the file (its
    // inkscape:labels), so when exactly one piece of that import carries
    // the saved name, use it. Built before applyOverrides renames anything.
    const detectedByName: Map<string, number[]>[] = data.imports.map(
      (_im, i) => {
        const m = new Map<string, number[]>();
        for (let k = 0; k < importCounts[i]; k++) {
          const memIdx = importOffsets[i] + k;
          const name = this.deepNest.parts[memIdx].name;
          if (!name) continue;
          m.set(name, [...(m.get(name) ?? []), memIdx]);
        }
        return m;
      },
    );
    const claimed = new Set<number>();

    // Map saved part index → in-memory part index, populated as we go.
    // Used by mirror-copy entries to resolve their source.
    const savedToMem: number[] = new Array(data.parts.length).fill(-1);

    // §9.0.1 R6-B: restore in TWO passes — import/sheet entries first,
    // mirror copies second — so a copy restores even when the saved order
    // put it before its source (e.g. the parts table was sorted by a
    // column before saving). The old single pass skipped such copies.
    const deferredCopies: number[] = [];

    // Pass 1: everything except mirror copies.
    for (let savedIdx = 0; savedIdx < data.parts.length; savedIdx++) {
      const sp = data.parts[savedIdx];
      let memIdx = -1;

      switch (sp.source.kind) {
        case "import": {
          const { importIndex, indexInImport } = sp.source;
          if (importIndex < 0 || importIndex >= importOffsets.length) {
            console.warn(
              `[grainnest] saved part ${savedIdx} references missing importIndex ${importIndex}; skipping`,
            );
            continue;
          }
          if (indexInImport >= importCounts[importIndex]) {
            console.warn(
              `[grainnest] saved part ${savedIdx} references indexInImport ${indexInImport} but import ${importIndex} only produced ${importCounts[importIndex]} parts; skipping`,
            );
            continue;
          }
          memIdx = importOffsets[importIndex] + indexInImport;
          if (!sp.source.exact && sp.name) {
            const byName = detectedByName[importIndex].get(sp.name);
            if (
              byName &&
              byName.length === 1 &&
              byName[0] !== memIdx &&
              !claimed.has(byName[0])
            ) {
              console.warn(
                `[grainnest] old-file rescue: saved part ${savedIdx} ("${sp.name}") ` +
                  `matched by name instead of list position`,
              );
              memIdx = byName[0];
            }
          }
          if (claimed.has(memIdx)) {
            console.warn(
              `[grainnest] saved part ${savedIdx} maps to a piece already restored; skipping`,
            );
            continue;
          }
          claimed.add(memIdx);
          break;
        }

        case "mirror-copy": {
          deferredCopies.push(savedIdx);
          continue;
        }

        case "sheet-rect": {
          // Reproduce sheet-dialog.addSheet without going through it
          // (avoids unit conversion — we already have SVG units).
          const { widthSvgUnits, heightSvgUnits } = sp.source;
          const sheetSvg = this.synthesiseSheetSvg(
            widthSvgUnits,
            heightSvgUnits,
          );
          const before = this.deepNest.parts.length;
          this.deepNest.importsvg(null, null, sheetSvg, null, false);
          const created = this.deepNest.parts.length - before;
          if (created === 0) continue;
          memIdx = before;
          this.deepNest.parts[memIdx].sheet = true;
          break;
        }
      }

      savedToMem[savedIdx] = memIdx;
      this.applyOverrides(this.deepNest.parts[memIdx], sp);
    }

    // Pass 2: mirror copies (in saved order, so a copy-of-a-copy can
    // resolve an earlier copy).
    for (const savedIdx of deferredCopies) {
      const sp = data.parts[savedIdx];
      const src = sp.source as { kind: "mirror-copy"; ofPartIndex: number };
      let ofSavedIdx = src.ofPartIndex;

      // §9.0.1 R6-B rescue for files saved by the buggy code, which
      // pointed EVERY bulk-made copy at the last original. The copy's
      // saved NAME was inherited from its true source, so it identifies
      // the right one: when the recorded source's name disagrees with the
      // copy's and exactly one non-mirror, non-sheet saved part carries
      // the copy's name, rewire to that part. A deliberately renamed copy
      // simply finds no name match and keeps its recorded link.
      const recorded = data.parts[ofSavedIdx] as SavedPart | undefined;
      if (sp.name && (!recorded || recorded.name !== sp.name)) {
        const candidates: number[] = [];
        data.parts.forEach((q, qi) => {
          if (
            !q.sheet &&
            q.source.kind !== "mirror-copy" &&
            q.name === sp.name
          ) {
            candidates.push(qi);
          }
        });
        if (candidates.length === 1 && candidates[0] !== ofSavedIdx) {
          console.warn(
            `[grainnest] mirror-copy rescue: saved part ${savedIdx} ` +
              `("${sp.name}") pointed at "${recorded ? recorded.name : "?"}" — ` +
              `rewired to saved part ${candidates[0]} by name`,
          );
          ofSavedIdx = candidates[0];
        }
      }

      const ofMemIdx =
        ofSavedIdx >= 0 && ofSavedIdx < savedToMem.length
          ? savedToMem[ofSavedIdx]
          : -1;
      if (ofMemIdx < 0) {
        console.warn(
          `[grainnest] saved part ${savedIdx} is a mirror-copy of saved part ${ofSavedIdx}, which didn't restore; skipping`,
        );
        continue;
      }
      const memIdx = this.deepNest.mirrorCopyPart(ofMemIdx);
      if (memIdx < 0) continue;
      savedToMem[savedIdx] = memIdx;
      this.applyOverrides(this.deepNest.parts[memIdx], sp);
    }

    // v1.10.0: the part each saved position became (before reordering).
    const partAtSaved = savedToMem.map((m) =>
      m >= 0 ? this.deepNest.parts[m] : undefined,
    );

    // Reorder deepNest.parts so its order matches the saved order
    // exactly. Without this, mirror-copy entries (which append) get
    // placed at the end rather than where the saved file had them.
    this.reorderPartsToSavedOrder(savedToMem);

    // v1.10.0: nest results from older files aren't restored (nothing
    // showed them, and their piece numbers can be stale); saved layouts
    // are.
    this.deepNest.nests.length = 0;
    const layouts = layoutsOf(this.deepNest);
    layouts.length = 0;
    for (const lf of data.layouts || []) {
      const l = layoutFromFile(this.deepNest, lf, (i) => partAtSaved[i]);
      if (l) layouts.push(l);
    }
    viewsFromFile(
      this.deepNest,
      data.views,
      data.currentView,
      (i) => partAtSaved[i],
    );
    setLastNest(
      this.deepNest,
      data.lastNest
        ? layoutFromFile(this.deepNest, data.lastNest, (i) => partAtSaved[i])
        : null,
    );

    if (this.deepNest.imports.length > 0) {
      this.deepNest.imports[this.deepNest.imports.length - 1].selected = true;
    }

    if (this.partsRactive) {
      this.partsRactive.update("parts");
      this.partsRactive.update("imports");
    }
    if (this.nestRactive) {
      this.nestRactive.update("nests");
    }
  }

  private applyOverrides(part: Part, saved: SavedPart): void {
    part.quantity = saved.quantity;
    if (saved.name !== undefined) part.name = saved.name;
    part.sheet = saved.sheet;
    if (saved.grainRule !== undefined) part.grainRule = saved.grainRule;
    if (saved.grainSource !== undefined) part.grainSource = saved.grainSource;
    if (saved.seamAllowance !== undefined)
      part.seamAllowance = saved.seamAllowance;
    part.excluded = !!saved.excluded;
    if (saved.sheet && saved.fabric) part.fabric = saved.fabric;
    if (saved.sheet && saved.flaws) part.flaws = saved.flaws;
    if (saved.fuseMode) part.fuseMode = saved.fuseMode;
    if (typeof saved.mirrorCount === "number")
      part.mirrorCount = saved.mirrorCount;
    if (saved.userUnfolded) part.userUnfolded = true;

    // Reconcile mirror. mirrorCopyPart already flipped once; if the
    // saved state says mirror=false, toggle it back off.
    const wantMirror = !!saved.mirror;
    if (!!part.mirror !== wantMirror) {
      const idx = this.deepNest.parts.indexOf(part);
      if (idx >= 0) this.deepNest.mirrorPart(idx);
    }

    // §9.3.2 behaviour 3: re-fold if the saved state was cut-on-fold.
    // foldPart re-derives the fold line from the freshly re-imported
    // grain/fold element and rebuilds the doubled polygon. Done after
    // the mirror reconcile so a mirrored+folded piece composes the same
    // way it was built.
    if (saved.markedFold) part.markedFold = saved.markedFold;
    if (saved.cutOnFold && !part.cutOnFold) {
      const fidx = this.deepNest.parts.indexOf(part);
      if (fidx >= 0) this.deepNest.foldPart(fidx);
    }

    // The saved grain angle and top are the piece's final state, so apply
    // them last: mirrorPart above re-mirrors the angle (and can swap
    // topFlip), which used to undo a saved mirrored angle on reload.
    if (saved.grainAngle !== undefined) part.grainAngle = saved.grainAngle;
    part.topFlip = !saved.sheet && !!saved.topFlip;
  }

  private resetWorkspace(): void {
    this.deepNest.imports.length = 0;
    this.deepNest.parts.length = 0;
    this.deepNest.nests.length = 0;
    layoutsOf(this.deepNest).length = 0;
    setLastNest(this.deepNest, null);
    clearViews(this.deepNest);
    if (this.partsRactive) {
      this.partsRactive.update("imports");
      this.partsRactive.update("parts");
    }
    if (this.nestRactive) {
      this.nestRactive.update("nests");
    }
  }

  /**
   * Build a minimal SVG document containing one rect of the given
   * dimensions, suitable for handing to deepNest.importsvg as a
   * synthetic "sheet" source. Mirrors sheet-dialog's createSheetSvg
   * but bypasses unit conversion (the caller already has SVG units).
   */
  private synthesiseSheetSvg(width: number, height: number): string {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect x="0" y="0" width="${width}" height="${height}"/>` +
      `</svg>`
    );
  }

  /**
   * Move parts around in this.deepNest.parts so they appear in the
   * same order as the saved file. Required because mirror-copy and
   * sheet creation both append to the end of the array, not at the
   * saved position. After this call the in-memory index of saved
   * part `savedIdx` equals `savedIdx`.
   */
  private reorderPartsToSavedOrder(savedToMem: number[]): void {
    // Rank each in-memory part by its saved position. Parts that weren't
    // claimed by a saved entry (shouldn't happen if save+load are
    // consistent, but be defensive — keep them rather than silently
    // dropping) go last, in their current order.
    const rank = new Map<Part, number>();
    savedToMem.forEach((memIdx, savedIdx) => {
      if (memIdx >= 0) rank.set(this.deepNest.parts[memIdx], savedIdx);
    });
    const current = new Map<Part, number>();
    this.deepNest.parts.forEach((p, i) => current.set(p, i));
    const key = (p: Part): number =>
      rank.has(p) ? rank.get(p)! : savedToMem.length + current.get(p)!;
    // v1.1.1: reorder with sort(), like the parts table's own column sort.
    // Ractive intercepts sort() and moves each row with its part; emptying
    // and refilling the array (as before) made it reuse rows by position,
    // so names updated but thumbnails and sizes stayed from the import
    // order (v1.1.1: "INT1" showing the Upper Front).
    this.deepNest.parts.sort((a, b) => key(a) - key(b));
  }
}

/**
 * v1.1.1: a saved import is the SVG *after* SvgParser has scaled it into
 * app units (the root's scale transform is baked into the coordinates), but
 * the root keeps its original width/height — e.g. "5296mm". Loading it as
 * is applied the unit scaling a second time (x3.78 for a mm file; fixed
 * in v1.1.1). Dropping width/height makes SvgParser.load skip root
 * scaling, which is right for every saved import, old .gnp files included.
 */
export function withoutRootSize(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") return svg;
  if (!root.hasAttribute("width") && !root.hasAttribute("height")) return svg;
  root.removeAttribute("width");
  root.removeAttribute("height");
  return new XMLSerializer().serializeToString(doc);
}

export function createProjectService(
  options: ProjectServiceOptions,
): ProjectService {
  return new ProjectService(options);
}
