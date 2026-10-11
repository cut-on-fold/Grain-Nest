/**
 * Configuration Service
 * Manages application configuration with synchronous get/set interface
 * and persists settings via IPC to the main process
 */

import type {
  UIConfig,
  ConfigObject,
  PlacementType,
  UnitType,
} from "../types/index.js";
import { DEFAULT_CONVERSION_SERVER, IPC_CHANNELS } from "../types/index.js";

// Type for IPC renderer - available in Electron context
interface IpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Default configuration values
 * Scale and distances are stored in native units (inches)
 */
export const DEFAULT_CONFIG: Readonly<UIConfig> = {
  units: "inch" as UnitType,
  scale: 96, // units/inch — 96 matches Inkscape / CSS px DPI (phase-5r, testing round 4). Was 72 (PostScript points).
  spacing: 0,
  curveTolerance: 0.72, // store distances in native units
  clipperScale: 10000000,
  rotations: 4,
  threads: 4,
  populationSize: 10,
  mutationRate: 10,
  // v1.7.0: Gravity (least fabric length) by default; Squeeze is retired.
  placementType: "gravity" as PlacementType, // gravity or box
  // v1.3.0: the laser-cutting options are retired (settings review):
  // no line merging, and nests are scored on fabric only. Forced on load by
  // retireSettings(), whatever an older settings file says.
  mergeLines: false,
  timeRatio: 0,
  simplify: false,
  dxfImportScale: 1,
  dxfExportScale: 1,
  endpointTolerance: 0.36,
  conversionServer: DEFAULT_CONVERSION_SERVER,
  useSvgPreProcessor: false,
  useQuantityFromFileName: false,
  // v1.3.0: on by default — the border is what you line up the
  // projector with.
  exportWithSheetBoundboarders: true,
  exportWithSheetsSpace: false,
  exportWithSheetsSpaceValue: 0.3937007874015748, // 10mm in inches
  // §9.3.8 (Phase 5j): calibration box on every SVG export so the
  // user can verify print/projection scale at a glance.
  exportScalingBox: true,
  exportScalingBoxSizeInches: 4,
  // v1.5.0: every line in the export is the same width (mm) and the cut,
  // sew and grain lines and the sheet border each have a colour — the
  // app's aubergine and moss by default. v1.6.0: the border is cyan — a
  // white one vanished in Pattern Projector (white page, or inverted to
  // black), a mid-bright colour shows either way.
  exportLineWidthMm: 2,
  exportCutColour: "#3b1f6e",
  exportSewColour: "#4f8a26",
  exportGrainColour: "#4f8a26",
  exportBorderColour: "#00ffff",
  // §9.3.9 / phase-5r: default per-piece seam allowance (mm) applied to
  // imported pieces, so sew lines appear by default (testing round 4).
  defaultSeamAllowanceMm: 12,
  // v1.3.0: knits default to 10 mm. Which one new pieces get is the
  // project's Woven / Knit switch (DeepNest.fabricType).
  defaultSeamAllowanceKnitMm: 10,
  // v1.9.0: pairs and folds worked out from the cut codes in piece names
  // ("C2M", "C1MOF"); equal main & interfacing counts bulk-fuse.
  autoCutsFromCodes: true,
  equalCutsFuse: "fuse",
  // v1.3.0: bumped when saved settings need a one-off migration.
  settingsRevision: 3,
};

/**
 * Keys that represent boolean configuration values (checkboxes in UI)
 */
export const BOOLEAN_CONFIG_KEYS: ReadonlyArray<keyof UIConfig> = [
  "mergeLines",
  "simplify",
  "useSvgPreProcessor",
  "useQuantityFromFileName",
  "exportWithSheetBoundboarders",
  "exportWithSheetsSpace",
  "exportScalingBox",
  "autoCutsFromCodes",
];

/**
 * Configuration Service class
 * Provides synchronous-style get/set interface for configuration management
 * Follows the pattern from main/deepnest.js ES6 class structure
 */
export class ConfigService implements ConfigObject {
  /** IPC renderer for communicating with main process */
  private ipcRenderer: IpcRenderer | null = null;

  /** Current configuration values */
  private config: UIConfig;

  /** Whether the service has been initialized */
  private initialized = false;

