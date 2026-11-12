/**
 * v1.14.0: a project file holds its drawings already scaled into the
 * app's units, at the Settings → Advanced "SVG scale" (units per inch) in
 * force when it was saved. Opened at another scale, every length in the
 * file is multiplied by new ÷ old here, before anything is loaded, so real
 * sizes stay what they were. (Before, the file didn't record its scale and
 * nothing was rescaled: a 100 mm piece saved at 96 reopened at 72 as
 * 133 mm.)
 *
 * Pure: no DOM beyond the parser handed in, no app state.
 */

interface XY {
  x0: number;
  y0: number;
}

/** The parts of a project file that hold lengths in app units. */
export interface ScalableProject {
  scale?: number;
  imports: { svg: string }[];
  parts: {
    source: { kind: string; widthSvgUnits?: number; heightSvgUnits?: number };
    foldLine?: XY;
    markedFold?: XY;
  }[];
  layouts?: ScalableLayout[];
  lastNest?: ScalableLayout;
}

interface ScalableLayout {
  sheets: { placements: { x: number; y: number }[] }[];
  pieces: Record<string, { w: number; h: number }>;
}

/**
 * The factor to bring a file saved at `fileScale` to `currentScale`, or 1
 * when the file doesn't say (older files: taken to be at the current
 * scale, as before) or the two agree.
 */
export function scaleFactor(
  fileScale: number | undefined,
  currentScale: number,
): number {
  const from = Number(fileScale);
  const to = Number(currentScale);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0)
    return 1;
  const k = to / from;
  return Math.abs(k - 1) < 1e-9 ? 1 : k;
}

/** A saved drawing scaled by `k`: a transform on its root, and its viewBox. */
export function scaleSvg(svg: string, k: number): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg") return svg;
  const own = root.getAttribute("transform");
  root.setAttribute("transform", `scale(${k})${own ? " " + own : ""}`);
  const viewBox = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/);
  if (viewBox.length >= 4 && viewBox.every((v) => Number.isFinite(Number(v)))) {
    root.setAttribute(
      "viewBox",
      viewBox
        .slice(0, 4)
        .map((v) => String(Number(v) * k))
        .join(" "),
    );
  }
  return new XMLSerializer().serializeToString(doc);
}

function scaleLayout(layout: ScalableLayout, k: number): void {
  for (const sheet of layout.sheets || []) {
    for (const p of sheet.placements || []) {
      p.x *= k;
      p.y *= k;
    }
  }
  for (const piece of Object.values(layout.pieces || {})) {
    piece.w = Math.round(piece.w * k * 10) / 10;
    piece.h = Math.round(piece.h * k * 10) / 10;
  }
}

/** Multiplies every length in the project data by `k`, in place. */
export function rescaleProject(data: ScalableProject, k: number): void {
  if (k === 1) return;
  for (const im of data.imports || []) im.svg = scaleSvg(im.svg, k);
  for (const part of data.parts || []) {
    const src = part.source;
    if (src.kind === "sheet-rect") {
      if (typeof src.widthSvgUnits === "number") src.widthSvgUnits *= k;
      if (typeof src.heightSvgUnits === "number") src.heightSvgUnits *= k;
    }
    for (const line of [part.foldLine, part.markedFold]) {
      if (line) {
        line.x0 *= k;
        line.y0 *= k;
      }
    }
  }
  for (const layout of data.layouts || []) scaleLayout(layout, k);
  if (data.lastNest) scaleLayout(data.lastNest, k);
}
