/**
 * Parts View Component
 * Ractive-based parts list with selection, sorting, and deletion functionality.
 * Extracted from page.js (lines 421-714)
 */

import type {
  Part,
  ImportedFile,
  Bounds,
  DeepNestInstance,
  ConfigObject,
  SvgPanZoomInstance,
} from "../types/index.js";
import {
  getElement,
  getElements,
  createSvgElement,
  serializeSvg,
  removeFromParent,
  setAttributes,
  foldReflectionTransform,
} from "../utils/dom-utils.js";
import { throttle, message } from "../utils/ui-helpers.js";
import { resetLayout } from "../utils/column-resize.js";
import {
  fuseModeFor,
  hasFuseChoice,
  isCoveredCopy,
  jobsForPiece,
  parseCuts,
  primaryCount,
  primaryFold,
  type FuseMode,
} from "../utils/auto-cuts.js";
import {
  NEST_JOBS,
  applyNestJob,
  SHEET_FABRICS,
  countIncluded,
  type NestJob,
} from "../utils/nest-jobs.js";

/**
 * Phase R8-C: rotation (degrees, SVG sense) that stands a piece upright in
 * its thumbnail — grain line vertical, top of the piece at the top. In the
 * nest the same piece lies at this minus 90°, top towards the left (start)
 * of the fabric; see grainRuleToRotations in main/deepnest.js. Null when
 * the piece has no grain angle (nothing to line up, so it's drawn as is).
 */
export function uprightRotation(part: Part): number | null {
  if (part.sheet || typeof part.grainAngle !== "number") return null;
  // The folded grain angle's "+180°" end is the top; topFlip swaps ends.
  const grain = part.grainAngle + (part.topFlip ? 180 : 0);
  return (((90 - grain) % 360) + 360) % 360;
}

/**
 * Everything a parts-table thumbnail is drawn from, as one string — when it
 * changes, the thumbnail is redrawn (see PartsViewService.fillThumbnails).
 */
function thumbnailSignature(part: Part): string {
  const b = part.bounds;
  return [
    part.grainAngle,
    part.topFlip ? 1 : 0,
    part.mirror ? 1 : 0,
    part.cutOnFold ? 1 : 0,
    b ? [b.x, b.y, b.width, b.height].join(",") : "",
    part.svgelements ? part.svgelements.length : 0,
  ].join("|");
}

/**
 * Build a parts-table thumbnail. Pieces with a grain angle are drawn
 * upright (rotated so the grain is vertical and the top is up) with an
 * arrow pointing to the top, so a piece that's upside down for the nest
 * stands out. Mirror and cut-on-fold are composed inside the rotation.
 */
