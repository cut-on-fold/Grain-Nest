/**
 * Main UI Entry Point
 * Orchestrates initialization of all UI modules for DeepNest
 * This file replaces the monolithic page.js with modular TypeScript components
 */

// Type imports
import type {
  UIConfig,
  ConfigObject,
  DeepNestInstance,
  RactiveInstance,
  NestViewData,
  NestingProgress,
  PartsViewData,
  Part,
  SelectableNestingResult,
} from "./types/index.js";
import { IPC_CHANNELS } from "./types/index.js";

// Service imports
import {
  ConfigService,
  createConfigService,
  BOOLEAN_CONFIG_KEYS,
} from "./services/config.service.js";
import {
  ImportService,
  createImportService,
} from "./services/import.service.js";
import {
  ExportService,
  createExportService,
} from "./services/export.service.js";
import {
  NestingService,
  createNestingService,
} from "./services/nesting.service.js";
import {
  ProjectService,
  createProjectService,
} from "./services/project.service.js";

// Component imports
import {
  NavigationService,
  createNavigationService,
} from "./components/navigation.js";
import {
  PartsViewService,
  createPartsViewService,
} from "./components/parts-view.js";
import {
  NestViewService,
  createNestViewService,
} from "./components/nest-view.js";
import {
  SheetDialogService,
  createSheetDialogService,
} from "./components/sheet-dialog.js";

// Utility imports
import { message } from "./utils/ui-helpers.js";
import { piecesPlaced, piecesToPlace, rankNests } from "./utils/nest-rank.js";
import { applyAutoCuts, clearAutoCuts } from "./utils/auto-cuts.js";
import {
  escapeHtml,
  hideNestBanner,
  showModal,
  showNestBanner,
} from "./utils/modal.js";
import {
  layoutChanges,
  layoutToNest,
  type SavedLayout,
} from "./utils/saved-layouts.js";
import { LayoutsService } from "./services/layouts.service.js";
import { ViewsService } from "./services/views.service.js";
import { clearViews, refreshViewFlags, setCurrentView } from "./utils/views.js";
import type { NestJob } from "./utils/nest-jobs.js";
import { describeSheet, parseSheetsFile } from "./utils/sheets-file.js";
import { getElement, getElements } from "./utils/dom-utils.js";
import {
  setupPartsColumnResize,
  loadLayout,
  saveLayout,
} from "./utils/column-resize.js";

/**
 * IPC renderer interface for Electron communication
 */
interface IpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
}

/**
 * Helper type for casting getSync() results
 */
type ConfigResult = UIConfig;

/**
 * Window is already augmented in index.d.ts
 * We use type assertion when setting globals that have different types
 */
declare const Ractive: { DEBUG: boolean };
declare const interact: (selector: string) => {
  resizable(options: {
    preserveAspectRatio: boolean;
    edges: { left: boolean; right: boolean; bottom: boolean; top: boolean };
  }): {
    on(
      event: string,
      handler: (event: { rect: { width: number } }) => void,
    ): void;
  };
};

/**
 * Node.js module interfaces for Electron context
 */
declare function require(module: string): unknown;

/**
 * Global DeepNest instance (set by deepnest.js)
 * Access via getDeepNest() helper to get proper typing
 */
declare let DeepNest: DeepNestInstance;

/**
 * Get the DeepNest global with proper typing
 */
function getDeepNest(): DeepNestInstance {
  return DeepNest;
}

/**
 * Execute a callback when the DOM is ready
 * @param fn - The callback function to execute
 */
function ready(fn: () => void | Promise<void>): void {
  if (document.readyState !== "loading") {
    fn();
  } else {
    document.addEventListener("DOMContentLoaded", fn);
  }
}

/**
 * Show a fixed-position red banner at the top of the page describing a
 * boot-time failure. Used by initialize() so a failure in any module
 * load / handler binding is visible to the user even without DevTools.
 *
 * Added 2026-05-19 after round-2 Mac testing revealed the post-MVP
 * handlers were silently failing to bind, leaving an app that looked
 * launched but had dead buttons.
 *
 * Banners append rather than replace, so multiple failures stack —
 * useful when the per-initializer wrapping below catches several
 * independent breakages in one run.
 */
function showInitBanner(step: string, err: unknown): void {
  const errAny = err as { stack?: string; message?: string } | string;
  const errText =
    typeof errAny === "string"
      ? errAny
      : errAny.stack || errAny.message || String(err);
  const safe = errText.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  let banner = document.getElementById("grainnest-init-error");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "grainnest-init-error";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
      "background:#b00020;color:#fff;padding:12px 20px;" +
      "font-family:-apple-system,system-ui,sans-serif;font-size:13px;" +
      "line-height:1.45;box-shadow:0 2px 12px rgba(0,0,0,0.45);" +
      "white-space:pre-wrap;max-height:50vh;overflow:auto";
    banner.innerHTML =
      "<strong>Grain-Nest init issues</strong> " +
      '<span style="font-size:11px;opacity:0.85">' +
      "(please copy this text when reporting the problem — DevTools console has full traces)" +
      "</span>\n";
    (document.body || document.documentElement).appendChild(banner);
  }
  const entry = document.createElement("div");
  entry.style.cssText =
    "margin-top:8px;border-top:1px solid #ffffff33;padding-top:8px";
  entry.innerHTML =
    "<strong>step:</strong> " +
    step.replace(/</g, "&lt;") +
    "\n" +
    safe.slice(0, 1200);
  banner.appendChild(entry);
}

/**
 * Module instances for cross-module communication
 */
