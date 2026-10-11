/*!
 * Deepnest
 * Licensed under GPLv3
 *
 * Modified for Grain-Nest from May 2026 onwards (grain rules, cutting on
 * the fold, mirrored pieces, nap, seam allowances). See the repository's
 * commit history for each change.
 */

import { Point } from '../build/util/point.js';
import { HullPolygon } from '../build/util/HullPolygon.js';

var config = {
  clipperScale: 10000000,
  curveTolerance: 0.3,
  spacing: 0,
  rotations: 4,
  populationSize: 10,
  mutationRate: 10,
  threads: 4,
  placementType: "gravity",
  mergeLines: false, // v1.3.0: laser options retired (see ConfigService)
  timeRatio: 0, // v1.3.0: nests are scored on fabric only
  scale: 72,
  simplify: false,
  overlapTolerance: 0.0001,
};

export class DeepNest {
  constructor(eventEmitter) {
    var svg = null;

    // list of imported files
    // import: {filename: 'blah.svg', svg: svgroot}
    this.imports = [];

    // list of all extracted parts
    // part: {name: 'part name', quantity: ...}
    this.parts = [];

    // a pure polygonal representation of parts that lives only during the nesting step
    this.partsTree = [];

    this.working = false;

    this.GA = null;
    this.workerTimer = null;

    this.progressCallback = null;
    this.displayCallback = null;
    // a running list of placements
    this.nests = [];

    // §9.3.4: Directional-print / nap toggle. When true, the rotation
    // set returned by grainRuleToRotations is reduced to one direction
    // per piece (no 0°/180° flipping, bias to a single diagonal) so a
    // napped fabric (velvet, corduroy, directional print) doesn't end
    // up with pieces oriented inconsistently down the bolt. Ephemeral
    // per session; saved with the project file.
    this.nap = false;

    // v1.3.0: woven or knit project — picks the default seam
    // allowance new pieces get (Settings: wovens 12 mm, knits 10 mm).
    // Saved with the project file.
    this.fabricType = "woven";

    // §9.3.10: warp direction. "horizontal" means the fabric's warp
    // threads run along the horizontal axis of the bin — grain-locked
    // pieces rotate so their grain ends at 0°. "vertical" rotates them
    // to 90° instead. Also determines which bin axis is the "length
    // being bought" for cut-list (§9.3.7) and the preset/auto-fit
    // features (§9.3.5, §9.3.6). Default "horizontal" per brief §3.3.
    //
    // Round 2: the UI picker was removed (patterns are always cut
    // warp-horizontal and the Vertical option was confusing), so this
    // stays "horizontal" for the whole session — project load pins it
    // too, ignoring any "vertical" saved by an older build. The
    // "vertical" branch below and in grainRuleToRotations is left in
    // place — dormant but correct — so reinstating the control is a
    // UI-only change (restore the <select> + the two helper fns).
    this.warpDirection = "horizontal";

    this.eventEmitter = eventEmitter;
  }

  importsvg(
    filename,
    dirpath,
    svgstring,
    scalingFactor,
    dxfFlag
  ) {
    // parse svg
    // config.scale is the default scale, and may not be applied
    // scalingFactor is an absolute scaling that must be applied regardless of input svg contents
    var svg = window.SvgParser.load(dirpath, svgstring, config.scale, scalingFactor);
    svg = window.SvgParser.cleanInput(dxfFlag);

    var imp = null;
    if (filename) {
      imp = {
        filename: filename,
        // v1.8.0: the pattern's folder, so Save and Export can suggest
        // saving next to it.
        dirpath: dirpath || null,
        svg: svg,
      };
      this.imports.push(imp);
    }

    var parts = this.getParts(svg.children, filename);
    for (var i = 0; i < parts.length; i++) {
      // v1.1.1: the part's fixed position among this import's parts, so a
      // saved project can find it again however the list was sorted or
      // pruned since (see ProjectService save/load).
      if (filename) parts[i].importPartIndex = i;
      // v1.3.0: and which import it came from — the same file imported
      // twice has two imports with one filename. Not saved (an object).
      if (imp) parts[i].importRef = imp;
      this.parts.push(parts[i]);
    }

    return parts;
  };

  // debug function
  renderPolygon(poly, svg, highlight) {
    if (!poly || poly.length == 0) {
      return;
    }
    var polyline = window.document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline"
    );

