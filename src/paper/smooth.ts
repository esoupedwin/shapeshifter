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

// Tolerance for simplifying the polyline between corners — passed to paper's
// Schneider bezier fitter. Smaller = more anchors kept (more faithful to input
// silhouette), larger = fewer anchors (more aggressive smoothing). At 2.5 px,
// gently-rounded arcs (a few px deep) get flattened into near-straight lines,
// which sharpens puffy tips. 1.0 keeps the silhouette honest.
const SIMPLIFY_TOLERANCE = 1.0;

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

  // No corners: simplify the whole path with Schneider's bezier fitter.
  if (cornerIndices.length === 0) {
    path.simplify(SIMPLIFY_TOLERANCE);
    return;
  }

  // Walk corner→corner, fit smooth cubic Beziers through the interior anchors
  // of each run, and stitch the result back into a single path. Corners get
  // re-added with zero handles so they stay mathematically sharp.
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

    const temp = new paper.Path({ insert: false });
    temp.add(cornerPt);
    for (const p of between) temp.add(p);
    temp.add(path.segments[nextCornerIdx].point.clone());
    temp.simplify(SIMPLIFY_TOLERANCE);

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