  // Implement UIConfig properties on the instance
  units: UnitType;
  scale: number;
  spacing: number;
  curveTolerance: number;
  clipperScale: number;
  rotations: number;
  threads: number;
  populationSize: number;
  mutationRate: number;
  placementType: PlacementType;
  mergeLines: boolean;
  timeRatio: number;
  simplify: boolean;
  dxfImportScale: number;
  dxfExportScale: number;
  endpointTolerance: number;
  conversionServer: string;
  useSvgPreProcessor: boolean;
  useQuantityFromFileName: boolean;
  exportWithSheetBoundboarders: boolean;
  exportWithSheetsSpace: boolean;
  exportWithSheetsSpaceValue: number;
  exportScalingBox: boolean;
  exportScalingBoxSizeInches: number;
  access_token?: string;
  id_token?: string;

  /**
   * Create a new ConfigService instance
   * @param ipcRenderer - Electron IPC renderer for persistence (optional for testing)
   */
  constructor(ipcRenderer?: IpcRenderer) {
    this.ipcRenderer = ipcRenderer || null;
    this.config = { ...DEFAULT_CONFIG };

    // Initialize all properties from config
    this.units = this.config.units;
    this.scale = this.config.scale;
    this.spacing = this.config.spacing;
    this.curveTolerance = this.config.curveTolerance;
    this.clipperScale = this.config.clipperScale;
    this.rotations = this.config.rotations;
    this.threads = this.config.threads;
    this.populationSize = this.config.populationSize;
    this.mutationRate = this.config.mutationRate;
    this.placementType = this.config.placementType;
    this.mergeLines = this.config.mergeLines;
    this.timeRatio = this.config.timeRatio;
    this.simplify = this.config.simplify;
    this.dxfImportScale = this.config.dxfImportScale;
    this.dxfExportScale = this.config.dxfExportScale;
    this.endpointTolerance = this.config.endpointTolerance;
    this.conversionServer = this.config.conversionServer;
    this.useSvgPreProcessor = this.config.useSvgPreProcessor;
    this.useQuantityFromFileName = this.config.useQuantityFromFileName;
    this.exportWithSheetBoundboarders =
      this.config.exportWithSheetBoundboarders;
    this.exportWithSheetsSpace = this.config.exportWithSheetsSpace;
    this.exportWithSheetsSpaceValue = this.config.exportWithSheetsSpaceValue;
    this.exportScalingBox = this.config.exportScalingBox;
    this.exportScalingBoxSizeInches = this.config.exportScalingBoxSizeInches;
  }

  /**
   * Initialize the service by loading persisted configuration
   * Must be called before using the service
   * @returns Promise that resolves when initialization is complete
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.ipcRenderer) {
      try {
        const savedConfig = (await this.ipcRenderer.invoke(
          IPC_CHANNELS.READ_CONFIG,
        )) as Partial<UIConfig> | null;

        if (savedConfig && typeof savedConfig === "object") {
          this.mergeConfig(savedConfig);
          this.retireSettings(savedConfig);
        }
      } catch {
        // If reading fails, continue with defaults
        // Error handling should be done at the application level
      }
    }

    this.initialized = true;
  }

  /**
   * v1.3.0 (settings review): settings removed from the Settings
   * page keep their harmless value even if an older settings file says
   * otherwise — no laser line-merging, fabric-only scoring, no rough
   * shapes, no SVG normaliser (it strips Inkscape labels), no quantity
   * from filenames, no Squeeze packing (v1.7.0). One-off migrations: the
   * sheet border defaults to on (v1.3.0), a white border becomes cyan
   * (v1.6.0) and Bounding box packing becomes Gravity (v1.7.0).
   */
  private retireSettings(saved: Partial<UIConfig>): void {
    this.setConfigValue("mergeLines", false);
    this.setConfigValue("timeRatio", 0);
    this.setConfigValue("simplify", false);
    this.setConfigValue("useSvgPreProcessor", false);
    this.setConfigValue("useQuantityFromFileName", false);
    if ((saved.settingsRevision ?? 0) < 1) {
      this.setConfigValue("exportWithSheetBoundboarders", true);
      this.setConfigValue("settingsRevision", 1);
    }
    // v1.6.0: the old white border default becomes cyan.
    if ((saved.settingsRevision ?? 0) < 2) {
      if ((saved.exportBorderColour ?? "#ffffff").toLowerCase() === "#ffffff")
        this.setConfigValue("exportBorderColour", "#00ffff");
      this.setConfigValue("settingsRevision", 2);
    }
    // v1.7.0: Gravity becomes the default; the old Bounding box default
    // switches over once (a later choice of Bounding box is kept).
    if ((saved.settingsRevision ?? 0) < 3) {
      if ((saved.placementType ?? "box") === "box")
        this.setConfigValue("placementType", "gravity");
      this.setConfigValue("settingsRevision", 3);
    }
    // v1.7.0: Squeeze is retired (no use for fabric).
    if (this.config.placementType === "convexhull")
      this.setConfigValue("placementType", "gravity");
  }