let configService: ConfigService;
let importService: ImportService;
let exportService: ExportService;
let nestingService: NestingService;
let navigationService: NavigationService;
let partsViewService: PartsViewService;
let nestViewService: NestViewService;
let sheetDialogService: SheetDialogService;
let projectService: ProjectService;
let layoutsService: LayoutsService;
let viewsService: ViewsService;

/**
 * Electron and Node.js module references
 */
let ipcRenderer: IpcRenderer;
let electronRemote: {
  dialog: { showOpenDialog: unknown; showSaveDialogSync: unknown };
  getGlobal: (name: string) => string | undefined;
};
let fs: unknown;
let path: {
  extname: (p: string) => string;
  basename: (p: string) => string;
  dirname: (p: string) => string;
};

/**
 * Resize function for parts list
 * Adjusts the parts table headers when resizing
 */
function resize(event?: { rect: { width: number } }): void {
  const parts = getElement<HTMLElement>("#parts");

  if (event && parts) {
    parts.style.width = event.rect.width + "px";
    // v1.1.1: remember the panel width the user dragged to.
    saveLayout({ partsWidth: Math.round(event.rect.width) });
  }

  const headers = getElements<HTMLTableCellElement>("#parts table th");
  headers.forEach((th) => {
    const span = th.querySelector("span");
    if (span) {
      (span as HTMLElement).style.width = th.offsetWidth + "px";
    }
  });
}

/**
 * Update the config form UI with current values
 * @param c - The configuration object
 */
function updateForm(c: UIConfig): void {
  // Update unit radio buttons
  let unitInput: HTMLInputElement | null;
  if (c.units === "inch") {
    unitInput = document.querySelector("#configform input[value=inch]");
  } else {
    unitInput = document.querySelector("#configform input[value=mm]");
  }

  if (unitInput) {
    unitInput.checked = true;
  }

  // Update unit labels
  const labels = document.querySelectorAll("span.unit-label");
  labels.forEach((l) => {
    (l as HTMLElement).innerText = c.units;
  });

  // Update scale input
  const scaleInput = document.querySelector<HTMLInputElement>("#inputscale");
  if (scaleInput) {
    if (c.units === "inch") {
      scaleInput.value = String(c.scale);
    } else {
      // mm
      scaleInput.value = String(c.scale / 25.4);
    }
  }

  // Update all other config inputs
  const inputs = document.querySelectorAll("#config input, #config select");
  inputs.forEach((i) => {
    const inputElement = i as HTMLInputElement | HTMLSelectElement;

    const key = inputElement.getAttribute("data-config") as
      | keyof UIConfig
      | null;
    if (!key) {
      return;
    }

    if (key === "units" || key === "scale") {
      return;
    }

    const value = c[key];

    if (inputElement.getAttribute("data-conversion") === "true") {
      const scaleValue = scaleInput ? Number(scaleInput.value) : c.scale;
      inputElement.value = String((value as number) / scaleValue);
    } else if (inputElement.getAttribute("data-conversion") === "inch") {
      // v1.3.0: values stored in inches (gap between sheets, calibration
      // square) — shown in mm when the display units are mm. They used to
      // go through the drawing-units conversion above and showed wrong.
      const shown =
        c.units === "mm" ? (value as number) * 25.4 : (value as number);
      inputElement.value = String(Math.round(shown * 100) / 100);
    } else if (BOOLEAN_CONFIG_KEYS.includes(key)) {
      (inputElement as HTMLInputElement).checked = value as boolean;
    } else if (value !== undefined) {
      inputElement.value = String(value);
    }
  });
}

/** Piece names for a pop-up list, shortened past a dozen. */
function pieceNames(names: string[]): string[] {
  const shown = names.slice(0, 12);
  if (names.length > 12) shown.push(`…and ${names.length - 12} more`);
  return shown;
}

/**
 * v1.10.0: what's on the nest screen — the layout opened from the saved
 * list (no "save it?" on Back), and the nest result last saved, so Back
 * only asks about a layout that isn't saved.
 */
const nestState: {
  opened: SavedLayout | null;
  saved: SelectableNestingResult | null;
} = { opened: null, saved: null };

/**
 * v1.9.0: before a nest starts, work out the pairs and folds from the cut
 * codes (Settings: "Pairs & folds from cut codes"). Asks first when some
 * pieces have no code or can't be folded; returns false to cancel.
 * `warn` is false when restarting from the nest screen (already asked).
 * v1.10.0: the no-code question has "Don't ask again" (Settings → Cut
 * codes turns it back on); with it off, a banner on the nest screen
 * names the pieces instead.
 */
