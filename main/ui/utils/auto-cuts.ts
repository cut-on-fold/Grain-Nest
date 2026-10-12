/**
 * v1.9.0: pairs and folds from cut codes.
 *
 * With "Pairs & folds from cut codes" on (Settings), each piece stays one
 * row in the parts list and its copies are worked out when a nest starts,
 * from the cut codes in its name ("C2M" = cut 2 main, "C1MOF" = cut 1 main
 * on the fold, "C2M C1I" = 2 main and 1 interfacing):
 *
 * - How many: the count for the fabric being nested ("Nest for").
 * - Mirrored: half of them, rounded down (C2 = a left/right pair; C3 = 2
 *   one way and 1 mirrored). A piece can set its own number ("Mirrored").
 * - On the fold: an OF code folds the piece; folded pieces aren't
 *   mirrored.
 * - Main + interfacing: each piece's Fuse choice decides how the main
 *   pieces split between the main fabric and the bulk-fused block:
 *     all       - every main piece is cut from the fused block
 *     one       - as many as there are interfacing pieces are fused, the
 *                 rest are plain main fabric
 *     separate  - main pieces from main fabric, interfacing cut on its own
 *   Defaults: equal counts (C2M C2I) bulk-fuse (or "separate", by the
 *   Settings default); fewer interfacing (C2M C1I) separate.
 *
 * Pure functions over the piece's name and its two choices; no DOM.
 */

import type { NestJob } from "./nest-jobs.js";

export type FuseMode = "all" | "one" | "separate";

/** One material's code: how many, and whether on the fold. */
export interface CutCode {
  count: number;
  fold: boolean;
}

/** Codes per material letter, e.g. { M: {count: 2, fold: false} }. */
export type CutCodes = Record<string, CutCode>;

const CUT_CODE = /(?:^|[\s_,;(])C(\d+)([A-Z])(OF)?(?=$|[\s_,;)])/g;

export function parseCuts(name: string | undefined | null): CutCodes {
  const codes: CutCodes = {};
  if (!name) return codes;
  for (const m of name.matchAll(CUT_CODE)) {
    const letter = m[2];
    const prev = codes[letter];
    codes[letter] = {
      count: (prev ? prev.count : 0) + parseInt(m[1], 10),
      fold: (prev ? prev.fold : false) || !!m[3],
    };
  }
  return codes;
}

/** True for pattern interfacing pieces named "INT1 …" / "INT 2 …". */
export function isInterfacingPiece(name: string | undefined | null): boolean {
  return !!name && /^\s*INT\s*\d+\b/i.test(name);
}

/** The piece fields these rules read. */
export interface AutoCutPiece {
  name?: string;
  /** "all" | "one" | "separate"; unset = the default for its codes. */
  fuseMode?: FuseMode;
  /** How many are mirrored; unset = half, rounded down. */
  mirrorCount?: number;
}

/** True when the piece has both main and interfacing codes. */
export function hasFuseChoice(piece: AutoCutPiece): boolean {
  const c = parseCuts(piece.name);
  return !!c.M && !!c.I;
}

/** The Fuse choice in effect for a piece (null when it has no choice). */
export function fuseModeFor(
  piece: AutoCutPiece,
  bulkFuseByDefault: boolean,
): FuseMode | null {
  const c = parseCuts(piece.name);
  if (!c.M || !c.I) return null;
  if (piece.fuseMode) return piece.fuseMode;
  return c.M.count === c.I.count && bulkFuseByDefault ? "all" : "separate";
}

/** What one piece contributes to one nest. */
export interface PieceCut {
  /** Copies cut as drawn. */
  asDrawn: number;
  /** Mirrored copies. */
  mirrored: number;
  /** Cut on the fold. */
  fold: boolean;
}

const NONE: PieceCut = { asDrawn: 0, mirrored: 0, fold: false };

/** Splits n pieces into as-drawn and mirrored. */
function split(n: number, fold: boolean, mirrorCount?: number): PieceCut {
  if (n <= 0) return NONE;
  if (fold) return { asDrawn: n, mirrored: 0, fold: true };
  const m =
    mirrorCount === undefined || mirrorCount === null
      ? Math.floor(n / 2)
      : Math.max(0, Math.min(n, Math.round(mirrorCount)));
  return { asDrawn: n - m, mirrored: m, fold: false };
}

