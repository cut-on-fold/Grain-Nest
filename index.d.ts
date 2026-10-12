/**
 * Core type definitions for DeepNest
 *
 * These types define the fundamental data structures used throughout the application.
 * UI-specific extensions are defined in main/ui/types/index.ts
 */

/**
 * Placement type options for nesting algorithm
 * - gravity: Parts fall towards bottom-left corner
 * - box: Parts placed in bounding box formation
 * - convexhull: Parts placed within convex hull boundaries
 */
export type PlacementType = "gravity" | "box" | "convexhull";

/**
 * Unit options for measurements
 */
export type UnitType = "mm" | "inch";

/**
 * Core configuration for DeepNest nesting algorithm
 */
export type DeepNestConfig = {
  /** Measurement units (mm or inch) */
  units: UnitType;
  /** Scale factor for SVG coordinate conversion */
  scale: number;
  /** Spacing between nested parts in SVG units */
  spacing: number;
  /** Tolerance for curve approximation in polygonification */
  curveTolerance: number;
  /** Scale factor for Clipper.js integer operations */
  clipperScale: number;
  /** Number of rotation angles to try (e.g., 4 = 0, 90, 180, 270) */
  rotations: number;
  /** Number of worker threads for parallel computation */
  threads: number;
  /** Genetic algorithm population size */
  populationSize: number;
  /** Genetic algorithm mutation rate (0-1) */
  mutationRate: number;
  /** Placement algorithm type */
  placementType: PlacementType;
  /** Enable laser line merging optimization */
  mergeLines: boolean;
  /**
   * Ratio of material reduction to laser time optimization.
   * 0 = optimize material only, 1 = optimize laser time only
   */
  timeRatio: number;
  /** Enable polygon simplification */
  simplify: boolean;
  /** Scale factor for DXF import */
  dxfImportScale: number;
  /** Scale factor for DXF export */
  dxfExportScale: number;
  /** Tolerance for endpoint matching when closing paths */
  endpointTolerance: number;
  /** URL of the file conversion server for DXF/DWG support */
  conversionServer: string;
};

/**
 * Placement of a single part on a sheet
 */
export type SheetPlacement = {
  /** Source filename of the part */
  filename: string;
  /** Unique identifier for this placement */
  id: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Source part index in the parts array */
  source: number;
  /** X coordinate of placement */
  x: number;
  /** Y coordinate of placement */
  y: number;
};

/**
 * Complete nesting result containing all sheet placements
 */
export type NestingResult = {
  /** Total area used by placements */
  area: number;
  /** Fitness score for genetic algorithm (lower is better) */
  fitness: number;
  /** Result index in the nests array */
  index: number;
  /** Total length of merged laser lines (if merging enabled) */
  mergedLength: number;
  /** Whether this result is currently selected in UI */
  selected: boolean;
  /** Array of sheet placements */
  placements: {
    /** Sheet index */
    sheet: number;
    /** Sheet identifier */
    sheetid: number;
    /** Parts placed on this sheet */
    sheetplacements: SheetPlacement[];
  }[];
};

/**
 * Bounding box rectangle
 */
export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * A point in a polygon with optional processing markers
 */
export type PolygonPoint = {
  x: number;
  y: number;
  /** Marked for NFP generation or simplification */
  marked?: boolean;
  /** Point lies exactly on original polygon edge */
  exact?: boolean;
};

/**
 * A polygon represented as an array of points
 * Extended with tree structure properties for nested parts
 */
export interface Polygon extends Array<PolygonPoint> {
  /** Unique identifier for the polygon within the part tree */
  id?: number;
  /** Source index in the original SVG elements array */
  source?: number;
  /** Child polygons (holes or nested parts) */
  children?: Polygon[];
  /** Parent polygon reference */
  parent?: Polygon;
  /** Original filename this polygon came from */
  filename?: string;
}

/**
 * Represents a part in the nesting workspace
 */
