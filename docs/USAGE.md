# Grain-Nest — user guide

**Grain-Nest** lays your sewing-pattern pieces out on fabric as tightly as it
can, while keeping every piece on its grain. You give it an SVG of your
pattern pieces and the size of your fabric; it works out a cutting layout and
saves it as an SVG you can print, or project onto the fabric with an app such
as Pattern Projector.

This guide is for version 1.5.0 on a Mac with Apple Silicon.

## Contents

- [Opening the Mac app the first time](#opening-the-mac-app-the-first-time)
- [Quick start](#quick-start)
- [Setting up a pattern in Inkscape](#setting-up-a-pattern-in-inkscape)
- [Naming pieces and the Nest for menu](#naming-pieces-and-the-nest-for-menu)
- [Grain rules](#grain-rules)
- [Marking a grain line or a fold in the app](#marking-a-grain-line-or-a-fold-in-the-app)
- [Which way up each piece goes (Flip top)](#which-way-up-each-piece-goes-flip-top)
- [Napped and directional fabrics](#napped-and-directional-fabrics)
- [Quantity, mirror copies and cutting on the fold](#quantity-mirror-copies-and-cutting-on-the-fold)
- [Sew lines (seam allowance)](#sew-lines-seam-allowance)
- [Sheets of fabric](#sheets-of-fabric)
- [Working with the parts list](#working-with-the-parts-list)
- [Running a nest](#running-a-nest)
- [Saved layouts](#saved-layouts)
- [Views](#views)
- [What's in the exported SVG](#whats-in-the-exported-svg)
- [Exporting a cut list](#exporting-a-cut-list)
- [Saving and reopening a project](#saving-and-reopening-a-project)
- [Settings](#settings)
- [Other handy bits](#other-handy-bits)
- [Example files](#example-files)
- [Common things that go wrong](#common-things-that-go-wrong)
- [Things this version doesn't do (yet)](#things-this-version-doesnt-do-yet)

## Opening the Mac app the first time

`Grain-Nest.app` (the disk image attached to each release on GitHub) is
**unsigned** — it hasn't been registered with Apple, because that costs
a yearly fee and this is a personal-use app. So the first time you open
it, macOS will say it can't check the app for malicious software and
won't open it on a plain double-click. You only have to get past this
once; after that it opens normally.

1. Download the **.dmg** from the release and double-click it. A window
   opens showing **Grain-Nest** next to an **Applications** folder: drag
   Grain-Nest onto Applications (choose **Replace** when updating), then
   eject the disk image. Keeping one Grain-Nest in Applications means
   your Dock icon keeps working after every update.
2. In Applications, **right-click** (or Control-click) **Grain-Nest** and
   choose **Open**. In the box that appears, click **Open** again.
3. If there's no **Open** button (newer macOS versions, Sequoia and
   later, removed it): click **Done**, then open **System Settings →
   Privacy & Security**, scroll down to the line saying *"Grain-Nest"
   was blocked*, click **Open Anyway**, and confirm with your password
   or Touch ID.

If macOS instead says the app **"is damaged and can't be opened"**,
open Terminal and run `xattr -cr /Applications/Grain-Nest.app`, then
try step 2 again. (That clears the "downloaded from the internet" tag
macOS put on it.)

## Quick start

1. **Open the app** (the very first time, see
   [Opening the Mac app the first time](#opening-the-mac-app-the-first-time)).
2. Click **Import** at the top left and choose the SVG file(s) of your
   pattern pieces. You can pick several files at once. Seamly2D exports work
   directly; for files you draw or tidy in Inkscape, see
   [Setting up a pattern in Inkscape](#setting-up-a-pattern-in-inkscape).
3. Look down the **Grain rule** column in the parts list:
    - **Lock to grain** — Grain-Nest found a grain line in your file. You
      don't need to do anything.
    - **Free** — no grain line was found. If the piece really has no grain
      (a small appliqué shape, say), leave it. Otherwise click **Mark grain**
      under the drop-down and click the bottom end, then the top end, of the
      grain line (see [Marking a grain line](#marking-a-grain-line-or-a-fold-in-the-app)).
4. Check each piece's picture: the orange arrow should point to the top of the
   piece. If a piece is upside down, click **Flip top** in its **Actions**
   column.
5. Check the pairs and folds. If your pieces have cut codes in their names
   (`C2M`, `C1MOF`…), Grain-Nest makes the left/right pairs and folds for you
   when you nest; each piece shows its count in the **Quantity** column.
   Pieces without codes: use **Quantity**, **Mirror copy** and **Cut on fold**
   (or **Mark fold**) in the **Actions** column. See [Quantity, mirror copies and cutting on the fold](#quantity-mirror-copies-and-cutting-on-the-fold).
6. Add your fabric: click the **+** button at the bottom left of the parts
   list, choose a preset width (it fills in the **Fabric width**), type the
   **Length** of fabric you want to try, and click **Add**. See [Sheets of fabric](#sheets-of-fabric).
7. If the pattern uses several fabrics, choose one in **Nest for** at the top
   (Main fabric, Lining…). See [Naming pieces and the Nest for menu](#naming-pieces-and-the-nest-for-menu).
8. Click **Start nest**. Watch the layout improve for as long as you like (a
   minute or two is usually plenty), then click **Stop nest**.
9. Click **Export → SVG file** to save the cutting layout, or **Export → Cut
   list (text)** for a list of pieces and how much fabric to buy.

## Setting up a pattern in Inkscape

Grain-Nest reads ordinary SVG files. It needs to know three things about each
piece: its **cutting line**, its **grain line** and its **name**. Setting your
file out like this makes all three come through automatically.

### The layout to aim for

- One layer called **Pieces**.
- Inside it, **one group per piece**, labelled with the piece number, name and
  cut codes, e.g. `14 Skirt Front C1MOF`.
- Inside each group: the piece's **cutting line** and its **grain line**, with
  the grain line's ID set to `grain-14` (the piece number after `grain-`).

The [example pattern](#example-files) is laid out exactly like this, so it's a
good one to open in Inkscape and copy.

### Step by step

1. **Draw or check the cutting line.** It must be one closed shape (the end
   joined back to the start). Notches can be part of the same path as little
   extra sub-paths (for example drawn separately and then joined with
   **Path → Combine**), or small triangles or slits cut into the outline
   itself, as many commercial patterns draw them; either way they're kept and
   drawn on the exported layout. Pieces
   are always nested as solid shapes, so nothing is ever tucked inside another
   piece's notches or holes.
2. **Draw the grain line.** Use the pen (Bézier) tool, click once at one end,
   hold **Ctrl** and double-click at the other end so you get a perfectly
   straight line with just two points. It doesn't matter which end you start
   from for detection — but see [Flip top](#which-way-up-each-piece-goes-flip-top)
   for how the app guesses the top.
    - Curved lines are ignored as grain lines.
    - If you want arrowheads, add them as **markers** (Fill and Stroke →
      Stroke style → Markers), not as drawn triangles. Markers are ignored on
      import; a drawn arrowhead would be treated as part of the piece.
3. **Tell Grain-Nest it's a grain line.** Select the line, open **Object →
   Object Properties** (Ctrl+Shift+O) and use any one of these:
    - type an **ID** containing the word `grain`, e.g. `grain-14`, then click
      **Set** (or press Enter) — this is the recommended way;
    - or set its **Label** to exactly `grainline`.

   Grain-Nest also recognises Seamly2D's grain lines (they carry a `grainline`
   class) and any line inside a group or layer whose label or ID is exactly
   `grain`.

   > **Pitfall:** a line labelled just **Grain** is *not* detected — Inkscape
   > gives it an automatic ID like `path123`, and "Grain" on its own isn't one
   > of the recognised labels. Use the ID `grain-14` or the label `grainline`.
   >
   > **Never** label or ID a *piece group* `grain`: everything inside a group
   > called `grain` is treated as a grain line, cutting line included. And
   > keep the word "grain" out of the cutting line's own ID.
4. **For a piece cut on the fold**, draw the grain line **on the fold edge**,
   right along the straight edge of the half-piece. When you click **Cut on
   fold**, Grain-Nest folds the piece along its grain line, snapping to a
   straight edge of the outline that runs within about 6° of the grain line
   and lies close to it — so a line drawn a hair off the edge still works. If
   your grain line isn't on the fold edge, don't worry: use the **Mark fold**
   button in the app instead (see
   [Marking a fold](#marking-the-fold-edge-mark-fold)).
5. **Group the piece.** Select the cutting line and its grain line and press
   **Ctrl+G**.
6. **Name the group.** With the group selected, in Object Properties set the
   **Label** to the piece name with its cut codes, e.g. `14 Skirt Front C1MOF`,
   and click **Set**. See [Naming pieces](#naming-pieces-and-the-nest-for-menu)
   for the codes.
7. Repeat for each piece, then **save as SVG** (Inkscape SVG or plain SVG are
   both fine).

### How Grain-Nest picks up names

For each cutting line, the name comes from the first of these it finds:

1. the cutting line's own Label;
2. otherwise the Label of the nearest group around it (layers don't count);
3. otherwise a Title on the cutting line (Object Properties → Title);
4. otherwise an ID you typed yourself (automatic IDs like `path123` or `g45`
   are skipped).

**Layer names are never used**, so a layer called "Pieces" won't name every
piece "Pieces". If the cutting line has its own Label that isn't the piece name
(e.g. "Cutting line"), that wins over the group's Label — clear it, or set it
to the same name. If nothing is found, the Name box in the parts list shows the
file name faintly; just click and type a name.

### Other things to know

- **SVG files only.** Inches, millimetres or centimetres are all fine — set the
  document units in Inkscape's Document Properties as usual. (Files with no
  units at all use the scale under Settings → Advanced.)
- **Text is not imported.** Labels and instructions written as text boxes are
  dropped — Grain-Nest prints each piece's name on the export itself, from the
  name in the parts list.
- One file can hold the whole pattern, or you can import a file per piece.

## Naming pieces and the Nest for menu

The parts list has a **Name** column. Names are filled in from your file (see
above) and you can edit them at any time. Names matter for two reasons: the
**cut list** and the **exported layout** are labelled by name, and the **Nest
for** menu sorts pieces into fabrics using the **cut codes** in their names.

### Cut codes

A cut code looks like `C2M`:

- a capital **C**,
- a number (how many to cut),
- **one capital letter** for the fabric:
  - **M** — main fabric
  - **I** — interfacing
  - **L** — lining
  - **R** — ribbing
- and optionally **OF** for "on the fold", e.g. `C1MOF`.

Other letters are allowed but the piece then only appears under **All
pieces**.

The code must be a **separate word**: it has to have a space, `_`, comma,
semicolon or round bracket (or the start/end of the name) on both sides. So
`Front C2M`, `Front_C2M`, `Front (C2M)` and `Front C2M, C1L` all work, but these
are **not** recognised:

| Not recognised | Why |
|---|---|
| `Front c2m` | small c and small letter |
| `Front C2m` | the fabric letter must be a capital |
| `Front C2M-front` | a hyphen straight after the code |
| `Front C2M.` | a full stop straight after the code |

The same letter adds up: `C1M C1M` counts as two main.

Pieces whose name **starts with** `INT1`, `INT 1`, `int2` and so on (any
capitals, any number) are pattern interfacing pieces and go into
**Interfacing**.

### Which pieces each job picks

| Nest for | Pieces it includes |
|---|---|
| **All pieces** | Everything, including pieces without codes. |
| **Main fabric** | Pieces with an M code — unless they count as fused. |
| **Fused (main + interfacing)** | Pieces with the **same number** of M and I, e.g. `C2M C2I`. These are cut from a block of main fabric that's been fused with interfacing first. |
| **Interfacing** | `INT…` pieces, and pieces with an I code that don't count as fused (e.g. `C2M C1I`, or interfacing only, `C2I`). |
| **Lining** | Pieces with an L code. |
| **Ribbing** | Pieces with an R code. |

A piece can belong to more than one job. Some examples:

| Piece name | Nest for |
|---|---|
| `Front C2M` | Main fabric |
| `Front C2M C2I` | Fused only |
| `Collar C2M C1I` | Main fabric and Interfacing |
| `Facing C2I` | Interfacing |
| `INT1 Collar` | Interfacing |
| `Back C1MOF C1LOF` | Main fabric and Lining |
| `Cuff C2R` | Ribbing |
| `Pocket` | All pieces only |

### Things to know

- **Codes also make the pairs and folds** (unless you turn that off in
  Settings): `C2M` nests a left and a right, `C1MOF` nests one piece cut on the
  fold. See [Pairs and folds from cut codes](#pairs-and-folds-from-cut-codes).
- **Fused or separate is your choice.** The table above shows the starting
  point. A piece with both M and I codes has a **fused** drop-down in its
  Quantity column that moves it between Main fabric, Fused and Interfacing —
  see [Main and interfacing](#main-and-interfacing).
- **The job is applied when you change the menu.** If you rename a piece
  afterwards it isn't re-sorted — pick another job and then pick yours again.
- After picking a job you can still tick or untick pieces by hand in the
  **Nest** column.
- **Sheets follow the job.** Each sheet has a **Fabric** setting. When you pick
  a job, every sheet whose Fabric matches is ticked and the others are
  unticked, so lining pieces nest on your lining sheet. If **no** sheet is set
  to that fabric, the sheet ticks are left as they were (and Grain-Nest tells
  you). **All pieces** never changes the sheet ticks.
- **Hide excluded / Show excluded** (top bar) hides the unticked pieces so the
  list shows exactly what will be nested — handy for checking every mirror copy
  and fold piece is there.
- Your ticks, the Nest for choice, and each sheet's name and fabric are saved
  with the project.

## Grain rules

The **Grain rule** drop-down on each piece says how the piece may be turned on
the fabric. In Grain-Nest the fabric runs **left to right** (the length you'd
buy), so "on grain" means the grain line lies **horizontally** in the layout.

| Rule | What it does | When to use it |
|---|---|---|
| **Lock to grain** | Grain line along the length of the fabric, with the top of the piece towards the start (left). | Most pieces — the default when a grain line is found. |
| **Grain or flipped** | On grain, either way up (turned end to end if that saves fabric). | Plain fabrics with no nap or one-way print. |
| **Bias** | Turned 45° or 135° from its drawn grain line. | Bias-cut pieces whose pattern draws the grain line *straight*, as for an on-grain piece. |
| **Free** | Any of a few turns (set under Settings → Advanced → Rotations). | Pieces with no real grain. |
| **Custom tolerance** | On grain, or up to 3° either way. | Forgiving fabrics, when a tiny wiggle helps the pieces fit. |

**About Bias:** Bias turns the piece 45° (or 135°) *from whatever grain line it
has*. Many patterns already draw the grain arrow diagonally on a bias piece —
in that case the drawn arrow *is* the warp direction, so choose **Lock to
grain**, not Bias, or the piece ends up turned twice.

**About Custom tolerance:** the piece may sit exactly on grain, 3° one way or
3° the other.

A grain line found in your file and one you mark in the app behave the same
once they're set.

To set one rule on many pieces, select them and use the **Grain rule…**
drop-down in the **Apply to selected** bar.

## Marking a grain line or a fold in the app

### Mark grain and Re-mark

Under each piece's grain-rule drop-down is a small link:

- **Mark grain** — for a piece where no grain line was found.
- **Re-mark** — for a piece that already has one (found in the file, or marked
  before), to replace it.

To mark:

1. Click **Mark grain** (or **Re-mark**). A banner appears at the top of the
   window.
2. Click **the bottom end** of the grain direction, **then the top end** —
   towards the top of the piece. The two clicks set both the angle and which way
   up the piece goes; exactly where you click doesn't matter.
    - **Hold Shift on the second click** to snap to the nearest 45° step
      (horizontal, vertical or diagonal).
3. The drop-down switches to **Lock to grain** and a dashed blue line appears on
   the piece, drawn through its middle.
4. Press **Esc** (or click **Cancel** on the banner) at any time to stop without
   changing anything.

Re-marking replaces the grain line from your file with the marked one, both for
nesting and in the export. On a piece you're going to cut on the fold, use
**Mark fold** to set the fold edge, as the marked line runs through the middle
of the piece rather than along its fold.

### Marking the fold edge (Mark fold)

If a piece is cut on the fold but its grain line isn't drawn on the fold edge,
tell Grain-Nest which edge is the fold:

1. Click **Mark fold** in the piece's **Actions** column. The preview on the
   right switches to the file the piece came from and zooms in on the piece.
2. Click on the piece's **straight fold edge** in that preview.
3. The edge nearest your click becomes the fold, and the piece is cut on the
   fold straight away — its picture doubles.

The marked fold is saved with the project. **Unfold** (the same button that said
Cut on fold) undoes it; Esc cancels before you click.

## Which way up each piece goes (Flip top)

Pattern files turn pieces every which way to fit the paper. A grain line on its
own doesn't say which end is the top, so Grain-Nest makes a guess:

- **For a grain line found in your file**, the end **higher up on the page** is
  the top. (If the line is exactly horizontal, the **left** end is the top.) So
  pieces drawn upright, as most patterns draw them, come in the right way up.
- **For a grain line you marked**, your **second click** is the top.

The picture of each piece in the parts list shows it **standing upright**, with
an **orange arrow pointing at the top**. Go down the list once and look for any
piece that's upside down (neckline or sleeve head at the bottom, and so on),
and click **Flip top** in its **Actions** column. The picture turns over;
that's all. Odd angles are handled for you — Flip top only ever swaps top and
bottom.

In the nest, **Lock to grain** lays every piece with its top towards the
**start (left)** of the fabric, so they all point the same way. (**Grain or
flipped** still lets a piece go either way when that saves fabric.)

- **Flip top** only appears on pieces that have a grain line — mark the grain
  first if it's missing.
- To flip several pieces at once, select them and click **Flip top** in the
  **Apply to selected** bar.
- Mirroring a piece keeps its top, and a mirror copy has the same top as its
  original.
- Flips are saved with the project, so you only do this once per pattern.

## Napped and directional fabrics

Some fabrics look different depending on which way you cut the pieces:

- **Napped fabrics** (velvet, corduroy, brushed flannel, suede) catch the light
  differently along the nap. Cut a piece upside down and it shows as a
  different shade in the finished garment.
- **One-way prints** (flowers all pointing up, falling rain) need every piece
  the same way up, or some motifs end up upside down.

For these, tick **Nap (directional)** in the top bar before starting the nest.
While it's ticked:

- **Lock to grain** and **Grain or flipped** pieces are all kept one way up
  (never turned end to end).
- **Bias** pieces all use the same diagonal (+45°), not both.
- **Free** pieces aren't turned at all — they stay as drawn.
- **Custom tolerance** pieces keep their 3° either way.

The nap setting is saved with the project. For ordinary fabrics leave it
unticked, or you'll lose some of the freedom that helps pieces fit.

> If you ever need the opposite diagonal on one bias piece, **Mirror copy** it:
> mirroring flips the bias direction.

## Quantity, mirror copies and cutting on the fold

### Pairs and folds from cut codes

With **Pairs & folds from cut codes** on (Settings → Cut codes; it's on to
start with), each piece stays **one row** and Grain-Nest works out its copies
from the cut code when you click **Start nest**:

| Code | What's nested |
|---|---|
| `C1M` | 1 piece, as drawn |
| `C2M` | a pair: 1 as drawn and 1 mirrored |
| `C3M` | 2 one way and 1 mirrored |
| `C4M` | 2 pairs |
| `C1MOF` | 1 piece, cut on the fold (folded for you) |
| `C2MOF` | 2 pieces on the fold (not mirrored — a folded piece is the same both ways) |

- The **Quantity** column shows the count from the code instead of a box, with
  a **mirrored** drop-down: *Auto* is half, rounded down (the table above).
  Pick a number to change it — **0 mirrored** for pieces cut twice the same way
  (two identical patch pockets), or 1 for an asymmetric piece where one of
  three is the other way round.
- The count **follows Nest for**: `Back C2M C2L` nests a pair in Main fabric and
  a pair in Lining.
- **On the fold**: the piece is folded along its grain line (drawn on the fold
  edge), or the edge you marked with **Mark fold**. If Grain-Nest can't find a
  fold edge, it tells you before nesting and cuts the piece whole as drawn. If
  you **Unfold** a piece by hand, it stays unfolded.
- The mirrored copies only exist while you're nesting: you won't see extra rows
  in the parts list, and they aren't saved with the project. **Mirror copy**
  isn't shown on pieces with a code.
- **Pieces without a code** are cut as their Quantity says, none mirrored.
  Grain-Nest lists them and asks before nesting, in case one of their names is
  missing its code. Tick **Don't ask again** if your patterns don't use codes;
  the list then shows as a reminder banner on the nest screen instead (turn the
  question back on under Settings → Cut codes → **Ask about pieces without a
  code**).
- Projects made before this version may have their own mirror copies. With the
  setting on, a mirror copy of a piece with a code is hidden and not nested
  (the code already counts it), so pairs aren't doubled. Turn the setting off
  to see them again.

#### Main and interfacing

A piece with both M and I codes has a **fused** drop-down under its count,
saying how many of its main pieces are cut from the fused block:

| fused | `C2M C2I` | `C2M C1I` |
|---|---|---|
| **All** | both from the fused block (Nest for: Fused) | both from the fused block, and no separate interfacing |
| **1** (as many as the interfacing pieces) | — | 1 from the fused block (as drawn) and 1 in plain main fabric (mirrored) |
| **None** (cut separately) | 2 in main fabric, 2 interfacing cut on their own | 2 in main fabric, 1 interfacing cut on its own |

Equal counts start as **All** (bulk-fusing), or **None** if you change
**Equal main & interfacing** in Settings to *Cut separately*. Fewer
interfacing than main starts as **None**. Your choice for each piece is saved with the
project.

### Doing it by hand

Turn **Pairs & folds from cut codes** off in Settings (or use pieces without
codes) and set things up yourself. Which one to use:

| You need… | Use |
|---|---|
| Identical copies of a piece (same way up, not mirrored) | **Quantity** |
| A left and right pair ("cut 2" of a one-sided piece, e.g. a sleeve or back) | **Mirror copy** |
| Two of a symmetrical piece (e.g. a patch pocket) | **Quantity** 2 |
| A piece the pattern stores as a half, to cut on the fold | **Cut on fold** (or **Mark fold**) |

### Quantity

Type a number in the **Quantity** box. Each extra copy is identical — not
mirrored. To set many at once, select the rows, type a number by **Set qty** in
the **Apply to selected** bar and click **Set qty**.

### Mirror and Mirror copy

Both buttons are in the piece's **Actions** column.

- **Mirror** flips the piece left to right in place (for a pattern that says
  "cut 1 reversed"). It changes to **Unmirror**, so the same button undoes it.
  The grain line flips with the piece, so it still lies on grain.
- **Mirror copy** leaves the original alone and adds a new row underneath:
  its mirror image. This is the usual way to get a left/right pair. The copy
  takes the original's name, grain rule, top, seam allowance, Nest tick and
  cut-on-fold setting. Its quantity starts at 1.

To mirror several pieces at once, select them and use **Mirror** / **Unmirror**
in the **Apply to selected** bar.

### Cut on fold

Cutting on the fold is when the pattern holds only *half* of a symmetrical
piece: you lay its straight edge on the fold of doubled fabric, cut, and unfold
to get the whole piece. Grain-Nest has to lay out the **whole** piece, or it
would under-estimate the fabric.

1. Click **Cut on fold** in the piece's **Actions** column.
2. The picture doubles: the half is reflected across its fold edge to make the
   full piece. The button changes to **Unfold**, so the same click undoes it.
3. Nest as usual. The layout and the fabric length allow for the full piece.

The fold edge is taken from the piece's grain line, which should be drawn on the
fold edge (see [Setting up a pattern in Inkscape](#setting-up-a-pattern-in-inkscape)).
If it isn't — or if Grain-Nest tells you it can't fold the piece — use **Mark
fold** instead.

In the export, a cut-on-fold piece is drawn as **one seamless outline** with no
line down the fold, and its notches appear on both halves. The fold setting is
saved with the project, and a mirror copy of a folded piece is folded too.

## Sew lines (seam allowance)

A **sew line** is the line you stitch along, set in from the cut edge by the
seam allowance. Grain-Nest draws it inside each piece on the exported layout,
so the print or projection shows where to stitch as well as where to cut.

1. Type a value in a piece's **Seam (mm)** box — e.g. `15` for 1.5 cm. Leave it
   blank or `0` for no sew line.
2. To set many at once, select the rows, type a value by **Set seam** in the
   **Apply to selected** bar and click **Set seam**.
3. Export as usual: each piece gets a **dashed** sew line that far inside its
   cutting line.

New pieces get a default allowance: **12 mm for a woven project, 10 mm for a
knit** — choose **Woven** or **Knit** in the top bar (saved with the project).
Switching updates every piece still on the old default and leaves any you've
set by hand. Change the two defaults in **Settings → Seam allowance**.

Notes:

- The allowance is per piece, so a hem can have more than the side seams.
- The sew line follows the piece's outline and ignores notches: separate
  notch lines, and notch triangles or slits up to 12 mm cut into the outline,
  are stitched straight past.
- It's set *inwards*, assuming your outline is the **cutting** line (with seam
  allowance included).
- It only appears in the exported SVG, not in the pictures on screen.

## Sheets of fabric

A **sheet** is a piece of fabric to nest on.

### Adding a sheet

Click the **+** button at the bottom left of the parts list. The **Add a sheet**
box opens:

- **Name** and **Fabric** — both optional and editable later in the parts list.
  The Fabric (Main fabric, Fused, Interfacing, Lining, Ribbing) is what the
  [Nest for](#naming-pieces-and-the-nest-for-menu) menu uses to tick the right
  sheets.
- **Preset width** — common usable fabric widths (selvedges already excluded):
  35 in (90 cm, for interfacing and fused — choosing Interfacing or Fused as
  the Fabric fills this in for you), 43 in (109 cm), 54 in (137 cm), 58 in
  (147 cm), 62 in (157 cm) and 70 in (177 cm).
- **Fabric width** — the width of the fabric, selvedge to selvedge. Picking a
  preset fills this in for you (e.g. 1370 mm for 54 in).
- **Length** — how much fabric you want to try, measured along the selvedge.
  Type it in and click **Add**.

(Earlier versions labelled these two boxes "width" and "height".)

If your fabric isn't on the list, leave the preset at "(no preset)" and type both
numbers yourself. The numbers are in the display units chosen in Settings
(inches or mm).

You can also import an SVG of a fabric outline (a remnant, say) and tick its
**Sheet** box in the parts list.

### How Grain-Nest reads a sheet

The sheet is a length of fabric laid out on screen as if unrolled from the
bolt: the **Length** runs **left to right**, across the screen, and the
**Fabric width** runs **top to bottom**, selvedge to selvedge. Pieces on
**Lock to grain** lie with their grain along the length, parallel to the
selvedges.

It's fine to start with a generous length: the nest tells you the **min fabric
length** actually used, and the exported SVG is cropped to the pieces (see
[What's in the exported SVG](#whats-in-the-exported-svg)).

### Several sheets and several fabrics

Each sheet has its own **Nest** tick box and a **Fabric** drop-down (in the
Grain rule / Fabric column). One fabric can have several sheets — two lining
remnants, say — and all of them are used. **Start nest** won't run with every
sheet unticked.

## Working with the parts list

### The Actions column

Each piece's buttons are in the last column: **Flip top** (only when the piece
has a grain line), **Mirror**, **Mirror copy**, **Cut on fold** / **Unfold** and
**Mark fold** (hidden while the piece is cut on the fold). **Mirror copy** is
hidden on pieces with a cut code while **Pairs & folds from cut codes** is on
(the code makes the pair). Clicking a button,
box or drop-down in a row doesn't select the row.

The Actions column stays pinned to the right-hand edge of the parts list, so
the buttons are always in view: if the list is narrower than its columns (you
dragged its right edge in, or the window is small), the other columns scroll
sideways underneath it.

### Selecting rows

- Click a row (anywhere that isn't a button or box) to select it; click it again
  to unselect.
- **Drag** down over rows with the mouse button held to select several in one
  go.
- **Select all** at the bottom left selects every visible row (and changes to
  **Deselect all**).

### Sorting

Click a column heading — **Size**, **Sheet**, **Quantity** or **Grain rule /
Fabric** — to sort the list by it. Click again to reverse the order.

### Applying a change to several pieces at once

Select the rows, then use the **Apply to selected** bar below the list:

- **Grain rule…** — set one rule on all of them.
- **Flip top**, **Mirror**, **Unmirror**.
- **Include** / **Exclude** — tick or untick them for the next nest.
- **Set qty** and **Set seam** — type a value in the box first.

After each of these the changed pieces are **unselected**, so the next action
can't catch them by mistake. If nothing is selected, Grain-Nest asks you to
select some pieces first.

### Deleting pieces

Select the rows and click the **bin** button at the bottom left of the parts list
(or press **Delete** or **Backspace**). Grain-Nest asks first, listing what will
go. Pressing Delete or Backspace while typing in a box (name, quantity or seam)
never deletes rows.

### Clear all

**Clear all** in the top bar removes every piece, sheet, import and nest result
and starts afresh. It asks first. There is **no undo** — in Clear all or
anywhere else in Grain-Nest — so save a project first if you might want it back.

### The import preview

The panel on the right shows the files you've imported, with **one tab per
file** along the top. Click a tab to see that file. Use the zoom buttons in the
corner to zoom in, zoom out and reset the view. Closing a tab (its small ×) only
removes the preview — the pieces stay in the parts list.

### Arranging the panels

- **Column widths:** drag the thin grip at the right edge of any column heading.
- **Panel width:** drag the right edge of the parts list to make it wider or
  narrower than the preview beside it.
- Grain-Nest **remembers** both next time. To go back to the original layout,
  click **Reset layout** at the bottom right of the parts list.

## Running a nest

Click **Start nest** (it's greyed out until you have a sheet). Grain-Nest
switches to the nest screen and keeps trying new layouts, showing the best so
far.

- **Stop nest** stops the search. The button then reads **Start nest**, so you
  can set it going again.
- The bar at the top shows **sheets used**, **parts placed**, **sheet
  utilisation** and **min fabric length** — the length of fabric the placed
  pieces actually use, i.e. the least you need to buy.
- **Best nests so far** lists the layouts found, each with its fabric length.
  Layouts that fit **every piece come first**, then the ones using the **least
  fabric**. On a tight fit, some layouts may leave pieces out; as soon as one
  fits them all, the ones that don't are removed from the list.
- The layout shown is the **top of the list**, and it moves to each new best
  as the nest runs. Click another one to show it instead; it stays shown
  until you click a different one. The one shown is the one Export uses.
- **Export** saves the selected layout as an **SVG file** or a **Cut list
  (text)**. If that layout leaves pieces out, Grain-Nest says how many are
  missing and asks before exporting. The suggested name is the pattern's name
  with the fabric and its width, next to the pattern file: `Coat.svg` nested
  on 58-inch main fabric becomes `Coat_Nested_Main_58in.svg` (or
  `Coat_Nested_Main_150cm.svg` when working in mm), and the cut list
  `Coat_Nested_Main_58in_CutList.txt`. A layout over several fabrics lists
  each one.
- **Save layout** keeps the layout shown in the project, so you can open and
  export it again later without re-nesting — see [Saved layouts](#saved-layouts).
- **Back** returns to the parts list. This stops the nest and clears the list
  of results. If the layout shown isn't saved, Grain-Nest asks first
  (**Save layout…**, **Leave** or **Cancel**); either way it's kept as **Last
  nest (not saved)** until your next nest.

A nest with grain rules usually uses a little more fabric than one where pieces
can turn freely — that's the cost of cutting on grain.

## Saved layouts

A layout you like can be kept in the project and opened again later — to
export it again, or to compare fabrics and widths — without re-nesting.

### Saving a layout

On the nest screen, click **Save layout**. Grain-Nest suggests a name from
the sheet: its name and width, e.g. *Navy twill_58in* (or *Main fabric_150cm*
if the sheet has no name). Change it if you like. The **Folder** is the
sheet's fabric (Main fabric, Lining, Fused…), so the same pattern cut from
different fabrics or widths stays apart.

If a layout with the same name is already in that folder, Grain-Nest asks
whether to **Replace** it or **Save as a new name**.

### The Saved layouts panel

Saved layouts are listed above your pieces, in a folder per fabric (click a
folder to open or close it). Each shows the fabric length it uses and how many
pieces it fits (*10/10*), with:

- **Open** — goes straight to the nest screen with that layout, ready to
  export. Nest for switches to the layout's fabric, and the pairs it used are
  made again.
- **Rename** and **Delete** — deleting a layout doesn't change your pieces.

Drag the bar between the panel and your pieces to share the space. The panel
only appears once there's a layout in it.

**Last nest (not saved)** at the top is the best layout from your most recent
nest that you didn't save. Click **Save** to keep it under a name. It's
replaced by the next nest you leave without saving.

### When pieces have changed

Each layout remembers how its pieces were set up. If you open one after
changing them — a seam allowance, a fold, the number to cut, a renamed,
deleted or added piece — a banner on the nest screen says what changed, and
the layout gets a ⚠ in the list:

- **Re-nest with the new pieces** starts a fresh nest with the pieces as they
  are now.
- **Keep as saved** keeps the layout (it's drawn with the pieces as they are
  now, so changed pieces may overlap or not fit).

### Leaving without saving

Going **Back** from a layout you haven't saved asks first. Tick **Don't ask
again** to stop the question; turn it back on under Settings → Nesting → **Ask
before leaving an unsaved layout**. The layout is still kept as **Last nest
(not saved)**.

## Views

A **view** is a named set of pieces in a project: one view of a pattern
(View A, View B), an expansion pack, or a mix-and-match (the bodice of one
pattern with the sleeves of another). Picking a view shows **only its
pieces**, nests only those, and lists only the layouts saved in it. A piece
can be in several views; sheets are always shown.

### Making a view

1. Select the pieces in the parts list (click their rows).
2. Click **Save as view…** in the toolbar under the list.
3. Type a name, or choose **Replace** an existing view to change which
   pieces it has. Replacing asks first and says which pieces are added and
   taken out.

### The View menu

Once there's a view, a **View** menu appears at the top of the Saved layouts
panel: **All pieces** and each view, with how many pieces it has. Pick one to
show it. **Nest for** still picks the fabric within the view (e.g. View B,
Lining).

With a view picked, the same menu has **Rename this view…** and **Delete this
view…**. Deleting a view **deletes its saved layouts too** (it says how many
first); your pieces aren't deleted — they're still in All pieces.

### Saved layouts and views

A layout belongs to the view it was saved in, and is listed only there.
Opening it switches to that view.

### Importing into a view

Importing while a view is shown (an expansion, or sleeves from another
pattern) asks whether to **add the new pieces to that view**. They're in All
pieces either way.

Views and the view shown are saved with the project.

## What's in the exported SVG

The exported file is laid out like your pattern file, so it's easy to open in
Inkscape or Pattern Projector.

The page is **cropped to the pieces**: each sheet's part of the page is the box
round the pieces nested on it, plus 10 mm, kept within the fabric. So a few
small pieces on wide fabric come out on a small page, not a huge empty one.
Where the pieces reach the fabric's edge (the selvedge, or the start of the
length), the page and border stop there too, so you can line up against it.

### Layers

- **Calibration** — the calibration square and its label (e.g. "4 in (101.6 mm)
  square: measure to check the scale"), in a strip along the top of the page
  above the first sheet, never over a piece.
- One layer per sheet, named **Sheet 1 - *sheet name*** (just "Sheet 1" if the
  sheet has no name), then Sheet 2 and so on, one below the other.

Pattern Projector only shows what's on the SVG's page, and can switch layers on
and off — so you can turn the **Calibration** layer off once you've checked the
scale (or hide it in Inkscape).

### Inside each sheet layer

- A **Sheet border** group: a box round the pieces, at the edge of the cropped
  page (when **Draw the sheet border** is on in Settings).
- One group per piece, labelled with the piece's name (mirrored pieces add
  **(mirrored)**). Inside, using the piece number from the start of the name
  (`14` for "14 Skirt Front C1MOF"):
  - `cut-14` — the cutting line, including notches;
  - `sew-14` — the dashed sew line, set in by the seam allowance (when the piece
    has one);
  - `grain-14` — the grain line, solid;
  - `name-14` — the piece name.

The **name** is placed where the piece has most room, clear of the notches, the
sew line and (where possible) the grain line. On thin pieces it's made smaller
or turned to run along the piece; if the full name won't fit, just the piece
number is printed.

### Lines and colours

Every line is the same width — **2 mm** by default — and the colours come from
**Settings → Export**:

| Line | Default colour |
|---|---|
| Cutting line (and piece names, calibration square) | aubergine `#3b1f6e` |
| Sew line (dashed) | moss green `#4f8a26` |
| Grain line (solid) | moss green `#4f8a26` |
| Sheet border | cyan `#00ffff` |

The border is cyan so it shows up both on a white page and when Pattern
Projector inverts the colours for projecting onto fabric (a white border
vanished in one or the other). It's drawn just inside the edge of the page, so
the whole line is on the page.

### Checking the scale

After you print or project the layout, measure the calibration square:

- If it's the right size (4 inches by default), everything else is too.
- If it's bigger or smaller, your printer's "fit to page" is on or your
  projector isn't calibrated. Fix that and re-print or re-project rather than
  cut from a mis-scaled copy.

Turn the square off, or change its size, in **Settings → Export → Calibration
square**.

## Exporting a cut list

**Export → Cut list (text)** on the nest screen saves a plain-text summary of
the selected layout:

- each piece name with how many of it are placed — mirrored copies are listed on
  their own `(mirrored)` line;
- for each sheet: its size, pieces placed, **length used** and utilisation;
- the **total fabric length** to buy.

The length used is measured from the placed pieces, not the sheet you set up — so
if you allowed 3 m but the layout only needs 2.65 m, the cut list says 2.65 m.
Pieces without a name are listed under their file name, so name your pieces to
get an itemised list. Print it out to take to the fabric shop.

## Saving and reopening a project

Two buttons in the top bar:

- **Save project** — saves a `.gnp` (Grain-Nest Project) file. It suggests the
  pattern's name next to the pattern file (`Coat.svg` → `Coat.gnp`), or the
  project you opened or last saved. Keep the `.gnp` ending.
- **Open project** — opens a `.gnp` file. What's on screen is cleared and the
  saved project loaded in its place.

A project keeps your pieces with their names, grain rules, marked grain lines,
tops, mirrors and mirror copies, cut-on-fold and marked folds, quantities, seam
allowances, Nest ticks, sheets (with their names and fabrics), the Nest for
choice, Woven/Knit and Nap, your [saved layouts](#saved-layouts) (and the
last nest), and your [views](#views).

The `.gnp` file is **self-contained** — it holds a full copy of every imported
SVG, so you can move it to another computer without the original files. If you
later change the original SVG, import it again; the project's copy doesn't
update by itself.

Not saved: which preview tab was open, the zoom, and the list of results on
the nest screen (save the ones you want with **Save layout**).

## Settings

Click the **gear** icon on the left. **set all to default** at the bottom puts
everything back.

- **Nesting**
  - **Display units** — inches or mm.
  - **Space between pieces** — a gap kept around every piece.
  - **Packing style** — how the pieces are packed:
    - *Gravity* (the default) fills across the fabric's width, selvedge to
      selvedge, before using more length, so the layout takes the least length
      of fabric. Use it for most cutting: lots of pieces on fashion or lining
      fabric.
    - *Bounding box* keeps the pieces in the most compact rectangle, using
      width and length evenly. Handy for bulk-fusing interfacing: fuse one block
      of interfacing to the fashion fabric and cut the pieces from it, with as
      little interfacing wasted as possible (interfacing is usually much
      narrower than the fabric).
  - **Ask before leaving an unsaved layout** — on by default; see
    [Leaving without saving](#leaving-without-saving).
- **Seam allowance** — the default for wovens (12 mm) and knits (10 mm).
- **Cut codes**
  - **Pairs & folds from cut codes** — on by default. See
    [Pairs and folds from cut codes](#pairs-and-folds-from-cut-codes).
  - **Ask about pieces without a code** — on by default; "Don't ask again"
    in the question turns it off.
  - **Equal main & interfacing** — *Bulk-fuse* (the default: `C2M C2I` is cut
    from the fused block) or *Cut separately*.
- **Export**
  - **Draw the sheet border** — on by default; handy for lining up a projector.
  - **Gap between sheets** — space between sheets when a layout uses several.
  - **Line width** — one width for every line (2 mm by default).
  - **Cut line colour**, **Sew line colour**, **Grain line colour** and **Sheet
    border colour** — see [Lines and colours](#lines-and-colours).
  - **Calibration square** — on or off, and its size (4 inches by default).
- **Advanced** (folded away) — curve and endpoint tolerances, **Rotations for
  Free pieces** (how many turns a *Free* piece may try — it doesn't affect any
  other rule), the scale for SVG files without units, and two settings for the
  layout search. You shouldn't normally need these.

## Other handy bits

- **Dark mode** — the dark-mode button at the bottom of the left-hand bar
  switches between light and dark. Grain-Nest remembers your choice.
- **Info tab** — the info button on the left-hand bar shows the version you're running,
  where Grain-Nest comes from, a link to its source code and its licences.
- **Update notice** — when a newer version of Grain-Nest is published, a notice
  pops up a few seconds after you open the app, with a link to download it.
  Click **OK** and it won't show again for that version.
- **Keyboard**
  - **Delete** or **Backspace** deletes the selected rows (after asking) — but
    never while you're typing in a box, or while marking.
  - **Esc** cancels Mark grain, Re-mark or Mark fold.

## Example files

Two example files come with Grain-Nest:

- [example-pattern.svg](../examples/example-pattern.svg) — a made-up dress
  pattern set out the recommended way: one **Pieces** layer, and a group per
  piece (labelled like `2 Bodice Back C2M`) holding its cutting line and its
  `grain-<n>` grain line. The cut-on-fold pieces have their grain line on the
  fold edge, and the notches are short sub-paths of the cutting line. Open it in
  Inkscape to see how a piece is put together, or import it into Grain-Nest to
  try things out.
- [example-export.svg](../examples/example-export.svg) — that pattern nested on a
  150 cm × 3 m sheet: the OF pieces cut on the fold, and the C2 pieces with
  mirror copies. It shows the layers and groups described in
  [What's in the exported SVG](#whats-in-the-exported-svg).

## Common things that go wrong

- **A piece comes in as Free when it has a grain line.** The line wasn't
  recognised: check it's straight with two points, and that its ID contains
  `grain` (or its Label is exactly `grainline`) — a Label of just "Grain" isn't
  enough. See [Setting up a pattern in Inkscape](#setting-up-a-pattern-in-inkscape).
  Or simply click **Mark grain**.
- **A piece is missing, or a cutting line comes in as several pieces.** The
  cutting line probably isn't one closed shape — join its ends in Inkscape.
- **Every piece has the same name, or the wrong one.** Check the Label on each
  piece's group, and that the cutting line hasn't got a different Label of its
  own.
- **Cut on fold says it can't fold the piece, or doubles it the wrong way.** The
  grain line isn't on the fold edge. Click **Unfold** if needed, then **Mark
  fold** and click the fold edge in the preview.
- **A piece is upside down in the layout.** Click **Flip top** and nest again.
- **A piece is turned the wrong way.** Check its grain rule — **Bias** and
  **Grain or flipped** turn pieces on purpose. A bias piece whose pattern
  already draws the grain diagonally wants **Lock to grain**.
- **A piece doesn't show up under a Nest for job.** Check its cut code is
  written exactly (capital C, capital letter, separate word), then pick another
  job and back to re-sort.
- **The dashed grain line looks a bit off after marking.** That's fine — only the
  angle is stored, drawn through the middle of the piece. If the angle looks
  wrong, click **Re-mark**.
- **The layout uses more fabric than expected.** Try leaving the nest running
  longer, picking the shortest layout in **best nests so far**, choosing
  **Gravity** in Settings, or giving plain fabrics **Grain or flipped**.

## Things this version doesn't do (yet)

- **Pattern matching** (stripes and checks).
- **Tighter nests.** The layout search could sometimes pack pieces more tightly;
  the "best nests so far" list (complete layouts first, then least fabric)
  helps you pick the tightest one meanwhile.
- **Grain tolerance setting.** The Custom tolerance rule is fixed at ±3°.

## Where else to look

- [README](../README.md) — overview, installing and building from source.