/**
 * The main-fabric pieces in order (as drawn first, then mirrored), so the
 * fused block and the plain main fabric share them out without doubling
 * up a side: with C2M C1I and Fuse "one", the fused piece is the one as
 * drawn and the plain main piece is its mirror.
 */
function shareMain(
  m: CutCode,
  fused: number,
  mirrorCount: number | undefined,
): { fused: PieceCut; main: PieceCut } {
  const all = split(m.count, m.fold, mirrorCount);
  const takeDrawn = Math.min(fused, all.asDrawn);
  const takeMirrored = Math.min(fused - takeDrawn, all.mirrored);
  return {
    fused: {
      asDrawn: takeDrawn,
      mirrored: takeMirrored,
      fold: m.fold,
    },
    main: {
      asDrawn: all.asDrawn - takeDrawn,
      mirrored: all.mirrored - takeMirrored,
      fold: m.fold,
    },
  };
}

/**
 * How a piece is cut in a given nest. Returns null when the name has no
 * cut code the rules can use (the piece is then cut as its Quantity says).
 */
export function cutsFor(
  piece: AutoCutPiece,
  job: NestJob,
  bulkFuseByDefault: boolean,
): PieceCut | null {
  const c = parseCuts(piece.name);
  const letters = Object.keys(c);
  if (letters.length === 0) {
    // "INT1 Collar" with no code: one interfacing piece.
    if (isInterfacingPiece(piece.name))
      return job === "interfacing" || job === "all"
        ? split(1, false, piece.mirrorCount)
        : NONE;
    return null;
  }
  const mode = fuseModeFor(piece, bulkFuseByDefault);
  const M = c.M;
  const I = c.I;
  const fusedCount = !M
    ? 0
    : mode === "all"
      ? M.count
      : mode === "one"
        ? Math.min(I ? I.count : 0, M.count)
        : 0;
  const mainShare = M
    ? shareMain(M, fusedCount, piece.mirrorCount)
    : { fused: NONE, main: NONE };
  // Interfacing cut on its own: all of it when separate; what's left over
  // otherwise (e.g. C2M C3I bulk-fused leaves one interfacing piece).
  const interfacingCount = I
    ? Math.max(0, I.count - (mode === "separate" || !mode ? 0 : fusedCount))
    : isInterfacingPiece(piece.name)
      ? 1
      : 0;
  const own = (code: CutCode | undefined) =>
    code
      ? split(code.count, code.fold, M ? undefined : piece.mirrorCount)
      : NONE;

  switch (job) {
    case "main":
      return mainShare.main;
    case "fused":
      return mainShare.fused;
    case "interfacing":
      return split(
        interfacingCount,
        I ? I.fold : false,
        M ? undefined : piece.mirrorCount,
      );
    case "lining":
      return own(c.L);
    case "ribbing":
      return own(c.R);
    case "all": {
      // Everything on whatever sheets are ticked: the main pieces (fused
      // or not), else the first code the piece has.
      if (M) return split(M.count, M.fold, piece.mirrorCount);
      const first = c[letters[0]];
      return split(first.count, first.fold, piece.mirrorCount);
    }
  }
  return NONE;
}

/** The nests a piece belongs to (where it has anything to cut). */
export function jobsForPiece(
  piece: AutoCutPiece,
  bulkFuseByDefault: boolean,
): Set<NestJob> {
  const jobs = new Set<NestJob>();
  for (const job of [
    "main",
    "fused",
    "interfacing",
    "lining",
    "ribbing",
  ] as NestJob[]) {
    const cut = cutsFor(piece, job, bulkFuseByDefault);
    if (cut && cut.asDrawn + cut.mirrored > 0) jobs.add(job);
  }
  return jobs;
}

/** The total a piece's main count (or first code) gives, for the row. */
export function primaryCount(piece: AutoCutPiece): number {
  const c = parseCuts(piece.name);
  if (c.M) return c.M.count;
  const first = Object.keys(c)[0];
  if (first) return c[first].count;
  return isInterfacingPiece(piece.name) ? 1 : 0;
}

/** True when the piece's main (or first) code is on the fold. */
export function primaryFold(piece: AutoCutPiece): boolean {
  const c = parseCuts(piece.name);
  if (c.M) return c.M.fold;
  const first = Object.keys(c)[0];
  return first ? c[first].fold : false;
}