export type Part = {
  /** Polygon tree representation for nesting calculations */
  polygontree: Polygon;
  /** Original SVG elements for rendering */
  svgelements: SVGElement[];
  /** Bounding box of the part */
  bounds: Bounds;
  /** Area of bounding box (width * height) */
  area: number;
  /** Number of copies to nest */
  quantity: number;
  /** Source filename or null for programmatically created parts */
  filename: string | null;
  /**
   * §9.3.12: human-friendly piece name (front, back, sleeve, …).
   * Auto-detected from the source SVG on import (inkscape:label /
   * <title> / meaningful id) when present, otherwise editable by the
   * user in the parts table. Used by the cut-list to itemise pieces;
   * falls back to `filename` when undefined.
   */
  name?: string;
  /**
   * v1.1.1: position of this part among the parts its import produced
   * (0-based, set at import; not on sheets or mirror copies). Saving uses it
   * to record each piece's place in the file however the list is sorted.
   */
  importPartIndex?: number;
  /** v1.3.0: the import this part came from (in-memory only). */
  importRef?: ImportedFile;
  /**
   * v1.2.0: sheets only — the fabric this sheet is for ("main", "fused",
   * "interfacing", "lining", "ribbing"; "" or undefined = not set). "Nest
   * for" ticks the sheets whose fabric matches the job.
   */
  fabric?: string;
  /** True if this part is a sheet (bin) rather than a piece to nest */
  sheet?: boolean;
  /** True if currently selected in the UI */
  selected?: boolean;
  /**
   * Round 8 (phase-r8a): true when the piece is left out of the next nest
   * without being deleted — set by the per-row "Nest" tick box, Bulk
   * Include/Exclude, or a "Nest for" job (main fabric, lining, …; see
   * main/ui/utils/nest-jobs.ts). Excluded pieces are sent to the engine
   * with quantity 0 so part indices stay stable. v1.2.0: sheets can be
   * excluded too (their own Nest tick box, or a "Nest for" job).
   */
  excluded?: boolean;
  /**
   * Grain-direction constraint chosen for this part. Translated into
   * `allowedRotations` at nest time.
   */
  grainRule?: "free" | "lock" | "flipped" | "bias" | "custom";
  /**
   * Computed rotation set the GA samples from (degrees, 0-359). When
   * undefined or empty, the GA falls back to the global
   * `config.rotations`-derived set. Set on a per-piece basis from
   * `grainRule` before IPC; not normally written by hand.
   */
  allowedRotations?: number[];
  /**
   * Angle of the detected grain line in SVG coordinates (degrees, folded
   * to [0, 180)). Used as a rotation offset so that "Lock to grain"
   * actually aligns the grain horizontal — see grainRuleToRotations in
   * main/deepnest.js. Undefined when no grain has been associated with
   * this part.
   */
  grainAngle?: number;
  /**
   * Provenance of the grain information:
   * - "detected": found via SVG import (Phase 3)
   * - "manual": user clicked two points (Phase 4)
   * - "manual-required": no grain found, awaiting user input
   */
  grainSource?: "detected" | "manual" | "manual-required";
  /**
   * Phase R8-C: which end of the grain line is the top of the piece.
   * `grainAngle` is folded to [0, 180), so it says nothing about up/down;
   * by default the top is the end of the grain line nearer the top of the
   * page (for a horizontal grain line, the left end). `topFlip: true`
   * swaps that, turning the piece end-to-end in the nest. "Lock to grain"
   * places every piece with its top towards the left (start) of the
   * fabric. Only meaningful when `grainAngle` is set.
   */
  topFlip?: boolean;
  /**
   * §9.3.2: true if the user has flipped this piece across its vertical
   * bounding-box centre. polygontree and grainAngle are stored already
   * mirrored; the flag exists so render/export paths can compose a
   * `scale(-1, 1)` transform on the svgelements (which are left in
   * their original orientation). Toggling the flag a second time
   * re-mirrors the polygontree (undoing the first flip).
   */
  mirror?: boolean;
  /**
   * §9.3.3: true on parts created via DeepNest.mirrorCopyPart, used by
   * the project-file save/load to distinguish synthetic mirror copies
   * (which share `filename` with their source) from import-origin
   * parts. Not user-visible; not normally inspected anywhere else.
   */
  isMirrorCopy?: boolean;
  /**
   * §9.3.2 behaviour 3: true when the piece is "cut on the fold" — its
   * polygontree has been doubled (the half reflected across `foldLine`
   * and unioned). The pre-fold half is stashed internally for unfold.
   */
  cutOnFold?: boolean;
  /**
   * §9.3.2 behaviour 3: the fold line in piece coordinates (a point and
   * an angle in radians) used to double the piece. Round-tripped in
   * `.gnp` so a loaded project can re-fold.
   */
  foldLine?: { x0: number; y0: number; ang: number };
  /** v1.5.0: fold edge marked in the app (drawing coordinates). */
  markedFold?: { x0: number; y0: number; ang: number };
  /**
   * §9.3.9: per-piece seam allowance in **millimetres** (canonical: stored
   * in mm so recalibrating the scale or toggling display units never
   * silently changes the real-world allowance). Undefined or 0 means no
   * sew line is drawn for this piece. At export the value is converted to
   * SVG units via the current scale and the piece's `polygontree` is inset
   * inward by it onto a dashed sew-line layer.
   */
  seamAllowance?: number;
  /**
   * §9.0.1 R6-B: stable per-session identity. `grainnestId` is stamped on a
   * part the first time something needs to reference it (currently:
   * becoming the source of a mirror copy); `mirrorOfId` on a copy records
   * its source's id. Used at SAVE time to record exactly which part a
   * mirror copy mirrors — replacing the filename-recency guess that
   * collapsed every bulk-made copy onto the last original. Session-scoped
   * plain numbers; never written to the `.gnp` themselves.
   */
  grainnestId?: number;
  mirrorOfId?: number;
  /**
   * v1.9.0 pairs & folds from cut codes (main/ui/utils/auto-cuts.ts).
   * `fuseMode` and `mirrorCount` are the piece's own choices (saved in the
   * .gnp). The rest are worked out at nest start and never saved:
   * `nestQuantity` is how many to nest (replaces Quantity), `autoSkip`
   * nests none (a manual mirror copy the codes already cover), `autoCopy`
   * marks the hidden mirrored copy made for the nest, of `autoCopyOf`.
   * `userUnfolded` stops an OF code re-folding a piece the user unfolded.
   */
  fuseMode?: "all" | "one" | "separate";
  mirrorCount?: number;
  nestQuantity?: number;
  autoSkip?: boolean;
  autoCopy?: boolean;
  autoCopyOf?: Part;
  userUnfolded?: boolean;
  /**
   * v1.11.0: not in the view being shown (utils/views.ts): hidden from the
   * list and nested as none. Never saved; worked out when the view changes.
   */
  outOfView?: boolean;
};

