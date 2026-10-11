/**
 * Type definitions for DeepNest UI components
 * Extends core types from index.d.ts with UI-specific interfaces
 */

// Re-export core types from root index.d.ts
export type {
  DeepNestConfig,
  SheetPlacement,
  NestingResult,
  PlacementType,
  UnitType,
  Bounds,
  PolygonPoint,
  Polygon,
  Part,
} from "../../../index.d.ts";

// Import base types for extension
import type {
  DeepNestConfig,
  NestingResult,
  PolygonPoint,
  Polygon,
  Part,
} from "../../../index.d.ts";

/**
 * Extended configuration with UI-specific properties
 */
export interface UIConfig extends DeepNestConfig {
  /** OAuth access token for authenticated features */
  access_token?: string;
  /** OAuth ID token for user identification */
  id_token?: string;
  /** Enable SVG pre-processor for cleaning input files */
  useSvgPreProcessor: boolean;
  /** Extract part quantity from filename (e.g., part.3.svg = 3 copies) */
  useQuantityFromFileName: boolean;
  /** Include sheet boundary rectangles in exports */
  exportWithSheetBoundboarders: boolean;
  /** Add spacing between sheets in multi-sheet exports */
  exportWithSheetsSpace: boolean;
  /** Space value between sheets in SVG units (default: 10mm) */
  exportWithSheetsSpaceValue: number;
  /** §9.3.8: include a calibration square in every SVG export */
  exportScalingBox: boolean;
  /** §9.3.8: side length of the calibration square, in inches (default 4) */
  exportScalingBoxSizeInches: number;
  /** v1.5.0: width of every line in the SVG export, in mm (default 2). */
  exportLineWidthMm?: number;
  /** v1.5.0: export line colours, "#rrggbb". */
  exportCutColour?: string;
  exportSewColour?: string;
  exportGrainColour?: string;
  exportBorderColour?: string;
  /** §9.3.9 / phase-5r: default per-piece seam allowance in mm (default 12). */
  defaultSeamAllowanceMm?: number;
  /** v1.3.0: default seam allowance (mm) for knit projects. */
  defaultSeamAllowanceKnitMm?: number;
  /** v1.3.0: saved-settings migration level (see ConfigService). */
  settingsRevision?: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONVERSION_SERVER =
  "https://converter.deepnest.app/convert";

/**
 * SVG Pan/Zoom instance for import view
 */
export interface SvgPanZoomInstance {
  getPan(): { x: number; y: number };
  getZoom(): number;
  zoom(level: number): SvgPanZoomInstance;
  pan(point: { x: number; y: number }): SvgPanZoomInstance;
  zoomIn(): SvgPanZoomInstance;
  zoomOut(): SvgPanZoomInstance;
  resetZoom(): SvgPanZoomInstance;
  resetPan(): SvgPanZoomInstance;
  zoomAtPointBy(
    scale: number,
    point: { x: number; y: number },
  ): SvgPanZoomInstance;
  panBy(point: { x: number; y: number }): SvgPanZoomInstance;
}

/**
 * Represents an imported file in the workspace
 */
export interface ImportedFile {
  /** Original filename */
  filename: string;
  /** v1.8.0: folder the file was imported from (none after opening a project) */
  dirpath?: string | null;
  /** Root SVG element */
  svg: SVGSVGElement;
  /** True if currently selected in the imports list */
  selected?: boolean;
  /** Pan/zoom controller for the import preview */
  zoom?: SvgPanZoomInstance;
}

/**
 * Configuration object with synchronous get/set methods
 * Wraps the electron-settings style interface
 */
export interface ConfigObject extends UIConfig {
  /**
   * Get a configuration value or the entire config object
   * @param key Optional key to retrieve specific value
   * @returns The value for the key, or entire config if no key provided
   */
  getSync<K extends keyof UIConfig>(
    key?: K,
  ): K extends keyof UIConfig ? UIConfig[K] : UIConfig;

  /**
   * Set configuration values
   * @param keyOrObject Key to set, or object with multiple values
   * @param value Value to set (when keyOrObject is a string)
   */
  setSync<K extends keyof UIConfig>(
    keyOrObject: K | Partial<UIConfig>,
    value?: UIConfig[K],
  ): void;