/** The engine methods and fields applyAutoCuts uses (DeepNest). */
interface AutoCutPart extends AutoCutPiece {
  sheet?: boolean;
  excluded?: boolean;
  isMirrorCopy?: boolean;
  mirrorOfId?: number;
  grainnestId?: number;
  cutOnFold?: boolean;
  userUnfolded?: boolean;
  nestQuantity?: number;
  autoSkip?: boolean;
  outOfView?: boolean;
  autoCopy?: boolean;
  autoCopyOf?: unknown;
}
interface AutoCutEngine<P extends AutoCutPart> {
  parts: P[];
  foldPart(index: number): boolean;
  mirrorCopyPart(index: number): number;
}

/** Pieces the nest-start warning names. */
export interface AutoCutsReport {
  /** Included pieces with no cut code (nested by their Quantity). */
  uncoded: string[];
  /** Pieces with an OF code that couldn't be folded (no fold edge). */
  foldFailed: string[];
}

/**
 * Takes away what applyAutoCuts added: the hidden mirrored copies and the
 * worked-out counts. Copies sit at the end of the parts list, so removing
 * them leaves every other part's place alone. Folds stay (they show in
 * the list, with Unfold).
 */
export function clearAutoCuts<P extends AutoCutPart>(
  dn: AutoCutEngine<P>,
): void {
  for (let i = dn.parts.length - 1; i >= 0; i--) {
    if (dn.parts[i].autoCopy) dn.parts.splice(i, 1);
  }
  for (const p of dn.parts) {
    delete p.nestQuantity;
    delete p.autoSkip;
  }
}

/** A piece's name for messages. */
function label(p: AutoCutPart & { filename?: string | null }): string {
  return p.name || p.filename || "(unnamed piece)";
}

/**
 * Sets up a nest from the cut codes: for each included piece with a code,
 * folds it if the code says OF, sets how many are nested as drawn
 * (nestQuantity) and adds a hidden mirrored copy for the rest. Manual
 * mirror copies of coded pieces are skipped (the codes already count
 * them). Pieces without a code nest their Quantity, as before.
 */
export function applyAutoCuts<P extends AutoCutPart>(
  dn: AutoCutEngine<P>,
  job: NestJob,
  bulkFuseByDefault: boolean,
): AutoCutsReport {
  clearAutoCuts(dn);
  const report: AutoCutsReport = { uncoded: [], foldFailed: [] };
  const originals = dn.parts.filter(
    (p) => !p.sheet && !p.isMirrorCopy && !p.excluded && !p.outOfView,
  );
  const coded = new Set<P>();
  for (const p of originals) {
    const cut = cutsFor(p, job, bulkFuseByDefault);
    if (!cut) {
      report.uncoded.push(label(p));
      continue;
    }
    coded.add(p);
    if (cut.fold && !p.cutOnFold && !p.userUnfolded) {
      if (!dn.foldPart(dn.parts.indexOf(p))) report.foldFailed.push(label(p));
    }
    p.nestQuantity = cut.asDrawn;
    if (cut.mirrored > 0) {
      const copy = dn.parts[dn.mirrorCopyPart(dn.parts.indexOf(p))];
      copy.isMirrorCopy = false;
      delete copy.mirrorOfId;
      copy.autoCopy = true;
      copy.autoCopyOf = p;
      copy.nestQuantity = cut.mirrored;
    }
  }
  // A manual mirror copy of a coded piece would double the pair.
  for (const p of dn.parts) {
    if (!p.sheet && isCoveredCopy(dn.parts, p)) p.autoSkip = true;
  }
  // Only worth a warning when the pattern uses codes at all.
  if (coded.size === 0) report.uncoded = [];
  return report;
}

/** True for a manual mirror copy whose piece has a cut code. */
export function isCoveredCopy<P extends AutoCutPart>(
  parts: P[],
  p: P,
): boolean {
  if (!p.isMirrorCopy) return false;
  const src = parts.find(
    (q) => q.grainnestId !== undefined && q.grainnestId === p.mirrorOfId,
  );
  return (
    !!src &&
    (Object.keys(parseCuts(src.name)).length > 0 ||
      isInterfacingPiece(src.name))
  );
}
