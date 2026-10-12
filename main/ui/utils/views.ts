/**
 * v1.11.0: views — named sets of pieces in a project (a pattern's views,
 * an expansion, a mix-and-match). Picking a view in the Saved layouts
 * panel shows and nests only its pieces; "All pieces" shows everything.
 * Sheets aren't in views (they always show). A piece can be in several
 * views. Saved layouts belong to the view they were saved in.
 *
 * Pieces are referred to by their session id (`grainnestId`, see
 * saved-layouts.ts pieceId); in the project file, by their position in
 * the saved parts list.
 */

import type { DeepNestInstance } from "../types/index.js";
import type { Part } from "../../../index.d.ts";
import { pieceId } from "./saved-layouts.js";

export interface PieceView {
  id: string;
  name: string;
  /** Session ids of the pieces in the view. */
  pids: number[];
}

/** In the project file: piece positions instead of session ids. */
export interface PieceViewFile {
  id: string;
  name: string;
  parts: number[];
}

type Engine = DeepNestInstance & {
  pieceViews?: PieceView[];
  currentViewId?: string | null;
};

export function viewsOf(dn: DeepNestInstance): PieceView[] {
  const e = dn as Engine;
  if (!e.pieceViews) e.pieceViews = [];
  return e.pieceViews;
}

export function currentView(dn: DeepNestInstance): PieceView | null {
  const id = (dn as Engine).currentViewId;
  return (id && viewsOf(dn).find((v) => v.id === id)) || null;
}

/** Whether a part shows (and nests) in the current view. */
export function inCurrentView(dn: DeepNestInstance, p: Part): boolean {
  if (p.sheet) return true;
  const view = currentView(dn);
  if (!view) return true;
  const real = (p.autoCopy && (p.autoCopyOf as Part | undefined)) || p;
  return real.grainnestId !== undefined && view.pids.includes(real.grainnestId);
}

/** Marks the pieces outside the current view (`outOfView`). */
export function refreshViewFlags(dn: DeepNestInstance): void {
  for (const p of dn.parts) {
    if (inCurrentView(dn, p)) delete p.outOfView;
    else p.outOfView = true;
  }
}

/** Shows a view (null = All pieces). */
export function setCurrentView(dn: DeepNestInstance, id: string | null): void {
  (dn as Engine).currentViewId =
    id && viewsOf(dn).some((v) => v.id === id) ? id : null;
  refreshViewFlags(dn);
}

/** How many of the project's pieces are in a view (deleted ones aside). */
export function viewCount(dn: DeepNestInstance, view: PieceView): number {
  const live = new Set(
    dn.parts.filter((p) => !p.sheet && !p.autoCopy).map((p) => p.grainnestId),
  );
  return view.pids.filter((pid) => live.has(pid)).length;
}

function newId(): string {
  return `V${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A new view of these pieces. */
export function addView(
  dn: DeepNestInstance,
  name: string,
  parts: Part[],
): PieceView {
  const view: PieceView = {
    id: newId(),
    name,
    pids: parts.filter((p) => !p.sheet).map((p) => pieceId(dn, p)),
  };
  viewsOf(dn).push(view);
  return view;
}

/** What replacing a view's pieces with these would add and take out. */
export function viewDiff(
  dn: DeepNestInstance,
  view: PieceView,
  parts: Part[],
): { added: Part[]; removed: Part[] } {
  const now = new Set(parts.filter((p) => !p.sheet).map((p) => pieceId(dn, p)));
  const added = parts.filter(
    (p) => !p.sheet && !view.pids.includes(pieceId(dn, p)),
  );
  const removed = dn.parts.filter(
    (p) =>
      !p.sheet &&
      !p.autoCopy &&
      p.grainnestId !== undefined &&
      view.pids.includes(p.grainnestId) &&
      !now.has(p.grainnestId),
  );
  return { added, removed };
}

export function replaceViewPieces(
  dn: DeepNestInstance,
  view: PieceView,
  parts: Part[],
): void {
  view.pids = parts.filter((p) => !p.sheet).map((p) => pieceId(dn, p));
  refreshViewFlags(dn);
}

/** Adds pieces to a view (after importing more into it). */
export function addToView(
  dn: DeepNestInstance,
  view: PieceView,
  parts: Part[],
): void {
  for (const p of parts) {
    if (p.sheet) continue;
    const pid = pieceId(dn, p);
    if (!view.pids.includes(pid)) view.pids.push(pid);
  }
  refreshViewFlags(dn);
}

export function removeView(dn: DeepNestInstance, id: string): void {
  const views = viewsOf(dn);
  const i = views.findIndex((v) => v.id === id);
  if (i >= 0) views.splice(i, 1);
  if ((dn as Engine).currentViewId === id) setCurrentView(dn, null);
}

/** Forgets every view (Clear all, loading a project). */
export function clearViews(dn: DeepNestInstance): void {
  viewsOf(dn).length = 0;
  (dn as Engine).currentViewId = null;
  refreshViewFlags(dn);
}

export function viewsForFile(
  dn: DeepNestInstance,
  savedIndexOfPid: Map<number, number>,
): { views: PieceViewFile[]; currentView?: string } {
  const views = viewsOf(dn).map((v) => ({
    id: v.id,
    name: v.name,
    parts: v.pids
      .map((pid) => savedIndexOfPid.get(pid))
      .filter((i): i is number => i !== undefined),
  }));
  const cur = currentView(dn);
  return { views, currentView: cur ? cur.id : undefined };
}

export function viewsFromFile(
  dn: DeepNestInstance,
  views: PieceViewFile[] | undefined,
  current: string | undefined,
  partAtSavedIndex: (i: number) => Part | undefined,
): void {
  const list = viewsOf(dn);
  list.length = 0;
  for (const v of views || []) {
    list.push({
      id: v.id,
      name: v.name,
      pids: v.parts
        .map((i) => partAtSavedIndex(i))
        .filter((p): p is Part => !!p)
        .map((p) => pieceId(dn, p)),
    });
  }
  setCurrentView(dn, current ?? null);
}