async function prepareAutoCuts(warn: boolean): Promise<boolean> {
  const dn = getDeepNest();
  hideNestBanner();
  nestState.opened = null;
  nestState.saved = null;
  // v1.11.0: only the pieces of the view shown nest.
  refreshViewFlags(dn);
  if (configService.getSync("autoCutsFromCodes") === false) {
    clearAutoCuts(dn);
    return true;
  }
  const job = ((dn.nestJob as NestJob | undefined) || "all") as NestJob;
  const report = applyAutoCuts(
    dn,
    job,
    configService.getSync("equalCutsFuse") !== "separate",
  );
  // Folds made for OF codes show in the list ("Unfold").
  if (partsViewService) partsViewService.update();
  const uncodedBanner = (): void => {
    if (report.uncoded.length === 0) return;
    showNestBanner(
      `${report.uncoded.length === 1 ? "1 piece has" : `${report.uncoded.length} pieces have`} no cut code, so ${report.uncoded.length === 1 ? "it's" : "they're"} cut as the Quantity says: ` +
        escapeHtml(pieceNames(report.uncoded).join(", ")),
      [],
      "info",
    );
  };
  if (!warn) return true;
  if (report.uncoded.length > 0) {
    if (configService.getSync("warnUncodedPieces") === false) {
      // Shown once the nest screen is up.
      setTimeout(uncodedBanner, 0);
    } else {
      const r = await showModal({
        title: "Pieces without a cut code",
        text: [
          "These pieces have no cut code (like C2M or C1MOF) in their name, so they're cut as their Quantity says, none mirrored:",
        ],
        list: pieceNames(report.uncoded),
        tickbox: "Don't ask again",
        buttons: [
          { id: "cancel", label: "Cancel" },
          { id: "nest", label: "Nest anyway", primary: true },
        ],
      });
      if (r.button !== "nest") {
        clearAutoCuts(dn);
        return false;
      }
      if (r.ticked) {
        configService.setSync("warnUncodedPieces", false);
        updateForm(configService.getSync() as unknown as UIConfig);
      }
    }
  }
  if (report.foldFailed.length > 0) {
    const r = await showModal({
      title: "Pieces without a fold edge",
      text: [
        "These pieces are cut on the fold (OF) but have no fold edge, so they're cut whole as drawn. Use Mark fold to show the fold.",
      ],
      list: pieceNames(report.foldFailed),
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "nest", label: "Nest anyway", primary: true },
      ],
    });
    if (r.button !== "nest") {
      clearAutoCuts(dn);
      return false;
    }
  }
  return true;
}

/** The nest shown on the nest screen (selected, else the top one). */
function shownNest(): SelectableNestingResult | null {
  const dn = getDeepNest();
  return dn.nests.find((n) => n.selected) || rankNests(dn, dn.nests)[0] || null;
}

/**
 * v1.10.0: before Back leaves the nest screen. An unsaved layout asks
 * first (Save layout… / Leave / Cancel, "Don't ask again"), and is kept
 * as "Last nest (not saved)" either way.
 */
async function beforeLeavingNest(): Promise<boolean> {
  hideNestBanner();
  const nest = shownNest();
  if (!nest || nestState.opened || nest === nestState.saved) return true;
  if (configService.getSync("askBeforeLeavingNest") !== false) {
    const r = await showModal({
      title: "Leave without saving?",
      text: [
        "This layout isn't saved. If you leave, it's kept as Last nest (not saved) until you run another nest.",
      ],
      tickbox: "Don't ask again",
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "leave", label: "Leave" },
        { id: "save", label: "Save layout…", primary: true },
      ],
    });
    if (r.button === "cancel") return false;
    if (r.ticked) {
      configService.setSync("askBeforeLeavingNest", false);
      updateForm(configService.getSync() as unknown as UIConfig);
    }
    if (r.button === "save") {
      const saved = await layoutsService.saveNest(nest);
      if (!saved) return false;
      nestState.saved = nest;
      return true;
    }
  }
  layoutsService.keepAsLastNest(nest);
  return true;
}

/** v1.10.0: Save layout on the nest screen. */
async function saveShownLayout(): Promise<void> {
  const nest = shownNest();
  if (!nest) {
    message("There's no layout to save yet.");
    return;
  }
  const saved = await layoutsService.saveNest(nest);
  if (saved) {
    nestState.saved = nest;
    nestState.opened = null;
    message(`Saved layout "${saved.name}".`);
  }
}

/**
 * v1.10.0: opens a saved layout on the nest screen: Nest for switches to
 * its fabric, its pairs are made, and a banner says if pieces changed
 * since it was saved.
 */
function openLayout(layout: SavedLayout): void {
  const dn = getDeepNest();
  const job = (layout.job || "all") as NestJob;
  // v1.11.0: a layout opens in its own view.
  setCurrentView(dn, layout.view ?? null);
  partsViewService.refreshLayouts();
  // Nest for switches only when the layout is for another fabric: on the
  // same one, ticks set by hand stay (re-applying the job reset them, and
  // hid pieces added or left out since — v1.11.0).
  if (((dn.nestJob as string | undefined) || "all") !== job)
    partsViewService.setNestJob(job);
  if (configService.getSync("autoCutsFromCodes") === false) clearAutoCuts(dn);
  else
    applyAutoCuts(
      dn,
      job,
      configService.getSync("equalCutsFuse") !== "separate",
    );
  // A mirrored copy the layout needs (made here when cut codes are off).
  const copyOf = (part: Part): Part | undefined => {
    const have = dn.parts.find((q) => q.autoCopy && q.autoCopyOf === part);
    if (have) return have;
    const idx = dn.mirrorCopyPart(dn.parts.indexOf(part));
    if (idx < 0) return undefined;
    const copy = dn.parts[idx];
    copy.isMirrorCopy = false;
    delete copy.mirrorOfId;
    copy.autoCopy = true;
    copy.autoCopyOf = part;
    copy.nestQuantity = 0;
    return copy;
  };
  const nest = layoutToNest(dn, layout, copyOf);
  // Copies made just for this layout count as placed pieces.
  for (const sg of nest.placements) {
    for (const pl of sg.sheetplacements) {
      const p = dn.parts[pl.source];
      if (p && p.autoCopy && p.nestQuantity === 0) p.nestQuantity = undefined;
    }
  }
  const changes = layoutChanges(dn, layout);
  dn.nests.length = 0;
  dn.nests.push(nest);
  nestState.opened = layout;
  nestState.saved = nest;
  nestingService.showLayout(nest);
  partsViewService.update();
  layoutsService.markChanged(layout.id, changes.length > 0);
  if (changes.length > 0) {
    showNestBanner(
      `⚠ Some pieces have changed since <b>${escapeHtml(layout.name)}</b> was saved: ` +
        escapeHtml(pieceNames(changes).join("; ")) +
        ". It's drawn with the pieces as they are now, so they may overlap or not fit.",
      [
        {
          label: "Re-nest with the new pieces",
          run: () => {
            nestingService.clearNests();
            void nestingService.startNesting(undefined, false);
          },
        },
        { label: "Keep as saved", run: () => undefined },
      ],
    );
  } else {
    hideNestBanner();
  }
}