  /**
   * Merge saved configuration with current config
   * @param savedConfig - Configuration object to merge
   */
  private mergeConfig(savedConfig: Partial<UIConfig>): void {
    for (const key in savedConfig) {
      if (Object.prototype.hasOwnProperty.call(savedConfig, key)) {
        const typedKey = key as keyof UIConfig;
        const value = savedConfig[typedKey];
        if (value !== undefined) {
          this.setConfigValue(typedKey, value);
        }
      }
    }
  }

  /**
   * Set a configuration value with proper type handling
   * @param key - The configuration key
   * @param value - The value to set
   */
  private setConfigValue<K extends keyof UIConfig>(
    key: K,
    value: UIConfig[K],
  ): void {
    // Use Object.assign to bypass strict type checking for dynamic assignment
    Object.assign(this.config, { [key]: value });
    Object.assign(this, { [key]: value });
  }

  /**
   * Synchronize instance properties with internal config object
   */
  private syncFromConfig(): void {
    this.units = this.config.units;
    this.scale = this.config.scale;
    this.spacing = this.config.spacing;
    this.curveTolerance = this.config.curveTolerance;
    this.clipperScale = this.config.clipperScale;
    this.rotations = this.config.rotations;
    this.threads = this.config.threads;
    this.populationSize = this.config.populationSize;
    this.mutationRate = this.config.mutationRate;
    this.placementType = this.config.placementType;
    this.mergeLines = this.config.mergeLines;
    this.timeRatio = this.config.timeRatio;
    this.simplify = this.config.simplify;
    this.dxfImportScale = this.config.dxfImportScale;
    this.dxfExportScale = this.config.dxfExportScale;
    this.endpointTolerance = this.config.endpointTolerance;
    this.conversionServer = this.config.conversionServer;
    this.useSvgPreProcessor = this.config.useSvgPreProcessor;
    this.useQuantityFromFileName = this.config.useQuantityFromFileName;
    this.exportWithSheetBoundboarders =
      this.config.exportWithSheetBoundboarders;
    this.exportWithSheetsSpace = this.config.exportWithSheetsSpace;
    this.exportWithSheetsSpaceValue = this.config.exportWithSheetsSpaceValue;
    this.exportScalingBox = this.config.exportScalingBox;
    this.exportScalingBoxSizeInches = this.config.exportScalingBoxSizeInches;
    this.access_token = this.config.access_token;
    this.id_token = this.config.id_token;
  }

  /**
   * Get a configuration value or the entire config object
   * Maintains compatibility with electron-settings style interface
   * @param key - Optional key to retrieve specific value
   * @returns The value for the key, or entire config if no key provided
   */
  getSync<K extends keyof UIConfig>(
    key?: K,
  ): K extends keyof UIConfig ? UIConfig[K] : UIConfig {
    if (key === undefined) {
      return { ...this.config } as K extends keyof UIConfig
        ? UIConfig[K]
        : UIConfig;
    }
    return this.config[key] as K extends keyof UIConfig
      ? UIConfig[K]
      : UIConfig;
  }

  /**
   * Set configuration values
   * Maintains compatibility with electron-settings style interface
   * @param keyOrObject - Key to set, or object with multiple values
   * @param value - Value to set (when keyOrObject is a string)
   */
  setSync<K extends keyof UIConfig>(
    keyOrObject: K | Partial<UIConfig>,
    value?: UIConfig[K],
  ): void {
    if (typeof keyOrObject === "object") {
      // Set multiple values from object
      for (const key in keyOrObject) {
        if (Object.prototype.hasOwnProperty.call(keyOrObject, key)) {
          const typedKey = key as keyof UIConfig;
          const val = keyOrObject[typedKey];
          if (val !== undefined) {
            Object.assign(this.config, { [typedKey]: val });
          }
        }
      }
    } else if (typeof keyOrObject === "string" && value !== undefined) {
      // Set single value
      Object.assign(this.config, { [keyOrObject]: value });
    }

    // Sync instance properties
    this.syncFromConfig();

    // Persist to storage asynchronously
    this.persist();
  }