/**
 * Configuration object interface for window.config
 * Provides synchronous get/set methods for configuration values
 */
export interface ConfigObject {
  /**
   * Get configuration value(s)
   * @param key Optional key to get specific value; if omitted, returns full config
   */
  getSync<K extends keyof DeepNestConfig>(
    key?: K,
  ): K extends keyof DeepNestConfig ? DeepNestConfig[K] : DeepNestConfig;

  /**
   * Set configuration value(s)
   * @param keyOrObject Key to set, or object with multiple values
   * @param value Value to set (when keyOrObject is a string)
   */
  setSync<K extends keyof DeepNestConfig>(
    keyOrObject: K | Partial<DeepNestConfig>,
    value?: DeepNestConfig[K],
  ): void;

  /**
   * Reset all configuration to default values
   */
  resetToDefaultsSync(): void;
}

/**
 * DeepNest instance interface for window.DeepNest
 * Core nesting engine API
 */
export interface DeepNestInstance {
  /** List of all parts (including sheets) */
  parts: Part[];
  /** Nesting results */
  nests: NestingResult[];
  /** Whether nesting is currently running */
  working: boolean;
  /**
   * §9.3.4 directional-print / nap toggle. See main/ui/types/index.ts
   * for the runtime-side definition.
   */
  /** v1.3.0: woven or knit project (sets the default seam allowance). */
  fabricType: "woven" | "knit";
  /** v1.3.0: default seam allowance (mm) for a woven or knit project. */
  defaultSeamMm(fabricType: "woven" | "knit"): number;
  /**
   * v1.3.0: switch woven/knit; pieces on the old default seam move to the
   * new one. Returns how many changed.
   */
  setFabricType(fabricType: "woven" | "knit"): number;
  nap: boolean;
  /**
   * §9.3.10 warp direction — picks which bin axis runs along the
   * fabric's warp. Affects grain-locked rotation target and which
   * axis the cut-list (and future preset/auto-fit features) treat
   * as "fabric length". Default 'horizontal' per brief §3.3.
   */
  warpDirection: "horizontal" | "vertical";