  /**
   * Reset all configuration to default values
   */
  resetToDefaultsSync(): void;
}

/**
 * Nesting progress information from background worker
 */
export interface NestingProgress {
  /** Worker index */
  index: number;
  /** Progress value (0-1, negative means finished) */
  progress: number;
}

/**
 * Extended nesting result with selection state
 */
export interface SelectableNestingResult extends NestingResult {
  /** Whether this result is currently selected in the UI */
  selected: boolean;
  /** Utilisation percentage (0-100) */
  utilisation: number;
  /** v1.8.0: the user clicked this one in "best nests so far" */
  userPicked?: boolean;
}

/**
 * DeepNest instance interface for window.DeepNest
 */
export interface DeepNestInstance {
  /** List of imported files */
  imports: ImportedFile[];
  /** List of all parts (including sheets) */
  parts: Part[];
  /** Nesting results */
  nests: SelectableNestingResult[];
  /** Whether nesting is currently running */
  working: boolean;
  /**
   * §9.3.4 directional-print / nap toggle. When true, every piece's
   * allowed-rotation set collapses to a single principal direction
   * so a napped fabric (velvet, corduroy, directional print) doesn't
   * end up with pieces inconsistently oriented down the bolt.
   * Ephemeral per session; round-tripped via the .gnp project file.
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
   * §9.3.10 warp direction. "horizontal" (default) means the fabric's
   * warp runs along the bin's horizontal axis — grain-locked pieces
   * sit grain-horizontal, length-being-bought is the horizontal
   * extent. "vertical" rotates everything 90° and treats vertical as
   * length. Round-tripped via the .gnp project file.
   */
  warpDirection: "horizontal" | "vertical";
  /**
   * Round 8 / phase-r8a: the last "Nest for" job picked (all, main, fused,
   * interfacing, lining, ribbing). Only remembers the picker position — the
   * per-piece `excluded` flags are the source of truth for what nests.
   * Round-tripped via the .gnp project file; undefined means "all".
   */
  nestJob?: string;

  /**
   * Import an SVG file
   * @param filename Original filename
   * @param dirpath Directory path for resolving relative image paths
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
    progressCallback: ((progress: NestingProgress) => void) | null,
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

  /**
   * §9.3.2: toggle the `mirror` flag on the part at `partIndex` and
   * mirror its polygontree + grain angle about the vertical axis
   * through the bounding-box centre. Idempotent — calling twice
   * un-mirrors.
   */
  mirrorPart(partIndex: number): void;

  /**
   * §9.3.2: create a mirrored copy of the part at `partIndex`, push
   * onto `parts`, and return the new index (or -1 if the source part
   * is a sheet / doesn't exist).
   */
  mirrorCopyPart(partIndex: number): number;

  /**
   * Phase R8-C: turn the piece end-to-end (toggle `topFlip`) so the other
   * end of its grain line counts as the top. Returns false for sheets and
   * pieces without a grain angle.
   */
  flipPartTop(partIndex: number): boolean;

  /**
   * §9.3.2 behaviour 3: "cut on the fold" — replace the part's polygon
   * with the doubled piece (half reflected across its fold line and
   * unioned). Returns true on success, false (unchanged) when there is
   * no usable fold line or the union fails.
   */
  foldPart(partIndex: number): boolean;

  /**
   * §9.3.2 behaviour 3: undo foldPart, restoring the stored half polygon.
   */
  unfoldPart(partIndex: number): boolean;
  /** v1.5.0: fold the piece along the outline edge nearest `point`. */
  markFoldEdge(partIndex: number, point: { x: number; y: number }): boolean;

  /**
   * §9.3.9: offset (inset/expand) a polygon using ClipperLib. Negative
   * offset contracts the polygon (used to draw sew lines inset from the
   * cut outline), positive expands it. Returns an array of polygons
   * because a single contour can split into several when contracted.
   */
  polygonOffset(polygon: Polygon, offset: number): Polygon[];