/**
 * Initialize config form change handlers
 */
function initializeConfigForm(): void {
  const inputs = document.querySelectorAll("#config input, #config select");

  inputs.forEach((i) => {
    const inputElement = i as HTMLInputElement | HTMLSelectElement;

    inputElement.addEventListener("change", () => {
      let val: string | number | boolean = inputElement.value;
      const key = inputElement.getAttribute("data-config") as
        | keyof UIConfig
        | null;

      if (!key) {
        return;
      }

      // Handle scale conversion
      if (key === "scale") {
        if (configService.getSync("units") === "mm") {
          val = Number(val) * 25.4; // Store scale config in inches
        }
      }

      // Handle boolean inputs (checkboxes)
      if (BOOLEAN_CONFIG_KEYS.includes(key)) {
        val = (inputElement as HTMLInputElement).checked;
      }

      // v1.3.0: inch-stored values (see the form fill above).
      if (inputElement.getAttribute("data-conversion") === "inch") {
        val =
          configService.getSync("units") === "mm"
            ? Number(val) / 25.4
            : Number(val);
      }

      // Handle unit conversion
      if (inputElement.getAttribute("data-conversion") === "true") {
        let conversion = configService.getSync("scale");
        if (configService.getSync("units") === "mm") {
          conversion /= 25.4;
        }
        val = Number(val) * conversion;
      }

      // Show spinner during save
      if (inputElement.parentNode) {
        (inputElement.parentNode as HTMLElement).className = "progress";
      }

      // Update config
      configService.setSync(key, val as UIConfig[typeof key]);
      const cfgValues = configService.getSync() as unknown as ConfigResult;
      getDeepNest().config(cfgValues);
      updateForm(cfgValues);

      // Remove spinner
      if (inputElement.parentNode) {
        (inputElement.parentNode as HTMLElement).className = "";
      }

      // Update unit-related Ractive bindings
      if (key === "units" && partsViewService) {
        partsViewService.updateUnits();
      }
      // v1.9.0: the cut-code settings change what the rows show.
      if (
        (key === "autoCutsFromCodes" || key === "equalCutsFuse") &&
        partsViewService
      ) {
        partsViewService.updateAutoCuts();
      }
    });

    // Config explanation hover handlers
    inputElement.onmouseover = () => {
      const configKey = inputElement.getAttribute("data-config");
      if (configKey) {
        document.querySelectorAll(".config_explain").forEach((el) => {
          el.className = "config_explain";
        });

        const selected = document.querySelector("#explain_" + configKey);
        if (selected) {
          selected.className = "config_explain active";
        }
      }
    };

    inputElement.onmouseleave = () => {
      document.querySelectorAll(".config_explain").forEach((el) => {
        el.className = "config_explain";
      });
    };
  });

  // Reset to defaults button
  const setDefaultBtn = getElement<HTMLElement>("#setdefault");
  if (setDefaultBtn) {
    setDefaultBtn.onclick = (e) => {
      e.preventDefault();

      // Preserve user profile
      const tempAccess = configService.getSync("access_token") as
        | string
        | undefined;
      const tempId = configService.getSync("id_token") as string | undefined;

      configService.resetToDefaultsSync();

      // Restore user profile
      if (tempAccess !== undefined) {
        configService.setSync("access_token", tempAccess);
      }
      if (tempId !== undefined) {
        configService.setSync("id_token", tempId);
      }

      const cfgValues = configService.getSync() as unknown as ConfigResult;
      getDeepNest().config(cfgValues);
      updateForm(cfgValues);
      if (partsViewService) partsViewService.updateAutoCuts();

      return false;
    };
  }

  // Add spinner elements to each form dd
  const ddElements = document.querySelectorAll("#configform dd");
  ddElements.forEach((d) => {
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    d.appendChild(spinner);
  });
}

/**
 * Initialize background progress handler
 */
function initializeBackgroundProgress(): void {
  ipcRenderer.on(
    IPC_CHANNELS.BACKGROUND_PROGRESS,
    (_event: unknown, ...args: unknown[]) => {
      const p = args[0] as NestingProgress;
      const bar = getElement<HTMLElement>("#progressbar");
      if (bar) {
        const progress = p.progress;
        const style = `width: ${parseInt(String(progress * 100))}%${progress < 0.01 ? "; transition: none" : ""}`;
        bar.setAttribute("style", style);
      }
    },
  );
}

/**
 * Initialize drag/drop prevention
 */
function initializeDragDropPrevention(): void {
  document.ondragover = document.ondrop = (ev) => {
    ev.preventDefault();
  };

  document.body.ondrop = (ev) => {
    ev.preventDefault();
  };
}

/**
 * Initialize message close handler
 */
function initializeMessageClose(): void {
  const messageClose = getElement<HTMLAnchorElement>("#message a.close");
  if (messageClose) {
    messageClose.onclick = () => {
      const wrapper = getElement<HTMLElement>("#messagewrapper");
      if (wrapper) {
        wrapper.className = "";
      }
      return false;
    };
  }
}