    for (var i = 0; i < poly.length; i++) {
      var p = svg.createSVGPoint();
      p.x = poly[i].x;
      p.y = poly[i].y;
      polyline.points.appendItem(p);
    }
    if (highlight) {
      polyline.setAttribute("class", highlight);
    }
    svg.appendChild(polyline);
  };

  // debug function
  renderPoints(points, svg, highlight) {
    for (var i = 0; i < points.length; i++) {
      var circle = window.document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      circle.setAttribute("r", "5");
      circle.setAttribute("cx", points[i].x);
      circle.setAttribute("cy", points[i].y);
      circle.setAttribute("class", highlight);

      svg.appendChild(circle);
    }
  };

  getHull(polygon) {
    var points = [];
    for (let i = 0; i < polygon.length; i++) {
      points.push({
        x: polygon[i].x,
        y: polygon[i].y
      });
    }
    var hullpoints = HullPolygon.hull(points);

    if (!hullpoints) {
      return null;
    }
    return hullpoints;
  };

  // use RDP simplification, then selectively offset
  simplifyPolygon(polygon, inside) {
    var tolerance = 4 * config.curveTolerance;

    // give special treatment to line segments above this length (squared)
    var fixedTolerance =
      40 * config.curveTolerance * 40 * config.curveTolerance;
    var i, j, k;
    var self = this;

    if (config.simplify) {
      /*
      // use convex hull
      var hull = new ConvexHullGrahamScan();
      for(var i=0; i<polygon.length; i++){
        hull.addPoint(polygon[i].x, polygon[i].y);
      }

      return hull.getHull();*/
      var hull = this.getHull(polygon);
      if (hull) {
        return hull;
      } else {
        return polygon;
      }
    }

    var cleaned = this.cleanPolygon(polygon);
    if (cleaned && cleaned.length > 1) {
      polygon = cleaned;
    } else {
      return polygon;
    }

    // polygon to polyline
    var copy = polygon.slice(0);
    copy.push(copy[0]);

    // mark all segments greater than ~0.25 in to be kept
    // the PD simplification algo doesn't care about the accuracy of long lines, only the absolute distance of each point
    // we care a great deal
    for (var i = 0; i < copy.length - 1; i++) {
      var p1 = copy[i];
      var p2 = copy[i + 1];
      var sqd = (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);
      if (sqd > fixedTolerance) {
        p1.marked = true;
        p2.marked = true;
      }
    }

    // Ramer-Douglas-Peucker via util/simplify.js (simplify-js, BSD-2-Clause),
    // loaded as a script in index.html. Until v1.5.1 this called the identical
    // Rust port in @deepnest/svg-preprocessor.
    var simple = window.simplify(copy, tolerance, true);
    // now a polygon again
    simple.pop();

    // could be dirty again (self intersections and/or coincident points)
    simple = this.cleanPolygon(simple);

    // simplification process reduced poly to a line or point
    if (!simple) {
      simple = polygon;
    }

    var offsets = this.polygonOffset(simple, inside ? -tolerance : tolerance);

    var offset = null;
    var offsetArea = 0;
    var holes = [];
    for (i = 0; i < offsets.length; i++) {
      var area = GeometryUtil.polygonArea(offsets[i]);
      if (offset == null || area < offsetArea) {
        offset = offsets[i];
        offsetArea = area;
      }
      if (area > 0) {
        holes.push(offsets[i]);
      }
    }

    // mark any points that are exact
    for (var i = 0; i < simple.length; i++) {
      var seg = [simple[i], simple[i + 1 == simple.length ? 0 : i + 1]];
      var index1 = find(seg[0], polygon);
      var index2 = find(seg[1], polygon);

      if (
        index1 + 1 == index2 ||
        index2 + 1 == index1 ||
        (index1 == 0 && index2 == polygon.length - 1) ||
        (index2 == 0 && index1 == polygon.length - 1)
      ) {
        seg[0].exact = true;
        seg[1].exact = true;
      }
    }

    var numshells = 4;
    var shells = [];

    for (var j = 1; j < numshells; j++) {
      var delta = j * (tolerance / numshells);
      delta = inside ? -delta : delta;
      var shell = this.polygonOffset(simple, delta);
      if (shell.length > 0) {
        shell = shell[0];
      }
      shells[j] = shell;
    }

    if (!offset) {
      return polygon;
    }

    // selective reversal of offset
    for (var i = 0; i < offset.length; i++) {
      var o = offset[i];
      var target = getTarget(o, simple, 2 * tolerance);

      // reverse point offset and try to find exterior points
      var test = clone(offset);
      test[i] = { x: target.x, y: target.y };

      if (!exterior(test, polygon, inside)) {
        o.x = target.x;
        o.y = target.y;
      } else {
        // a shell is an intermediate offset between simple and offset
        for (var j = 1; j < numshells; j++) {
          if (shells[j]) {
            var shell = shells[j];
            var delta = j * (tolerance / numshells);
            target = getTarget(o, shell, 2 * delta);
            var test = clone(offset);
            test[i] = { x: target.x, y: target.y };
            if (!exterior(test, polygon, inside)) {
              o.x = target.x;
              o.y = target.y;
              break;
            }
          }
        }
      }
    }

    // straighten long lines
    // a rounded rectangle would still have issues at this point, as the long sides won't line up straight

    var straightened = false;

    for (var i = 0; i < offset.length; i++) {
      var p1 = offset[i];
      var p2 = offset[i + 1 == offset.length ? 0 : i + 1];

      var sqd = (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);

      if (sqd < fixedTolerance) {
        continue;
      }
      for (var j = 0; j < simple.length; j++) {
        var s1 = simple[j];
        var s2 = simple[j + 1 == simple.length ? 0 : j + 1];

        var sqds =
          (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);

        if (sqds < fixedTolerance) {
          continue;
        }

        if (
          (GeometryUtil.almostEqual(s1.x, s2.x) ||
            GeometryUtil.almostEqual(s1.y, s2.y)) && // we only really care about vertical and horizontal lines
          GeometryUtil.withinDistance(p1, s1, 2 * tolerance) &&
          GeometryUtil.withinDistance(p2, s2, 2 * tolerance) &&
          (!GeometryUtil.withinDistance(
            p1,
            s1,
            config.curveTolerance / 1000
          ) ||
            !GeometryUtil.withinDistance(
              p2,
              s2,
              config.curveTolerance / 1000
            ))
        ) {
          p1.x = s1.x;
          p1.y = s1.y;
          p2.x = s2.x;
          p2.y = s2.y;
          straightened = true;
        }
      }
    }

    //if(straightened){
    var Ac = toClipperCoordinates(offset);
    ClipperLib.JS.ScaleUpPath(Ac, 10000000);
    var Bc = toClipperCoordinates(polygon);
    ClipperLib.JS.ScaleUpPath(Bc, 10000000);

    var combined = new ClipperLib.Paths();
    var clipper = new ClipperLib.Clipper();

    clipper.AddPath(Ac, ClipperLib.PolyType.ptSubject, true);
    clipper.AddPath(Bc, ClipperLib.PolyType.ptSubject, true);

    // the line straightening may have made the offset smaller than the simplified
    if (
      clipper.Execute(
        ClipperLib.ClipType.ctUnion,
        combined,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero
      )
    ) {
      var largestArea = null;
      for (var i = 0; i < combined.length; i++) {
        var n = toNestCoordinates(combined[i], 10000000);
        var sarea = -GeometryUtil.polygonArea(n);
        if (largestArea === null || largestArea < sarea) {
          offset = n;
          largestArea = sarea;
        }
      }
    }
    //}

    cleaned = this.cleanPolygon(offset);
    if (cleaned && cleaned.length > 1) {
      offset = cleaned;
    }

    // mark any points that are exact (for line merge detection)
    for (var i = 0; i < offset.length; i++) {
      var seg = [offset[i], offset[i + 1 == offset.length ? 0 : i + 1]];
      var index1 = find(seg[0], polygon);
      var index2 = find(seg[1], polygon);

      if (
        index1 + 1 == index2 ||
        index2 + 1 == index1 ||
        (index1 == 0 && index2 == polygon.length - 1) ||
        (index2 == 0 && index1 == polygon.length - 1)
      ) {
        seg[0].exact = true;
        seg[1].exact = true;
      }
    }

    if (!inside && holes && holes.length > 0) {
      offset.children = holes;
    }

    return offset;

    function getTarget(point, simple, tol) {
      var inrange = [];
      // find closest points within 2 offset deltas
      for (var j = 0; j < simple.length; j++) {
        var s = simple[j];
        var d2 = (o.x - s.x) * (o.x - s.x) + (o.y - s.y) * (o.y - s.y);
        if (d2 < tol * tol) {
          inrange.push({ point: s, distance: d2 });
        }
      }

      var target;
      if (inrange.length > 0) {
        var filtered = inrange.filter(function (p) {
          return p.point.exact;
        });

        // use exact points when available, normal points when not
        inrange = filtered.length > 0 ? filtered : inrange;

        inrange.sort(function (a, b) {
          return a.distance - b.distance;
        });

        target = inrange[0].point;
      } else {
        var mind = null;
        for (var j = 0; j < simple.length; j++) {
          var s = simple[j];
          var d2 = (o.x - s.x) * (o.x - s.x) + (o.y - s.y) * (o.y - s.y);
          if (mind === null || d2 < mind) {
            target = s;
            mind = d2;
          }
        }
      }

      return target;
    }

    // returns true if any complex vertices fall outside the simple polygon
    function exterior(simple, complex, inside) {
      // find all protruding vertices
      for (var i = 0; i < complex.length; i++) {
        var v = complex[i];
        if (
          !inside &&
          !self.pointInPolygon(v, simple) &&
          find(v, simple) === null
        ) {
          return true;
        }
        if (
          inside &&
          self.pointInPolygon(v, simple) &&
          !find(v, simple) === null
        ) {
          return true;
        }
      }
      return false;
    }

    function toClipperCoordinates(polygon) {
      var clone = [];
      for (var i = 0; i < polygon.length; i++) {
        clone.push({
          X: polygon[i].x,
          Y: polygon[i].y,
        });
      }

      return clone;
    }

    function toNestCoordinates(polygon, scale) {
      var clone = [];
      for (var i = 0; i < polygon.length; i++) {
        clone.push({
          x: polygon[i].X / scale,
          y: polygon[i].Y / scale,
        });
      }

      return clone;
    }

    function find(v, p) {
      for (var i = 0; i < p.length; i++) {
        if (
          GeometryUtil.withinDistance(v, p[i], config.curveTolerance / 1000)
        ) {
          return i;
        }
      }
      return null;
    }

    function clone(p) {
      var newp = [];
      for (var i = 0; i < p.length; i++) {
        newp.push({
          x: p[i].x,
          y: p[i].y,
        });
      }

      return newp;
    }
  };

  config(c) {
    // clean up inputs

    if (!c) {
      return config;
    }

    if (
      c.curveTolerance &&
      !GeometryUtil.almostEqual(parseFloat(c.curveTolerance), 0)
    ) {
      config.curveTolerance = parseFloat(c.curveTolerance);
    }

    if ("spacing" in c) {
      config.spacing = parseFloat(c.spacing);
    }

    if (c.rotations && parseInt(c.rotations) > 0) {
      config.rotations = parseInt(c.rotations);
    }

    if (c.populationSize && parseInt(c.populationSize) > 2) {
      config.populationSize = parseInt(c.populationSize);
    }

    if (c.mutationRate && parseInt(c.mutationRate) > 0) {
      config.mutationRate = parseInt(c.mutationRate);
    }

    if (c.threads && parseInt(c.threads) > 0) {
      // max 8 threads
      config.threads = Math.min(parseInt(c.threads), 8);
    }

    if (c.placementType) {
      config.placementType = String(c.placementType);
    }

    if (c.mergeLines === true || c.mergeLines === false) {
      config.mergeLines = !!c.mergeLines;
    }

    if (c.simplify === true || c.simplify === false) {
      config.simplify = !!c.simplify;
    }

    var n = Number(c.timeRatio);
    if (typeof n == "number" && !isNaN(n) && isFinite(n)) {
      config.timeRatio = n;
    }

    if (c.scale && parseFloat(c.scale) > 0) {
      config.scale = parseFloat(c.scale);
    }

    window.SvgParser.config({
      tolerance: config.curveTolerance,
      endpointTolerance: c.endpointTolerance,
    });

    //nfpCache = {};
    //binPolygon = null;
    this.GA = null;

    return config;
  };

  pointInPolygon(point, polygon) {
    // scaling is deliberately coarse to filter out points that lie *on* the polygon
    var p = this.svgToClipper(polygon, 1000);
    var pt = new ClipperLib.IntPoint(1000 * point.x, 1000 * point.y);

    return ClipperLib.Clipper.PointInPolygon(pt, p) > 0;
  };

  /*this.simplifyPolygon = function(polygon, concavehull){
    function clone(p){
      var newp = [];
      for(var i=0; i<p.length; i++){
        newp.push({
          x: p[i].x,
          y: p[i].y
          //fuck: p[i].fuck
        });
      }
      return newp;
    }
    if(concavehull){
      var hull = concavehull;
    }
    else{
      var hull = new ConvexHullGrahamScan();
      for(var i=0; i<polygon.length; i++){
        hull.addPoint(polygon[i].x, polygon[i].y);
      }

      hull = hull.getHull();
    }

    var hullarea = Math.abs(GeometryUtil.polygonArea(hull));

    var concave = [];
    var detail = [];

    // fill concave[] with convex points, ensuring same order as initial polygon
    for(i=0; i<polygon.length; i++){
      var p = polygon[i];
      var found = false;
      for(var j=0; j<hull.length; j++){
        var hp = hull[j];
        if(GeometryUtil.almostEqual(hp.x, p.x) && GeometryUtil.almostEqual(hp.y, p.y)){
          found = true;
          break;
        }
      }

      if(found){
        concave.push(p);
        //p.fuck = i+'yes';
      }
      else{
        detail.push(p);
        //p.fuck = i+'no';
      }
    }

    var cindex = -1;
    var simple = [];

    for(i=0; i<polygon.length; i++){
      var p = polygon[i];
      if(concave.indexOf(p) > -1){
        cindex = concave.indexOf(p);
        simple.push(p);
      }
      else{

        var test = clone(concave);
        test.splice(cindex < 0 ? 0 : cindex+1,0,p);

        var outside = false;
        for(var j=0; j<detail.length; j++){
          if(detail[j] == p){
            continue;
          }
          if(!this.pointInPolygon(detail[j], test)){
            //console.log(detail[j], test);
            outside = true;
            break;
          }
        }

        if(outside){
          continue;
        }

        var testarea =  Math.abs(GeometryUtil.polygonArea(test));
        //console.log(testarea, hullarea);
        if(testarea/hullarea < 0.98){
          simple.push(p);
        }
      }
    }

    return simple;
  }*/

  // assuming no intersections, return a tree where odd leaves are parts and even ones are holes
  // might be easier to use the DOM, but paths can't have paths as children. So we'll just make our own tree.
  getParts(paths, filename) {
    var j;
    var polygons = [];

    var numChildren = paths.length;
    for (var i = 0; i < numChildren; i++) {
      if (window.SvgParser.polygonElements.indexOf(paths[i].tagName) < 0) {
        continue;
      }

      // don't use open paths
      if (!window.SvgParser.isClosed(paths[i], 2 * config.curveTolerance)) {
        continue;
      }

      var poly = window.SvgParser.polygonify(paths[i]);
      poly = this.cleanPolygon(poly);

      // todo: warn user if poly could not be processed and is excluded from the nest
      if (
        poly &&
        poly.length > 2 &&
        Math.abs(GeometryUtil.polygonArea(poly)) >
        config.curveTolerance * config.curveTolerance
      ) {
        poly.source = i;
        polygons.push(poly);
      }
    }

    // turn the list into a tree
    // root level nodes of the tree are parts
    toTree(polygons);

    function toTree(list, idstart) {
      function svgToClipper(polygon) {
        var clip = [];
        for (var i = 0; i < polygon.length; i++) {
          clip.push({ X: polygon[i].x, Y: polygon[i].y });
        }

        ClipperLib.JS.ScaleUpPath(clip, config.clipperScale);

        return clip;
      }
      function pointInClipperPolygon(point, polygon) {
        var pt = new ClipperLib.IntPoint(
          config.clipperScale * point.x,
          config.clipperScale * point.y
        );

        return ClipperLib.Clipper.PointInPolygon(pt, polygon) > 0;
      }
      var parents = [];

      // assign a unique id to each leaf
      var id = idstart || 0;

      for (var i = 0; i < list.length; i++) {
        var p = list[i];

        var ischild = false;
        for (var j = 0; j < list.length; j++) {
          if (j == i) {
            continue;
          }
          if (p.length < 2) {
            continue;
          }
          var inside = 0;
          var fullinside = Math.min(10, p.length);

          // sample about 10 points
          var clipper_polygon = svgToClipper(list[j]);

          for (var k = 0; k < fullinside; k++) {
            if (pointInClipperPolygon(p[k], clipper_polygon) === true) {
              inside++;
            }
          }

          //console.log(inside, fullinside);

          if (inside > 0.5 * fullinside) {
            if (!list[j].children) {
              list[j].children = [];
            }
            list[j].children.push(p);
            p.parent = list[j];
            ischild = true;
            break;
          }
        }

        if (!ischild) {
          parents.push(p);
        }
      }

      for (var i = 0; i < list.length; i++) {
        if (parents.indexOf(list[i]) < 0) {
          list.splice(i, 1);
          i--;
        }
      }

      for (var i = 0; i < parents.length; i++) {
        parents[i].id = id;
        id++;
      }

      for (var i = 0; i < parents.length; i++) {
        if (parents[i].children) {
          id = toTree(parents[i].children, id);
        }
      }

      return id;
    }

    // construct part objects with metadata
    var parts = [];
    var svgelements = Array.prototype.slice.call(paths);
    // §9.0.1 #1 / phase-5s: identity of the source <path> a polygon came from,
    // used to tell a piece's own interior subpaths from a genuine separate hole.
    function elementKey(el) {
      if (!el || !el.getAttribute) return null;
      return el.getAttribute("id") || el.getAttribute("inkscape:label") || null;
    }
    var openelements = svgelements.slice(); // elements that are not a part of the poly tree but may still be a part of the part (images, lines, possibly text..)

    for (var i = 0; i < polygons.length; i++) {
      var part = {};
      part.polygontree = polygons[i];
      part.svgelements = [];

      var bounds = GeometryUtil.getPolygonBounds(part.polygontree);
      part.bounds = bounds;
      part.area = bounds.width * bounds.height;
      part.quantity = 1;
      part.filename = filename;
      part.grainRule = "free";

      // §9.3.12: best-effort piece name from the source SVG, so the cut
      // list can itemise pieces (front, back, …) instead of merging them
      // under one filename. extractPartName reads inkscape:label / a
      // <title> child / a meaningful id off the root element or an
      // ancestor group — the same attribute classes the grain detector
      // already relies on surviving import. Undefined when nothing usable
      // is found; the user types a name in the parts table instead.
      // §9.3.12 / phase-5r: prefer the pre-flatten data-grainnest-name tag
      // (inkscape:label/group context only survives flatten as this data
      // attribute); fall back to extractPartName for untagged / programmatic
      // elements.
      var srcEl = svgelements[part.polygontree.source];
      var detectedName =
        (srcEl && srcEl.getAttribute && srcEl.getAttribute("data-grainnest-name")) ||
        extractPartName(srcEl);
      if (detectedName) {
        part.name = detectedName;
      }

      if (part.filename === "BACKGROUND.svg") {
        part.sheet = true;
      }

      // §9.3.9 / phase-5r: default seam allowance (mm) on imported pieces so
      // sew lines appear without per-piece setup (testing round 4 — "make 12mm
      // the default"). Sheets get none; per-piece edit/clear still wins, and
      // a saved .gnp value overrides this on load.
      if (!part.sheet) {
        // v1.3.0: the woven or knit default, per the project's fabric type.
        var defSeamMm = this.defaultSeamMm(this.fabricType);
        if (defSeamMm > 0) part.seamAllowance = defSeamMm;
      }

      if (
        window.config.getSync("useQuantityFromFileName") &&
        part.filename &&
        part.filename !== null
      ) {
        const fileNameParts = part.filename.split(".");
        if (fileNameParts.length >= 3) {
          const fileNameQuantityPart = fileNameParts[fileNameParts.length - 2];
          const quantity = parseInt(fileNameQuantityPart, 10);
          if (!isNaN(quantity)) {
            part.quantity = quantity;
          }
        }
      }

      // load root element
      part.svgelements.push(svgelements[part.polygontree.source]);
      var index = openelements.indexOf(svgelements[part.polygontree.source]);
      if (index > -1) {
        openelements.splice(index, 1);
      }

      // load all elements that lie within the outer polygon
      for (var j = 0; j < svgelements.length; j++) {
        if (
          j != part.polygontree.source &&
          findElementById(j, part.polygontree)
        ) {
          part.svgelements.push(svgelements[j]);
          index = openelements.indexOf(svgelements[j]);
          if (index > -1) {
            openelements.splice(index, 1);
          }
        }
      }

      // §9.0.1 / phase-5u (supersedes the 5s id-based filter): dressmaking
      // pieces are SOLID — interior marks (drill dots, notches, grain/welt
      // annotations) are not cut-outs to nest other pieces into. flatten splits
      // them into separate paths, sometimes sharing the piece's id (caught by
      // 5s), sometimes not (Test Pattern 2's <g>-grouped marks have different
      // ids and slipped through). The robust rule: a non-sheet part nests as its
      // outer boundary. Drop ALL holes from the NESTING polygon; the marks stay
      // in part.svgelements, so they still render and export on the cut piece.
      // A genuine cut-out is still drawn/cut from svgelements — we just never
      // pack another piece into it, which is the correct, safe choice for fabric.
      if (
        !part.sheet &&
        part.polygontree.children &&
        part.polygontree.children.length
      ) {
        if (grainnestDebugEnabled()) {
          var _dropped = part.polygontree.children.map(function (c) {
            var b = GeometryUtil.getPolygonBounds(c);
            return b ? Math.round(b.width) + "x" + Math.round(b.height) : "?";
          });
          console.log(
            "[grainnest] solid-piece: dropped " + _dropped.length +
              " hole(s) from " +
              (elementKey(svgelements[part.polygontree.source]) || "part") +
              " [" + _dropped.join(", ") + "]",
          );
        }
        part.polygontree.children = [];
      }

      parts.push(part);
    }

    function findElementById(id, tree) {
      if (id == tree.source) {
        return true;
      }

      if (tree.children && tree.children.length > 0) {
        for (var i = 0; i < tree.children.length; i++) {
          if (findElementById(id, tree.children[i])) {
            return true;
          }
        }
      }

      return false;
    }

    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      // the elements left are either erroneous or open
      // we want to include open segments that also lie within the part boundaries
      for (var j = 0; j < openelements.length; j++) {
        var el = openelements[j];
        if (el.tagName == "line") {
          var x1 = Number(el.getAttribute("x1"));
          var x2 = Number(el.getAttribute("x2"));
          var y1 = Number(el.getAttribute("y1"));
          var y2 = Number(el.getAttribute("y2"));
          var start = { x: x1, y: y1 };
          var end = { x: x2, y: y2 };
          var mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

          if (
            this.pointInPolygon(start, part.polygontree) === true ||
            this.pointInPolygon(end, part.polygontree) === true ||
            this.pointInPolygon(mid, part.polygontree) === true
          ) {
            part.svgelements.push(el);
            recordGrainIfTagged(part, el);
            openelements.splice(j, 1);
            j--;
          }
        } else if (el.tagName == "image") {
          var x = Number(el.getAttribute("x"));
          var y = Number(el.getAttribute("y"));
          var width = Number(el.getAttribute("width"));
          var height = Number(el.getAttribute("height"));

          var mid = new Point(x + width / 2, y + height / 2);

          var transformString = el.getAttribute("transform");
          if (transformString) {
            var transform = window.SvgParser.transformParse(transformString);
            if (transform) {
              mid = transform.calc(mid);
            }
          }
          // just test midpoint for images
          if (this.pointInPolygon(mid, part.polygontree) === true) {
            part.svgelements.push(el);
            openelements.splice(j, 1);
            j--;
          }
        } else if (
          el.tagName == "path" ||
          el.tagName == "polyline" ||
          el.tagName == "polygon"
        ) {
          var k;
          if (el.tagName == "path") {
            var p = window.SvgParser.polygonifyPath(el);
          } else {
            // polyline + polygon both expose SVGPointList via el.points
            var p = [];
            for (k = 0; k < el.points.length; k++) {
              p.push({
                x: el.points[k].x,
                y: el.points[k].y,
              });
            }
          }

          if (p.length < 2) {
            continue;
          }

          var found = false;
          var next = p[1];
          for (k = 0; k < p.length; k++) {
            if (this.pointInPolygon(p[k], part.polygontree) === true) {
              found = true;
              break;
            }

            if (k >= p.length - 1) {
              next = p[0];
            } else {
              next = p[k + 1];
            }

            // also test for midpoints in case of single line edge case
            var mid = {
              x: (p[k].x + next.x) / 2,
              y: (p[k].y + next.y) / 2,
            };
            if (this.pointInPolygon(mid, part.polygontree) === true) {
              found = true;
              break;
            }
          }
          if (found) {
            part.svgelements.push(el);
            recordGrainIfTagged(part, el);
            openelements.splice(j, 1);
            j--;
          }
        } else {
          // something went wrong
          //console.log('part not processed: ',el);
        }
      }
    }

    // §phase-5r: a grain/fold line drawn ON a piece's outline edge (e.g. the
    // fold edge of a cut-on-fold half-piece) lies on the polygon boundary, so
    // every pointInPolygon test above is false and it's left unattached —
    // leaving the piece "Free" and breaking Cut-on-fold even though the grain
    // was correctly detected. Rescue any still-unattached *tagged* grain/fold
    // element by attaching it to the part whose bounding box contains its
    // midpoint (bbox includes the boundary, unlike pointInPolygon). At import
    // the pieces are at their original, non-overlapping positions, so the bbox
    // hit is unambiguous. (testing round 4: real grains sit on the fold edge.)
    var grainMidpoint = function (el) {
      if (!el || !el.tagName) return null;
      if (el.tagName === "line") {
        var lx1 = Number(el.getAttribute("x1")),
          ly1 = Number(el.getAttribute("y1")),
          lx2 = Number(el.getAttribute("x2")),
          ly2 = Number(el.getAttribute("y2"));
        return isFinite(lx1) && isFinite(ly1) && isFinite(lx2) && isFinite(ly2)
          ? { x: (lx1 + lx2) / 2, y: (ly1 + ly2) / 2 }
          : null;
      }
      if (el.tagName === "path") {
        var ep = window.SvgParser.pathEndpoints(el.getAttribute("d") || "");
        return ep ? { x: (ep.x1 + ep.x2) / 2, y: (ep.y1 + ep.y2) / 2 } : null;
      }
      if (
        (el.tagName === "polyline" || el.tagName === "polygon") &&
        el.points &&
        el.points.length
      ) {
        var a = el.points[0],
          b = el.points[el.points.length - 1];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      return null;
    };
    if (grainnestDebugEnabled()) {
      console.log(
        "[grainnest] part bounds:",
        parts.map(function (p, ix) {
          return {
            ix: ix,
            sheet: !!p.sheet,
            b: p.bounds
              ? [
                  Math.round(p.bounds.x),
                  Math.round(p.bounds.y),
                  Math.round(p.bounds.width),
                  Math.round(p.bounds.height),
                ]
              : null,
          };
        }),
      );
    }
    for (var gi = 0; gi < openelements.length; gi++) {
      var gel = openelements[gi];
      if (
        !gel.getAttribute ||
        (gel.getAttribute("data-grainnest-grain") !== "1" &&
          gel.getAttribute("data-grainnest-fold") !== "1")
      ) {
        continue;
      }
      var matchedPart = -1;
      // Primary: shared SVG piece-group with a part's source element — the
      // grain and its outline are siblings in the same <g>. Geometry-
      // independent, so it works even when the grain's baked position lands
      // off the piece (the Inkscape transform quirk — testing round 4).
      var grp = gel.getAttribute("data-grainnest-group");
      if (grp) {
        for (var gp = 0; gp < parts.length; gp++) {
          if (parts[gp].sheet) continue;
          var srcEl = svgelements[parts[gp].polygontree.source];
          if (
            srcEl &&
            srcEl.getAttribute &&
            srcEl.getAttribute("data-grainnest-group") === grp
          ) {
            matchedPart = gp;
            break;
          }
        }
      }
      // Fallback: the part whose bounding box contains the grain's midpoint.
      var gmp = grainMidpoint(gel);
      if (matchedPart === -1 && gmp) {
        for (var gp2 = 0; gp2 < parts.length; gp2++) {
          var gb = parts[gp2].bounds;
          if (
            gb &&
            !parts[gp2].sheet &&
            gmp.x >= gb.x &&
            gmp.x <= gb.x + gb.width &&
            gmp.y >= gb.y &&
            gmp.y <= gb.y + gb.height
          ) {
            matchedPart = gp2;
            break;
          }
        }
      }
      if (matchedPart !== -1) {
        parts[matchedPart].svgelements.push(gel);
        recordGrainIfTagged(parts[matchedPart], gel);
        openelements.splice(gi, 1);
        gi--;
      }
      if (grainnestDebugEnabled()) {
        console.log(
          "[grainnest] grain-rescue id=" +
            (gel.getAttribute("id") || "") +
            " group=" +
            (grp || "") +
            " mid=" +
            (gmp ? Math.round(gmp.x) + "," + Math.round(gmp.y) : "null") +
            " matchedPart=" +
            matchedPart,
        );
      }
    }

    if (grainnestDebugEnabled()) {
      console.log(
        "[grainnest] getParts done for " + filename + ":",
        parts.map(function (p, idx) {
          return {
            idx: idx,
            filename: p.filename,
            sheet: !!p.sheet,
            grainRule: p.grainRule,
            grainSource: p.grainSource,
            grainAngle: p.grainAngle,
            elementTags: (p.svgelements || []).map(function (e) {
              return (
                e.tagName +
                (e.getAttribute && e.getAttribute("data-grainnest-grain") === "1"
                  ? "[grain]"
                  : "")
              );
            }),
          };
        })
      );
      console.log(
        "[grainnest] openelements left unattached:",
        openelements.map(function (e) {
          return (
            e.tagName +
            (e.getAttribute && e.getAttribute("data-grainnest-grain") === "1"
              ? "[grain]"
              : "")
          );
        })
      );

      try {
        var dbgFs = require("fs");
        var dbgPath = require("path").join(
          require("os").tmpdir(),
          "grainnest-parts-debug.json"
        );
        dbgFs.writeFileSync(
          dbgPath,
          JSON.stringify(
            {
              filename: filename,
              partCount: parts.length,
              parts: parts.map(function (p, idx) {
                var tree = p.polygontree || [];
                function elDesc(srcIdx) {
                  var e = svgelements[srcIdx];
                  if (!e || !e.getAttribute) return { src: srcIdx };
                  return {
                    src: srcIdx,
                    tag: e.tagName,
                    id: e.getAttribute("id"),
                    label: e.getAttribute("inkscape:label"),
                  };
                }
                return {
                  idx: idx,
                  el: elDesc(tree.source),
                  w: p.bounds ? Math.round(p.bounds.width) : null,
                  h: p.bounds ? Math.round(p.bounds.height) : null,
                  points: tree.length,
                  holes: tree.children
                    ? tree.children.map(function (c) {
                        var b = GeometryUtil.getPolygonBounds(c);
                        return {
                          el: elDesc(c.source),
                          w: b ? Math.round(b.width) : null,
                          h: b ? Math.round(b.height) : null,
                          points: c.length,
                        };
                      })
                    : [],
                  grainRule: p.grainRule,
                };
              }),
            },
            null,
            2
          )
        );
        console.log("[grainnest] wrote parts debug to " + dbgPath);
      } catch (e) {
        console.log("[grainnest] parts debug write failed: " + e.message);
      }
    }

    for (j = 0; j < openelements.length; j++) {
      var el = openelements[j];
      if (
        el.tagName == "line" ||
        el.tagName == "polyline" ||
        el.tagName == "path"
      ) {
        // Don't flag unmatched grain lines as errors — they are valid
        // metadata that just couldn't be associated with a piece (e.g.
        // grain drawn outside the cut boundary). Leave them alone.
        if (el.getAttribute && el.getAttribute("data-grainnest-grain") === "1") {
          continue;
        }
        el.setAttribute("class", "error");
      }
    }

    // For any non-sheet part without a detected grain, mark it as
    // "manual-required" so Phase 4 knows to surface it for user
    // marking. Pieces with a detected grain were already updated above.
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i].sheet && !parts[i].grainSource) {
        parts[i].grainSource = "manual-required";
      }
    }

    return parts;
  };

  cloneTree(tree) {
    var newtree = [];
    tree.forEach(function (t) {
      newtree.push({ x: t.x, y: t.y, exact: t.exact });
    });

    var self = this;
    if (tree.children && tree.children.length > 0) {
      newtree.children = [];
      tree.children.forEach(function (c) {
        newtree.children.push(self.cloneTree(c));
      });
    }

    return newtree;
  };

  // §9.3.2 mirror toggle — behaviour 1 (Mirror, replace).
  //
  // Toggles the mirror flag on the part at `partIndex`, mirrors its
  // polygontree and grain angle about the bounding-box vertical centre
  // line, and notifies Ractive. svgelements are left untouched — the
  // visual flip is composed at render/export time via a `scale(-1, 1)`
  // transform that picks up off `part.mirror`.
  //
  // Toggling a second time un-mirrors (the polygontree is mirrored
  // about the same axis a second time, which undoes the first
  // operation; the flag flips back to false).
  mirrorPart(partIndex) {
    var part = this.parts[partIndex];
    if (!part || part.sheet) return;
    var axisX = part.bounds.x + part.bounds.width / 2;
    mirrorPolygontreeX(part.polygontree, axisX);
    // v1.5.0: a cut-on-fold piece keeps its unfolded half for Unfold; flip
    // it too, so unfolding a mirrored piece gives the mirrored half.
    if (part._foldHalfTree) mirrorPolygontreeX(part._foldHalfTree, axisX);
    if (typeof part.grainAngle === "number") {
      var a = ((180 - part.grainAngle) % 360 + 360) % 360;
      // phase-r8c: the top end of the grain line mirrors with the piece.
      // For every angle but 0 the folded angle already keeps the top at
      // its "+180°" end; a horizontal grain (0 -> 180 -> folded 0) swaps
      // which end that is, so swap topFlip to keep the same physical top.
      if (a >= 180) {
        a -= 180;
        part.topFlip = !part.topFlip;
      }
      part.grainAngle = a;
    }
    part.mirror = !part.mirror;
  };

  // v1.3.0: default seam allowance (mm) for a woven or knit project, from
  // Settings (wovens 12 mm, knits 10 mm by default).
  defaultSeamMm(fabricType) {
    var key =
      fabricType === "knit" ? "defaultSeamAllowanceKnitMm" : "defaultSeamAllowanceMm";
    var mm = Number(window.config.getSync(key));
    if (!isFinite(mm)) mm = fabricType === "knit" ? 10 : 12;
    return mm;
  };

  // v1.3.0: switch the project between woven and knit. Pieces still on the
  // old default seam allowance move to the new default; pieces whose seam
  // was set by hand are left alone. Returns how many pieces changed.
  setFabricType(fabricType) {
    var next = fabricType === "knit" ? "knit" : "woven";
    var oldMm = this.defaultSeamMm(this.fabricType);
    var newMm = this.defaultSeamMm(next);
    this.fabricType = next;
    var changed = 0;
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      if (p.sheet || p.seamAllowance !== oldMm || oldMm === newMm) continue;
      p.seamAllowance = newMm;
      changed++;
    }
    return changed;
  };

  // Phase R8-C: turn a piece end-to-end in the nest. grainAngle is folded
  // to [0, 180) and can't say which end of the grain line is the top, so
  // topFlip picks the other end.
  flipPartTop(partIndex) {
    var part = this.parts[partIndex];
    if (!part || part.sheet || typeof part.grainAngle !== "number") {
      return false;
    }
    part.topFlip = !part.topFlip;
    return true;
  };

  // §9.3.2 mirror toggle — behaviour 2 (Mirror, keep both).
  //
  // Creates a new part that is a mirrored copy of the part at
  // `partIndex`. Polygontree is deep-cloned and mirrored; svgelements
  // are cloneNode(true)-d so the new part owns its own DOM nodes
  // (otherwise the same element can't appear in two thumbnails). The
  // copy's quantity defaults to 1 — the user adjusts after. Pushes
  // the new part onto this.parts and returns its new index.
  mirrorCopyPart(partIndex) {
    var src = this.parts[partIndex];
    if (!src || src.sheet) return -1;
    // §9.0.1 R6-B: give the source a stable per-session id and link the
    // copy to it, so saving can record EXACTLY which part a copy mirrors.
    // The save-side filename-recency guess this replaces collapsed every
    // bulk-made copy onto the last original (testing round 6: all 11 copies
    // in a real .gnp saved as copies of part 14). Plain numbers — safe to
    // clone/serialise, never persisted in the .gnp themselves.
    if (!src.grainnestId) {
      this._partIdSeq = (this._partIdSeq || 0) + 1;
      src.grainnestId = this._partIdSeq;
    }
    var copy = {
      polygontree: this.cloneTree(src.polygontree),
      svgelements: src.svgelements.map(function (e) {
        return e.cloneNode(true);
      }),
      filename: src.filename,
      name: src.name,
      quantity: 1,
      grainRule: src.grainRule,
      grainAngle: src.grainAngle,
      grainSource: src.grainSource,
      // phase-r8c: same top as the source (mirrorPart below keeps it).
      topFlip: src.topFlip,
      // §9.0.1 R6-D (testing round 6): the copy keeps the seam allowance
      // already set on its source — a left/right pair gets the same seam.
      seamAllowance: src.seamAllowance,
      // phase-r8a: a copy starts in the same nest job as its source.
      excluded: src.excluded,
      sheet: false,
      // v1.5.0: starts in the source's state; mirrorPart below flips the
      // outline and the flag together, so the copy is the opposite of its
      // source. (It used to start false: a copy of a mirrored piece got the
      // un-mirrored outline but mirror=true, so it was drawn flipped.)
      mirror: !!src.mirror,
      // v1.5.0: a copy of a cut-on-fold piece is cut on the fold too. It
      // used to be nested as the doubled shape but drawn and exported as
      // the half, because the fold state wasn't copied.
      cutOnFold: !!src.cutOnFold,
      foldLine: src.foldLine
        ? { x0: src.foldLine.x0, y0: src.foldLine.y0, ang: src.foldLine.ang }
        : undefined,
      _foldHalfTree: src._foldHalfTree ? this.cloneTree(src._foldHalfTree) : undefined,
      markedFold: src.markedFold
        ? { x0: src.markedFold.x0, y0: src.markedFold.y0, ang: src.markedFold.ang }
        : undefined,
      // §9.3.3: tag so save/load can distinguish copies from import-
      // origin parts (they share filename but have different lineage).
      isMirrorCopy: true,
      mirrorOfId: src.grainnestId,
    };
    // polygontree.source on the cloned tree still points at the
    // *source's* index in *its* svgelements array — that's a number
    // and survives the clone unchanged, and matches the new
    // svgelements layout (we cloned them in order).
    copy.bounds = GeometryUtil.getPolygonBounds(copy.polygontree);
    copy.area = copy.bounds.width * copy.bounds.height;
    this.parts.push(copy);
    var newIndex = this.parts.length - 1;
    this.mirrorPart(newIndex);
    return newIndex;
  };

  // §9.3.2 behaviour 3 — "cut on the fold". Replace the part's polygon
  // with the *doubled* piece: the half reflected across its fold line and
  // unioned with the original, so it nests as one connected symmetric
  // piece. v1 takes the fold line
  // from getFoldLineForPart (an explicit foldline element, else the grain
  // line — which must lie on the fold edge per the pattern convention).
  // Returns true on success; false (unchanged) when there's no usable
  // fold line or the union fails. unfoldPart restores the stored half.
  foldPart(partIndex) {
    var part = this.parts[partIndex];
    if (!part || part.sheet || part.cutOnFold) return false;
    // v1.5.0: the fold line is read from the piece's own drawing (source
    // frame), so fold a mirrored piece un-mirrored and mirror it back after
    // (about the doubled piece's centre, as the export and thumbnails do).
    // Folding a mirrored piece used to reflect across the wrong line.
    if (part.mirror) {
      this.mirrorPart(partIndex);
      var ok = this.foldPart(partIndex);
      this.mirrorPart(partIndex);
      return ok;
    }
    var fold = getFoldLineForPart(part);
    // §9.0.1 / phase-5t fix: snap the axis onto the piece's true fold edge so a
    // grain line drawn a hair off the edge still doubles cleanly (piece 5's axis
    // was 2 units outside its edge → reflected half didn't touch → no merge).
    if (fold) fold = snapFoldAxisToEdge(part.polygontree, fold);

    // §9.0.1 / phase-5t: fold diagnostics on EVERY path (incl. silent failures),
    // so a piece whose "Cut on fold" does nothing still tells us why. Compares
    // the fold axis to the half's own bounds — an axis off the half means the
    // grain endpoints resolved in the wrong coordinate frame. deepnest_debug=1.
    var _half = part.polygontree
      ? GeometryUtil.getPolygonBounds(part.polygontree)
      : null;
    function _foldDbg(status, dbl) {
      if (!grainnestDebugEnabled()) return;
      try {
        var _nm = null, _se = part.svgelements || [];
        for (var _z = 0; _z < _se.length; _z++) {
          if (_se[_z] && _se[_z].getAttribute) {
            _nm = _se[_z].getAttribute("inkscape:label") || _se[_z].getAttribute("id");
            if (_nm) break;
          }
        }
        var _rec = {
          name: _nm,
          status: status,
          fold: fold && {
            x0: Math.round(fold.x0), y0: Math.round(fold.y0),
            angDeg: Math.round((fold.ang * 180) / Math.PI),
          },
          half: _half && {
            x: Math.round(_half.x), y: Math.round(_half.y),
            w: Math.round(_half.width), h: Math.round(_half.height),
          },
          foldOnHalfEdge: fold && _half
            ? fold.x0 >= _half.x - 5 && fold.x0 <= _half.x + _half.width + 5 &&
              fold.y0 >= _half.y - 5 && fold.y0 <= _half.y + _half.height + 5
            : null,
          doubled: dbl && { w: Math.round(dbl.width), h: Math.round(dbl.height) },
        };
        require("fs").appendFileSync(
          require("path").join(require("os").tmpdir(), "grainnest-fold-debug.jsonl"),
          JSON.stringify(_rec) + "\n",
        );
        console.log("[grainnest] fold " + _nm + " -> " + status, _rec.fold, _rec.half);
      } catch (_err) {
        console.log("[grainnest] fold debug failed: " + _err.message);
      }
    }

    if (!fold) { _foldDbg("NO_FOLD_AXIS"); return false; }

    var outer = part.polygontree;
    var reflected = reflectTreeAcrossLine(outer, fold.x0, fold.y0, fold.ang);
    var doubledOuter = unionRingsFold(outer, reflected);
    if (!doubledOuter || doubledOuter.length < 3) {
      _foldDbg("UNION_FAILED");
      return false;
    }

    // keep the doubled outer's winding consistent with the original so
    // the NFP / placement code sees the orientation it expects.
    if (
      GeometryUtil.polygonArea(doubledOuter) * GeometryUtil.polygonArea(outer) <
      0
    ) {
      doubledOuter.reverse();
    }

    // stash the half for unfold, then assemble the doubled tree:
    // unioned outer + original holes + reflected holes.
    part._foldHalfTree = this.cloneTree(outer);
    part.foldLine = { x0: fold.x0, y0: fold.y0, ang: fold.ang };
    doubledOuter.source = outer.source;
    doubledOuter.children = [];
    var holes = outer.children || [];
    for (var i = 0; i < holes.length; i++) {
      doubledOuter.children.push(this.cloneTree(holes[i]));
      doubledOuter.children.push(
        reflectTreeAcrossLine(holes[i], fold.x0, fold.y0, fold.ang),
      );
    }
    part.polygontree = doubledOuter;
    part.bounds = GeometryUtil.getPolygonBounds(part.polygontree);
    part.area = part.bounds.width * part.bounds.height;
    part.cutOnFold = true;
    _foldDbg("OK", part.bounds);
    return true;
  };

  // §9.0.1 R6-A — exact bounding box of a part at a given placement, in the
  // sheet's coordinate frame. Reproduces the placement worker's convention
  // exactly (background.js rotatePolygon): rotate the baked polygontree about
  // the ORIGIN by placement.rotation (degrees), THEN translate by the
  // placement (x, y). The old shortcut `p.x + part.bounds.width` ignored both
  // the rotation and the polygon's own coordinate offset, so the min-length
  // stat, the old Trim sheets, and the cut-list "length used" all disagreed with the
  // real layout (testing round 6: stat said 171.5 in on a 160 in sheet with
  // everything placed — and Trim *grew* the sheet to the overestimate).
  // Only the outer ring matters for bounds (holes lie inside it).
  // Returns {x, y, width, height}, or null when the part has no polygon.
  placedBounds(part, placement) {
    if (!part || !part.polygontree || part.polygontree.length < 3) return null;
    var rad = (((placement && placement.rotation) || 0) * Math.PI) / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    var dx = (placement && placement.x) || 0;
    var dy = (placement && placement.y) || 0;
    var minx = null,
      miny = null,
      maxx = null,
      maxy = null;
    for (var i = 0; i < part.polygontree.length; i++) {
      var px = part.polygontree[i].x;
      var py = part.polygontree[i].y;
      var x = px * cos - py * sin + dx;
      var y = px * sin + py * cos + dy;
      if (minx === null || x < minx) minx = x;
      if (maxx === null || x > maxx) maxx = x;
      if (miny === null || y < miny) miny = y;
      if (maxy === null || y > maxy) maxy = y;
    }
    return { x: minx, y: miny, width: maxx - minx, height: maxy - miny };
  };

  // Undo foldPart: restore the stored half polygon.
  // v1.5.0: "Mark fold" — the user clicked near the fold edge of the piece
  // in the import preview (`point`, in the drawing's own coordinates). The
  // nearest edge of the piece's outline becomes its fold line, and the piece
  // is cut on the fold. Returns false if there's no outline to snap to.
  markFoldEdge(partIndex, point) {
    var part = this.parts[partIndex];
    if (!part || part.sheet || part.cutOnFold || !part.polygontree) return false;
    var ring = part.polygontree;
    var cx = part.bounds.x + part.bounds.width / 2;
    // The preview shows the drawing un-mirrored; compare in that frame.
    var pt = function (k) {
      var q = ring[k];
      return part.mirror ? { x: 2 * cx - q.x, y: q.y } : { x: q.x, y: q.y };
    };
    var best = null;
    for (var i = 0; i < ring.length; i++) {
      var a = pt(i);
      var b = pt((i + 1) % ring.length);
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      var t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      var d = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
      if (!best || d < best.d) best = { d: d, a: a, b: b };
    }
    if (!best) return false;
    part.markedFold = {
      x0: best.a.x,
      y0: best.a.y,
      ang: Math.atan2(best.b.y - best.a.y, best.b.x - best.a.x),
    };
    return this.foldPart(partIndex);
  };

  unfoldPart(partIndex) {
    var part = this.parts[partIndex];
    if (!part || !part.cutOnFold) return false;
    // v1.5.0: as foldPart — unfold un-mirrored, then mirror the half back
    // about its own centre.
    if (part.mirror) {
      this.mirrorPart(partIndex);
      var ok = this.unfoldPart(partIndex);
      this.mirrorPart(partIndex);
      return ok;
    }
    if (part._foldHalfTree) {
      part.polygontree = part._foldHalfTree;
      delete part._foldHalfTree;
      part.bounds = GeometryUtil.getPolygonBounds(part.polygontree);
      part.area = part.bounds.width * part.bounds.height;
    }
    part.cutOnFold = false;
    return true;
  };

  // progressCallback is called when progress is made
  // displayCallback is called when a new placement has been made
  start(p, d) {
    this.progressCallback = p;
    this.displayCallback = d;

    var parts = [];

    /*while(this.nests.length > 0){
      this.nests.pop();
    }*/

    // send only bare essentials through ipc
    for (var i = 0; i < this.parts.length; i++) {
      parts.push({
        // phase-r8a: excluded pieces nest zero copies. They stay in the
        // array (rather than being filtered out) so placement.source still
        // indexes this.parts.
        // v1.2.0: so do excluded sheets (no copies of that fabric).
        // v1.9.0: with pairs & folds from cut codes, the count worked out
        // for this nest (nestQuantity); a skipped piece nests none.
        quantity:
          this.parts[i].excluded || this.parts[i].autoSkip
            ? 0
            : typeof this.parts[i].nestQuantity === "number"
              ? this.parts[i].nestQuantity
              : this.parts[i].quantity,
        sheet: this.parts[i].sheet,
        polygontree: this.cloneTree(this.parts[i].polygontree),
        filename: this.parts[i].filename,
        allowedRotations: grainRuleToRotations(
          this.parts[i],
          this.nap,
          this.warpDirection,
        ),
      });
    }

    for (var i = 0; i < parts.length; i++) {
      if (parts[i].sheet) {
        offsetTree(
          parts[i].polygontree,
          -0.5 * config.spacing,
          this.polygonOffset.bind(this),
          this.simplifyPolygon.bind(this),
          true
        );
      } else {
        offsetTree(
          parts[i].polygontree,
          0.5 * config.spacing,
          this.polygonOffset.bind(this),
          this.simplifyPolygon.bind(this)
        );
      }
    }

    // offset tree recursively
    function offsetTree(t, offset, offsetFunction, simpleFunction, inside) {
      var simple = t;
      if (simpleFunction) {
        simple = simpleFunction(t, !!inside);
      }

      var offsetpaths = [simple];
      if (offset > 0) {
        offsetpaths = offsetFunction(simple, offset);
      }

      if (offsetpaths.length > 0) {
        //var cleaned = cleanFunction(offsetpaths[0]);

        // replace array items in place
        Array.prototype.splice.apply(t, [0, t.length].concat(offsetpaths[0]));
      }

      if (simple.children && simple.children.length > 0) {
        if (!t.children) {
          t.children = [];
        }

        for (var i = 0; i < simple.children.length; i++) {
          t.children.push(simple.children[i]);
        }
      }

      if (t.children && t.children.length > 0) {
        for (var i = 0; i < t.children.length; i++) {
          offsetTree(
            t.children[i],
            -offset,
            offsetFunction,
            simpleFunction,
            !inside
          );
        }
      }
    }

    var self = this;
    this.working = true;

    if (!this.workerTimer) {
      this.workerTimer = setInterval(function () {
        self.launchWorkers.call(
          self,
          parts,
          config,
          this.progressCallback,
          this.displayCallback
        );
        //progressCallback(progress);
      }, 100);
    }

    this.eventEmitter.on("background-response", (event, payload) => {
      this.eventEmitter.send("setPlacements", payload);
      console.log("ipc response", payload);
      if (!this.GA) {
        // user might have quit while we're away
        return;
      }
      this.GA.population[payload.index].processing = false;
      this.GA.population[payload.index].fitness = payload.fitness;

      // render placement
      if (this.nests.length == 0 || this.nests[0].fitness > payload.fitness) {
        this.nests.unshift(payload);

        // Check if we should keep a long list (more than 100 results)
        const keepLongList = process.env.DEEPNEST_LONGLIST;

        if (keepLongList) {
          // Keep up to 100 results without sorting
          if (this.nests.length > 100) {
            this.nests.pop();
          }
        } else {
          // Original behavior - keep only top 10 by fitness
          if (this.nests.length > 10) {
            this.nests.pop();
          }
        }

        if (this.displayCallback) {
          this.displayCallback();
        }
      } else if (process.env.DEEPNEST_LONGLIST) {
        // With DEEPNEST_LONGLIST, we add the result to the list regardless of fitness
        // Just make sure it's not worse than the worst result we already have
        const worstFitness = Math.min(...this.nests.map(item => item.fitness));
        if (this.nests.length < 100 || payload.fitness > worstFitness) {
          // Find where to insert this result to maintain insertion order
          this.nests.push(payload);

          // If we exceeded 100 results, remove the worst one
          if (this.nests.length > 100) {
            // Find the worst fitness
            let worstIndex = 0;
            let worstFitness = this.nests[0].fitness;

            for (let i = 1; i < this.nests.length; i++) {
              if (this.nests[i].fitness > worstFitness) {
                worstIndex = i;
                worstFitness = this.nests[i].fitness;
              }
            }

            // Remove the worst fitness item
            this.nests.splice(worstIndex, 1);
          }

          if (this.displayCallback) {
            this.displayCallback();
          }
        }
      }
    });
  };

  padNumber(n, width, z) {
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
  }

  launchWorkers(
    parts,
    config,
    progressCallback,
    displayCallback
  ) {
    function shuffle(array) {
      var currentIndex = array.length,
        temporaryValue,
        randomIndex;

      // While there remain elements to shuffle...
      while (0 !== currentIndex) {
        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;

        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
      }

      return array;
    }

    var i, j;

    if (this.GA === null) {
      // initiate new GA

      var adam = [];
      var id = 0;
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i].sheet) {
          for (var j = 0; j < parts[i].quantity; j++) {
            var poly = this.cloneTree(parts[i].polygontree); // deep copy
            poly.id = id; // id is the unique id of all parts that will be nested, including cloned duplicates
            poly.source = i; // source is the id of each unique part from the main part list
            poly.filename = parts[i].filename;
            if (parts[i].allowedRotations) {
              poly.allowedRotations = parts[i].allowedRotations.slice();
            }

            adam.push(poly);
            id++;
          }
        }
      }

      // seed with decreasing area
      adam.sort(function (a, b) {
        return (
          Math.abs(GeometryUtil.polygonArea(b)) -
          Math.abs(GeometryUtil.polygonArea(a))
        );
      });

      this.GA = new GeneticAlgorithm(adam, config);
      //console.log(GA.population[1].placement);
    }

    // check if current generation is finished
    var finished = true;
    for (var i = 0; i < this.GA.population.length; i++) {
      if (!this.GA.population[i].fitness) {
        finished = false;
        break;
      }
    }

    if (finished) {
      console.log("new generation!");
      // all individuals have been evaluated, start next generation
      this.GA.generation();
    }

    var running = this.GA.population.filter(function (p) {
      return !!p.processing;
    }).length;

    var sheets = [];
    var sheetids = [];
    var sheetsources = [];
    var sheetchildren = [];
    var sid = 0;

    for (var i = 0; i < parts.length; i++) {
      if (parts[i].sheet) {
        var poly = parts[i].polygontree;
        for (var j = 0; j < parts[i].quantity; j++) {
          sheets.push(poly);
          sheetids.push(this.padNumber(sid, 4) + '-' + this.padNumber(j, 4));
          sheetsources.push(i);
          sheetchildren.push(poly.children);
        }
        sid++;
      }
    }

    for (var i = 0; i < this.GA.population.length; i++) {
      //if(running < config.threads && !GA.population[i].processing && !GA.population[i].fitness){
      // only one background window now...
      if (
        running < 1 &&
        !this.GA.population[i].processing &&
        !this.GA.population[i].fitness
      ) {
        this.GA.population[i].processing = true;

        // hash values on arrays don't make it across ipc, store them in an array and reassemble on the other side....
        var ids = [];
        var sources = [];
        var children = [];
        var filenames = [];

        for (var j = 0; j < this.GA.population[i].placement.length; j++) {
          var id = this.GA.population[i].placement[j].id;
          var source = this.GA.population[i].placement[j].source;
          var child = this.GA.population[i].placement[j].children;
          var filename = this.GA.population[i].placement[j].filename;
          ids[j] = id;
          sources[j] = source;
          children[j] = child;
          filenames[j] = filename;
        }

        this.eventEmitter.send("background-start", {
          index: i,
          sheets: sheets,
          sheetids: sheetids,
          sheetsources: sheetsources,
          sheetchildren: sheetchildren,
          individual: this.GA.population[i],
          config: config,
          ids: ids,
          sources: sources,
          children: children,
          filenames: filenames,
        });
        running++;
      }
    }
  };

  // use the clipper library to return an offset to the given polygon. Positive offset expands the polygon, negative contracts
  // note that this returns an array of polygons
  polygonOffset(polygon, offset) {
    if (!offset || offset == 0 || GeometryUtil.almostEqual(offset, 0)) {
      return polygon;
    }

    var p = this.svgToClipper(polygon);

    var miterLimit = 4;
    var co = new ClipperLib.ClipperOffset(
      miterLimit,
      config.curveTolerance * config.clipperScale
    );
    co.AddPath(
      p,
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etClosedPolygon
    );

    var newpaths = new ClipperLib.Paths();
    co.Execute(newpaths, offset * config.clipperScale);

    var result = [];
    for (var i = 0; i < newpaths.length; i++) {
      result.push(this.clipperToSvg(newpaths[i]));
    }

    return result;
  };

  // returns a less complex polygon that satisfies the curve tolerance
  cleanPolygon(polygon) {
    var p = this.svgToClipper(polygon);
    // remove self-intersections and find the biggest polygon that's left
    var simple = ClipperLib.Clipper.SimplifyPolygon(
      p,
      ClipperLib.PolyFillType.pftNonZero
    );

    if (!simple || simple.length == 0) {
      return null;
    }

    var biggest = simple[0];
    var biggestarea = Math.abs(ClipperLib.Clipper.Area(biggest));
    for (var i = 1; i < simple.length; i++) {
      var area = Math.abs(ClipperLib.Clipper.Area(simple[i]));
      if (area > biggestarea) {
        biggest = simple[i];
        biggestarea = area;
      }
    }

    // clean up singularities, coincident points and edges
    var clean = ClipperLib.Clipper.CleanPolygon(
      biggest,
      0.01 * config.curveTolerance * config.clipperScale
    );

    if (!clean || clean.length == 0) {
      return null;
    }

    var cleaned = this.clipperToSvg(clean);

    // remove duplicate endpoints
    var start = cleaned[0];
    var end = cleaned[cleaned.length - 1];
    if (
      start == end ||
      (GeometryUtil.almostEqual(start.x, end.x) &&
        GeometryUtil.almostEqual(start.y, end.y))
    ) {
      cleaned.pop();
    }

    return cleaned;
  };

  // converts a polygon from normal float coordinates to integer coordinates used by clipper, as well as x/y -> X/Y
  svgToClipper(polygon, scale) {
    var clip = [];
    for (var i = 0; i < polygon.length; i++) {
      clip.push({ X: polygon[i].x, Y: polygon[i].y });
    }

    ClipperLib.JS.ScaleUpPath(clip, scale || config.clipperScale);

    return clip;
  };

  clipperToSvg(polygon) {
    var normal = [];

    for (var i = 0; i < polygon.length; i++) {
      normal.push({
        x: polygon[i].X / config.clipperScale,
        y: polygon[i].Y / config.clipperScale,
      });
    }

    return normal;
  };

  // returns an array of SVG elements that represent the placement, for export or rendering
  applyPlacement(placement) {
    var clone = [];
    for (var i = 0; i < parts.length; i++) {
      clone.push(parts[i].cloneNode(false));
    }

    var svglist = [];

    for (var i = 0; i < placement.length; i++) {
      var newsvg = svg.cloneNode(false);
      newsvg.setAttribute(
        "viewBox",
        "0 0 " + binBounds.width + " " + binBounds.height
      );
      newsvg.setAttribute("width", binBounds.width + "px");
      newsvg.setAttribute("height", binBounds.height + "px");
      var binclone = bin.cloneNode(false);

      binclone.setAttribute("class", "bin");
      binclone.setAttribute(
        "transform",
        "translate(" + -binBounds.x + " " + -binBounds.y + ")"
      );
      newsvg.appendChild(binclone);

      for (var j = 0; j < placement[i].length; j++) {
        var p = placement[i][j];
        var part = tree[p.id];

        // the original path could have transforms and stuff on it, so apply our transforms on a group
        var partgroup = document.createElementNS(svg.namespaceURI, "g");
        partgroup.setAttribute(
          "transform",
          "translate(" + p.x + " " + p.y + ") rotate(" + p.rotation + ")"
        );
        partgroup.appendChild(clone[part.source]);

        if (part.children && part.children.length > 0) {
          var flattened = _flattenTree(part.children, true);
          for (var k = 0; k < flattened.length; k++) {
            var c = clone[flattened[k].source];
            if (flattened[k].hole) {
              c.setAttribute("class", "hole");
            }
            partgroup.appendChild(c);
          }
        }

        newsvg.appendChild(partgroup);
      }

      svglist.push(newsvg);
    }

    // flatten the given tree into a list
    function _flattenTree(t, hole) {
      var flat = [];
      for (var i = 0; i < t.length; i++) {
        flat.push(t[i]);
        t[i].hole = hole;
        if (t[i].children && t[i].children.length > 0) {
          flat = flat.concat(_flattenTree(t[i].children, !hole));
        }
      }

      return flat;
    }

    return svglist;
  };

  stop() {
    this.working = false;
    if (this.GA && this.GA.population && this.GA.population.length > 0) {
      this.GA.population.forEach(function (i) {
        i.processing = false;
      });
    }
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  };

  reset() {
    this.GA = null;
    while (this.nests.length > 0) {
      this.nests.pop();
    }
    this.progressCallback = null;
    this.displayCallback = null;
  };
}

