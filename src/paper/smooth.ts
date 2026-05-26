import paper from 'paper';
import { pushProjectSnapshot } from './editHistory';
import { getSelected, notifySelectionChanged } from './selection';

// Default: anything with a turn angle > 90° at the anchor is treated as a
// sharp corner that should be preserved. Lower values catch softer corners
// (e.g. 60° for chevron-style arrows); higher values let everything be
// smoothed (e.g. 120° to treat rounded blobs as fully smooth).
export const DEFAULT_CORNER_THRESHOLD = 90;

function turnAngleAt(path: paper.Path, index: number): number {
  const n = path.segments.length;
  if (!path.closed && (index === 0 || index === n - 1)) return 180;
  const seg = path.segments[index];
  const prev = path.segments[(index - 1 + n) % n];
  const next = path.segments[(index + 1) % n];
  const inVec = seg.point.subtract(prev.point);
  const outVec = next.point.subtract(seg.point);
  if (inVec.length === 0 || outVec.length === 0) return 0;
  return Math.abs(((outVec.angle - inVec.angle + 540) % 360) - 180);
}

function isCornerAtIndex(
  path: paper.Path,
  index: number,
  thresholdDeg: number,
): boolean {
  if (!path.closed) {
    if (index === 0 || index === path.segments.length - 1) return true;
  }
  return turnAngleAt(path, index) >= thresholdDeg;
}

// Catmull-Rom is an *interpolating* spline: the fitted curve passes through
// every control point exactly. Using it instead of Schneider's simplify()
// preserves the silhouette pixel-perfectly while converting straight-line
// polygon edges to smooth Bézier arcs.
//
// Why not simplify()? simplify() is a *approximating* fitter — it is allowed
// to discard intermediate anchors and fit a Bézier that stays within a
// tolerance of the original points. That means inner concave anchors (the
// "armpits" of a star) can be dropped: without them the fitter bridges across
// the concavity and the V-shape disappears. Catmull-Rom never drops a point,
// so every traced feature survives.
const SMOOTH_TYPE = 'catmull-rom' as const;

/**
 * Returns the indices of the four axis-extreme anchor points (leftmost,
 * rightmost, topmost, bottommost). These are pinned as forced corners so
 * that Schneider-simplify can never drift the overall bounding box.
 *
 * Why this matters: a rounded star tip spreads its ~144° turn across 3–4
 * polyline segments (~48° each). No single segment exceeds a typical threshold
 * (e.g. 115°), so none are detected as corners. Without extrema pinning,
 * path.simplify() fits a Bézier with up to ±1 px tolerance per run; across
 * the whole outline those errors compound to a measurable height/width change.
 * Pinning the four extreme vertices costs at most four extra corner splits and
 * guarantees the bounding box of the output matches the input exactly.
 */
function bboxExtremaIndices(path: paper.Path): number[] {
  const segs = path.segments;
  const n = segs.length;
  if (n === 0) return [];
  let minXi = 0, maxXi = 0, minYi = 0, maxYi = 0;
  for (let i = 1; i < n; i++) {
    const p = segs[i].point;
    if (p.x < segs[minXi].point.x) minXi = i;
    if (p.x > segs[maxXi].point.x) maxXi = i;
    if (p.y < segs[minYi].point.y) minYi = i;
    if (p.y > segs[maxYi].point.y) maxYi = i;
  }
  return [...new Set([minXi, maxXi, minYi, maxYi])];
}

