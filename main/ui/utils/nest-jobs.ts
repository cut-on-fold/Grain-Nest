/**
 * Round 8 / phase-r8a: nest jobs — choose which pieces go into a nest from
 * the cut codes in their names, without deleting the rest.
 *
 * Dressmaking context: one garment is usually cut from several
 * fabrics — the main ("fashion") fabric, lining, ribbing, interfacing (a
 * stiffening layer ironed onto some pieces). Each fabric is a separate
 * nest. Pieces are named like "16 Hood Facing C2M C2I" where each code is
 * C<count><material>[OF]: "C2M" = cut 2 main, "C1IOF" = cut 1 interfacing on
 * the fold. The rules for which nest a piece belongs to (round 8):
 *
 * - Main:        any M code, unless the piece is Fused (below).
 * - Fused:       same number of M and I (e.g. C2M C2I). A block of main fabric
 *                is bulk-fused with interfacing and these are cut from
 *                it, because interfacing pieces cut separately warp.
 * - Interfacing: fewer I than M (e.g. C2M C1I — the 1I is cut separately and
 *                halved), interfacing-only pieces (no M), and every piece
 *                named "INT<n> …" (pattern interfacing pieces).
 * - Lining:      any L code.        - Ribbing: any R code.
 * - All:         everything (the only job that includes pieces without
 *                recognised codes).
 *
 * Counts are NOT used to set quantities: a "cut 2" piece is normally a
 * piece plus its mirror copy (two rows sharing a name), so jobs only switch
 * rows in or out (`part.excluded`). Pure functions, no DOM — unit-testable.
 */

export type NestJob =
  | "all"
  | "main"
  | "fused"
  | "interfacing"
  | "lining"
  | "ribbing";

/** Picker order and labels. */
export const NEST_JOBS: { id: NestJob; label: string }[] = [
  { id: "all", label: "All pieces" },
  { id: "main", label: "Main fabric" },
  { id: "fused", label: "Fused (main + interfacing)" },
  { id: "interfacing", label: "Interfacing" },
  { id: "lining", label: "Lining" },
  { id: "ribbing", label: "Ribbing" },
];

/** Cut counts per material letter found in a piece name, e.g. {M: 2, I: 1}. */
export type CutCounts = Record<string, number>;

const CUT_CODE = /(?:^|[\s_,;(])C(\d+)([A-Z])(?:OF)?(?=$|[\s_,;)])/g;

/** Parse "C2M C1IOF"-style cut codes out of a piece name. */
export function parseCutCodes(name: string | undefined | null): CutCounts {
  const counts: CutCounts = {};
  if (!name) return counts;
  for (const m of name.matchAll(CUT_CODE)) {
    const n = parseInt(m[1], 10);
    counts[m[2]] = (counts[m[2]] || 0) + n;
  }
  return counts;
}

/** True for pattern interfacing pieces named "INT1 …" / "INT 2 …". */
export function isInterfacingPiece(name: string | undefined | null): boolean {
  return !!name && /^\s*INT\s*\d+\b/i.test(name);
}

/** The nest jobs (other than "all") a piece with this name belongs to. */
export function jobsForName(name: string | undefined | null): Set<NestJob> {
  const c = parseCutCodes(name);
  const M = c.M || 0;
  const I = c.I || 0;
  const jobs = new Set<NestJob>();
  const fused = M > 0 && I > 0 && M === I;
  if (fused) jobs.add("fused");
  else if (M > 0) jobs.add("main");
  if (isInterfacingPiece(name) || (I > 0 && !fused)) jobs.add("interfacing");
  if ((c.L || 0) > 0) jobs.add("lining");
  if ((c.R || 0) > 0) jobs.add("ribbing");
  return jobs;
}

/**
 * v1.2.0: the fabric a sheet is for (a drop-down per sheet; one job
 * can use several sheets; Fused has its own sheet). "" = not set.
 */
export type SheetFabric = Exclude<NestJob, "all"> | "";

/** Fabric drop-down options for sheets. */
export const SHEET_FABRICS: { id: SheetFabric; label: string }[] = [
  { id: "", label: "Fabric…" },
  { id: "main", label: "Main fabric" },
  { id: "fused", label: "Fused" },
  { id: "interfacing", label: "Interfacing" },
  { id: "lining", label: "Lining" },
  { id: "ribbing", label: "Ribbing" },
];

/** Minimal part shape this module needs (structurally matches Part). */
interface JobPart {
  name?: string;
  sheet?: boolean;
  excluded?: boolean;
  fabric?: string;
}

/** What applying a job changed. */
export interface NestJobResult {
  /** Pieces (not sheets) now included. */
  included: number;
  /**
   * Sheets ticked for the job — `null` when no sheet is set to this
   * job's fabric (or the job is "all"), in which case sheet ticks were
   * left exactly as they were.
   */
  sheets: number | null;
}

/**
 * Apply a job: include exactly the pieces belonging to it, and — v1.2.0 —
 * tick exactly the sheets whose Fabric is that job (every one of them),
 * unticking the rest. "All pieces", or a job no sheet is set to, leaves the
 * sheet ticks alone rather than leave the nest with no fabric.
 */
export function applyNestJob<P extends JobPart>(
  parts: P[],
  job: NestJob,
  // v1.9.0: with pairs & folds from cut codes, each piece's Fuse choice
  // decides between Main, Fused and Interfacing (auto-cuts jobsForPiece).
  jobsOf: (p: P) => Set<NestJob> = (p) => jobsForName(p.name),
): NestJobResult {
  let included = 0;
  for (const p of parts) {
    if (p.sheet) continue;
    p.excluded = job === "all" ? false : !jobsOf(p).has(job);
    if (!p.excluded) included++;
  }
  const sheets = parts.filter((p) => p.sheet);
  const matching = sheets.filter((p) => job !== "all" && p.fabric === job);
  if (matching.length === 0) return { included, sheets: null };
  for (const s of sheets) s.excluded = s.fabric !== job;
  return { included, sheets: matching.length };
}

/** Number of non-sheet pieces currently included. */
export function countIncluded(parts: JobPart[]): number {
  return parts.filter((p) => !p.sheet && !p.excluded).length;
}