// Pick a rotation for a part. If the part declares allowedRotations,
// sample uniformly from that set; otherwise fall back to the global
// config.rotations-derived set (original deepnest behaviour).
function pickRotation(part, config) {
  var allowed = part && part.allowedRotations;
  if (allowed && allowed.length > 0) {
    return allowed[Math.floor(Math.random() * allowed.length)];
  }
  return Math.floor(Math.random() * config.rotations) *
    (360 / config.rotations);
}

// Return true when [grainnest] diagnostic logging should fire. Opt-in
// via either the env var (deepnest_debug=1 — same knob that opens
// devtools at startup, see main.js) or by setting window.GRAINNEST_DEBUG
// = true in devtools console. Default off so production runs stay quiet.
function grainnestDebugEnabled() {
  if (typeof window !== "undefined" && window.GRAINNEST_DEBUG) return true;
  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.deepnest_debug === "1"
  )
    return true;
  return false;
}

// §9.3.2 mirror helper — flip every point in a polygontree (and its
// children, recursively) about a vertical line at x = `axisX`. Used by
// DeepNest.mirrorPart and DeepNest.mirrorCopyPart. Pure mutation; the
// caller is responsible for updating any cached bounds.
// §9.3.2 behaviour 3 (cut on the fold) geometry.

// Reflect a point across the line through (x0,y0) at angle `ang`
// (radians). Reflection about a line at angle θ uses the matrix
// [[cos2θ, sin2θ], [sin2θ, -cos2θ]] applied to (p - origin).
function reflectPointFold(px, py, x0, y0, ang) {
  var dx = px - x0;
  var dy = py - y0;
  var c = Math.cos(2 * ang);
  var s = Math.sin(2 * ang);
  return { x: x0 + dx * c + dy * s, y: y0 + dx * s - dy * c };
}