function buildPartThumbnail(part: Part): SVGElement {
  const svg = createSvgElement("svg");
  const rot = uprightRotation(part);

  // Viewbox: the piece's bounds after rotation about the origin (the
  // polygontree is already mirrored / folded, so it matches what's drawn).
  let b = part.bounds;
  if (rot !== null && rot !== 0 && part.polygontree?.length) {
    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let minx = Infinity,
      miny = Infinity,
      maxx = -Infinity,
      maxy = -Infinity;
    for (const pt of part.polygontree) {
      const x = pt.x * cos - pt.y * sin;
      const y = pt.x * sin + pt.y * cos;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    b = { x: minx, y: miny, width: maxx - minx, height: maxy - miny };
  }
  setAttributes(svg, {
    width: b.width + 10 + "px",
    height: b.height + 10 + "px",
    viewBox: `${b.x - 5} ${b.y - 5} ${b.width + 10} ${b.height + 10}`,
  });

  let target: Element = svg;
  if (rot !== null && rot !== 0) {
    const rg = createSvgElement("g");
    rg.setAttribute("transform", `rotate(${rot})`);
    svg.appendChild(rg);
    target = rg;
  }
  // §9.3.2: when mirrored, wrap the cloned svgelements in a <g> that flips
  // them across the bounds-centre vertical axis. The svgelements themselves
  // stay in original orientation so this is cheap to toggle.
  if (part.mirror) {
    const cx = part.bounds.x + part.bounds.width / 2;
    const g = createSvgElement("g");
    g.setAttribute("transform", `translate(${2 * cx} 0) scale(-1 1)`);
    target.appendChild(g);
    target = g;
  }
  part.svgelements.forEach((e) => {
    target.appendChild(e.cloneNode(false));
  });
  // §9.3.2 b3: a cut-on-fold piece draws a second, reflected copy of its
  // elements so the thumbnail shows the doubled piece (the bounds are
  // already the doubled extent).
  if (part.cutOnFold && part.foldLine) {
    const fg = createSvgElement("g");
    fg.setAttribute("transform", foldReflectionTransform(part.foldLine));
    target.appendChild(fg);
    part.svgelements.forEach((e) => {
      fg.appendChild(e.cloneNode(false));
    });
  }

  // Top arrow, up the middle of the upright piece.
  if (rot !== null) {
    const cx = b.x + b.width / 2;
    const y0 = b.y + b.height * 0.75;
    const y1 = b.y + b.height * 0.2;
    const head = Math.min(b.width, b.height) * 0.12;
    const arrow = createSvgElement("g");
    arrow.setAttribute("class", "toparrow");
    const shaft = createSvgElement("line");
    setAttributes(shaft, {
      x1: String(cx),
      y1: String(y0),
      x2: String(cx),
      y2: String(y1 + head),
    });
    const tip = createSvgElement("polygon");
    tip.setAttribute(
      "points",
      `${cx},${y1} ${cx - head * 0.7},${y1 + head * 1.2} ${cx + head * 0.7},${y1 + head * 1.2}`,
    );
    arrow.appendChild(shaft);
    arrow.appendChild(tip);
    const title = createSvgElement("title");
    title.textContent =
      "Top of the piece (points to the start of the fabric in the nest)";
    arrow.appendChild(title);
    svg.appendChild(arrow);
  }
  return svg;
}

/**
 * Ractive event object with original DOM event
 */
interface RactiveEvent {
  original: MouseEvent;
}

/**
 * Ractive instance interface for parts view
 * More specific than the general RactiveInstance to handle custom events
 */
interface PartsViewRactiveInstance {
  /** Update a specific keypath */
  update(keypath?: string): Promise<void>;
  /** Get a value from the data context */
  get<K extends keyof PartsViewData>(keypath: K): PartsViewData[K];
  /** Set a value in the data context */
  set<K extends keyof PartsViewData>(
    keypath: K,
    value: PartsViewData[K],
  ): Promise<void>;
  /** Register an event handler with Ractive-specific event signature */
  on(
    eventName: string,
    handler: (event: RactiveEvent, ...args: unknown[]) => boolean | void,
  ): void;
}

/**
 * Declare Ractive as a global variable available in the Electron context
 */
declare const Ractive: {
  DEBUG: boolean;
  extend(options: RactiveExtendOptions): RactiveComponentConstructor;
  new (options: RactiveOptions): PartsViewRactiveInstance;
};

/**
 * Declare svgPanZoom as a global function available in the Electron context
 */
declare function svgPanZoom(
  selector: string,
  options: SvgPanZoomOptions,
): SvgPanZoomInstance;

/**
 * Options for Ractive.extend
 */
interface RactiveExtendOptions {
  template: string;
  computed?: Record<string, () => unknown>;
}

/**
 * Constructor returned by Ractive.extend
 */
type RactiveComponentConstructor = new () => unknown;

/**
 * Options for creating a Ractive instance
 */
interface RactiveOptions {
  el: string;
  template: string;
  data: PartsViewData;
  computed?: Record<string, () => unknown>;
  components?: Record<string, RactiveComponentConstructor>;
}

/**
 * Options for svgPanZoom initialization
 */
interface SvgPanZoomOptions {
  zoomEnabled: boolean;
  controlIconsEnabled: boolean;
  fit: boolean;
  center: boolean;
  maxZoom: number;
  minZoom: number;
}

/**
 * Ractive component data interface for parts list
 */
interface PartsViewData {
  parts: Part[];
  imports: ImportedFile[];
  getSelected: () => Part[];
  getSheets: () => Part[];
  serializeSvg: (svg: SVGElement) => string;
  /** phase-r8a: picker options, current job, show/hide excluded rows. */
  nestJobs: { id: NestJob; label: string }[];
  /** v1.2.0: Fabric drop-down options for sheet rows. */
  sheetFabrics: { id: string; label: string }[];
  nestJob: NestJob;
  showExcluded: boolean;
  excludedCount: (parts: Part[]) => number;
  /** v1.9.0: pairs & folds from cut codes, and the template's helpers. */
  autoCuts: boolean;
  bulkFuse: boolean;
  rowShown: (...args: never[]) => boolean;
  autoCount: (...args: never[]) => number;
  autoFold: (...args: never[]) => boolean;
  mirrorChoices: (...args: never[]) => unknown[];
  fuseChoice: (...args: never[]) => boolean;
  fuseChoices: (...args: never[]) => unknown[];
}

/**
 * DOM element selectors used by the parts view component
 */
const SELECTORS = {
  /** Container for the parts list */
  HOME_CONTENT: "#homecontent",
  /** Template for the parts list */
  TEMPLATE_PART_LIST: "#template-part-list",
  /** Table headers for sorting */
  PARTS_TABLE_HEADERS: "#parts table thead th",
  /** Parts container */
  PARTS_CONTAINER: "#parts",
  /** Parts table */
  PARTS_TABLE: "#parts table",
} as const;

/**
 * CSS classes used by the parts view
 */
const CSS_CLASSES = {
  ACTIVE: "active",
  ASC: "asc",
  DESC: "desc",
} as const;

/**
 * Data attributes used for sorting
 */
const DATA_ATTRIBUTES = {
  SORT_FIELD: "data-sort-field",
} as const;

/**
 * Resize callback type
 */
export type ResizeCallback = (event?: { rect: { width: number } }) => void;

/**
 * Options for PartsView initialization
 */
export interface PartsViewOptions {
  /** DeepNest instance for accessing parts and imports */
  deepNest: DeepNestInstance;
  /** Configuration object */
  config: ConfigObject;
  /** Callback to resize the parts list */
  resizeCallback?: ResizeCallback;
}

/**
 * Parts View Service class
 * Manages the Ractive-based parts list with selection, sorting, and deletion
 */
export class PartsViewService {
  /** DeepNest instance */
  private deepNest: DeepNestInstance;

  /** Configuration object */
  private config: ConfigObject;

  /** Main Ractive instance for parts list */
  private ractive: PartsViewRactiveInstance | null = null;

  /** Dimension label Ractive component */
  private labelComponent: RactiveComponentConstructor | null = null;

  /** Tracks if mouse button is currently down */
  private mouseDown = 0;

  /** Throttled update function */
  private throttledUpdate: (() => void) | null = null;

  /** Resize callback */
  private resizeCallback: ResizeCallback | null = null;

  /** Flag to track if service has been initialized */
  private initialized = false;

  /**
   * Phase 4: index in deepNest.parts of the piece currently being marked,
   * or null when not in marking mode. While non-null, the next two
   * left-clicks anywhere on the page are captured as grain endpoints.
   */
  private markingPartIndex: number | null = null;
  /** v1.5.0: what the marking clicks are for — a grain line or a fold edge. */
  private markingKind: "grain" | "fold" = "grain";
  /** First click point in marking mode (pixels). */
  private markingStartPoint: { x: number; y: number } | null = null;

  /**
   * Create a new PartsViewService instance
   * @param options - Configuration options
   */
  constructor(options: PartsViewOptions) {
    this.deepNest = options.deepNest;
    this.config = options.config;
    if (options.resizeCallback) {
      this.resizeCallback = options.resizeCallback;
    }
  }

  /**
   * Set the resize callback function
   * @param callback - Function to call when resize is needed
   */
  setResizeCallback(callback: ResizeCallback): void {
    this.resizeCallback = callback;
  }

  /**
   * Create the dimension label Ractive component
   * This component displays part dimensions in the current unit system
   */
  private createLabelComponent(): RactiveComponentConstructor {
    const config = this.config;

    return Ractive.extend({
      template: "{{label}}",
      computed: {
        label: function (this: {
          get: (key: string) => Bounds | string;
        }): string {
          const bounds = this.get("bounds") as Bounds;
          const width = bounds.width;
          const height = bounds.height;
          const units = config.getSync("units");
          const conversion = config.getSync("scale");

          // trigger computed dependency chain
          this.get("getUnits");

          if (units === "mm") {
            return (
              ((25.4 * width) / conversion).toFixed(1) +
              "mm x " +
              ((25.4 * height) / conversion).toFixed(1) +
              "mm"
            );
          } else {
            return (
              (width / conversion).toFixed(1) +
              "in x " +
              (height / conversion).toFixed(1) +
              "in"
            );
          }
        },
      },
    });
  }

  /**
   * Toggle selection state of a part
   * @param part - The part to toggle
   */
  private togglePart(part: Part): void {
    // v1.5.0: add / remove just the "active" class, keeping any class the
    // element came with (e.g. Seamly2D's "grainline"); replacing the whole
    // attribute lost those and left "active" in exported files.
    part.selected = !part.selected;
    for (let i = 0; i < part.svgelements.length; i++) {
      part.svgelements[i].classList.toggle(CSS_CLASSES.ACTIVE, part.selected);
    }
  }

  /**
   * Apply SVG pan/zoom library to the currently visible import
   */
  applyZoom(): void {
    if (this.deepNest.imports.length === 0) {
      return;
    }

    for (let i = 0; i < this.deepNest.imports.length; i++) {
      const importItem = this.deepNest.imports[i];
      if (importItem.selected) {
        // Store current pan/zoom state if exists
        let pan: { x: number; y: number } | false = false;
        let zoom: number | false = false;

        if (importItem.zoom) {
          pan = importItem.zoom.getPan();
          zoom = importItem.zoom.getZoom();
        }

        // Initialize svgPanZoom
        importItem.zoom = svgPanZoom("#import-" + i + " svg", {
          zoomEnabled: true,
          controlIconsEnabled: false,
          fit: true,
          center: true,
          maxZoom: 500,
          minZoom: 0.01,
        });

        // Restore previous state
        if (zoom !== false) {
          importItem.zoom.zoom(zoom);
        }
        if (pan !== false) {
          importItem.zoom.pan(pan);
        }

        // Set up zoom control buttons
        this.setupZoomControls(i);
      }
    }
  }

  /**
   * Set up zoom control button event listeners for an import
   * @param importIndex - Index of the import
   */
  private setupZoomControls(importIndex: number): void {
    const deepNest = this.deepNest;

    const zoomInBtn = getElement<HTMLElement>(`#import-${importIndex} .zoomin`);
    const zoomOutBtn = getElement<HTMLElement>(
      `#import-${importIndex} .zoomout`,
    );
    const zoomResetBtn = getElement<HTMLElement>(
      `#import-${importIndex} .zoomreset`,
    );

    if (zoomInBtn) {
      zoomInBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const selectedImport = deepNest.imports.find((e) => e.selected);
        if (selectedImport?.zoom) {
          selectedImport.zoom.zoomIn();
        }
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const selectedImport = deepNest.imports.find((e) => e.selected);
        if (selectedImport?.zoom) {
          selectedImport.zoom.zoomOut();
        }
      });
    }

    if (zoomResetBtn) {
      zoomResetBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const selectedImport = deepNest.imports.find((e) => e.selected);
        if (selectedImport?.zoom) {
          selectedImport.zoom.resetZoom().resetPan();
        }
      });
    }
  }

  /**
   * Delete all selected parts
   */
  deleteParts(): void {
    // v1.1.2: confirm first — rows left selected by mistake used to
    // vanish without warning.
    const doomed = this.deepNest.parts.filter((p) => p.selected);
    if (doomed.length === 0) return;
    const label = (p: Part): string =>
      p.sheet ? "a sheet" : p.name || p.filename || "unnamed piece";
    const list = doomed.slice(0, 5).map(label).join(", ");
    const more = doomed.length > 5 ? `, and ${doomed.length - 5} more` : "";
    if (
      !window.confirm(
        `Delete ${doomed.length} row${doomed.length === 1 ? "" : "s"}? (${list}${more})`,
      )
    ) {
      return;
    }
    for (let i = 0; i < this.deepNest.parts.length; i++) {
      if (this.deepNest.parts[i].selected) {
        // Remove SVG elements from DOM
        for (let j = 0; j < this.deepNest.parts[i].svgelements.length; j++) {
          const node = this.deepNest.parts[i].svgelements[j];
          removeFromParent(node);
        }
        // Remove from parts array
        this.deepNest.parts.splice(i, 1);
        i--;
      }
    }

    // Update UI
    this.update();
    this.updateImports();

    if (this.deepNest.imports.length > 0) {
      this.applyZoom();
    }

    if (this.resizeCallback) {
      this.resizeCallback();
    }
  }

  /**
   * Attach sorting functionality to table headers
   */
  attachSort(): void {
    const headers = getElements<HTMLTableCellElement>(
      SELECTORS.PARTS_TABLE_HEADERS,
    );

    headers.forEach((header) => {
      header.addEventListener("click", () => {
        const sortField = header.getAttribute(DATA_ATTRIBUTES.SORT_FIELD) as
          | keyof Part
          | null;

        if (!sortField) {
          return;
        }

        const reverse = header.className === CSS_CLASSES.ASC;

        // Sort parts
        this.deepNest.parts.sort((a, b) => {
          const av = a[sortField];
          const bv = b[sortField];

          if (
            av === undefined ||
            av === null ||
            bv === undefined ||
            bv === null
          ) {
            return 0;
          }

          if (av < bv) {
            return reverse ? 1 : -1;
          }
          if (av > bv) {
            return reverse ? -1 : 1;
          }
          return 0;
        });

        // Update header classes
        headers.forEach((h) => {
          h.className = "";
        });

        header.className = reverse ? CSS_CLASSES.DESC : CSS_CLASSES.ASC;

        // Update UI
        this.update();
      });
    });
  }

  /**
   * Update the parts data in Ractive
   */
  update(): void {
    if (this.ractive) {
      this.ractive.update("parts");
    }
  }

  /**
   * Update the imports data in Ractive
   */
  updateImports(): void {
    if (this.ractive) {
      this.ractive.update("imports");
    }
  }

  /**
   * Update units-related computed properties
   */
  updateUnits(): void {
    if (this.ractive) {
      this.ractive.update("getUnits");
    }
  }

  /** v1.9.0: Settings "Pairs & folds from cut codes" is on. */
  private autoCutsOn(): boolean {
    return this.config.getSync("autoCutsFromCodes") !== false;
  }

  /** v1.9.0: Settings "Equal main & interfacing" is Bulk-fuse. */
  bulkFuseByDefault(): boolean {
    return this.config.getSync("equalCutsFuse") !== "separate";
  }

  /**
   * v1.9.0: whether a row shows in the parts list. Hidden: the copies
   * made for a nest, and (with cut codes on) manual mirror copies of a
   * piece whose code already counts them; with "Hide excluded", excluded
   * pieces.
   */
  isRowVisible(p: Part): boolean {
    if (p.autoCopy) return false;
    if (this.autoCutsOn() && isCoveredCopy(this.deepNest.parts, p))
      return false;
    return !!this.ractive?.get("showExcluded") || !!p.sheet || !p.excluded;
  }

  /**
   * Applies a "Nest for" job. v1.9.0: with cut codes on, each piece's Fuse
   * choice decides whether it is Main, Fused or Interfacing.
   */
  applyJob(job: NestJob): ReturnType<typeof applyNestJob> {
    if (!this.autoCutsOn()) return applyNestJob(this.deepNest.parts, job);
    const bulk = this.bulkFuseByDefault();
    return applyNestJob(this.deepNest.parts, job, (p) => jobsForPiece(p, bulk));
  }

  /** v1.9.0: the cut-code settings changed; redraw the rows. */
  updateAutoCuts(): void {
    if (!this.ractive) return;
    this.ractive.set("autoCuts", this.autoCutsOn());
    this.ractive.set("bulkFuse", this.bulkFuseByDefault());
    // The settings can move pieces between Main, Fused and Interfacing.
    const job = (this.deepNest.nestJob as NestJob | undefined) || "all";
    if (job !== "all") this.applyJob(job);
    this.ractive.update("parts");
  }

  /**
   * Initialize the Ractive instance for parts list
   */
  private initializeRactive(): void {
    // Disable Ractive debug mode
    Ractive.DEBUG = false;

    // Create label component
    this.labelComponent = this.createLabelComponent();

    const deepNest = this.deepNest;
    const config = this.config;

    // Create main Ractive instance
    this.ractive = new Ractive({
      el: SELECTORS.HOME_CONTENT,
      template: SELECTORS.TEMPLATE_PART_LIST,
      data: {
        parts: deepNest.parts,
        imports: deepNest.imports,
        getSelected: function (this: { get: (key: string) => Part[] }): Part[] {
          const parts = this.get("parts");
          return parts.filter((p) => p.selected);
        },
        getSheets: function (this: { get: (key: string) => Part[] }): Part[] {
          const parts = this.get("parts");
          return parts.filter((p) => p.sheet);
        },
        // phase-r8a: nest jobs. `parts` is passed in (not read via
        // this.get) so Ractive re-evaluates the label when parts change.
        nestJobs: NEST_JOBS,
        sheetFabrics: SHEET_FABRICS,
        nestJob: (deepNest.nestJob as NestJob | undefined) || "all",
        showExcluded: true,
        excludedCount: function (parts: Part[]): number {
          return parts.filter((p) => !p.sheet && p.excluded && !p.autoCopy)
            .length;
        },
        // v1.9.0: pairs & folds from cut codes (see utils/auto-cuts.ts).
        // The template also passes the row's fields they read (name,
        // mirrorCount, …) so Ractive redraws them when those change.
        autoCuts: this.autoCutsOn(),
        bulkFuse: this.bulkFuseByDefault(),
        rowShown: function (
          p: Part,
          parts: Part[],
          showExcluded: boolean,
          autoCuts: boolean,
        ): boolean {
          if (p.autoCopy) return false;
          if (autoCuts && isCoveredCopy(parts, p)) return false;
          return showExcluded || !!p.sheet || !p.excluded;
        },
        autoCount: function (p: Part): number {
          return p.sheet ? 0 : primaryCount(p);
        },
        autoFold: function (p: Part): boolean {
          return primaryFold(p);
        },
        // "Mirrored" choices: Auto (half, rounded down) or 0…count.
        mirrorChoices: function (
          p: Part,
        ): { value: string; label: string; sel: boolean }[] {
          const n = primaryCount(p);
          const choices = [
            {
              value: "auto",
              label: "Auto",
              sel: p.mirrorCount === undefined,
            },
          ];
          for (let k = 0; k <= n; k++) {
            choices.push({
              value: String(k),
              label: String(k),
              sel: p.mirrorCount === k,
            });
          }
          return choices;
        },
        fuseChoice: function (p: Part): boolean {
          return !p.sheet && hasFuseChoice(p);
        },
        fuseChoices: function (
          p: Part,
          ...deps: unknown[]
        ): { value: FuseMode; label: string; sel: boolean }[] {
          // The last argument is the Settings default (bulkFuse).
          const mode = fuseModeFor(p, deps[deps.length - 1] !== false);
          const c = parseCuts(p.name);
          const m = c.M?.count ?? 0;
          const i = c.I?.count ?? 0;
          // "n fused" only differs from All fused with fewer interfacing.
          const options: [FuseMode, string][] = [["all", "All"]];
          if (i < m) options.push(["one", String(i)]);
          options.push(["separate", "None"]);
          return options.map(([value, label]) => ({
            value,
            label,
            sel: value === mode,
          }));
        },
        serializeSvg: function (svg: SVGElement): string {
          return serializeSvg(svg);
        },
      },
      computed: {
        getUnits: function (): string {
          const units = config.getSync("units");
          return units === "mm" ? "mm" : "in";
        },
      },
      components: { dimensionLabel: this.labelComponent },
    });

    // v1.1.1: thumbnails live outside Ractive (see fillThumbnails). After
    // every update of the parts list, and whenever Ractive (re)builds rows —
    // sorting, Hide excluded, Nest -> Back — fill each row's slot.
    const ractive = this.ractive as unknown as {
      update(keypath?: string): Promise<void>;
    };
    const baseUpdate = ractive.update.bind(ractive);
    ractive.update = (keypath?: string): Promise<void> => {
      const done = baseUpdate(keypath);
      this.fillThumbnails();
      return done;
    };
    const home = document.querySelector(SELECTORS.HOME_CONTENT);
    if (home) {
      new MutationObserver(() => this.fillThumbnails()).observe(home, {
        childList: true,
        subtree: true,
      });
    }
    this.fillThumbnails();
  }

  /**
   * Set up mouse tracking for drag selection
   */
  private setupMouseTracking(): void {
    document.body.onmousedown = () => {
      this.mouseDown = 1;
    };
    document.body.onmouseup = () => {
      this.mouseDown = 0;
    };
  }

  /**
   * Create throttled update function
   */
  private createThrottledUpdate(): void {
    const updateFn = () => {
      this.updateImports();
      this.applyZoom();
    };

    this.throttledUpdate = throttle(updateFn, 500);
  }

  /**
   * Bind Ractive event handlers
   */
  private bindRactiveEvents(): void {
    if (!this.ractive) {
      return;
    }

    const ractive = this.ractive;
    const deepNest = this.deepNest;

    // Handle part selection on click/mouseover
    ractive.on(
      "selecthandler",
      (e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        // Don't select the row when the click is on one of its controls —
        // a box, drop-down, tick box or button. v1.2.0: the Actions
        // buttons (Flip top, Mirror, …) used to select their row as well.
        const target = e.original.target as HTMLElement | null;
        if (target && target.closest("input, select, textarea, a, button")) {
          return true;
        }

        if (this.mouseDown > 0 || e.original.type === "mousedown") {
          this.togglePart(part);
          ractive.update("parts");
          if (this.throttledUpdate) {
            this.throttledUpdate();
          }
        }
        return;
      },
    );

    // Handle select all toggle
    ractive.on("selectall", () => {
      // phase-r8a: with "Hide excluded" on, Select all covers only the rows
      // you can see.
      const visible = deepNest.parts.filter((p) => this.isRowVisible(p));
      const selectedCount = visible.filter((p) => p.selected).length;
      const toggleOn = selectedCount < visible.length;

      visible.forEach((p) => {
        if (p.selected !== toggleOn) {
          this.togglePart(p);
        }
        p.selected = toggleOn;
      });

      ractive.update("parts");
      ractive.update("imports");

      if (deepNest.imports.length > 0) {
        this.applyZoom();
      }
    });

    // Handle import tab selection
    ractive.on(
      "importselecthandler",
      (_e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const im = args[0] as ImportedFile;
        if (im.selected) {
          return false;
        }

        deepNest.imports.forEach((i) => {
          i.selected = false;
        });

        im.selected = true;
        ractive.update("imports");
        this.applyZoom();
        return;
      },
    );

    // Handle import deletion
    ractive.on("importdelete", (_e: RactiveEvent, ...args: unknown[]) => {
      const im = args[0] as ImportedFile;
      let index = deepNest.imports.indexOf(im);
      deepNest.imports.splice(index, 1);

      if (deepNest.imports.length > 0) {
        if (!deepNest.imports[index]) {
          index = 0;
        }
        deepNest.imports[index].selected = true;
      }

      ractive.update("imports");

      if (deepNest.imports.length > 0) {
        this.applyZoom();
      }
    });

    // Handle delete button/event
    ractive.on("delete", () => {
      this.deleteParts();
    });

    // Phase 4: enter marking mode for the clicked part.
    ractive.on(
      "markgrain",
      (_e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        const idx = deepNest.parts.indexOf(part);
        if (idx === -1) return false;
        this.startMarkingMode(idx);
        return false;
      },
    );

    // v1.5.0: "Mark fold" — the next click on the import preview picks the
    // piece's fold edge.
    ractive.on(
      "markfold",
      (_e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        const idx = deepNest.parts.indexOf(part);
        if (idx === -1) return false;
        this.startMarkingMode(idx, "fold");
        return false;
      },
    );

    // §9.3.2: toggle the mirror flag on the clicked part (or undo if
    // already mirrored). ractive.update("parts") also redraws the thumbnail
    // (see fillThumbnails).
    ractive.on(
      "mirrortoggle",
      (_e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        const idx = deepNest.parts.indexOf(part);
        if (idx === -1) return false;
        deepNest.mirrorPart(idx);
        ractive.update("parts");
        return false;
      },
    );

    // §9.3.2: create a mirrored copy and append to the parts list.
    // mirrorCopyPart returns the new index; we just need to nudge
    // Ractive to re-render the parts table to show the new row.
    ractive.on(
      "mirrorcopy",
      (_e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        const idx = deepNest.parts.indexOf(part);
        if (idx === -1) return false;
        deepNest.mirrorCopyPart(idx);
        ractive.update("parts");
        return false;
      },
    );

    // phase-r8c: turn the piece end-to-end (the other end of its grain line
    // becomes the top). update("parts") redraws the thumbnail.
    ractive.on(
      "fliptop",
      (_e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        const idx = deepNest.parts.indexOf(part);
        if (idx === -1) return false;
        deepNest.flipPartTop(idx);
        ractive.update("parts");
        return false;
      },
    );

    // §9.3.2 behaviour 3: toggle "cut on the fold". foldPart doubles the
    // piece across its fold line; unfoldPart restores the half. foldPart
    // returns false when the piece has no usable fold line, so tell the
    // user how to give it one.
    ractive.on(
      "foldtoggle",
      (_e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        const idx = deepNest.parts.indexOf(part);
        if (idx === -1) return false;
        // v1.9.0: an OF cut code won't re-fold a piece unfolded here.
        if (part.cutOnFold) {
          deepNest.unfoldPart(idx);
          part.userUnfolded = true;
        } else if (deepNest.foldPart(idx)) {
          delete part.userUnfolded;
        } else {
          message(
            "To cut on the fold, click Mark fold and then the piece's fold " +
              "edge in the preview, or draw its grain line on the fold edge " +
              "in the pattern file.",
          );
        }
        ractive.update("parts");
        return false;
      },
    );

    // ---- phase-r8a: nest jobs (include / exclude pieces without deleting).

    // A piece that's hidden (excluded while "Hide excluded" is on) must not
    // stay selected, or Bulk Apply / Delete would act on rows you can't see.
    const deselectHidden = (): void => {
      deepNest.parts.forEach((p) => {
        if (p.selected && !this.isRowVisible(p)) this.togglePart(p);
      });
    };

    const afterIncludeChange = (note?: string): void => {
      deselectHidden();
      ractive.update("parts");
      if (note) message(note);
    };

    // Per-row "Nest" tick box.
    ractive.on(
      "includetoggle",
      (e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = deepNest.parts[args[0] as number];
        if (!part) return false; // v1.2.0: sheets have a tick box too
        part.excluded = !(e.original.target as HTMLInputElement).checked;
        afterIncludeChange();
        return;
      },
    );

    // "Nest for" picker: include exactly the pieces whose cut codes belong
    // to the job. Ticks can still be adjusted by hand afterwards.
    ractive.on("nestjob", (e: RactiveEvent): boolean | void => {
      const job = (e.original.target as HTMLSelectElement).value as NestJob;
      ractive.set("nestJob", job);
      deepNest.nestJob = job;
      const { included: n, sheets } = this.applyJob(job);
      const label = NEST_JOBS.find((j) => j.id === job)?.label ?? job;
      // v1.2.0: also say which sheets the job ticked (or that none is set
      // to its fabric, so the sheet ticks were left alone).
      const hasSheets = deepNest.parts.some((p) => p.sheet);
      let note: string;
      if (job === "all") {
        note = `All ${n} piece(s) included.`;
      } else if (n === 0) {
        note = `No pieces have a ${label.toLowerCase()} cut code (e.g. C2M, C1L, C2I, C1R) in their name.`;
      } else {
        note =
          `${label}: ${n} piece(s) included` +
          (hasSheets && sheets !== null ? `, on ${sheets} sheet(s).` : ".");
      }
      if (job !== "all" && hasSheets && sheets === null) {
        note += ` No sheet's Fabric is set to ${label.toLowerCase()}, so the sheet ticks are unchanged.`;
      }
      afterIncludeChange(note);
      return;
    });

    // v1.9.0: a piece's "Mirrored" and "Fuse" choices (cut codes on).
    ractive.on(
      "setmirrorcount",
      (e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        const v = (e.original.target as HTMLSelectElement).value;
        if (v === "auto") delete part.mirrorCount;
        else part.mirrorCount = parseInt(v, 10);
        ractive.update("parts");
        return false;
      },
    );
    ractive.on(
      "setfusemode",
      (e: RactiveEvent, ...args: unknown[]): boolean | void => {
        const part = args[0] as Part;
        part.fuseMode = (e.original.target as HTMLSelectElement)
          .value as FuseMode;
        // The choice moves the piece between Main, Fused and Interfacing.
        const job = (deepNest.nestJob as NestJob | undefined) || "all";
        if (job !== "all") this.applyJob(job);
        afterIncludeChange();
        return false;
      },
    );

    ractive.on("toggleexcluded", (): boolean | void => {
      ractive.set("showExcluded", !ractive.get("showExcluded"));
      afterIncludeChange();
      return false;
    });

    const bulkSetExcluded = (excluded: boolean): void => {
      // Pieces only: sheets are ticked by their own box or "Nest for", so
      // Select all + Exclude can't leave the nest without fabric.
      const pieces = deepNest.parts.filter((p) => p.selected && !p.sheet);
      if (pieces.length === 0) {
        message("Select some pieces first.");
        return;
      }
      pieces.forEach((p) => {
        p.excluded = excluded;
        p.selected = false; // v1.1.2: see clearSelection below
      });
      afterIncludeChange(
        `${excluded ? "Excluded" : "Included"} ${pieces.length} piece(s) — ${countIncluded(deepNest.parts)} now in the nest.`,
      );
    };
    ractive.on("bulkinclude", (): boolean | void => {
      bulkSetExcluded(false);
      return false;
    });
    ractive.on("bulkexclude", (): boolean | void => {
      bulkSetExcluded(true);
      return false;
    });

    // §9.3.13: Bulk Apply — apply one change to every selected non-sheet
    // part at once. Reuses the existing selection state and the same
    // per-part writers as the single-row controls. The grain-rule select
    // and quantity input values are read straight off the DOM: those
    // controls live in #partstools, which Ractive doesn't re-render on
    // update("parts"), so plain getElementById is stable.
    const selectedPieces = (): { part: Part; index: number }[] => {
      const out: { part: Part; index: number }[] = [];
      deepNest.parts.forEach((p, i) => {
        if (p.selected && !p.sheet) out.push({ part: p, index: i });
      });
      return out;
    };
    // v1.1.2: every Apply-to-selected action unselects the rows it
    // changed, so the next action (or Delete) can't hit them again by
    // mistake — e.g. flipping a piece back upside down.
    const clearSelection = (): void => {
      deepNest.parts.forEach((p) => (p.selected = false));
    };

    ractive.on("bulkgrainrule", (): boolean | void => {
      const sel = document.getElementById(
        "bulkgrainrule",
      ) as HTMLSelectElement | null;
      const rule = sel ? sel.value : "";
      if (!rule) return false;
      const pieces = selectedPieces();
      if (pieces.length === 0) {
        message("Select some pieces first, then pick a grain rule.");
      } else {
        pieces.forEach(({ part }) => {
          part.grainRule = rule as Part["grainRule"];
        });
        clearSelection();
        ractive.update("parts");
        message(`Set grain rule on ${pieces.length} piece(s).`);
      }
      if (sel) sel.value = ""; // reset to the "Grain rule…" placeholder
      return false;
    });

    // v1.1.1: forget the remembered panel/column widths.
    ractive.on("resetlayout", (): boolean => {
      resetLayout();
      message("Layout reset to the original panel and column widths.");
      return false;
    });

    ractive.on("bulkfliptop", (): boolean | void => {
      const pieces = selectedPieces();
      if (pieces.length === 0) {
        message("Select some pieces first.");
        return false;
      }
      let n = 0;
      pieces.forEach(({ index }) => {
        if (deepNest.flipPartTop(index)) n++;
      });
      clearSelection();
      ractive.update("parts");
      const skipped = pieces.length - n;
      message(
        `Flipped ${n} piece(s) end-to-end.` +
          (skipped > 0
            ? ` ${skipped} without a grain line left as they were — mark their grain first.`
            : ""),
      );
      return false;
    });

    ractive.on("bulkmirror", (): boolean | void => {
      const pieces = selectedPieces();
      if (pieces.length === 0) {
        message("Select some pieces first.");
        return false;
      }
      let n = 0;
      pieces.forEach(({ part, index }) => {
        if (!part.mirror) {
          deepNest.mirrorPart(index);
          n++;
        }
      });
      clearSelection();
      ractive.update("parts");
      message(
        n > 0
          ? `Mirrored ${n} piece(s).`
          : "Selected pieces were already mirrored.",
      );
      return false;
    });

    ractive.on("bulkunmirror", (): boolean | void => {
      const pieces = selectedPieces();
      if (pieces.length === 0) {
        message("Select some pieces first.");
        return false;
      }
      let n = 0;
      pieces.forEach(({ part, index }) => {
        if (part.mirror) {
          deepNest.mirrorPart(index);
          n++;
        }
      });
      clearSelection();
      ractive.update("parts");
      message(
        n > 0
          ? `Un-mirrored ${n} piece(s).`
          : "Selected pieces were not mirrored.",
      );
      return false;
    });

    ractive.on("bulksetquantity", (): boolean | void => {
      const input = document.getElementById(
        "bulkquantity",
      ) as HTMLInputElement | null;
      const q = input ? parseInt(input.value, 10) : NaN;
      if (!Number.isFinite(q) || q < 1) {
        message("Enter a quantity of 1 or more, then click Set qty.");
        return false;
      }
      const pieces = selectedPieces();
      if (pieces.length === 0) {
        message("Select some pieces first.");
        return false;
      }
      pieces.forEach(({ part }) => {
        part.quantity = q;
      });
      clearSelection();
      ractive.update("parts");
      message(`Set quantity ${q} on ${pieces.length} piece(s).`);
      return false;
    });

    // §9.3.9: Bulk Apply a seam allowance (mm) to the selection. Empty or
    // 0 clears the sew line on those pieces. Same DOM-read pattern as the
    // quantity control above.
    ractive.on("bulksetseam", (): boolean | void => {
      const input = document.getElementById(
        "bulkseam",
      ) as HTMLInputElement | null;
      const raw = input ? input.value.trim() : "";
      const mm = raw === "" ? 0 : parseFloat(raw);
      if (!Number.isFinite(mm) || mm < 0) {
        message("Enter a seam allowance in mm (0 to clear), then Set seam.");
        return false;
      }
      const pieces = selectedPieces();
      if (pieces.length === 0) {
        message("Select some pieces first.");
        return false;
      }
      pieces.forEach(({ part }) => {
        part.seamAllowance = mm;
      });
      clearSelection();
      ractive.update("parts");
      message(
        mm > 0
          ? `Set ${mm}mm seam allowance on ${pieces.length} piece(s).`
          : `Cleared seam allowance on ${pieces.length} piece(s).`,
      );
      return false;
    });
  }

  /**
   * Set up keyboard event listener for delete key
   */
  private setupKeyboardEvents(): void {
    document.body.addEventListener("keydown", (e) => {
      // Esc cancels marking mode (must come before delete handling so it
      // doesn't accidentally fall through).
      if (e.key === "Escape" && this.markingPartIndex !== null) {
        this.cancelMarkingMode();
        return;
      }
      // Delete key (8 = backspace, 46 = delete) — but not while marking,
      // and not while typing in a box: v1.1.2 — Backspace in a
      // name / quantity / seam box used to delete the selected rows.
      if (this.markingPartIndex !== null) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName))
      ) {
        return;
      }
      if (e.keyCode === 8 || e.keyCode === 46) {
        this.deleteParts();
      }
    });
  }

  /**
   * Phase 4: document-level click listener that captures grain endpoints
   * during marking mode. No-op when not marking. Installed once during
   * initialize().
   */
  private setupGrainMarkerEvents(): void {
    document.addEventListener(
      "click",
      (e) => {
        if (this.markingPartIndex === null) return;
        const target = e.target as HTMLElement;
        // Don't capture clicks on the marker banner itself or on the
        // parts-table button that opened the mode.
        if (target.closest("#grainmarker-banner")) return;
        if (target.closest(".markgrain")) return;
        if (target.closest(".markfold")) return;
        // §9.3.2: don't swallow Mirror / Mirror copy clicks as grain
        // endpoints when the user is in marking mode.
        if (target.closest(".mirror")) return;
        e.preventDefault();
        e.stopPropagation();
        // Pass Shift through so handleMarkingClick can snap the angle
        // to the nearest 45° step on the second click — §9.3.1.
        this.handleMarkingClick(e.clientX, e.clientY, e.shiftKey);
      },
      true, // capture phase, so we beat svgpanzoom and other listeners
    );

    const cancelBtn = document.getElementById("grainmarker-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.cancelMarkingMode();
      });
    }
  }

  /**
   * Enter marking mode for the part at the given index.
   */
  private startMarkingMode(
    partIndex: number,
    kind: "grain" | "fold" = "grain",
  ): void {
    this.markingPartIndex = partIndex;
    this.markingKind = kind;
    this.markingStartPoint = null;
    const banner = document.getElementById("grainmarker-banner");
    const text = document.getElementById("grainmarker-text");
    if (banner && text) {
      const part = this.deepNest.parts[partIndex];
      const label =
        (part && (part.name || part.filename)) || `piece ${partIndex + 1}`;
      text.textContent =
        kind === "fold"
          ? `Mark the fold for ${label}: click its fold edge in the preview on the right. Press Esc to cancel.`
          : `Mark the grain line for ${label}: click its bottom end, then its top end. Press Esc to cancel.`;
      banner.classList.add("active");
    }
    // The preview has to show this piece's file for a fold click, zoomed
    // in on the piece so its edge is easy to hit.
    if (kind === "fold") {
      this.showImportFor(partIndex);
      this.zoomPreviewTo(partIndex);
    }
  }

  /** v1.5.0: switch the import preview to the file a piece came from. */
  private showImportFor(partIndex: number): void {
    const importIdx = this.importIndexFor(partIndex);
    if (importIdx === -1) return;
    // v1.6.0: redrawing the preview drops its pan/zoom, so only redraw
    // when it has to change file, and put the pan/zoom back afterwards.
    if (this.deepNest.imports[importIdx].selected) return;
    this.deepNest.imports.forEach((im, i) => (im.selected = i === importIdx));
    if (this.ractive) {
      (this.ractive as unknown as { update(k?: string): void }).update(
        "imports",
      );
    }
    this.applyZoom();
  }

  /**
   * v1.6.0: zoom the import preview in on one piece. The preview is a
   * copy of the imported file, so the piece's shapes are found there by
   * their position in the file.
   */
  private zoomPreviewTo(partIndex: number): void {
    const importIdx = this.importIndexFor(partIndex);
    const imp = this.deepNest.imports[importIdx];
    const part = this.deepNest.parts[partIndex];
    const liveSvg = document
      .getElementById(`import-${importIdx}`)
      ?.querySelector("svg") as SVGSVGElement | null;
    if (!imp?.zoom || !part || !liveSvg) return;
    const source = Array.from(imp.svg.querySelectorAll("*"));
    const shown = Array.from(liveSvg.querySelectorAll("*")).filter(
      (e) => !e.classList.contains("svg-pan-zoom_viewport"),
    );
    if (source.length !== shown.length) return;
    const els = (part.svgelements || [])
      .map((e) => shown[source.indexOf(e as Element)])
      .filter((e): e is Element => !!e);
    const bounds = () => {
      const r = els.map((e) => e.getBoundingClientRect());
      const left = Math.min(...r.map((b) => b.left));
      const top = Math.min(...r.map((b) => b.top));
      const right = Math.max(...r.map((b) => b.right));
      const bottom = Math.max(...r.map((b) => b.bottom));
      return {
        cx: (left + right) / 2,
        cy: (top + bottom) / 2,
        w: right - left,
        h: bottom - top,
      };
    };
    if (els.length === 0) return;
    const view = liveSvg.getBoundingClientRect();
    const b = bounds();
    if (!(b.w > 0 || b.h > 0)) return;
    const scale =
      0.8 *
      Math.min(view.width / Math.max(b.w, 1), view.height / Math.max(b.h, 1));
    imp.zoom.zoomAtPointBy(scale, { x: b.cx - view.left, y: b.cy - view.top });
    // Then centre it.
    const a = bounds();
    imp.zoom.panBy({
      x: view.left + view.width / 2 - a.cx,
      y: view.top + view.height / 2 - a.cy,
    });
  }

  private importIndexFor(partIndex: number): number {
    const part = this.deepNest.parts[partIndex];
    if (!part) return -1;
    const byRef = part.importRef
      ? this.deepNest.imports.indexOf(part.importRef)
      : -1;
    return byRef !== -1
      ? byRef
      : this.deepNest.imports.findIndex((im) => im.filename === part.filename);
  }

  /**
   * v1.5.0: a click while marking a fold. Converts the click to the
   * drawing's coordinates in the preview and folds the piece along the
   * outline edge nearest to it.
   */
  private handleFoldClick(x: number, y: number): void {
    const idx = this.markingPartIndex;
    if (idx === null) return;
    const text = document.getElementById("grainmarker-text");
    const importIdx = this.importIndexFor(idx);
    const liveSvg = document
      .getElementById(`import-${importIdx}`)
      ?.querySelector("svg") as SVGSVGElement | null;
    const box = liveSvg?.getBoundingClientRect();
    if (
      !liveSvg ||
      !box ||
      x < box.left ||
      x > box.right ||
      y < box.top ||
      y > box.bottom
    ) {
      if (text)
        text.textContent =
          "Click the piece's fold edge in the preview on the right (Esc to cancel).";
      return;
    }
    // Use a drawn shape's own frame: its coordinates are the pieces'
    // coordinates (the preview of a mm file is scaled differently from the
    // svg root, and pan/zoom adds its own transform).
    const frame =
      (liveSvg.querySelector(
        "path, polygon, polyline, rect, line, circle, ellipse",
      ) as SVGGraphicsElement | null) || liveSvg;
    const ctm = frame.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(x, y).matrixTransform(ctm.inverse());
    const ok = this.deepNest.markFoldEdge(idx, { x: p.x, y: p.y });
    this.cancelMarkingMode();
    // v1.7.0: like the other actions, a marked fold unselects the piece.
    if (ok && this.deepNest.parts[idx]) {
      this.deepNest.parts[idx].selected = false;
      delete this.deepNest.parts[idx].userUnfolded;
    }
    if (!ok) {
      message(
        "Couldn't fold the piece along that edge. Click right on its straight fold edge.",
        true,
      );
    }
    if (this.ractive) {
      (this.ractive as unknown as { update(k?: string): void }).update("parts");
    }
  }

  /**
   * Leave marking mode without applying changes.
   */
  private cancelMarkingMode(): void {
    this.markingPartIndex = null;
    this.markingStartPoint = null;
    const banner = document.getElementById("grainmarker-banner");
    if (banner) banner.classList.remove("active");
  }

  /**
   * Handle a click while in marking mode. First click stores the start
   * point; second click computes the angle and finalises the marking.
   * If `shiftKey` was held on the second click, the angle is snapped
   * to the nearest 45° step before being stored — see §9.3.1 design
   * note.
   */
  private handleMarkingClick(x: number, y: number, shiftKey: boolean): void {
    if (this.markingPartIndex === null) return;
    if (this.markingKind === "fold") {
      this.handleFoldClick(x, y);
      return;
    }

    if (this.markingStartPoint === null) {
      this.markingStartPoint = { x, y };
      const text = document.getElementById("grainmarker-text");
      if (text)
        text.textContent =
          "Bottom end recorded. Now click the top end of the grain line. Hold Shift to snap to 0° / 45° / 90° / 135°.";
      return;
    }

    const start = this.markingStartPoint;
    const dx = x - start.x;
    const dy = y - start.y;
    if (dx === 0 && dy === 0) {
      // Same point twice — ignore the second click and stay in mode.
      return;
    }

    // Angle in screen coordinates = angle in SVG coordinates (no rotation
    // between them). Fold to [0, 180) like Phase 3 detection.
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    angleDeg = ((angleDeg % 360) + 360) % 360;
    if (shiftKey) {
      // §9.3.1: snap to the nearest 45° before the fold. After the
      // fold-to-[0,180) below, the eight snap targets collapse to the
      // four useful grain orientations: 0, 45, 90, 135.
      angleDeg = Math.round(angleDeg / 45) * 45;
      angleDeg = ((angleDeg % 360) + 360) % 360;
    }
    // phase-r8c: the clicks run bottom -> top, so the second click is the
    // piece's top. After the fold the default top is the grain's "+180°"
    // end; a line pointing into [0, 180) (downwards, or exactly right)
    // means the other end is the top.
    const topFlip = angleDeg < 180;
    if (angleDeg >= 180) angleDeg -= 180;

    const idx = this.markingPartIndex;
    const part = this.deepNest.parts[idx];
    this.applyGrainMarking(part, angleDeg);
    part.topFlip = topFlip;
    this.cancelMarkingMode();

    // The imports view's `{{{ serializeSvg(svg) }}}` doesn't re-run on the
    // import.svg mutation above, so update its live DOM directly. (The
    // parts-table thumbnail is redrawn by fillThumbnails.)
    this.refreshThumbnails();
    this.injectGrainIntoLiveImportsView(idx);

    // Also tell Ractive about the grainRule/grainSource changes so the
    // dropdown and the Mark grain button visibility update correctly.
    if (this.ractive) {
      const r = this.ractive as unknown as {
        update(keypath?: string): Promise<void>;
      };
      r.update("parts");
    }
  }

  /**
   * Sync the rendered imports canvas with the line we just appended to
   * the source import.svg. Without this the user has to wait for some
   * other Ractive re-render to see their newly-marked grain.
   *
   * The previous attempt at this appended naively to all <svg> under
   * `#imports`. Two issues that this version avoids:
   *  - Match the right import via filename (so we don't spam every SVG
   *    in the document).
   *  - Tag the live clone with the same partKey we used in the source so
   *    re-marking and Phase 5+ teardown can find and remove cleanly.
   */
  private injectGrainIntoLiveImportsView(idx: number): void {
    const part = this.deepNest.parts[idx];
    if (!part) return;
    const importIdx = this.deepNest.imports.findIndex(
      (im) => im.filename === part.filename,
    );
    if (importIdx === -1) return;
    const partKey = `mark-${idx}`;

    // The rendered import lives at #import-${importIdx}.
    const importDiv = document.getElementById(`import-${importIdx}`);
    if (!importDiv) return;
    const liveSvg = importDiv.querySelector("svg");
    if (!liveSvg) return;

    // svg-pan-zoom wraps the SVG content in a transformed group
    // (`<g class="svg-pan-zoom_viewport">`) once it's been initialised.
    // Anything appended to the <svg> root sits OUTSIDE that group and
    // doesn't move with pan/zoom — that's the "pinned in the corner"
    // bug the user spotted. Append to the viewport group when present
    // and fall back to the SVG root when it isn't (e.g. before zoom
    // initialisation).
    const target =
      (liveSvg.querySelector(".svg-pan-zoom_viewport") as Element | null) ||
      liveSvg;

    // Drop any previous live overlay for this part so re-marking doesn't
    // stack lines. Search the whole live SVG (root and viewport) so we
    // also catch overlays appended before svg-pan-zoom rewrapped.
    liveSvg
      .querySelectorAll(`[data-grainnest-grain-piece="${partKey}"]`)
      .forEach((el) => el.remove());

    // Clone from the source SVG entry we just appended (so the live and
    // source trees stay in sync).
    const imp = this.deepNest.imports[importIdx];
    const sourceLine = imp.svg.querySelector(
      `[data-grainnest-grain-piece="${partKey}"]`,
    );
    if (!sourceLine) return;
    target.appendChild(sourceLine.cloneNode(false));
  }

  /**
   * v1.1.1: draw each row's thumbnail into its `.partthumb` slot. The slot
   * is an empty element in the template, so Ractive never owns what's
   * inside it: Ractive 0.8 doesn't reliably re-run a {{{ thumbnail }}}
   * expression when a part changes in place (Flip top), and swapping its
   * <svg> behind its back left stray copies when Ractive later re-rendered
   * the row — doubled or wrong thumbnails (v1.1.1). A slot is
   * redrawn only when its part, or anything drawn from it, has changed.
   */
  private fillThumbnails(): void {
    const slots = document.querySelectorAll<HTMLElement>(
      "#partslist tbody .partthumb",
    );
    slots.forEach((slot) => {
      const idx = Number(slot.dataset.index);
      const part = this.deepNest.parts[idx];
      if (!part) return;
      const sig = `${idx}|${thumbnailSignature(part)}`;
      if (slot.dataset.sig === sig && slot.firstElementChild) return;
      slot.dataset.sig = sig;
      slot.replaceChildren(buildPartThumbnail(part));
    });
  }

  /** Redraw the parts-list thumbnails after a part changed in place. */
  private refreshThumbnails(): void {
    this.fillThumbnails();
  }

  /**
   * Mutate the part to record a manual grain mark. Creates an SVG <line>
   * centred on the part's bounding box at the given angle, tags it with
   * the data-grainnest-grain attribute (so existing CSS renders it as a
   * dashed cyan overlay), and updates grainAngle/grainSource/grainRule.
   */
  private applyGrainMarking(part: Part, angleDeg: number): void {
    // Strip any prior grain element from svgelements so that re-marking
    // overwrites the old line rather than stacking a new one on top.
    part.svgelements = part.svgelements.filter(
      (el) =>
        !(el.getAttribute && el.getAttribute("data-grainnest-grain") === "1"),
    );

    const bounds = part.bounds;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const len = Math.min(bounds.width, bounds.height) * 0.6;
    const angleRad = (angleDeg * Math.PI) / 180;
    const dx = (len / 2) * Math.cos(angleRad);
    const dy = (len / 2) * Math.sin(angleRad);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(cx - dx));
    line.setAttribute("y1", String(cy - dy));
    line.setAttribute("x2", String(cx + dx));
    line.setAttribute("y2", String(cy + dy));
    line.setAttribute("data-grainnest-grain", "1");
    line.setAttribute("data-grainnest-grain-angle", String(angleDeg));
    // Inline !important style as a final safety net against the many
    // existing CSS overrides on `svg *`, `svg *.active`, dark-mode, etc.
    // The CSS rule at the bottom of style.css normally wins on its own,
    // but inline + !important is unbeatable.
    line.setAttribute(
      "style",
      "stroke: #24c7ed !important; stroke-dasharray: 6 3 !important; stroke-width: 1.2px !important; fill: none !important; fill-opacity: 0 !important;",
    );

    part.svgelements.push(line as unknown as SVGElement);

    // Also inject a clone into the source import.svg tree so the line
    // appears on the imports canvas after the next Ractive render. Phase 3
    // detection works on the canvas naturally because the <line> is
    // already in the SVG file. For Phase 4 we created a fresh DOM node;
    // it has to be parented somewhere in the source tree to render in
    // the import view's `{{{ serializeSvg(svg) }}}` expression.
    const imp = this.deepNest.imports.find(
      (im) => im.filename === part.filename,
    );
    if (imp && imp.svg) {
      // Strip any previous overlay we added for this part on a prior mark.
      const partKey = `mark-${this.deepNest.parts.indexOf(part)}`;
      imp.svg
        .querySelectorAll(`[data-grainnest-grain-piece="${partKey}"]`)
        .forEach((el) => el.remove());
      const importLine = line.cloneNode(false) as SVGElement;
      importLine.setAttribute("data-grainnest-grain-piece", partKey);
      imp.svg.appendChild(importLine);
    }

    part.grainAngle = angleDeg;
    part.grainSource = "manual";
    part.grainRule = "lock";
  }

  /**
   * Initialize the parts view service
   * Sets up Ractive, event handlers, and keyboard shortcuts
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initializeRactive();
    this.setupMouseTracking();
    this.createThrottledUpdate();
    this.bindRactiveEvents();
    this.setupKeyboardEvents();
    this.setupGrainMarkerEvents();

    this.initialized = true;
  }

  /**
   * Get the Ractive instance
   * @returns The Ractive instance or null if not initialized
   */
  getRactive(): PartsViewRactiveInstance | null {
    return this.ractive;
  }

  /**
   * Refresh the entire view (parts and imports)
   */
  refresh(): void {
    this.update();
    this.updateImports();
    this.attachSort();
    this.applyZoom();

    if (this.resizeCallback) {
      this.resizeCallback();
    }
  }

  /**
   * Create and return a new PartsViewService instance
   * @param options - Configuration options
   * @returns New PartsViewService instance
   */
  static create(options: PartsViewOptions): PartsViewService {
    return new PartsViewService(options);
  }
}

/**
 * Factory function to create a parts view service
 * @param options - Configuration options
 * @returns New PartsViewService instance
 */
export function createPartsViewService(
  options: PartsViewOptions,
): PartsViewService {
  return PartsViewService.create(options);
}

/**
 * Initialize parts view with a simple functional API
 * For use cases where a full service instance is not needed
 *
 * @param deepNest - DeepNest instance
 * @param config - Configuration object
 * @param resizeCallback - Optional resize callback
 * @returns The initialized PartsViewService instance
 *
 * @example
 * // Simple initialization
 * const partsView = initializePartsView(window.DeepNest, window.config, resize);
 *
 * // Later, update parts
 * partsView.update();
 */
export function initializePartsView(
  deepNest: DeepNestInstance,
  config: ConfigObject,
  resizeCallback?: ResizeCallback,
): PartsViewService {
  const service = new PartsViewService({ deepNest, config, resizeCallback });
  service.initialize();
  return service;
}
