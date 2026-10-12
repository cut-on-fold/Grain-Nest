/**
 * v1.10.0: saved layouts — the Save layout, Rename and Delete dialogs,
 * folders by fabric, and the rows the parts panel lists. The layouts
 * themselves live on DeepNest (utils/saved-layouts.ts) and are saved with
 * the project.
 */

import type {
  ConfigObject,
  DeepNestInstance,
  SelectableNestingResult,
} from "../types/index.js";
import { SHEET_FABRICS } from "../utils/nest-jobs.js";
import { widthTag } from "../utils/file-names.js";
import { showModal } from "../utils/modal.js";
import {
  captureLayout,
  formatLengthMm,
  lastNestOf,
  layoutsOf,
  setLastNest,
  type SavedLayout,
} from "../utils/saved-layouts.js";

/** One row of the Saved layouts panel. */
export interface LayoutRow {
  id: string;
  name: string;
  meta: string;
  unsaved: boolean;
  changed: boolean;
}

export interface LayoutFolder {
  fabric: string;
  label: string;
  open: boolean;
  rows: LayoutRow[];
}

const LAST_NEST_ID = "last-nest";

export class LayoutsService {
  private deepNest: DeepNestInstance;
  private config: ConfigObject;
  /** Called whenever the list changes (the panel redraws). */
  onChange: () => void = () => {};
  /** Opens a layout on the nest screen (set by the app). */
  onOpen: (layout: SavedLayout) => void = () => {};
  /** Folders closed in the panel. */
  private closed = new Set<string>();
  /** Layouts whose pieces changed (shown with ⚠), by id. */
  private changedIds = new Set<string>();

  constructor(deepNest: DeepNestInstance, config: ConfigObject) {
    this.deepNest = deepNest;
    this.config = config;
  }

  private units(): string {
    return this.config.getSync("units") === "mm" ? "mm" : "inch";
  }

  private scale(): number {
    return (this.config.getSync("scale") as number) || 96;
  }

  folderLabel(fabric: string): string {
    if (!fabric) return "No fabric set";
    return SHEET_FABRICS.find((f) => f.id === fabric)?.label ?? fabric;
  }

  private meta(l: SavedLayout, withFabric: boolean): string {
    const bits: string[] = [];
    if (withFabric) bits.push(this.folderLabel(l.fabric));
    bits.push(formatLengthMm(l.lengthMm, this.units()));
    bits.push(`${l.placed}/${l.total}`);
    return bits.join(" · ");
  }

  /** v1.11.0: whether a layout belongs to the view being shown. */
  private inView(l: SavedLayout): boolean {
    const cur = (this.deepNest as { currentViewId?: string | null })
      .currentViewId;
    return (l.view ?? null) === (cur ?? null);
  }

  /** The layouts of the view being shown. */
  private shownLayouts(): SavedLayout[] {
    return layoutsOf(this.deepNest).filter((l) => this.inView(l));
  }

  /** How many layouts a view has (for the Delete view warning). */
  countInView(viewId: string): number {
    return layoutsOf(this.deepNest).filter((l) => l.view === viewId).length;
  }

  /** v1.11.0: deleting a view deletes its layouts. */
  removeLayoutsOfView(viewId: string): void {
    const layouts = layoutsOf(this.deepNest);
    for (let i = layouts.length - 1; i >= 0; i--) {
      if (layouts[i].view === viewId) layouts.splice(i, 1);
    }
    const last = lastNestOf(this.deepNest);
    if (last && last.view === viewId) setLastNest(this.deepNest, null);
    this.onChange();
  }