function smoothOnePath(path: paper.Path, thresholdDeg: number) {
  const n = path.segments.length;
  if (n < 4) return;

  // Detect corner indices on the original polyline. Anchors whose turn angle
  // exceeds the user's threshold are corners; their handles will be zeroed
  // (kept sharp) and the runs between them get simplified into smooth curves.
  //
  // Threshold tuning is exposed to the user via the Properties Panel slider:
  // - Default 60° catches the sharp corners of icons / polygons / arrows.
  // - For rounded/puffy shapes where the user wants a single smooth outline,
  //   dial the threshold UP (e.g. 120°+) so rounded peaks aren't treated as
  //   corners and the algorithm just fits one smooth Bezier through the whole
  //   path.
  const cornerIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (isCornerAtIndex(path, i, thresholdDeg)) cornerIndices.push(i);
  }

  // Always pin the four bounding-box extrema as corners regardless of the
  // angle threshold. This prevents the Schneider fitter from drifting the
  // overall dimensions (e.g. a rounded star traced at low detail has its tip
  // turn spread across several segments, none above threshold; without pinning,
  // simplify() shortens the star by several pixels).
  for (const idx of bboxExtremaIndices(path)) {
    if (!cornerIndices.includes(idx)) cornerIndices.push(idx);
  }
  cornerIndices.sort((a, b) => a - b);

  // No corners: smooth the whole path in place.
  if (cornerIndices.length === 0) {
    path.smooth({ type: SMOOTH_TYPE });
    return;
  }

  // Walk corner→corner, fit smooth cubic Béziers through the interior anchors
  // of each run, and stitch the result back into a single path. Corners get
  // re-added with zero handles so they stay mathematically sharp.
  //
  // We use Catmull-Rom (interpolating) rather than Schneider simplify
  // (approximating) so that every anchor in each run is preserved at its
  // exact position. This means inner concaves, rounded tips, and any other
  // traced feature survive unchanged — only the straight-line polygon edges
  // between anchors are replaced by smooth Bézier arcs.
  const wasClosed = path.closed;
  const newSegments: paper.Segment[] = [];
  for (let ci = 0; ci < cornerIndices.length; ci++) {
    const cornerIdx = cornerIndices[ci];
    const nextCornerIdx = cornerIndices[(ci + 1) % cornerIndices.length];
    const cornerPt = path.segments[cornerIdx].point.clone();
    newSegments.push(new paper.Segment(cornerPt));

    const between: paper.Point[] = [];
    let i = (cornerIdx + 1) % n;
    let safety = n + 1;
    while (i !== nextCornerIdx && safety-- > 0) {
      between.push(path.segments[i].point.clone());
      i = (i + 1) % n;
    }
    if (between.length === 0) continue;

    // Build a temporary open path: [cornerPt, ...between, nextCornerPt]
    // Smooth it with Catmull-Rom so every original point is interpolated.
    // Extract only the interior segments (j=1…len-2); the endpoint segments
    // are excluded because corners are added separately with zero handles.
    const temp = new paper.Path({ insert: false });
    temp.add(cornerPt);
    for (const p of between) temp.add(p);
    temp.add(path.segments[nextCornerIdx].point.clone());
    temp.smooth({ type: SMOOTH_TYPE });

    for (let j = 1; j < temp.segments.length - 1; j++) {
      const s = temp.segments[j];
      newSegments.push(
        new paper.Segment(s.point.clone(), s.handleIn.clone(), s.handleOut.clone()),
      );
    }
    temp.remove();
  }

  path.removeSegments();
  for (const seg of newSegments) path.add(seg);
  path.closed = wasClosed;
}

function smoothPathItem(item: paper.PathItem, thresholdDeg: number) {
  if (item instanceof paper.Path) {
    smoothOnePath(item, thresholdDeg);
  } else if (item instanceof paper.CompoundPath) {
    for (const child of item.children) {
      if (child instanceof paper.Path) smoothOnePath(child, thresholdDeg);
    }
  }
}

export function smoothSelection(
  thresholdDeg: number = DEFAULT_CORNER_THRESHOLD,
): number {
  const items = getSelected().filter(
    (i): i is paper.PathItem =>
      i instanceof paper.Path || i instanceof paper.CompoundPath,
  );
  if (items.length === 0) return 0;
  pushProjectSnapshot();
  for (const item of items) smoothPathItem(item, thresholdDeg);
  notifySelectionChanged();
  paper.view.update();
  return items.length;
}
