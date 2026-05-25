import paper from 'paper';
import { getContentLayer, getOverlayLayer, activateOverlay, activateContent } from './setup';
import { useEditor, SelectionStyle, SelectionTransform } from '../store/useEditor';
import { clearHistory } from './editHistory';

const selected: paper.PathItem[] = [];
let editPointsTarget: paper.PathItem | null = null;
let selectedSegment: { pathId: number; index: number } | null = null;

export function getSelected(): paper.PathItem[] {
  return selected.slice();
}

export function getEditPointsTarget(): paper.PathItem | null {
  return editPointsTarget;
}

export function setEditPointsTarget(item: paper.PathItem | null) {
  if (item == null && editPointsTarget) {
    // Exiting edit-points mode — drop history for the path we were editing
    clearHistory(editPointsTarget.id);
  }
  editPointsTarget = item;
  selectedSegment = null;
  refreshOverlay();
}

export function getSelectedSegment(): { pathId: number; index: number } | null {
  return selectedSegment;
}

export function setSelectedSegment(path: paper.Path | null, index: number | null) {
  if (!path || index == null) {
    selectedSegment = null;
  } else {
    selectedSegment = { pathId: path.id, index };
  }
  refreshOverlay();
}

export function clearSelection() {
  selected.length = 0;
  editPointsTarget = null;
  refreshOverlay();
  pushToStore();
}

export function selectItem(item: paper.PathItem, additive = false) {
  if (!additive) selected.length = 0;
  if (!selected.includes(item)) selected.push(item);
  refreshOverlay();
  pushToStore();
}

export function setSelection(items: paper.PathItem[]) {
  selected.length = 0;
  selected.push(...items);
  refreshOverlay();
  pushToStore();
}

export function toggleItem(item: paper.PathItem) {
  const idx = selected.indexOf(item);
  if (idx >= 0) selected.splice(idx, 1);
  else selected.push(item);
  refreshOverlay();
  pushToStore();
}

export function isSelected(item: paper.PathItem): boolean {
  return selected.includes(item);
}

export function hitTestSelectable(point: paper.Point): paper.PathItem | null {
  const layer = getContentLayer();
  const result = layer.hitTest(point, {
    fill: true,
    stroke: true,
    segments: false,
    tolerance: 5,
  });
  if (!result || !result.item) return null;
  let item: paper.Item | null = result.item;
  while (item && item.parent && item.parent !== layer) item = item.parent;
  if (item && (item instanceof paper.Path || item instanceof paper.CompoundPath)) {
    return item as paper.PathItem;
  }
  return null;
}

const HANDLE_PX = 7;
const BEZIER_HANDLE_PX = 6;

function handleSize(): number {
  return HANDLE_PX / paper.view.zoom;
}

function makeHandle(
  point: paper.Point,
  name: string,
  variant: 'normal' | 'selected' = 'normal',
): paper.Path.Rectangle {
  const s = handleSize();
  const rect = new paper.Path.Rectangle({
    point: [point.x - s / 2, point.y - s / 2],
    size: [s, s],
    fillColor: variant === 'selected' ? '#0e639c' : '#ffffff',
    strokeColor: '#0e639c',
    strokeWidth: 1 / paper.view.zoom,
  });
  rect.data.handle = name;
  return rect;
}

function makeBezierHandle(
  anchor: paper.Point,
  handlePos: paper.Point,
  name: 'handleIn' | 'handleOut',
  path: paper.Path,
  index: number,
  ghost = false,
): void {
  const zoom = paper.view.zoom;
  // Connecting line — solid for real handles, dashed for ghost (corner) handles
  const line = new paper.Path.Line(anchor, handlePos);
  line.strokeColor = new paper.Color('#0e639c');
  line.strokeWidth = 1 / zoom;
  if (ghost) line.dashArray = [3 / zoom, 3 / zoom];
  line.data.overlay = true;
  // Handle dot
  const r = BEZIER_HANDLE_PX / 2 / zoom;
  const dot = new paper.Path.Circle(handlePos, r);
  dot.fillColor = new paper.Color(ghost ? '#2b2b2b' : '#ffffff');
  dot.strokeColor = new paper.Color('#0e639c');
  dot.strokeWidth = 1 / zoom;
  dot.data.handle = name;
  dot.data.path = path;
  dot.data.segmentIndex = index;
  dot.data.ghost = ghost;
}