  /**
   * §9.0.1 R6-A: exact bounding box of a part at a given placement —
   * rotates the baked polygontree about the origin by the placement
   * rotation (the placement worker's own convention), then translates by
   * the placement x/y. Single source of truth for the min-length stat,
   * export's page crop, and the cut-list "length used". Returns null when the
   * part has no usable polygon.
   */
  placedBounds(
    part: Part,
    placement: { x: number; y: number; rotation: number },
  ): { x: number; y: number; width: number; height: number } | null;
}

/**
 * Ractive component data interface for parts list
 */
export interface PartsViewData {
  parts: Part[];
  imports: ImportedFile[];
  getSelected(): Part[];
  getSheets(): Part[];
  serializeSvg(svg: SVGElement): string;
  partrenderer(part: Part): string;
}

/**
 * Ractive component data interface for nest display
 */
export interface NestViewData {
  nests: SelectableNestingResult[];
  getSelected(): SelectableNestingResult[];
  getNestedPartSources(n: SelectableNestingResult): number[];
  getColorBySource(id: number): string;
  getPartsPlaced(): string;
  getUtilisation(): string;
  getTimeSaved(): string;
}

/**
 * Ractive instance interface (minimal typing for our use)
 */
export interface RactiveInstance<T = unknown> {
  /** Update a specific keypath */
  update(keypath?: string): Promise<void>;
  /** Get a value from the data context */
  get<K extends keyof T>(keypath: K): T[K];
  /** Set a value in the data context */
  set<K extends keyof T>(keypath: K, value: T[K]): Promise<void>;
  /** Register an event handler */
  on(
    eventName: string,
    handler: (event: Event, ...args: unknown[]) => void,
  ): void;
}

/**
 * Throttle options
 */
export interface ThrottleOptions {
  /** Fire on leading edge */
  leading?: boolean;
  /** Fire on trailing edge */
  trailing?: boolean;
}

/**
 * File filter for dialog.showOpenDialog
 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Merged line segment for laser optimization display
 */
export interface MergedSegment {
  x: number;
  y: number;
}

/**
 * Sheet placement with merged segments for display
 */
export interface SheetPlacementWithMerged {
  filename: string;
  id: number;
  rotation: number;
  source: number;
  x: number;
  y: number;
  /** Pairs of points representing merged line segments */
  mergedSegments?: [MergedSegment, MergedSegment][];
}

/**
 * Preset configuration stored in presets file
 */
export interface PresetConfig {
  [presetName: string]: string; // JSON stringified UIConfig
}

/**
 * IPC channel names used by the application
 */
export const IPC_CHANNELS = {
  LOAD_PRESETS: "load-presets",
  SAVE_PRESET: "save-preset",
  DELETE_PRESET: "delete-preset",
  READ_CONFIG: "read-config",
  WRITE_CONFIG: "write-config",
  BACKGROUND_START: "background-start",
  BACKGROUND_STOP: "background-stop",
  BACKGROUND_PROGRESS: "background-progress",
  BACKGROUND_RESPONSE: "background-response",
  SET_PLACEMENTS: "setPlacements",
} as const;

/**
 * Type for IPC channel names
 */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/**
 * SvgParser interface for window.SvgParser
 */
export interface SvgParserInstance {
  load(
    dirpath: string | null,
    svgstring: string,
    scale: number,
    scalingFactor?: number | null,
  ): SVGSVGElement;
  cleanInput(dxfFlag?: boolean): SVGSVGElement;
  polygonElements: string[];
  isClosed(element: SVGElement, tolerance: number): boolean;
  polygonify(element: SVGElement): PolygonPoint[];
  polygonifyPath(element: SVGPathElement): PolygonPoint[];
  transformParse(
    transformString: string,
  ): { calc(point: PolygonPoint): PolygonPoint } | null;
  applyTransform(svg: SVGSVGElement): void;
  flatten(svg: SVGSVGElement): void;
  splitLines(svg: SVGSVGElement): void;
  mergeOverlap(svg: SVGSVGElement, tolerance: number): void;
  mergeLines(svg: SVGSVGElement): void;
  config(options: { tolerance: number; endpointTolerance?: number }): void;
}

/**
 * Extended Window interface types
 * Note: The base Window interface is augmented in index.d.ts
 * These interfaces provide more detailed typing for use within the UI modules
 */
export interface ExtendedWindow {
  config: ConfigObject;
  DeepNest: DeepNestInstance;
  nest: RactiveInstance<NestViewData>;
  SvgParser: SvgParserInstance;
  loginWindow: Window | null;
}