/**
 * Initialize parts list resize functionality
 */
function initializePartsResize(): void {
  // v1.1.1: restore the remembered parts-panel width (kept clear of the
  // window edge, in case the window is smaller than when it was saved).
  const savedWidth = loadLayout().partsWidth;
  const partsPanel = getElement<HTMLElement>("#parts");
  if (savedWidth && partsPanel) {
    partsPanel.style.width =
      Math.min(savedWidth, Math.max(300, window.innerWidth - 200)) + "px";
  }

  interact(".parts-drag")
    .resizable({
      preserveAspectRatio: false,
      edges: { left: false, right: true, bottom: false, top: false },
    })
    .on("resizemove", resize);

  window.addEventListener("resize", () => {
    resize();
  });

  // Initial resize
  resize();
}

/**
 * Initialize version info display
 */
function initializeVersionInfo(): void {
  try {
    const pjson = require("../package.json") as { version: string };
    const versionElement = getElement<HTMLElement>("#package-version");
    if (versionElement) {
      versionElement.innerText = pjson.version;
    }
  } catch {
    // Ignore if package.json is not accessible
  }
}

/**
 * Initialize all services
 */
async function initializeServices(): Promise<void> {
  // Create config service and set up window.config
  configService = await createConfigService(ipcRenderer);
  (
    window as unknown as {
      config: unknown;
      nest: unknown;
      loginWindow: unknown;
    }
  ).config = configService as unknown as ConfigObject;

  // Get config values and configure DeepNest
  const cfgValues = configService.getSync() as unknown as ConfigResult;
  getDeepNest().config(cfgValues);
  updateForm(cfgValues);
}

/**
 * Initialize all components
 */
function initializeComponents(): void {
  // Initialize navigation with dark mode
  navigationService = createNavigationService({ resizeCallback: resize });
  navigationService.initialize();

  // Initialize parts view
  partsViewService = createPartsViewService({
    deepNest: getDeepNest(),
    config: configService as unknown as ConfigObject,
    resizeCallback: resize,
  });
  partsViewService.initialize();

  // v1.10.0: saved layouts, listed above the pieces.
  layoutsService = new LayoutsService(
    getDeepNest(),
    configService as unknown as ConfigObject,
  );
  layoutsService.onOpen = openLayout;
  partsViewService.attachLayouts(layoutsService);
  // v1.11.0: views (the View menu above the saved layouts).
  viewsService = new ViewsService(getDeepNest(), layoutsService);
  partsViewService.attachViews(viewsService);

  // Initialize nest view
  nestViewService = createNestViewService({
    deepNest: getDeepNest(),
    config: configService as unknown as ConfigObject,
  });
  nestViewService.initialize();

  // Set window.nest reference for backward compatibility
  (
    window as unknown as {
      config: unknown;
      nest: unknown;
      loginWindow: unknown;
    }
  ).nest = nestViewService.getRactive();

  // Initialize sheet dialog
  sheetDialogService = createSheetDialogService({
    deepNest: getDeepNest(),
    config: configService as unknown as ConfigObject,
    // Use updatePartsCallback instead of ractive to avoid type conflicts
    updatePartsCallback: () => partsViewService.update(),
    resizeCallback: resize,
  });
  sheetDialogService.initialize();

  // Initialize import service
  importService = createImportService({
    dialog: electronRemote.dialog as unknown as {
      showOpenDialog: (
        options: unknown,
      ) => Promise<{ canceled: boolean; filePaths: string[] }>;
    },
    remote: electronRemote as unknown as {
      getGlobal: (name: string) => string | undefined;
    },
    fs: fs as unknown as {
      readFileSync: (path: string) => Buffer;
      readFile: (
        path: string,
        encoding: string,
        callback: (err: Error | null, data: string) => void,
      ) => void;
      readdirSync: (path: string) => string[];
    },
    path: path,
    deepNest: getDeepNest(),
    ractive:
      partsViewService.getRactive() as unknown as RactiveInstance<PartsViewData>,
    attachSortCallback: () => partsViewService.attachSort(),
    applyZoomCallback: () => partsViewService.applyZoom(),
    resizeCallback: resize,
  });

  // Initialize export service
  exportService = createExportService({
    dialog: electronRemote.dialog as unknown as {
      showSaveDialogSync: (options: {
        title: string;
        filters: { name: string; extensions: string[] }[];
      }) => string | undefined;
    },
    remote: electronRemote as unknown as {
      getGlobal: (name: string) => string | undefined;
    },
    fs: fs as unknown as {
      writeFileSync: (path: string, data: string) => void;
    },
    config: configService as unknown as {
      getSync: <K extends keyof UIConfig>(
        key?: K,
      ) => K extends keyof UIConfig ? UIConfig[K] : UIConfig;
    },
    deepNest: getDeepNest(),
  });

  // Initialize nesting service
  nestingService = createNestingService({
    fs: fs as unknown as {
      existsSync: (path: string) => boolean;
      readdirSync: (path: string) => string[];
      lstatSync: (path: string) => { isDirectory: () => boolean };
      unlinkSync: (path: string) => void;
      rmdirSync: (path: string) => void;
    },
    ipcRenderer: ipcRenderer as unknown as {
      send: (channel: string, ...args: unknown[]) => void;
    },
    deepNest: getDeepNest(),
    // Note: nestRactive set separately to avoid type conflicts
    displayNestFn: nestViewService.getDisplayNestCallback(),
    saveJsonFn: () => exportService.exportToJson(),
    prepareNestFn: prepareAutoCuts,
    beforeBackFn: beforeLeavingNest,
  });

  // Set nestRactive separately to avoid type conflicts
  const nestRactive = nestViewService.getRactive();
  if (nestRactive) {
    nestingService.setNestRactive(
      nestRactive as unknown as RactiveInstance<NestViewData>,
    );
  }

  nestingService.bindEventHandlers();

  // §9.3.3: project save/load. Depends on partsRactive + nestRactive
  // being available, so this comes after partsViewService and
  // nestViewService are both wired up above.
  projectService = createProjectService({
    dialog: electronRemote.dialog as unknown as {
      showSaveDialogSync: (options: {
        title: string;
        defaultPath?: string;
        filters: { name: string; extensions: string[] }[];
      }) => string | undefined;
      showOpenDialogSync: (options: {
        title: string;
        filters: { name: string; extensions: string[] }[];
        properties: "openFile"[];
      }) => string[] | undefined;
    },
    fs: fs as unknown as {
      writeFileSync: (path: string, data: string) => void;
      readFileSync: (path: string, encoding: string) => string;
    },
    deepNest: getDeepNest(),
    partsRactive:
      partsViewService.getRactive() as unknown as RactiveInstance<PartsViewData>,
    nestRactive:
      nestViewService.getRactive() as unknown as RactiveInstance<NestViewData>,
    onAfterLoad: () => {
      // Reattach UI bits that depend on the freshly-loaded parts and
      // imports — same set the import path runs after a successful
      // file import.
      partsViewService.attachSort();
      partsViewService.applyZoom();
      // §9.3.4: re-sync the nap checkbox with whatever the loaded
      // project's nap flag said (ProjectService set deepNest.nap
      // during applyLoadData).
      syncNapCheckboxFromDeepNest();
      partsViewService.refreshLayouts();
      resize();
    },
  });
}