  /**
   * Reset all configuration to default values
   * Preserves access_token and id_token (user profile)
   */
  resetToDefaultsSync(): void {
    // Preserve user profile tokens
    const tempAccess = this.config.access_token;
    const tempId = this.config.id_token;

    // Reset to defaults
    this.config = { ...DEFAULT_CONFIG };

    // Restore user profile
    if (tempAccess !== undefined) {
      this.config.access_token = tempAccess;
    }
    if (tempId !== undefined) {
      this.config.id_token = tempId;
    }

    // Sync instance properties
    this.syncFromConfig();

    // Persist to storage
    this.persist();
  }

  /**
   * Persist current configuration to storage via IPC
   * Called automatically after setSync operations
   */
  private persist(): void {
    if (this.ipcRenderer) {
      // Fire and forget - don't await
      this.ipcRenderer
        .invoke(IPC_CHANNELS.WRITE_CONFIG, JSON.stringify(this.config, null, 2))
        .catch(() => {
          // Silently ignore persistence errors
          // Application should handle this at a higher level if needed
        });
    }
  }

  /**
   * Check if a key represents a boolean configuration value
   * @param key - Configuration key to check
   * @returns True if the key is a boolean config
   */
  static isBooleanKey(key: string): boolean {
    return BOOLEAN_CONFIG_KEYS.includes(key as keyof UIConfig);
  }

  /**
   * Get the conversion factor based on current units
   * @returns Conversion factor for SVG units
   */
  getConversionFactor(): number {
    const conversion = this.config.scale;
    if (this.config.units === "mm") {
      return conversion / 25.4;
    }
    return conversion;
  }

  /**
   * Convert a value from user units to SVG units
   * @param value - Value in user units
   * @returns Value in SVG units
   */
  toSvgUnits(value: number): number {
    return value * this.getConversionFactor();
  }

  /**
   * Convert a value from SVG units to user units
   * @param value - Value in SVG units
   * @returns Value in user units
   */
  fromSvgUnits(value: number): number {
    return value / this.getConversionFactor();
  }

  /**
   * Get scale value adjusted for current unit setting
   * @returns Scale value in current units
   */
  getScaleInUnits(): number {
    if (this.config.units === "mm") {
      return this.config.scale / 25.4;
    }
    return this.config.scale;
  }

  /**
   * Set scale from a value in current units
   * @param scaleInUnits - Scale value in current units (mm or inch)
   */
  setScaleFromUnits(scaleInUnits: number): void {
    let scaleValue = scaleInUnits;
    if (this.config.units === "mm") {
      scaleValue *= 25.4; // Store scale config in inches
    }
    this.setSync("scale", scaleValue);
  }

  /**
   * Create a ConfigObject that can be assigned to window.config
   * This creates a proxy-like object that maintains backward compatibility
   * @param ipcRenderer - Electron IPC renderer
   * @returns Promise resolving to ConfigObject
   */
  static async create(ipcRenderer: IpcRenderer): Promise<ConfigService> {
    const service = new ConfigService(ipcRenderer);
    await service.initialize();
    return service;
  }
}

/**
 * Factory function to create and initialize the config service
 * @param ipcRenderer - Electron IPC renderer
 * @returns Promise resolving to initialized ConfigService
 */
export async function createConfigService(
  ipcRenderer: IpcRenderer,
): Promise<ConfigService> {
  return ConfigService.create(ipcRenderer);
}

/**
 * Type guard to check if a value is a valid PlacementType
 * @param value - Value to check
 * @returns True if the value is a valid PlacementType
 */
export function isValidPlacementType(value: unknown): value is PlacementType {
  return value === "gravity" || value === "box" || value === "convexhull";
}

/**
 * Type guard to check if a value is a valid UnitType
 * @param value - Value to check
 * @returns True if the value is a valid UnitType
 */
export function isValidUnitType(value: unknown): value is UnitType {
  return value === "mm" || value === "inch";
}