  /** The panel's contents: Last nest first, then a folder per fabric. */
  folders(): { last: LayoutRow | null; folders: LayoutFolder[] } {
    const lastAny = lastNestOf(this.deepNest);
    const lastLayout = lastAny && this.inView(lastAny) ? lastAny : null;
    const last = lastLayout
      ? {
          id: LAST_NEST_ID,
          name: "Last nest (not saved)",
          meta: this.meta(lastLayout, true),
          unsaved: true,
          changed: false,
        }
      : null;
    const order = SHEET_FABRICS.map((f) => f.id as string);
    const byFabric = new Map<string, SavedLayout[]>();
    for (const l of this.shownLayouts()) {
      byFabric.set(l.fabric, [...(byFabric.get(l.fabric) ?? []), l]);
    }
    const fabrics = [...byFabric.keys()].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    const folders = fabrics.map((fabric) => ({
      fabric,
      label: this.folderLabel(fabric),
      open: !this.closed.has(fabric),
      rows: byFabric
        .get(fabric)!
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => ({
          id: l.id,
          name: l.name,
          meta: this.meta(l, false),
          unsaved: false,
          changed: this.changedIds.has(l.id),
        })),
    }));
    return { last, folders };
  }

  hasAny(): boolean {
    return !!lastNestOf(this.deepNest) || layoutsOf(this.deepNest).length > 0;
  }

  /** Anything to list in the view being shown. */
  hasShown(): boolean {
    const last = lastNestOf(this.deepNest);
    return (!!last && this.inView(last)) || this.shownLayouts().length > 0;
  }

  toggleFolder(fabric: string): void {
    if (this.closed.has(fabric)) this.closed.delete(fabric);
    else this.closed.add(fabric);
    this.onChange();
  }

  find(id: string): SavedLayout | undefined {
    if (id === LAST_NEST_ID) return lastNestOf(this.deepNest) ?? undefined;
    return layoutsOf(this.deepNest).find((l) => l.id === id);
  }

  markChanged(id: string, changed: boolean): void {
    if (changed) this.changedIds.add(id);
    else this.changedIds.delete(id);
    this.onChange();
  }

  /** "Navy twill_58in": the first sheet's name (or fabric) and width. */
  defaultName(nest: SelectableNestingResult): string {
    const first = nest.placements[0];
    const sheet = first ? this.deepNest.parts[first.sheet] : undefined;
    if (!sheet) return "Layout";
    const base =
      (sheet.name || "").trim() ||
      (sheet.fabric ? this.folderLabel(sheet.fabric) : "Fabric");
    return `${base}_${widthTag(sheet.bounds.height, this.units(), this.scale())}`;
  }

  private defaultFabric(nest: SelectableNestingResult): string {
    const first = nest.placements[0];
    const sheet = first ? this.deepNest.parts[first.sheet] : undefined;
    return (sheet && sheet.fabric) || "";
  }

  /** The layout on screen as Last nest (not saved); replaces the old one. */
  keepAsLastNest(nest: SelectableNestingResult): void {
    setLastNest(
      this.deepNest,
      captureLayout(
        this.deepNest,
        nest,
        "Last nest (not saved)",
        this.defaultFabric(nest),
        this.scale(),
      ),
    );
    this.onChange();
  }

  /**
   * Asks for a name and folder; when the name is taken in that folder,
   * Replace / Save as a new name / Cancel. Resolves to the saved layout
   * (or null if cancelled).
   */
  private async askNameAndStore(
    makeLayout: (name: string, fabric: string) => SavedLayout,
    name: string,
    fabric: string,
  ): Promise<SavedLayout | null> {
    for (;;) {
      const r = await showModal({
        title: "Save layout",
        text: [
          "Keeps this layout in the project, so you can open and export it again without re-nesting.",
        ],
        input: { label: "Name", value: name },
        select: {
          label: "Folder (the sheet's fabric)",
          options: SHEET_FABRICS.map((f) => ({
            value: f.id,
            label: f.id ? f.label : "No fabric set",
          })),
          value: fabric,
        },
        buttons: [
          { id: "cancel", label: "Cancel" },
          { id: "save", label: "Save", primary: true },
        ],
      });
      if (r.button !== "save") return null;
      name = r.input || name;
      fabric = r.select ?? fabric;
      const layouts = layoutsOf(this.deepNest);
      const same = layouts.find(
        (l) =>
          this.inView(l) &&
          l.fabric === fabric &&
          l.name.toLowerCase() === name.toLowerCase(),
      );
      if (same) {
        const d = await showModal({
          title: `Replace "${same.name}"?`,
          text: [
            `There's already a saved layout called ${same.name} in ${this.folderLabel(fabric)} (${formatLengthMm(same.lengthMm, this.units())}, saved ${new Date(same.savedAt).toLocaleDateString()}).`,
          ],
          buttons: [
            { id: "cancel", label: "Cancel" },
            { id: "rename", label: "Save as a new name" },
            { id: "replace", label: "Replace", primary: true },
          ],
        });
        if (d.button === "rename") continue;
        if (d.button !== "replace") return null;
        layouts.splice(layouts.indexOf(same), 1);
      }
      const layout = makeLayout(name, fabric);
      layouts.push(layout);
      this.closed.delete(fabric);
      this.onChange();
      return layout;
    }
  }

  /** Save layout (nest screen): the layout on screen. */
  saveNest(nest: SelectableNestingResult): Promise<SavedLayout | null> {
    return this.askNameAndStore(
      (name, fabric) =>
        captureLayout(this.deepNest, nest, name, fabric, this.scale()),
      this.defaultName(nest),
      this.defaultFabric(nest),
    );
  }

  /** Save (on the Last nest row): keeps it under a name. */
  async saveLastNest(): Promise<SavedLayout | null> {
    const last = lastNestOf(this.deepNest);
    if (!last) return null;
    const saved = await this.askNameAndStore(
      (name, fabric) => ({
        ...last,
        id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name,
        fabric,
        savedAt: new Date().toISOString(),
      }),
      this.suggestedNameFor(last),
      last.fabric,
    );
    if (saved) {
      setLastNest(this.deepNest, null);
      this.onChange();
    }
    return saved;
  }

  /** The default name for a stored layout (its first sheet and width). */
  private suggestedNameFor(l: SavedLayout): string {
    const sheet = this.deepNest.parts.find(
      (p) => p.grainnestId === l.sheets[0]?.sheet && p.sheet,
    );
    if (!sheet) return "Layout";
    const base =
      (sheet.name || "").trim() ||
      (sheet.fabric ? this.folderLabel(sheet.fabric) : "Fabric");
    return `${base}_${widthTag(sheet.bounds.height, this.units(), this.scale())}`;
  }

  async rename(id: string): Promise<void> {
    const l = this.find(id);
    if (!l || id === LAST_NEST_ID) return;
    const r = await showModal({
      title: "Rename layout",
      input: { label: "Name", value: l.name },
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "ok", label: "Rename", primary: true },
      ],
    });
    if (r.button === "ok" && r.input) {
      l.name = r.input;
      this.onChange();
    }
  }

  async remove(id: string): Promise<void> {
    const l = this.find(id);
    if (!l) return;
    const r = await showModal({
      title: `Delete "${l.name}"?`,
      text: [
        "The saved layout is removed from the project. Your pieces aren't changed.",
      ],
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "delete", label: "Delete", primary: true },
      ],
    });
    if (r.button !== "delete") return;
    if (id === LAST_NEST_ID) setLastNest(this.deepNest, null);
    else {
      const layouts = layoutsOf(this.deepNest);
      layouts.splice(layouts.indexOf(l), 1);
    }
    this.onChange();
  }

  open(id: string): void {
    const l = this.find(id);
    if (l) this.onOpen(l);
  }

  /** Forget every layout (Clear all, or before loading a project). */
  clear(): void {
    layoutsOf(this.deepNest).length = 0;
    setLastNest(this.deepNest, null);
    this.changedIds.clear();
    this.onChange();
  }
}