/**
 * Initialize import button handler
 */
function initializeImportButton(): void {
  const importButton = getElement<HTMLElement>("#import");
  if (importButton) {
    importButton.onclick = async () => {
      if (
        importButton.className.includes("disabled") ||
        importButton.className.includes("spinner")
      ) {
        return false;
      }
      await importPatterns(() => importService.showImportDialog());
      return false;
    };
  }
}

/**
 * Imports patterns (the Import button, or v1.12.0 SVGs the Mac sends) with
 * the button showing it's busy. v1.11.0: with a view shown, asks whether
 * the new pieces join it.
 */
async function importPatterns(load: () => Promise<void>): Promise<void> {
  const importButton = getElement<HTMLElement>("#import");
  if (importButton) importButton.className = "button import spinner";
  try {
    const dn = getDeepNest();
    const before = dn.parts.length;
    const importsBefore = dn.imports.length;
    await load();
    const names = dn.imports
      .slice(importsBefore)
      .map((im) => im.filename)
      .join(", ");
    await viewsService.afterImport(dn.parts.slice(before), names);
  } finally {
    if (importButton) importButton.className = "button import";
  }
}

/**
 * v1.12.0: files the Mac sends Grain-Nest (double-click, Open With,
 * dropping on the Dock icon): a project (.gnp) opens as Open project does,
 * a sheets file (.gnsheets) adds its sheets, SVG patterns import as Import
 * does. On the nest screen it goes Back first (asking about an unsaved
 * layout). Batches are handled one after another.
 */
let openFilesQueue: Promise<void> = Promise.resolve();

function initializeOpenFiles(): void {
  ipcRenderer.on("open-files", (_event: unknown, ...args: unknown[]) => {
    const paths = (Array.isArray(args[0]) ? args[0] : []) as string[];
    openFilesQueue = openFilesQueue
      .then(() => openFiles(paths))
      .catch((e) => {
        console.error("[grainnest] open files", e);
        message(`Couldn't open the file: ${(e as Error).message}`, true);
      });
  });
  ipcRenderer.send("open-files-ready");
}

async function openFiles(paths: string[]): Promise<void> {
  const ext = (p: string) => path.extname(p).toLowerCase();
  const projects = paths.filter((p) => ext(p) === ".gnp");
  const sheets = paths.filter((p) => ext(p) === ".gnsheets");
  const svgs = paths.filter((p) => ext(p) === ".svg");
  const other = paths.filter(
    (p) => ![".gnp", ".gnsheets", ".svg"].includes(ext(p)),
  );
  if (other.length > 0) {
    message(
      `Grain-Nest opens SVG patterns, projects (.gnp) and sheets files (.gnsheets) — ${other
        .map((p) => `"${path.basename(p)}"`)
        .join(", ")} wasn't opened.`,
      true,
    );
  }
  if (projects.length + sheets.length + svgs.length === 0) return;
  if (nestingService.isNestScreenShown()) {
    if (!(await nestingService.leaveNestScreen())) return;
  }
  // A project replaces what's open, so it goes first; one at a time.
  if (projects.length > 0) {
    projectService.loadProjectFile(projects[projects.length - 1]);
    if (projects.length > 1) {
      message(
        `Opened ${path.basename(projects[projects.length - 1])}; a project at a time, so the other ${projects.length - 1} weren't opened.`,
        true,
      );
    }
  }
  for (const p of sheets) await openSheetsFile(p);
  if (svgs.length > 0) {
    await importPatterns(async () => {
      for (const p of svgs) await importService.processFile(p);
    });
  }
}

