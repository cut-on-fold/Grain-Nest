/**
 * Nest View Component
 * Ractive-based nest result display with selection and visualization.
 * Extracted from page.js (lines 1463-1697)
 */

import type {
  Part,
  Bounds,
  DeepNestInstance,
  ConfigObject,
  SelectableNestingResult,
  SheetPlacementWithMerged,
} from "../types/index.js";
import {
  getElement,
  getElements,
  createSvgElement,
  setAttributes,
  serializeSvg,
  setInnerHtml,
  createTranslate,
  createCssTransform,
  foldReflectionTransform,
  clearChildren,
} from "../utils/dom-utils.js";
import { millisecondsToStr } from "../utils/ui-helpers.js";
import {
  copiesToNest,
  minLengthSvg as minLengthOf,
  rankNests,
} from "../utils/nest-rank.js";

/**
 * Ractive event object with original DOM event
 */
interface RactiveEvent {
  original: MouseEvent;
}

/**
 * Ractive instance interface for nest view
 */
interface NestViewRactiveInstance {
  /** Update a specific keypath */
  update(keypath?: string): Promise<void>;
  /** Get a value from the data context */
  get<K extends keyof NestViewData>(keypath: K): NestViewData[K];
  /** Set a value in the data context */
  set<K extends keyof NestViewData>(
    keypath: K,
    value: NestViewData[K],
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
  new (options: RactiveOptions): NestViewRactiveInstance;
};

/**
 * Options for creating a Ractive instance
 */
interface RactiveOptions {
  el: string;
  template: string;
  data: NestViewData;
}

/**
 * Ractive component data interface for nest display
 */
interface NestViewData {
  nests: SelectableNestingResult[];
  getSelected: () => SelectableNestingResult[];
  getNestedPartSources: (n: SelectableNestingResult) => number[];
  getColorBySource: (id: number) => string;
  getPartsPlaced: () => string;
  getUtilisation: () => string;
  getTimeSaved: () => string;
  /**
   * §9.3.6: minimum fabric length needed across all sheets in the
   * currently-selected nest, formatted in the user's current units.
   * Returns "-" when no nest is selected.
   */
  getMinLength: () => string;
  /**
   * §9.0.1 R6-A: nests ranked by min fabric length, least first — the
   * order the "best nests so far" list renders in.
   */
  getNestsByFabric: () => SelectableNestingResult[];
  /** §9.0.1 R6-A: a nest's min fabric length, formatted for its row label. */
  getNestLength: (n: SelectableNestingResult) => string;
}

/**
 * Sheet placement structure used in nesting results
 */
interface SheetPlacement {
  sheetid: number;
  sheet: number;
  sheetplacements: SheetPlacementWithMerged[];
}

/**
 * DOM element selectors used by the nest view component
 */
const SELECTORS = {
  /** Container for the nest content */
  NEST_CONTENT: "#nestcontent",
  /** Template for the nest view */
  NEST_TEMPLATE: "#nest-template",
  /** Container for the nest SVG display */
  NEST_DISPLAY: "#nestdisplay",
  /** Nest SVG element */
  NEST_SVG: "#nestsvg",
  /** Part elements in SVG */
  NEST_SVG_PARTS: "#nestsvg .part",
  /** Sheet elements in SVG */
  NEST_SVG_SHEETS: "#nestsvg .sheet",
  /** Merged line elements in SVG */
  NEST_SVG_MERGED: "#nestsvg .merged",
} as const;

/**
 * CSS classes used by the nest view
 */
const CSS_CLASSES = {
  PART: "part",
  SHEET: "sheet",
  ACTIVE: "active",
  MERGED: "merged",
} as const;

/**
 * Options for NestView initialization
 */
export interface NestViewOptions {
  /** DeepNest instance for accessing nests and parts */
  deepNest: DeepNestInstance;
  /** Configuration object */
  config: ConfigObject;
}

/**
 * Nest View Service class
 * Manages the Ractive-based nest display with selection and visualization
 */
export class NestViewService {
  /** DeepNest instance */
  private deepNest: DeepNestInstance;

  /** Configuration object */
  private config: ConfigObject;

  /** Main Ractive instance for nest view */
  private ractive: NestViewRactiveInstance | null = null;

  /** Flag to track if service has been initialized */
  private initialized = false;

  /**
   * Create a new NestViewService instance
   * @param options - Configuration options
   */
  constructor(options: NestViewOptions) {
    this.deepNest = options.deepNest;
    this.config = options.config;
  }