export function refreshOverlay() {
  activateOverlay();
  const overlay = getOverlayLayer();
  overlay.removeChildren();

  if (editPointsTarget) {
    drawEditPointsOverlay(editPointsTarget);
    activateContent();
    return;
  }

  if (selected.length === 0) {
    activateContent();
    return;
  }

  let bounds: paper.Rectangle | null = null;
  for (const item of selected) {
    const b = item.strokeBounds;
    bounds = bounds ? bounds.unite(b) : b;
  }
  if (!bounds) {
    activateContent();
    return;
  }

  const zoom = paper.view.zoom;
  const outline = new paper.Path.Rectangle(bounds);
  outline.strokeColor = new paper.Color('#0e639c');
  outline.strokeWidth = 1 / zoom;
  outline.dashArray = [4 / zoom, 3 / zoom];
  outline.fillColor = null;
  outline.data.overlay = true;

  const { topLeft, topRight, bottomLeft, bottomRight } = bounds;
  const topCenter = new paper.Point(bounds.center.x, bounds.top);
  const bottomCenter = new paper.Point(bounds.center.x, bounds.bottom);
  const leftCenter = new paper.Point(bounds.left, bounds.center.y);
  const rightCenter = new paper.Point(bounds.right, bounds.center.y);

  makeHandle(topLeft, 'nw');
  makeHandle(topRight, 'ne');
  makeHandle(bottomLeft, 'sw');
  makeHandle(bottomRight, 'se');
  makeHandle(topCenter, 'n');
  makeHandle(bottomCenter, 's');
  makeHandle(leftCenter, 'w');
  makeHandle(rightCenter, 'e');

  const rotHandlePos = new paper.Point(bounds.center.x, bounds.top - 22 / zoom);
  const stem = new paper.Path.Line(topCenter, rotHandlePos);
  stem.strokeColor = new paper.Color('#0e639c');
  stem.strokeWidth = 1 / zoom;

  const rotHandle = new paper.Path.Circle(rotHandlePos, (HANDLE_PX / 2 + 1) / zoom);
  rotHandle.fillColor = new paper.Color('#ffffff');
  rotHandle.strokeColor = new paper.Color('#0e639c');
  rotHandle.strokeWidth = 1 / zoom;
  rotHandle.data.handle = 'rotate';

  activateContent();
}