/** v1.12.0: adds a sheets file's sheets, and says what was added. */
async function openSheetsFile(filePath: string): Promise<void> {
  const name = path.basename(filePath);
  let text: string;
  try {
    text = (
      fs as { readFileSync: (p: string, enc: string) => string }
    ).readFileSync(filePath, "utf8");
  } catch (e) {
    message(`Couldn't read ${name}: ${(e as Error).message}`, true);
    return;
  }
  const r = parseSheetsFile(text);
  if (r.error) {
    message(`${name} wasn't opened: ${r.error}.`, true);
    return;
  }
  const added = sheetDialogService.addSheetsMm(r.sheets);
  const units = configService.getSync("units") as string;
  await showModal({
    title:
      added > 0
        ? `Added ${added} sheet${added === 1 ? "" : "s"}`
        : "No sheets added",
    text: [
      added > 0
        ? `From ${name}:`
        : `${name} has no sheets Grain-Nest could add.`,
      ...r.notes,
    ],
    list: r.sheets.map((s) => describeSheet(s, units)),
    buttons: [{ id: "ok", label: "OK", primary: true }],
  });
}

/**
 * §9.3.4: Initialize the Nap (directional) checkbox. Reads the
 * current DeepNest.nap value into the box on first render, and
 * writes back to DeepNest.nap on change. Exported for ProjectService
 * to call after a project load so the box reflects the freshly-
 * loaded nap state.
 */
function initializeNapCheckbox(): void {
  const cb = getElement<HTMLInputElement>("#napcheckbox");
  if (!cb) return;
  cb.checked = !!getDeepNest().nap;
  cb.addEventListener("change", () => {
    getDeepNest().nap = cb.checked;
  });
}

function syncNapCheckboxFromDeepNest(): void {
  const cb = getElement<HTMLInputElement>("#napcheckbox");
  if (cb) cb.checked = !!getDeepNest().nap;
  // v1.3.0: the Woven / Knit switch is project state too.
  const ft = getElement<HTMLSelectElement>("#fabrictype");
  if (ft) ft.value = getDeepNest().fabricType || "woven";
}

/**
 * v1.3.0: Woven / Knit switch. New pieces get that default seam
 * allowance; switching moves pieces still on the old default to the new
 * one and leaves hand-set seams alone.
 */
function initializeFabricTypeSelect(): void {
  const sel = getElement<HTMLSelectElement>("#fabrictype");
  if (!sel) return;
  sel.value = getDeepNest().fabricType || "woven";
  sel.addEventListener("change", () => {
    const dn = getDeepNest();
    const type = sel.value === "knit" ? "knit" : "woven";
    const n = dn.setFabricType(type);
    partsViewService?.update();
    const mm = dn.defaultSeamMm(type);
    message(
      `${type === "knit" ? "Knit" : "Woven"} project: new pieces get ${mm} mm seams` +
        (n > 0 ? `; ${n} piece(s) updated to ${mm} mm.` : "."),
      false,
    );
  });
}

// §9.3.10: the Warp-direction picker was removed in round 2 — patterns
// are always cut with the warp horizontal, and testers found the Vertical option
// more confusing than useful. DeepNest.warpDirection stays pinned to
// "horizontal" (its constructor default), so the cut-list length-axis
// and grain-lock target maths are unchanged; reinstating the control is
// just restoring the <select> in index.html and these two helpers.

/**
 * §9.3.3: Initialize Save / Open project button handlers.
 */
function initializeProjectButtons(): void {
  const saveBtn = getElement<HTMLElement>("#saveproject");
  if (saveBtn) {
    saveBtn.onclick = () => {
      projectService.saveProject();
      return false;
    };
  }
  const openBtn = getElement<HTMLElement>("#openproject");
  if (openBtn) {
    openBtn.onclick = () => {
      projectService.loadProject();
      return false;
    };
  }
}

/**
 * §9.5 / phase-5z: Initialize the "Clear all" / reset-workspace button.
 * Removes every imported part and resets the workspace to empty. The action
 * is destructive and has no undo, so it asks for confirmation first.
 */
function initializeClearAllButton(): void {
  const btn = getElement<HTMLElement>("#clearall");
  if (!btn) return;
  btn.onclick = () => {
    const dn = getDeepNest();
    if (dn.parts.length === 0 && dn.imports.length === 0) {
      message("Workspace is already empty — nothing to clear.", false);
      return false;
    }
    if (
      !window.confirm(
        "This will remove all imported parts and reset the workspace. Continue?",
      )
    ) {
      return false;
    }
    // Clear engine state. These three arrays are the whole workspace — the
    // same set project.service.resetWorkspace() empties on project load.
    dn.imports.length = 0;
    dn.parts.length = 0;
    dn.nests.length = 0;
    dn.nestJob = "all"; // phase-r8a: an empty workspace has no nest job
    layoutsService.clear(); // v1.10.0
    clearViews(dn); // v1.11.0
    // Refresh the parts table + import preview.
    const partsRactive = partsViewService.getRactive() as unknown as {
      update(keypath?: string): Promise<void>;
      set(keypath: string, value: unknown): Promise<void>;
    } | null;
    if (partsRactive) {
      partsRactive.set("nestJob", "all");
      partsRactive.update("imports");
      partsRactive.update("parts");
    }
    // Clear the imperative nest preview (#nestsvg) + reset its stats — a
    // Ractive update alone won't touch it (it's drawn imperatively into #nestsvg).
    nestViewService.clearDisplay();
    message("Workspace cleared.", false);
    return false;
  };
}

/**
 * Initialize export button handlers
 */