  /**
   * Import an SVG file
   * @param filename Original filename
   * @param dirpath Directory path for resolving relative paths
   * @param svgstring SVG content as string
   * @param scalingFactor Optional scaling factor
   * @param dxfFlag Whether this is a converted DXF file
   * @returns Array of parts extracted from the SVG
   */
  importsvg(
    filename: string | null,
    dirpath: string | null,
    svgstring: string,
    scalingFactor?: number | null,
    dxfFlag?: boolean,
  ): Part[];

  /**
   * Get or set configuration
   * @param config Optional config to set
   * @returns Current configuration
   */
  config(config?: Partial<DeepNestConfig>): DeepNestConfig;

  /**
   * Start the nesting process
   * @param progressCallback Called on progress updates
   * @param displayCallback Called when new placement is ready
   */
  start(
    progressCallback:
      | ((progress: { index: number; progress: number }) => void)
      | null,
    displayCallback: (() => void) | null,
  ): void;

  /**
   * Stop the nesting process
   */
  stop(): void;

  /**
   * Reset nesting state
   */
  reset(): void;
}

/**
 * Minimal Ractive instance interface for window.nest
 */
export interface RactiveInstance {
  /** Update the view */
  update(keypath?: string): Promise<void>;
}

/**
 * SvgParser instance interface for window.SvgParser
 */
export interface SvgParserInstance {
  /** Load and parse SVG content */
  load(
    dirpath: string | null,
    svgstring: string,
    scale: number,
    scalingFactor?: number | null,
  ): SVGSVGElement;
  /** Clean input SVG for nesting */
  cleanInput(dxfFlag?: boolean): SVGSVGElement;
  /** Supported polygon element types */
  polygonElements: string[];
  /** Check if an element forms a closed path */
  isClosed(element: SVGElement, tolerance: number): boolean;
  /** Convert element to polygon points */
  polygonify(element: SVGElement): PolygonPoint[];
  /** Configure parser options */
  config(options: { tolerance: number; endpointTolerance?: number }): void;
}

declare global {
  interface Window {
    /**
     * Configuration service with electron-settings style interface
     * Provides getSync/setSync methods for configuration management
     */
    config: ConfigObject;

    /**
     * DeepNest core nesting engine instance
     * Manages parts, sheets, and nesting operations
     */
    DeepNest: DeepNestInstance;

    /**
     * Ractive instance for nest result display
     * Used for UI updates after nesting operations
     */
    nest: RactiveInstance;

    /**
     * SVG parser utility for importing and processing SVG files
     */
    SvgParser: SvgParserInstance;

    /**
     * Reference to OAuth login popup window (if open)
     */
    loginWindow: Window | null;
  }
}