function drawEditPointsOverlay(item: paper.PathItem) {
  const paths: paper.Path[] = [];
  if (item instanceof paper.Path) paths.push(item);
  else if (item instanceof paper.CompoundPath) {
    for (const child of item.children) {
      if (child instanceof paper.Path) paths.push(child);
    }
  }

  for (const path of paths) {
    const outline = new paper.Path(path.segments.map((s) => s.point.clone()));
    outline.closed = path.closed;
    outline.strokeColor = new paper.Color('#0e639c');
    outline.strokeWidth = 1 / paper.view.zoom;
    outline.fillColor = null;
    outline.data.overlay = true;
    // Copy curve handles for accurate outline
    outline.segments.forEach((seg, i) => {
      seg.handleIn = path.segments[i].handleIn.clone();
      seg.handleOut = path.segments[i].handleOut.clone();
    });

    path.segments.forEach((seg, idx) => {
      const isSelected =
        selectedSegment !== null &&
        selectedSegment.pathId === path.id &&
        selectedSegment.index === idx;
      const h = makeHandle(seg.point, 'seg', isSelected ? 'selected' : 'normal');
      h.data.path = path;
      h.data.segmentIndex = idx;
    });

    // Draw bezier handles for the currently-selected segment.
    // Always draw both handles, even on corner anchors — if a handle is zero,
    // we draw it as a "ghost" offset along the path tangent so the user can
    // grab it and pull out curvature (PowerPoint behaviour).
    if (selectedSegment && selectedSegment.pathId === path.id) {
      const seg = path.segments[selectedSegment.index];
      if (seg) {
        const ghostLen = 28 / paper.view.zoom;
        // Tangent direction along the path at this anchor. Use the vector to
        // the previous segment for handleIn ghost, next segment for handleOut.
        const segs = path.segments;
        const n = segs.length;
        const prev = path.closed ? segs[(selectedSegment.index - 1 + n) % n] : segs[selectedSegment.index - 1];
        const next = path.closed ? segs[(selectedSegment.index + 1) % n] : segs[selectedSegment.index + 1];

        let inPos: paper.Point;
        if (!seg.handleIn.isZero()) {
          inPos = seg.point.add(seg.handleIn);
        } else if (prev) {
          const dir = prev.point.subtract(seg.point);
          inPos = seg.point.add(dir.length > 0 ? dir.normalize().multiply(ghostLen) : new paper.Point(-ghostLen, 0));
        } else {
          inPos = seg.point.add(new paper.Point(-ghostLen, 0));
        }

        let outPos: paper.Point;
        if (!seg.handleOut.isZero()) {
          outPos = seg.point.add(seg.handleOut);
        } else if (next) {
          const dir = next.point.subtract(seg.point);
          outPos = seg.point.add(dir.length > 0 ? dir.normalize().multiply(ghostLen) : new paper.Point(ghostLen, 0));
        } else {
          outPos = seg.point.add(new paper.Point(ghostLen, 0));
        }

        const inIsGhost = seg.handleIn.isZero();
        const outIsGhost = seg.handleOut.isZero();
        makeBezierHandle(seg.point, inPos, 'handleIn', path, selectedSegment.index, inIsGhost);
        makeBezierHandle(seg.point, outPos, 'handleOut', path, selectedSegment.index, outIsGhost);
      }
    }
  }
}

function pushToStore() {
  const items = selected;
  if (items.length === 0) {
    useEditor.getState().setSelection([], null, null);
    refreshLayerNames();
    return;
  }

  const first = items[0];
  const style: SelectionStyle = {
    fill: first.fillColor ? first.fillColor.toCSS(true) : '#000000',
    stroke: first.strokeColor ? first.strokeColor.toCSS(true) : '#000000',
    strokeWidth: first.strokeWidth ?? 0,
    hasStroke: !!first.strokeColor && (first.strokeWidth ?? 0) > 0,
    hasFill: !!first.fillColor,
  };

  let bounds: paper.Rectangle | null = null;
  for (const it of items) {
    bounds = bounds ? bounds.unite(it.bounds) : it.bounds;
  }
  const transform: SelectionTransform = bounds
    ? {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        rotation: Math.round((first.rotation ?? 0) * 10) / 10,
      }
    : { x: 0, y: 0, width: 0, height: 0, rotation: 0 };

  useEditor.getState().setSelection(items.map((i) => i.id), style, transform);
  refreshLayerNames();
}

export function refreshLayerNames() {
  const layer = getContentLayer();
  const names = layer.children
    .filter((c) => c instanceof paper.Path || c instanceof paper.CompoundPath)
    .map((c, idx) => ({
      id: c.id,
      name: `${c instanceof paper.CompoundPath ? 'Compound' : 'Shape'} ${idx + 1}`,
    }))
    .reverse();
  useEditor.getState().setLayerNames(names);
}

export function notifySelectionChanged() {
  pushToStore();
  refreshOverlay();
}

export function findItemById(id: number): paper.PathItem | null {
  const layer = getContentLayer();
  for (const child of layer.children) {
    if (child.id === id && (child instanceof paper.Path || child instanceof paper.CompoundPath)) {
      return child as paper.PathItem;
    }
  }
  return null;
}