// Deep-clone a polygontree with every point reflected across the fold
// line. A reflection flips winding order, so each ring is reversed to
// preserve its original orientation (outer stays outer, holes stay
// holes) for a clean union and correct NFP behaviour.
function reflectTreeAcrossLine(tree, x0, y0, ang) {
  var out = [];
  for (var i = 0; i < tree.length; i++) {
    out.push(reflectPointFold(tree[i].x, tree[i].y, x0, y0, ang));
  }
  out.reverse();
  if (tree.children && tree.children.length > 0) {
    out.children = [];
    for (var j = 0; j < tree.children.length; j++) {
      out.children.push(reflectTreeAcrossLine(tree.children[j], x0, y0, ang));
    }
  }
  return out;
}

// Union two simple rings (arrays of {x,y}) via ClipperLib, returning the
// largest resulting ring in nest coordinates. Same Clipper union pattern
// used by polygonOffset above. The two halves share the fold edge, so
// the union dissolves that seam into one connected polygon.
function unionRingsFold(ringA, ringB) {
  function toClip(r) {
    var out = [];
    for (var i = 0; i < r.length; i++) out.push({ X: r[i].x, Y: r[i].y });
    return out;
  }
  var A = toClip(ringA);
  var B = toClip(ringB);
  ClipperLib.JS.ScaleUpPath(A, 10000000);
  ClipperLib.JS.ScaleUpPath(B, 10000000);
  var combined = new ClipperLib.Paths();
  var clipper = new ClipperLib.Clipper();
  clipper.AddPath(A, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(B, ClipperLib.PolyType.ptSubject, true);
  var best = null;
  var bestArea = null;
  if (
    clipper.Execute(
      ClipperLib.ClipType.ctUnion,
      combined,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero,
    )
  ) {
    for (var i = 0; i < combined.length; i++) {
      var n = [];
      for (var k = 0; k < combined[i].length; k++) {
        n.push({ x: combined[i][k].X / 10000000, y: combined[i][k].Y / 10000000 });
      }
      var area = Math.abs(GeometryUtil.polygonArea(n));
      if (bestArea === null || area > bestArea) {
        best = n;
        bestArea = area;
      }
    }
  }
  return best;
}

// Resolve the fold line for a part. v1 priority: an explicit foldline
// element (tagged data-grainnest-fold), else the grain line element
// (data-grainnest-grain) — the pattern convention is that the fold edge is
// the grainline itself. Falls back to the grain *angle* through the
// bounding-box centre when only an angle is known (this is the case the
// design note flags as unreliable for a centred manual mark). Returns
// {x0, y0, ang(rad)} or null.
function getFoldLineForPart(part) {
  if (!part || !part.svgelements) return null;
  // v1.5.0: a fold edge marked in the app ("Mark fold") wins over the
  // drawing's grain / fold line.
  if (part.markedFold) {
    return { x0: part.markedFold.x0, y0: part.markedFold.y0, ang: part.markedFold.ang };
  }
  function finish(x1, y1, x2, y2) {
    if (
      !isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2) ||
      (x1 === x2 && y1 === y2)
    ) {
      return null;
    }
    return { x0: x1, y0: y1, ang: Math.atan2(y2 - y1, x2 - x1) };
  }
  // §9.3.2 / phase-5r: read the *drawn* fold/grain line's endpoints so the
  // fold uses the actual line, not the bounding-box centre. Handles <line>
  // and — for real Inkscape files (testing round 4) — <path>/<polyline>/
  // <polygon>, whose grain lines are paths drawn on the fold edge.
  function endpoints(el) {
    if (!el || !el.tagName) return null;
    if (el.tagName === "line") {
      return finish(
        parseFloat(el.getAttribute("x1")), parseFloat(el.getAttribute("y1")),
        parseFloat(el.getAttribute("x2")), parseFloat(el.getAttribute("y2")),
      );
    }
    if (el.tagName === "path") {
      var ep = window.SvgParser.pathEndpoints(el.getAttribute("d") || "");
      return ep ? finish(ep.x1, ep.y1, ep.x2, ep.y2) : null;
    }
    var pts = null;
    if (el.tagName === "polyline" || el.tagName === "polygon") {
      var raw = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(parseFloat);
      pts = [];
      for (var k = 0; k + 1 < raw.length; k += 2) pts.push({ x: raw[k], y: raw[k + 1] });
    }
    if (!pts || pts.length < 2) return null;
    return finish(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  var fold = null;
  var grain = null;
  for (var i = 0; i < part.svgelements.length; i++) {
    var e = part.svgelements[i];
    if (!e || !e.getAttribute) continue;
    if (e.getAttribute("data-grainnest-fold") === "1" && !fold) fold = e;
    if (e.getAttribute("data-grainnest-grain") === "1" && !grain) grain = e;
  }
  var fromEl = endpoints(fold) || endpoints(grain);
  if (fromEl) return fromEl;
  if (part.bounds && typeof part.grainAngle === "number") {
    return {
      x0: part.bounds.x + part.bounds.width / 2,
      y0: part.bounds.y + part.bounds.height / 2,
      ang: (part.grainAngle * Math.PI) / 180,
    };
  }
  return null;
}

// §9.0.1 / phase-5t: snap a fold axis onto the piece's true fold edge. The
// drawn grain/fold line can sit a hair off the straight edge it's meant to lie
// on (a real file's grain-5 was ~2 units outside piece 5's edge). Reflecting across an
// axis even slightly outside the piece leaves the mirrored half not touching the
// original, so unionRingsFold can't merge them and the fold silently does
// nothing (or strands the reflected half off-sheet). Find the polygon edge most
// parallel to, and nearest, the drawn line and adopt it as the axis — but only
// when it's close (grain is supposed to be on the edge), so a genuinely interior
// line is left alone.
function snapFoldAxisToEdge(poly, fold) {
  if (!poly || poly.length < 3 || !fold) return fold;
  var EPS = (6 * Math.PI) / 180; // within 6° counts as parallel
  var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (var k = 0; k < poly.length; k++) {
    if (poly[k].x < minx) minx = poly[k].x;
    if (poly[k].x > maxx) maxx = poly[k].x;
    if (poly[k].y < miny) miny = poly[k].y;
    if (poly[k].y > maxy) maxy = poly[k].y;
  }
  var threshold = 0.05 * Math.max(maxx - minx, maxy - miny);
  var best = null, bestDist = Infinity;
  for (var i = 0; i < poly.length; i++) {
    var a = poly[i], b = poly[(i + 1) % poly.length];
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) continue;
    var ea = Math.atan2(dy, dx);
    var da = (((ea - fold.ang) % Math.PI) + Math.PI) % Math.PI; // 0..π
    if (da > EPS && da < Math.PI - EPS) continue; // not parallel to the line
    var dist = Math.abs((fold.x0 - a.x) * dy - (fold.y0 - a.y) * dx) / len;
    if (dist < bestDist) {
      bestDist = dist;
      best = { x0: a.x, y0: a.y, ang: ea };
    }
  }
  return best && bestDist <= threshold ? best : fold;
}

function mirrorPolygontreeX(tree, axisX) {
  for (var i = 0; i < tree.length; i++) {
    tree[i].x = 2 * axisX - tree[i].x;
  }
  // §9.0.1 R6-C: a reflection flips winding order — reverse the ring to
  // restore its original orientation, exactly as reflectTreeAcrossLine
  // (the fold reflection) already does "for correct NFP behaviour". The
  // missing reversal left every mirrored part wound backwards; most
  // shapes survived it, but the placement engine refused to place the
  // big concave shrug piece's mirror copy at all (testing round 6: "0/2
  // placed no matter how big the sheet"). Mirroring twice still
  // round-trips: the point flip and the order reversal both self-invert
  // and commute.
  tree.reverse();
  if (tree.children && tree.children.length > 0) {
    for (var j = 0; j < tree.children.length; j++) {
      mirrorPolygontreeX(tree.children[j], axisX);
    }
  }
}

// §9.3.12: derive a human-friendly piece name from the source SVG.
// Priority: inkscape:label (Inkscape's per-object/group "Label", the most
// likely real-world source) on the element or an ancestor group; then a
// <title> direct child (Inkscape's "Title"); then a meaningful id
// (skipping auto-generated ids like path1234 / g12) on the element or an
// ancestor. Inkscape *layer* groups and the <svg> root are skipped so a
// document/layer label can't end up naming every piece the same.
// Returns undefined when nothing usable is found — the part stays unnamed
// and the UI shows the filename as a placeholder for the user to fill.
function extractPartName(el) {
  var AUTO_ID = /^(path|g|rect|svg|polygon|polyline|use|circle|ellipse|line|tspan|text|defs|image|clip|mask)\d+$/i;
  function isLayer(n) {
    return !!(n.getAttribute && n.getAttribute("inkscape:groupmode") === "layer");
  }
  function isSvgRoot(n) {
    return !!(n.tagName && String(n.tagName).toLowerCase() === "svg");
  }
  var n, hops;
  // 1. inkscape:label on the element or an ancestor group
  for (n = el, hops = 0; n && n.getAttribute && !isSvgRoot(n) && hops < 6; n = n.parentElement, hops++) {
    if (isLayer(n)) continue;
    var label = n.getAttribute("inkscape:label");
    if (label && label.trim()) return label.trim();
  }
  // 2. <title> as a direct child of the root element
  if (el && el.children) {
    for (var k = 0; k < el.children.length; k++) {
      var child = el.children[k];
      if (
        child.tagName &&
        String(child.tagName).toLowerCase() === "title" &&
        child.textContent &&
        child.textContent.trim()
      ) {
        return child.textContent.trim();
      }
    }
  }
  // 3. meaningful id on the element or an ancestor group
  for (n = el, hops = 0; n && n.getAttribute && !isSvgRoot(n) && hops < 6; n = n.parentElement, hops++) {
    if (isLayer(n)) continue;
    var id = n.getAttribute("id");
    if (id && id.trim() && !AUTO_ID.test(id.trim())) return id.trim();
  }
  return undefined;
}

// Shared post-claim hook used by every branch of DeepNest.getParts's
// "attach open elements to a part" loop. If the element was tagged as
// a grain during cleanInput's detectGrainLines pass (which marks
// <line>/<polyline>/<polygon>/two-point <path> the same way), flip
// the part's defaults so it ends up Locked to the detected angle.
// Originally inlined inside the <line> branch only — which left
// <path>/<polyline>/<polygon> grains visually dashed but functionally
// "Free" (§9.1).
function recordGrainIfTagged(part, el) {
  if (
    el.getAttribute &&
    el.getAttribute("data-grainnest-grain") === "1"
  ) {
    var angleAttr = el.getAttribute("data-grainnest-grain-angle");
    if (angleAttr !== null && !isNaN(Number(angleAttr))) {
      part.grainAngle = Number(angleAttr);
      part.grainSource = "detected";
      part.grainRule = "lock";
    }
  }
}

// Translate a part's UI-level grainRule into a concrete allowedRotations
// array consumed by the GA. Returns undefined for "free" so the GA falls
// through to the global config.rotations behaviour. The custom-tolerance
// value is hard-coded to 3° in Phase 2; Phase 3 will read it from settings.
//
// When the part has a `grainAngle` (set by Phase 3's SVG detector), the
// returned rotations are shifted by -grainAngle so that "Lock to grain"
// (base [0]) actually rotates the piece by -grainAngle and ends with the
// grain horizontal. Same offset applied uniformly to "flipped", "bias",
// and "custom"; "free" stays unconstrained regardless of grain.
var GRAIN_RULE_CUSTOM_TOLERANCE = 3;
// §9.3.4: when `nap` is true, every rule collapses to a single
// principal rotation so a napped fabric doesn't get pieces facing
// different directions down the bolt. Bias under nap defaults to
// +45° (the open question of per-piece sign is tracked in §9.4).
// "Custom" stays as-is — its ±tol set is small enough that all
// rotations within it preserve up-direction. "Free" under nap
// behaves like "lock" (one allowed rotation at 0°).
//
// §9.3.10: `warpDirection` ("horizontal" default, "vertical" optional)
// sets the target angle the grain should land at after rotation.
// Horizontal target = 0° (the historical behaviour); vertical = 90°.
// Offset is computed as (targetAngle - grainAngle) so a piece with a
// 30° source grain and warp=horizontal rotates by -30°, same as
// before; with warp=vertical it rotates by +60° (90 - 30).
function grainRuleToRotations(part, nap, warpDirection) {
  var base;
  switch (part && part.grainRule) {
    case "lock":
      base = [0];
      break;
    case "flipped":
      base = nap ? [0] : [0, 180];
      break;
    case "bias":
      base = nap ? [45] : [45, 135];
      break;
    case "custom": {
      var t = GRAIN_RULE_CUSTOM_TOLERANCE;
      base = [0, t, (360 - t) % 360];
      break;
    }
    case "free":
    default:
      return nap ? [0] : undefined;
  }
  var grainAngle = (part && part.grainAngle) || 0;
  // phase-r8c: the folded grainAngle's "+180°" end is the piece's top, and
  // rotating by -grainAngle sends it to 180° — the left of the sheet, i.e.
  // the start of the fabric. topFlip makes the other end the top.
  if (part && part.topFlip) grainAngle += 180;
  var targetAngle = warpDirection === "vertical" ? 90 : 0;
  // Always apply the offset shift — even when grainAngle is 0, a
  // vertical-warp target needs +90° baked in. Folding to [0, 360).
  var offset = ((targetAngle - grainAngle) % 360 + 360) % 360;
  if (offset === 0) return base;
  return base.map(function (r) {
    return ((r + offset) % 360 + 360) % 360;
  });
}

export class GeneticAlgorithm {
  constructor(adam, config) {
    this.config = config || {
      populationSize: 10,
      mutationRate: 10,
      rotations: 4,
    };

    // population is an array of individuals. Each individual is a object representing the order of insertion and the angle each part is rotated
    var angles = [];
    for (var i = 0; i < adam.length; i++) {
      angles.push(pickRotation(adam[i], this.config));
    }

    this.population = [{ placement: adam, rotation: angles }];

    while (this.population.length < config.populationSize) {
      var mutant = this.mutate(this.population[0]);
      this.population.push(mutant);
    }
  }

  // returns a mutated individual with the given mutation rate
  mutate(individual) {
    var clone = {
      placement: individual.placement.slice(0),
      rotation: individual.rotation.slice(0),
    };
    for (var i = 0; i < clone.placement.length; i++) {
      var rand = Math.random();
      if (rand < 0.01 * this.config.mutationRate) {
        // swap current part with next part
        var j = i + 1;

        if (j < clone.placement.length) {
          var temp = clone.placement[i];
          clone.placement[i] = clone.placement[j];
          clone.placement[j] = temp;

          // Also swap the rotations so each piece keeps the rotation it
          // was paired with. Without this, a piece's rotation can end up
          // outside its allowedRotations set after a swap (the original
          // deepnest got away with this because every piece shared the
          // same global rotation set; per-piece grain constraints expose
          // the issue).
          var temprot = clone.rotation[i];
          clone.rotation[i] = clone.rotation[j];
          clone.rotation[j] = temprot;
        }
      }

      rand = Math.random();
      if (rand < 0.01 * this.config.mutationRate) {
        clone.rotation[i] = pickRotation(clone.placement[i], this.config);
      }
    }

    return clone;
  };

  // single point crossover
  mate(male, female) {
    var cutpoint = Math.round(
      Math.min(Math.max(Math.random(), 0.1), 0.9) * (male.placement.length - 1)
    );

    var gene1 = male.placement.slice(0, cutpoint);
    var rot1 = male.rotation.slice(0, cutpoint);

    var gene2 = female.placement.slice(0, cutpoint);
    var rot2 = female.rotation.slice(0, cutpoint);

    for (var i = 0; i < female.placement.length; i++) {
      if (!contains(gene1, female.placement[i].id)) {
        gene1.push(female.placement[i]);
        rot1.push(female.rotation[i]);
      }
    }

    for (var i = 0; i < male.placement.length; i++) {
      if (!contains(gene2, male.placement[i].id)) {
        gene2.push(male.placement[i]);
        rot2.push(male.rotation[i]);
      }
    }

    function contains(gene, id) {
      for (var i = 0; i < gene.length; i++) {
        if (gene[i].id == id) {
          return true;
        }
      }
      return false;
    }

    return [
      { placement: gene1, rotation: rot1 },
      { placement: gene2, rotation: rot2 },
    ];
  };

  generation() {
    // Individuals with higher fitness are more likely to be selected for mating
    this.population.sort(function (a, b) {
      return a.fitness - b.fitness;
    });

    // fittest individual is preserved in the new generation (elitism)
    var newpopulation = [this.population[0]];

    while (newpopulation.length < this.population.length) {
      var male = this.randomWeightedIndividual();
      var female = this.randomWeightedIndividual(male);

      // each mating produces two children
      var children = this.mate(male, female);

      // slightly mutate children
      newpopulation.push(this.mutate(children[0]));

      if (newpopulation.length < this.population.length) {
        newpopulation.push(this.mutate(children[1]));
      }
    }

    this.population = newpopulation;
  };

  // returns a random individual from the population, weighted to the front of the list (lower fitness value is more likely to be selected)
  randomWeightedIndividual(exclude) {
    var pop = this.population.slice(0);

    if (exclude && pop.indexOf(exclude) >= 0) {
      pop.splice(pop.indexOf(exclude), 1);
    }

    var rand = Math.random();

    var lower = 0;
    var weight = 1 / pop.length;
    var upper = weight;

    for (var i = 0; i < pop.length; i++) {
      // if the random number falls between lower and upper bounds, select this individual
      if (rand > lower && rand < upper) {
        return pop[i];
      }
      lower = upper;
      upper += 2 * weight * ((pop.length - i) / pop.length);
    }

    return pop[0];
  };
}