  /**
   * Display a nesting result in the SVG viewport
   * Creates/updates SVG elements for sheets and placed parts
   * @param n - The nesting result to display
   */
  displayNest(n: SelectableNestingResult): void {
    // Create svg if not exist
    let svg = getElement<SVGSVGElement>(SELECTORS.NEST_SVG);

    if (!svg) {
      const newSvg = createSvgElement("svg");
      newSvg.setAttribute("id", "nestsvg");
      const nestDisplay = getElement(SELECTORS.NEST_DISPLAY);
      if (nestDisplay) {
        setInnerHtml(nestDisplay, serializeSvg(newSvg));
      }
      svg = getElement<SVGSVGElement>(SELECTORS.NEST_SVG);
    }

    if (!svg) {
      return;
    }

    // Remove active class from parts and sheets
    const parts = getElements<SVGElement>(SELECTORS.NEST_SVG_PARTS);
    parts.forEach((p) => {
      p.setAttribute("class", CSS_CLASSES.PART);
    });

    const sheets = getElements<SVGElement>(SELECTORS.NEST_SVG_SHEETS);
    sheets.forEach((p) => {
      p.setAttribute("class", CSS_CLASSES.SHEET);
    });

    // Remove laser markers (merged lines)
    const merged = getElements<SVGElement>(SELECTORS.NEST_SVG_MERGED);
    merged.forEach((p) => {
      p.remove();
    });

    let svgWidth = 0;
    let svgHeight = 0;

    // Create elements if they don't exist, show them otherwise
    n.placements.forEach((s: SheetPlacement) => {
      // Create sheet if it doesn't exist
      let groupElement = getElement<SVGGElement>(`#sheet${s.sheetid}`);
      if (!groupElement) {
        const group = createSvgElement("g");
        group.setAttribute("id", `sheet${s.sheetid}`);
        group.setAttribute("data-index", String(s.sheetid));

        svg.appendChild(group);
        groupElement = getElement<SVGGElement>(`#sheet${s.sheetid}`);

        if (groupElement && this.deepNest.parts[s.sheet]) {
          this.deepNest.parts[s.sheet].svgelements.forEach((e) => {
            const node = e.cloneNode(false) as SVGElement;
            node.setAttribute("stroke", "#ffffff");
            node.setAttribute("fill", "none");
            node.removeAttribute("style");
            groupElement!.appendChild(node);
          });
        }
      }

      if (!groupElement) {
        return;
      }

      // Reset class (make visible)
      groupElement.setAttribute(
        "class",
        `${CSS_CLASSES.SHEET} ${CSS_CLASSES.ACTIVE}`,
      );

      const sheetBounds: Bounds = this.deepNest.parts[s.sheet].bounds;
      groupElement.setAttribute(
        "transform",
        createTranslate(-sheetBounds.x, svgHeight - sheetBounds.y),
      );
      if (svgWidth < sheetBounds.width) {
        svgWidth = sheetBounds.width;
      }

      s.sheetplacements.forEach((p: SheetPlacementWithMerged) => {
        let partElement = getElement<SVGGElement>(`#part${p.id}`);
        if (!partElement) {
          const part: Part = this.deepNest.parts[p.source];
          const partGroup = createSvgElement("g");
          partGroup.setAttribute("id", `part${p.id}`);

          // §9.3.2: a mirrored piece is flipped at render time, not baked
          // into its svgelements. The parts-table thumbnail (parts-view.ts)
          // and the SVG export (export.service.ts) both wrap the elements
          // in a `scale(-1, 1)` group about the bounds-centre vertical axis;
          // the nest preview must do the same or the mirror is silently
          // dropped here. Symptom: a mirror-copy whose grain was reflected
          // (e.g. 45°→135°) gets the engine's compensating rotation but is
          // drawn un-flipped, so the grain line lands along the weft
          // instead of the warp (and a non-symmetric outline is drawn the
          // wrong way round). The flip is appended *inside* partGroup so it
          // composes in the piece's local frame — before the placement
          // translate/rotate applied to partGroup below.
          let elementTarget: SVGElement = partGroup;
          if (part.mirror) {
            const cx = part.bounds.x + part.bounds.width / 2;
            const mirrorGroup = createSvgElement("g");
            mirrorGroup.setAttribute(
              "transform",
              `translate(${2 * cx} 0) scale(-1 1)`,
            );
            partGroup.appendChild(mirrorGroup);
            elementTarget = mirrorGroup;
          }

          const appendStyledElements = (parent: SVGElement): void => {
            part.svgelements.forEach((e, index) => {
              const node = e.cloneNode(false) as SVGElement;
              if (index === 0) {
                node.setAttribute("fill", `url(#part${p.source}hatch)`);
                node.setAttribute("fill-opacity", "0.5");
              } else {
                node.setAttribute("fill", "#404247");
              }
              node.removeAttribute("style");
              node.setAttribute("stroke", "#ffffff");
              parent.appendChild(node);
            });
          };
          appendStyledElements(elementTarget);
          // §9.3.2 b3: a cut-on-fold piece draws a second, reflected copy
          // so the placed piece shows doubled — matching the doubled
          // polygon the worker actually nested. Inside elementTarget so it
          // composes in the piece's local frame, before the placement
          // transform applied to partGroup.
          if (part.cutOnFold && part.foldLine) {
            const foldGroup = createSvgElement("g");
            foldGroup.setAttribute(
              "transform",
              foldReflectionTransform(part.foldLine),
            );
            elementTarget.appendChild(foldGroup);
            appendStyledElements(foldGroup);
          }

          svg.appendChild(partGroup);

          // Create hatch pattern if it doesn't exist
          if (!getElement(`#part${p.source}hatch`)) {
            const pattern = createSvgElement("pattern");
            pattern.setAttribute("id", `part${p.source}hatch`);
            pattern.setAttribute("patternUnits", "userSpaceOnUse");

            let psize = parseInt(
              String(this.deepNest.parts[s.sheet].bounds.width / 120),
            );
            psize = psize || 10;

            pattern.setAttribute("width", String(psize));
            pattern.setAttribute("height", String(psize));

            const path = createSvgElement("path");
            path.setAttribute(
              "d",
              `M-1,1 l2,-2 M0,${psize} l${psize},-${psize} M${psize - 1},${psize + 1} l2,-2`,
            );
            const hue = 360 * (p.source / this.deepNest.parts.length);
            path.setAttribute(
              "style",
              // v1.4.0: deeper in light mode, pastel in dark (theme variables).
              `stroke: hsl(${hue}, var(--hatch-saturation), var(--hatch-lightness)) !important; stroke-width:1`,
            );
            pattern.appendChild(path);

            groupElement!.appendChild(pattern);
          }

          partElement = getElement<SVGGElement>(`#part${p.id}`);
        } else {
          // Ensure correct z layering
          svg.appendChild(partElement);
        }

        if (partElement) {
          // Reset class (make visible)
          partElement.setAttribute(
            "class",
            `${CSS_CLASSES.PART} ${CSS_CLASSES.ACTIVE}`,
          );

          // Position part with CSS transform
          partElement.setAttribute(
            "style",
            `transform: ${createCssTransform(
              p.x - sheetBounds.x,
              p.y + svgHeight - sheetBounds.y,
              p.rotation,
            )}`,
          );

          // Add merge lines if present
          if (p.mergedSegments && p.mergedSegments.length > 0) {
            for (let i = 0; i < p.mergedSegments.length; i++) {
              const s1 = p.mergedSegments[i][0];
              const s2 = p.mergedSegments[i][1];
              const line = createSvgElement("line");
              line.setAttribute("class", CSS_CLASSES.MERGED);
              line.setAttribute("x1", String(s1.x - sheetBounds.x));
              line.setAttribute("x2", String(s2.x - sheetBounds.x));
              line.setAttribute("y1", String(s1.y + svgHeight - sheetBounds.y));
              line.setAttribute("y2", String(s2.y + svgHeight - sheetBounds.y));
              svg.appendChild(line);
            }
          }
        }
      });

      // Put next sheet below
      svgHeight += 1.1 * sheetBounds.height;
    });

    // Activate merged lines after delay for animation
    setTimeout(() => {
      const mergedElements = getElements<SVGElement>(SELECTORS.NEST_SVG_MERGED);
      mergedElements.forEach((p) => {
        p.setAttribute("class", `${CSS_CLASSES.MERGED} ${CSS_CLASSES.ACTIVE}`);
      });
    }, 1500);

    // Set SVG viewBox
    setAttributes(svg, {
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${svgWidth} ${svgHeight}`,
    });
  }

  /**
   * Initialize the Ractive instance for nest view
   */
  private initializeRactive(): void {
    const deepNest = this.deepNest;
    const config = this.config;

    // §9.0.1 R6-A: minimum fabric length of ONE nest result, in SVG units —
    // per sheet, the max warp-axis extent of its placements (exact
    // rotation-aware DeepNest.placedBounds, measured from the sheet's own
    // origin), summed across sheets. Shared by the selected-nest stat, the
    // per-row labels, and the fabric-ranked ordering of "best nests so far"
    // (the GA's fitness ranking is NOT a fabric ranking —
    // its favourites can need 200 in while a 157 in layout sits mid-list, so
    // order the list by what the user actually buys).
    const minLengthSvg = (nest: SelectableNestingResult): number | null =>
      minLengthOf(deepNest, nest);

    // Format an SVG-unit length in the user's units — same convention as
    // the cut list (m for anything ≥1000 mm, otherwise mm; inches as in).
    const formatLengthSvg = (totalSvg: number): string => {
      const units = config.getSync("units");
      const scale = (config.getSync("scale") as number) || 72;
      const userUnits =
        units === "mm" ? (totalSvg / scale) * 25.4 : totalSvg / scale;
      if (units === "mm") {
        if (Math.abs(userUnits) >= 1000)
          return `${(userUnits / 1000).toFixed(2)} m`;
        return `${userUnits.toFixed(0)} mm`;
      }
      return `${userUnits.toFixed(1)} in`;
    };

    // Create main Ractive instance
    this.ractive = new Ractive({
      el: SELECTORS.NEST_CONTENT,
      template: SELECTORS.NEST_TEMPLATE,
      data: {
        nests: deepNest.nests,
        getSelected: function (this: {
          get: (key: string) => SelectableNestingResult[];
        }): SelectableNestingResult[] {
          const ne = this.get("nests");
          return ne.filter((n: SelectableNestingResult) => n.selected);
        },
        getNestedPartSources: function (n: SelectableNestingResult): number[] {
          const sources: number[] = [];
          for (let i = 0; i < n.placements.length; i++) {
            const sheet = n.placements[i] as SheetPlacement;
            for (let j = 0; j < sheet.sheetplacements.length; j++) {
              sources.push(sheet.sheetplacements[j].source);
            }
          }
          return sources;
        },
        getColorBySource: function (id: number): string {
          return `hsl(${360 * (id / deepNest.parts.length)}, 100%, 80%)`;
        },
        getPartsPlaced: function (this: {
          get: (key: string) => SelectableNestingResult[];
        }): string {
          const ne = this.get("nests");
          const selected = ne.filter(
            (n: SelectableNestingResult) => n.selected,
          );

          if (selected.length === 0) {
            return "";
          }

          const selectedNest = selected.pop()!;

          let num = 0;
          for (let i = 0; i < selectedNest.placements.length; i++) {
            const sheet = selectedNest.placements[i] as SheetPlacement;
            num += sheet.sheetplacements.length;
          }

          let total = 0;
          for (let i = 0; i < deepNest.parts.length; i++) {
            // phase-r8a: excluded pieces aren't part of this nest.
            // v1.9.0: counts from cut codes (see copiesToNest).
            if (!deepNest.parts[i].sheet) {
              total += copiesToNest(deepNest.parts[i]);
            }
          }

          return `${num}/${total}`;
        },
        getUtilisation: function (this: {
          get: (key: string) => () => SelectableNestingResult[];
        }): string {
          const getSelected = this.get("getSelected");
          const selected = getSelected();
          if (selected.length === 0) return "-";
          return selected[0].utilisation.toFixed(2);
        },
        getTimeSaved: function (this: {
          get: (key: string) => SelectableNestingResult[];
        }): string {
          const ne = this.get("nests");
          const selected = ne.filter(
            (n: SelectableNestingResult) => n.selected,
          );

          if (selected.length === 0) {
            return "0 seconds";
          }

          const selectedNest = selected.pop()!;
          const totalLength = selectedNest.mergedLength;

          const scale = config.getSync("scale");
          const lengthInches = totalLength / scale;

          // Assume 2 inches per second cut speed
          const seconds = lengthInches / 2;
          return millisecondsToStr(seconds * 1000);
        },
        // §9.3.6: total min fabric length needed across all sheets in
        // the currently-selected nest, formatted in current units.
        // §9.0.1 R6-A: computed by the shared minLengthSvg (exact
        // rotation-aware placedBounds) — the old `p.x + bounds.width`
        // shortcut reported 171.5 in on a 160 in sheet that held everything
        // (testing round 6).
        getMinLength: function (this: {
          get: (key: string) => () => SelectableNestingResult[];
        }): string {
          const getSelected = this.get("getSelected");
          const selected = getSelected();
          if (selected.length === 0) return "-";
          const v = minLengthSvg(selected[0]);
          return v === null ? "-" : formatLengthSvg(v);
        },
        // §9.0.1 R6-A: "best nests so far" ranked by fabric needed,
        // least first — the GA's own fitness order is not a fabric order.
        // v1.8.0: layouts that place more pieces come first (one that left
        // pieces out used less fabric and topped the list). Returns a
        // sorted COPY; deepNest.nests itself is untouched.
        getNestsByFabric: function (this: {
          get: (key: string) => SelectableNestingResult[];
        }): SelectableNestingResult[] {
          return rankNests(deepNest, this.get("nests"));
        },
        // §9.0.1 R6-A: per-row fabric-length label so the ranking is
        // visible on the list itself.
        getNestLength: function (n: SelectableNestingResult): string {
          const v = minLengthSvg(n);
          return v === null ? "" : formatLengthSvg(v);
        },
      },
    });
  }

  /**
   * Bind Ractive event handlers
   */
  private bindRactiveEvents(): void {
    if (!this.ractive) {
      return;
    }

    const deepNest = this.deepNest;

    // Handle nest selection
    this.ractive.on(
      "selectnest",
      (_e: RactiveEvent, ...args: unknown[]): void => {
        const n = args[0] as SelectableNestingResult;

        // Deselect all nests
        for (let i = 0; i < deepNest.nests.length; i++) {
          deepNest.nests[i].selected = false;
          deepNest.nests[i].userPicked = false;
        }

        // Select this nest. v1.8.0: and keep showing it while the nest
        // runs, rather than jumping to each new best.
        n.selected = true;
        n.userPicked = true;

        // Update UI
        this.update();
        this.displayNest(n);
      },
    );
  }

  /**
   * Update the nests data in Ractive
   */
  update(): void {
    if (this.ractive) {
      this.ractive.update("nests");
    }
  }

  /**
   * §9.3.6 / phase-5z: empty the nest preview and reset its stats, for when
   * DeepNest.nests has been cleared. The preview is built *imperatively*
   * into #nestsvg (cached per-sheet and per-part groups whose sheet `<rect>`
   * was cloned at the OLD bounds), so a Ractive update alone never refreshes
   * it — and worse, the cached sheet group would be reused at the stale size
   * on the next nest. Removing the children forces displayNest to rebuild
   * every group from the now-trimmed bounds. A full ractive.update() then
   * re-reads the emptied nests array so utilisation / min-length /
   * parts-placed fall back to "-".
   */
  clearDisplay(): void {
    const svg = getElement<SVGSVGElement>(SELECTORS.NEST_SVG);
    if (svg) {
      clearChildren(svg);
    }
    if (this.ractive) {
      this.ractive.update();
    }
  }

  /**
   * Initialize the nest view service
   * Sets up Ractive and event handlers
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initializeRactive();
    this.bindRactiveEvents();

    this.initialized = true;
  }

  /**
   * Get the Ractive instance
   * @returns The Ractive instance or null if not initialized
   */
  getRactive(): NestViewRactiveInstance | null {
    return this.ractive;
  }

  /**
   * Get the displayNest function bound to this instance
   * Useful for passing to callbacks
   * @returns Bound displayNest function
   */
  getDisplayNestCallback(): (n: SelectableNestingResult) => void {
    return this.displayNest.bind(this);
  }

  /**
   * Create and return a new NestViewService instance
   * @param options - Configuration options
   * @returns New NestViewService instance
   */
  static create(options: NestViewOptions): NestViewService {
    return new NestViewService(options);
  }
}

/**
 * Factory function to create a nest view service
 * @param options - Configuration options
 * @returns New NestViewService instance
 */
export function createNestViewService(
  options: NestViewOptions,
): NestViewService {
  return NestViewService.create(options);
}

/**
 * Initialize nest view with a simple functional API
 * For use cases where a full service instance is not needed
 *
 * @param deepNest - DeepNest instance
 * @param config - Configuration object
 * @returns The initialized NestViewService instance
 *
 * @example
 * // Simple initialization
 * const nestView = initializeNestView(window.DeepNest, window.config);
 *
 * // Later, display a nest
 * nestView.displayNest(selectedNest);
 */
export function initializeNestView(
  deepNest: DeepNestInstance,
  config: ConfigObject,
): NestViewService {
  const service = new NestViewService({ deepNest, config });
  service.initialize();
  return service;
}
