/**
 * v1.13.0: the Flaws box on a sheet's row — add flaws measured from a
 * corner (round or rectangle), see them drawn to scale on the sheet, remove
 * them. Keeps each sheet's flaw outlines (appFlawPolys) and the red shapes
 * shown on the sheet (in its svgelements) up to date. The maths is in
 * utils/flaws.ts.
 */

import type { Part } from "../../../index.d.ts";
import type { ConfigObject } from "../types/index.js";
import { escapeHtml as esc } from "../utils/modal.js";
import {
  FLAW_CORNERS,
  describeFlaw,
  flawPolygon,
  polygonPath,
  unitsPerMm,
  validFlaw,
  type Pt,
  type SheetFlaw,
} from "../utils/flaws.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FLAW_STYLE =
  "stroke: #c0392b !important; stroke-width: 1.2px !important; fill: rgba(192,57,43,0.25) !important; fill-opacity: 1 !important;";

type Config = ConfigObject;

export class FlawsService {
  private config: Config;
  /** Called after flaws change (the list and preview redraw). */
  onChange: () => void = () => {};

  constructor(config: Config) {
    this.config = config;
  }

  private perMm(): number {
    return unitsPerMm(Number(this.config.getSync("scale")) || 72);
  }

  /** Recomputes a sheet's flaw outlines and the red shapes drawn on it. */
  refresh(part: Part): void {
    const flaws = (part.flaws || []) as SheetFlaw[];
    const perMm = this.perMm();
    part.appFlawPolys = flaws
      .filter(validFlaw)
      .map((f) => flawPolygon(f, part.bounds, perMm));
    part.svgelements = (part.svgelements || []).filter(
      (el) => !(el.getAttribute && el.getAttribute("data-grainnest-appflaw")),
    );
    for (const poly of part.appFlawPolys) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", polygonPath(poly));
      path.setAttribute("data-grainnest-appflaw", "1");
      path.setAttribute("style", FLAW_STYLE);
      part.svgelements.push(path as unknown as SVGElement);
    }
  }

  /** After a project loads: every sheet's flaws. */
  refreshAll(parts: Part[]): void {
    for (const p of parts)
      if (p.sheet && p.flaws && p.flaws.length) this.refresh(p);
  }

  /** The Flaws box. Resolves when it's closed. */
  show(part: Part): Promise<void> {
    return new Promise((resolve) => {
      const units = String(this.config.getSync("units") || "inch");
      const metric = units === "mm";
      const unit = metric ? "cm" : "in";
      const toMm = (v: number) => (metric ? v * 10 : v * 25.4);
      const perMm = this.perMm();
      if (!part.flaws) part.flaws = [];
      const flaws = part.flaws as SheetFlaw[];

      const back = document.createElement("div");
      back.className = "gn-modal-back";
      const corners = FLAW_CORNERS.map(
        (c) => `<option value="${c.id}">${esc(c.label)}</option>`,
      ).join("");
      const sheetName = (part.name || "").trim() || "this sheet";
      back.innerHTML = `<div class="gn-modal gn-flaws" role="dialog">
        <h2>Flaws on ${esc(sheetName)}</h2>
        <svg class="fl-draw" width="396" height="150"></svg>
        <div class="fl-row"><span>Measured from</span><select class="fl-corner">${corners}</select></div>
        <div class="fl-row"><span>Along the length</span><input class="fl-along" type="number" min="0" step="any" /> ${unit}</div>
        <div class="fl-row"><span>In from the edge</span><input class="fl-in" type="number" min="0" step="any" /> ${unit}</div>
        <div class="fl-row"><span>Shape</span><select class="fl-shape"><option value="round">Round</option><option value="rect">Rectangle</option></select></div>
        <div class="fl-row"><span class="fl-size-label">Size across</span><input class="fl-size" type="number" min="0" step="any" /> ${unit}</div>
        <div class="fl-row fl-rect-w" hidden><span>Width across</span><input class="fl-width" type="number" min="0" step="any" /> ${unit}</div>
        <p class="fl-hint">Measure to the middle of the flaw. Pieces keep the usual gap from it.</p>
        <div class="btns"><button type="button" class="sec fl-add">Add flaw</button></div>
        <div class="fl-list"></div>
        <div class="btns"><button type="button" class="pri fl-done">Done</button></div>
      </div>`;
      document.body.appendChild(back);

      const $ = <T extends Element>(sel: string) =>
        back.querySelector(sel) as unknown as T;
      const corner = $<HTMLSelectElement>(".fl-corner");
      const along = $<HTMLInputElement>(".fl-along");
      const inn = $<HTMLInputElement>(".fl-in");
      const shape = $<HTMLSelectElement>(".fl-shape");
      const size = $<HTMLInputElement>(".fl-size");
      const width = $<HTMLInputElement>(".fl-width");
      const sizeLabel = $<HTMLElement>(".fl-size-label");
      const rectW = $<HTMLElement>(".fl-rect-w");
      const draw = $<SVGSVGElement>(".fl-draw");
      const list = $<HTMLElement>(".fl-list");

      const pending = (): SheetFlaw => ({
        corner: corner.value as SheetFlaw["corner"],
        alongMm: toMm(Number(along.value)),
        inMm: toMm(Number(inn.value)),
        shape: shape.value === "rect" ? "rect" : "round",
        sizeMm: toMm(Number(size.value)),
        widthMm: shape.value === "rect" ? toMm(Number(width.value)) : undefined,
      });
      const filled = () =>
        along.value !== "" &&
        inn.value !== "" &&
        size.value !== "" &&
        (shape.value !== "rect" || width.value !== "");

      const redraw = (): void => {
        const b = part.bounds;
        const pad = 6;
        const k = Math.min(
          (396 - 2 * pad) / b.width,
          (150 - 2 * pad) / b.height,
        );
        const map = (p: Pt) =>
          ({ x: pad + (p.x - b.x) * k, y: pad + (p.y - b.y) * k }) as Pt;
        const outline = polygonPath(
          (part.polygontree as unknown as Pt[]).map(map),
        );
        const shapes: string[] = [];
        const add = (poly: Pt[], n: string, dashed = false) => {
          const m = poly.map(map);
          const cx = Math.max(...m.map((p) => p.x));
          const cy = Math.min(...m.map((p) => p.y));
          shapes.push(
            `<path d="${polygonPath(m)}" fill="rgba(192,57,43,.25)" stroke="#c0392b" stroke-width="1.5"${dashed ? ' stroke-dasharray="3 2"' : ""}/>` +
              (n
                ? `<text x="${cx + 3}" y="${cy + 8}" font-size="10" fill="#c0392b">${n}</text>`
                : ""),
          );
        };
        (part.fileFlaws || []).forEach((f) => add(f as Pt[], ""));
        flaws.forEach((f, i) => {
          if (validFlaw(f)) add(flawPolygon(f, b, perMm), String(i + 1));
        });
        if (filled() && validFlaw(pending()))
          add(flawPolygon(pending(), b, perMm), "", true);
        const cornerDot = {
          tl: [pad, pad],
          tr: [pad + b.width * k, pad],
          bl: [pad, pad + b.height * k],
          br: [pad + b.width * k, pad + b.height * k],
        }[corner.value as SheetFlaw["corner"]];
        draw.innerHTML =
          `<rect x="${pad}" y="${pad}" width="${b.width * k}" height="${b.height * k}" fill="none" stroke="#d3c8e3" stroke-dasharray="2 3"/>` +
          `<path d="${outline}" fill="#f4f0fa" stroke="#3b1f6e" stroke-width="1.5"/>` +
          shapes.join("") +
          `<circle cx="${cornerDot[0]}" cy="${cornerDot[1]}" r="5" fill="#9ed35b"/>`;
        list.innerHTML = flaws.length
          ? flaws
              .map(
                (f, i) =>
                  `<div class="fl-item"><span>${i + 1} · ${esc(describeFlaw(f, units))}</span><a href="#" data-i="${i}" class="fl-remove">Remove</a></div>`,
              )
              .join("")
          : "";
        list.querySelectorAll<HTMLAnchorElement>(".fl-remove").forEach((a) => {
          a.onclick = (e) => {
            e.preventDefault();
            flaws.splice(Number(a.dataset.i), 1);
            this.refresh(part);
            this.onChange();
            redraw();
          };
        });
      };

      shape.onchange = () => {
        const rect = shape.value === "rect";
        rectW.hidden = !rect;
        sizeLabel.textContent = rect ? "Length along" : "Size across";
        redraw();
      };
      [corner, along, inn, size, width].forEach((el) => {
        el.addEventListener("input", redraw);
        el.addEventListener("change", redraw);
      });
      $<HTMLButtonElement>(".fl-add").onclick = () => {
        const f = pending();
        if (!filled() || !validFlaw(f)) {
          [along, inn, size, width].forEach((el) =>
            el.classList.toggle(
              "error",
              el.value === "" || Number(el.value) < 0,
            ),
          );
          return;
        }
        flaws.push(f);
        along.value = inn.value = size.value = width.value = "";
        this.refresh(part);
        this.onChange();
        redraw();
        along.focus();
      };
      const finish = () => {
        document.removeEventListener("keydown", onKey, true);
        back.remove();
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish();
        }
      };
      document.addEventListener("keydown", onKey, true);
      $<HTMLButtonElement>(".fl-done").onclick = finish;
      redraw();
      along.focus();
    });
  }
}