function initializeExportButtons(): void {
  // JSON export
  const exportJsonBtn = getElement<HTMLElement>("#exportjson");
  if (exportJsonBtn) {
    exportJsonBtn.onclick = () => {
      exportService.exportToJson();
      return false;
    };
  }

  // v1.8.0: exporting a layout that left pieces out asks first.
  const okToExport = (): boolean => {
    const dn = getDeepNest();
    const nest = dn.nests.find((n) => n.selected);
    if (!nest) return true;
    const placed = piecesPlaced(nest);
    const total = piecesToPlace(dn);
    if (placed >= total) return true;
    const missing = total - placed;
    return window.confirm(
      `This layout only fits ${placed} of ${total} pattern pieces — ` +
        `${missing} ${missing === 1 ? "piece is" : "pieces are"} missing from it.\n\n` +
        "Export it anyway?",
    );
  };

  // v1.10.0: Save layout (nest screen).
  const saveLayoutBtn = getElement<HTMLElement>("#savelayout");
  if (saveLayoutBtn) {
    saveLayoutBtn.onclick = () => {
      void saveShownLayout();
      return false;
    };
  }

  // SVG export
  const exportSvgBtn = getElement<HTMLElement>("#exportsvg");
  if (exportSvgBtn) {
    exportSvgBtn.onclick = () => {
      if (okToExport()) exportService.exportToSvg();
      return false;
    };
  }

  // §9.3.7: Cut-list (text) export
  const exportCutListBtn = getElement<HTMLElement>("#exportcutlist");
  if (exportCutListBtn) {
    exportCutListBtn.onclick = () => {
      if (okToExport()) exportService.exportToCutList();
      return false;
    };
  }
}

/**
 * Load initial SVG files from nest directory
 */
async function loadInitialFiles(): Promise<void> {
  await importService.loadNestDirectoryFiles();
}

/**
 * Main initialization function
 * Called when the DOM is ready
 */
async function initialize(): Promise<void> {
  // Round-2 Mac diagnostics (2026-05-19): each require() and each
  // initializeX() is wrapped so failures show in console with a
  // [grainnest:boot] prefix AND in a visible page banner. The
  // previous unwrapped sequence threw silently on whatever Mac
  // Electron-40 patch was installed, killing every later
  // handler binding and leaving the app in a "renders but dead
  // buttons" state. Per-step wrapping means we now know which line.
  const log = (...a: unknown[]): void => {
    console.log("[grainnest:boot]", ...a);
  };
  const fail = (step: string, err: unknown): void => {
    console.error("[grainnest:boot]", step, "FAILED:", err);
    showInitBanner(step, err);
  };

  // Load required Electron and Node.js modules. Each require is in
  // its own try/catch so we know exactly which dependency failed if
  // the chain breaks.
  try {
    log("require electron");
    const electron = require("electron") as { ipcRenderer: IpcRenderer };
    ipcRenderer = electron.ipcRenderer;
  } catch (e) {
    fail("require('electron')", e);
    return;
  }
  try {
    log("require @electron/remote");
    electronRemote = require("@electron/remote") as typeof electronRemote;
  } catch (e) {
    fail("require('@electron/remote')", e);
    return;
  }
  try {
    log("require graceful-fs");
    fs = require("graceful-fs");
  } catch (e) {
    fail("require('graceful-fs')", e);
    return;
  }
  try {
    log("require path");
    path = require("path") as typeof path;
  } catch (e) {
    fail("require('path')", e);
    return;
  }

  // Disable Ractive debug mode
  Ractive.DEBUG = false;

  // Initialize services and UI handlers. Each step is wrapped so a
  // failure in one initializer doesn't silently skip every later one;
  // we log which step failed and continue trying the rest. Result: a
  // partial init produces a partially-usable app + a banner naming the
  // broken step, instead of an apparently-working app with most
  // handlers dead.
  const step = async (
    label: string,
    fn: () => void | Promise<void>,
  ): Promise<void> => {
    try {
      log(label);
      await fn();
    } catch (e) {
      fail(label, e);
      // Deliberately do NOT return — keep trying later steps so the
      // user gets as much functionality as possible.
    }
  };

  await step("initializeServices", () => initializeServices());
  await step("initializeComponents", () => initializeComponents());
  await step("initializeConfigForm", () => initializeConfigForm());
  await step("initializeBackgroundProgress", () =>
    initializeBackgroundProgress(),
  );
  await step("initializeDragDropPrevention", () =>
    initializeDragDropPrevention(),
  );
  await step("initializeMessageClose", () => initializeMessageClose());
  await step("initializePartsResize", () => initializePartsResize());
  await step("initializePartsColumnResize", () => setupPartsColumnResize());
  await step("initializeVersionInfo", () => initializeVersionInfo());
  await step("initializeImportButton", () => initializeImportButton());
  await step("initializeProjectButtons", () => initializeProjectButtons());
  await step("initializeClearAllButton", () => initializeClearAllButton());
  await step("initializeNapCheckbox", () => initializeNapCheckbox());
  await step("initializeFabricTypeSelect", () => initializeFabricTypeSelect());
  await step("initializeExportButtons", () => initializeExportButtons());
  await step("initializeOpenFiles", () => initializeOpenFiles());

  // Load initial files from nest directory
  await step("loadInitialFiles", () => loadInitialFiles());

  // Set up loginWindow reference
  (
    window as unknown as {
      config: unknown;
      nest: unknown;
      loginWindow: unknown;
    }
  ).loginWindow = null;
}

// Start initialization when DOM is ready
ready(initialize);

/**
 * Export service instances for external access if needed
 */
export {
  configService,
  importService,
  exportService,
  nestingService,
  navigationService,
  partsViewService,
  nestViewService,
  sheetDialogService,
};
