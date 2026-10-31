# Grain-Nest

Pattern nesting for dressmaking. Grain-Nest takes the pieces of a sewing
pattern (as an SVG file) and lays them out on fabric as tightly as it can,
keeping every piece on its grain line.

It's a Mac app (Apple Silicon), built on the open-source
[deepnest-next](https://github.com/deepnest-next/deepnest) nesting engine.

## What it does

- **Grain lines.** Finds each piece's grain line when you import (Seamly2D
  `class="grainline"`, Inkscape layers or ids containing `grain`), or you
  mark it by hand with two clicks. Each piece gets a grain rule: on grain,
  grain or flipped, bias, free or a custom tolerance.
- **Cut on fold** along the grain line drawn on the fold edge, or click
  **Mark fold** and then the fold edge in the preview.
- **Dressmaking pieces.** Cut on fold, mirrored pieces (in place or as a
  copy), a top end for each piece, nap (one-way fabric), and seam
  allowances with sew lines. Woven and knit projects have their own
  default seam allowance.
- **Fabrics and sheets.** Name each sheet and say which fabric it is for
  (main, lining, interfacing, fused…). **Nest for** picks the pieces for
  one fabric from the cut codes in their names (e.g. `C2M` = cut 2 main).
- **Results.** A list of the best layouts so far, sorted by fabric used.
  The SVG export is laid out like your pattern file — a layer per sheet,
  a named group per piece with its cutting, sew and grain lines and its
  name — with line colours and width from Settings, a sheet border and a
  calibration square, ready for projector cutting (e.g. Pattern
  Projector). There's a cut list too.
- **Hides and flaws.** Nest on any shape, such as a side of leather drawn in
  Inkscape (area used shown in m² or sq ft), and keep pieces off flaws, drawn
  in the file (`flaw-1`…) or measured from a corner in the app.
- **Projects.** Save and reopen everything as a `.gnp` file.
- **Files from Finder and other apps.** Double-click a project, open an SVG
  with Grain-Nest, or hand it a sheets file (`.gnsheets`) listing your
  fabric, and it opens them.

There's a full walkthrough in [docs/USAGE.md](docs/USAGE.md), and an
example pattern with its exported nest in [examples/](examples/).

## Install

Download `grain-nest-v<version>-macos-arm64.dmg` from the latest
[release](https://github.com/cut-on-fold/Grain-Nest/releases/latest), open it
and drag **Grain-Nest** onto **Applications**. From v1.12.0 a release can
be signed and notarised by Apple, and opens on a double-click. If yours
isn't, the first time macOS may refuse to open it: right-click the app →
**Open**, or **System Settings → Privacy & Security → Open Anyway**.

When a new version comes out, Grain-Nest says so when it starts.

## Build from source

See [BUILD.md](BUILD.md). In short, with Node.js 20+:

```sh
npm install
npm run build
npm start
```

`npm run dist` on a Mac makes `Grain-Nest.app`; `npm test` runs the
Playwright tests.

## Built on

Grain-Nest is a fork of
[deepnest-next](https://github.com/deepnest-next/deepnest), maintained by
Josef Fröhle, which grew out of Jack Qiao's
[SVGnest](https://github.com/Jack000/SVGnest) and
[Deepnest](https://github.com/Jack000/Deepnest) (via the Dogthemachine and
cmidgley forks). The nesting engine — the no-fit-polygon solver, the
genetic algorithm and the SVG import — comes from those projects,
including deepnest-next's `@deepnest/calculate-nfp` package; Grain-Nest
adds the grain and dressmaking features above. Earlier versions also used
deepnest-next's SVG preprocessor (`@deepnest/svg-preprocessor`) to clean
up imported files.

### Credits and history

Thank you to everyone whose work this is built on: Josef Fröhle, abebeos
and the other deepnest-next contributors; cmidgley, Dogthemachine and the
earlier Deepnest forks; and Jack Qiao, who wrote SVGnest and Deepnest.

This repository's history starts with deepnest-next's own (up to its
commit `798262f`, April 2026), so every earlier contribution is kept in
the commit history under its author's name. Grain-Nest's changes come
after it.

### Changes from deepnest-next

As the GNU GPL asks: Grain-Nest has modified deepnest-next's files,
including the GPL-licensed nesting module `main/deepnest.js`, from May
2026 onwards — grain rules, cutting on the fold, mirrored pieces, nap,
seam allowances, cut lists and the SVG export. The commit history shows
each change and when it was made.

## Licence

Open source, with the licences of the projects it's built on: mostly MIT,
with one module under the GNU GPL v3 and the geometry libraries under the
Boost Software License. See [LICENSE](LICENSE) and
[LICENSES.md](LICENSES.md). The GPL part means the source code must stay
available to everyone who gets the app; it is, in this repository.
