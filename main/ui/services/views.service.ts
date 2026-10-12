/**
 * v1.11.0: views — Save as view, the View menu in the Saved layouts
 * panel, Rename / Delete, and "add the new pieces to this view?" after
 * an import. The views themselves are in utils/views.ts.
 */

import type { DeepNestInstance } from "../types/index.js";
import type { Part } from "../../../index.d.ts";
import { showModal } from "../utils/modal.js";
import {
  addToView,
  addView,
  currentView,
  refreshViewFlags,
  removeView,
  replaceViewPieces,
  setCurrentView,
  viewCount,
  viewDiff,
  viewsOf,
} from "../utils/views.js";
import type { LayoutsService } from "./layouts.service.js";

export interface ViewOption {
  id: string;
  name: string;
  count: number;
}

const listNames = (parts: Part[], max = 8): string => {
  const names = parts.map((p) => p.name || p.filename || "a piece");
  return (
    names.slice(0, max).join(", ") +
    (names.length > max ? ` and ${names.length - max} more` : "")
  );
};

export class ViewsService {
  private deepNest: DeepNestInstance;
  private layouts: LayoutsService;
  /** Called when the views or the view shown change (the list redraws). */
  onChange: () => void = () => {};

  constructor(deepNest: DeepNestInstance, layouts: LayoutsService) {
    this.deepNest = deepNest;
    this.layouts = layouts;
  }

  /** For the View menu. */
  options(): { all: number; list: ViewOption[]; current: string } {
    const all = this.deepNest.parts.filter(
      (p) => !p.sheet && !p.autoCopy,
    ).length;
    const list = viewsOf(this.deepNest).map((v) => ({
      id: v.id,
      name: v.name,
      count: viewCount(this.deepNest, v),
    }));
    const cur = currentView(this.deepNest);
    return { all, list, current: cur ? cur.id : "" };
  }

  /** Done with the selection once it's a view. */
  private deselect(): void {
    for (const p of this.deepNest.parts) p.selected = false;
  }

  hasViews(): boolean {
    return viewsOf(this.deepNest).length > 0;
  }

  /** Shows a view ("" = All pieces). */
  choose(id: string): void {
    setCurrentView(this.deepNest, id || null);
    // Pieces not shown shouldn't stay selected (Delete, Apply to selected).
    for (const p of this.deepNest.parts) {
      if (p.outOfView) p.selected = false;
    }
    this.onChange();
  }

  /** Keeps the flags right after pieces are added or removed. */
  refresh(): void {
    refreshViewFlags(this.deepNest);
  }

  /** Save as view…: the selected pieces, as a new view or replacing one. */
  async saveAsView(): Promise<void> {
    const selected = this.deepNest.parts.filter(
      (p) => p.selected && !p.sheet && !p.autoCopy,
    );
    if (selected.length === 0) {
      await showModal({
        title: "Save as view",
        text: [
          "Select the pieces for the view first (click their rows), then click Save as view.",
        ],
        buttons: [{ id: "ok", label: "OK", primary: true }],
      });
      return;
    }
    const views = viewsOf(this.deepNest);
    const NEW = "__new";
    const r = await showModal({
      title: "Save as view",
      text: [
        "A view is a set of pieces you can pick from the View menu above your saved layouts (a pattern view, an expansion, a mix-and-match). Only its pieces show and nest.",
        `${selected.length} piece${selected.length === 1 ? "" : "s"} selected: ${listNames(selected)}.`,
      ],
      input: {
        label: "Name (for a new view)",
        value: `View ${views.length + 1}`,
      },
      select: views.length
        ? {
            label: "Save as",
            options: [
              { value: NEW, label: "A new view" },
              ...views.map((v) => ({
                value: v.id,
                label: `Replace ${v.name} (${viewCount(this.deepNest, v)} pieces)`,
              })),
            ],
            value: NEW,
          }
        : undefined,
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "save", label: "Save view", primary: true },
      ],
    });
    if (r.button !== "save") return;
    const target = r.select && r.select !== NEW ? r.select : null;
    if (!target) {
      const name = (r.input || "").trim() || `View ${views.length + 1}`;
      const view = addView(this.deepNest, name, selected);
      setCurrentView(this.deepNest, view.id);
      this.deselect();
      this.onChange();
      return;
    }
    const view = views.find((v) => v.id === target);
    if (!view) return;
    const { added, removed } = viewDiff(this.deepNest, view, selected);
    const n = this.layouts.countInView(view.id);
    const text = [
      `${view.name} will have the ${selected.length} piece${selected.length === 1 ? "" : "s"} selected.`,
    ];
    if (added.length) text.push(`Adds: ${listNames(added)}.`);
    if (removed.length) text.push(`Takes out: ${listNames(removed)}.`);
    if (!added.length && !removed.length) text.push("No pieces change.");
    if (n > 0)
      text.push(
        `Its ${n} saved layout${n === 1 ? "" : "s"} stay${n === 1 ? "s" : ""}, and will say the pieces have changed when opened.`,
      );
    const c = await showModal({
      title: `Replace "${view.name}"?`,
      text,
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "replace", label: "Replace", primary: true },
      ],
    });
    if (c.button !== "replace") return;
    replaceViewPieces(this.deepNest, view, selected);
    setCurrentView(this.deepNest, view.id);
    this.deselect();
    this.onChange();
  }

  async renameCurrent(): Promise<void> {
    const view = currentView(this.deepNest);
    if (!view) return;
    const r = await showModal({
      title: "Rename view",
      input: { label: "Name", value: view.name },
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "ok", label: "Rename", primary: true },
      ],
    });
    if (r.button === "ok" && r.input) view.name = r.input;
    this.onChange();
  }

  /** Deletes the view shown, and its saved layouts. */
  async deleteCurrent(): Promise<void> {
    const view = currentView(this.deepNest);
    if (!view) return;
    const n = this.layouts.countInView(view.id);
    const r = await showModal({
      title: `Delete "${view.name}"?`,
      text: [
        n > 0
          ? `Its ${n} saved layout${n === 1 ? " is" : "s are"} deleted too. Your pieces aren't deleted; they're still in All pieces.`
          : "Your pieces aren't deleted; they're still in All pieces.",
      ],
      buttons: [
        { id: "cancel", label: "Cancel" },
        {
          id: "delete",
          label: n > 0 ? "Delete view and layouts" : "Delete view",
          primary: true,
        },
      ],
    });
    if (r.button === "delete") {
      this.layouts.removeLayoutsOfView(view.id);
      removeView(this.deepNest, view.id);
    }
    this.onChange();
  }

  /**
   * After an import: when a view is shown, asks whether to add the new
   * pieces to it (they're in All pieces either way).
   */
  async afterImport(newParts: Part[], fileNames: string): Promise<void> {
    const view = currentView(this.deepNest);
    const pieces = newParts.filter((p) => !p.sheet);
    if (view && pieces.length > 0) {
      const r = await showModal({
        title: `Add the new pieces to ${view.name}?`,
        text: [
          `${pieces.length} piece${pieces.length === 1 ? " was" : "s were"} imported${fileNames ? ` from ${fileNames}` : ""}: ${listNames(pieces)}. They're in All pieces either way.`,
        ],
        buttons: [
          { id: "no", label: "Don't add" },
          { id: "add", label: `Add to ${view.name}`, primary: true },
        ],
      });
      if (r.button === "add") addToView(this.deepNest, view, pieces);
    }
    refreshViewFlags(this.deepNest);
    this.onChange();
  }
}
