import paper from 'paper';
import { useEditor, ToolMode } from '../store/useEditor';
import { getOverlayLayer, activateContent, activateOverlay } from './setup';
import {
  createRect,
  createEllipse,
  createRegularPolygon,
  createStar,
  createLine,
  createArrow,
} from './shapes';
import {
  clearSelection,
  selectItem,
  toggleItem,
  hitTestSelectable,
  getSelected,
  setSelection,
  refreshOverlay,
  notifySelectionChanged,
  getEditPointsTarget,
  setEditPointsTarget,
  setSelectedSegment,
  getSelectedSegment,
} from './selection';
import { pushSnapshot } from './editHistory';

let tool: paper.Tool | null = null;
let currentMode: ToolMode = 'select';

let drawingPath: paper.Path | null = null;
let drawStart: paper.Point | null = null;

let dragMode: 'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'segment' | 'bezier' | 'curve' = 'none';
let dragHandle: string = '';
let dragStartPoint: paper.Point | null = null;
let dragOriginalBounds: paper.Rectangle | null = null;
let dragOriginalPositions: Map<number, paper.Point> = new Map();
let dragOriginalCenter: paper.Point | null = null;
let dragSegment: { path: paper.Path; index: number } | null = null;
let dragBezier: { path: paper.Path; index: number; which: 'handleIn' | 'handleOut' } | null = null;
let dragCurve: { path: paper.Path; curveIndex: number } | null = null;
let marqueeRect: paper.Path.Rectangle | null = null;

export function initTools() {
  if (tool) return;
  tool = new paper.Tool();
  tool.minDistance = 1;

  tool.onMouseDown = onMouseDown;
  tool.onMouseDrag = onMouseDrag;
  tool.onMouseUp = onMouseUp;

  useEditor.subscribe((state, prev) => {
    if (state.tool !== prev.tool) {
      onToolChange(state.tool);
    }
  });
  onToolChange(useEditor.getState().tool);
}

function onToolChange(newMode: ToolMode) {
  currentMode = newMode;
  if (newMode !== 'select' && newMode !== 'editPoints') {
    clearSelection();
    setEditPointsTarget(null);
  } else if (newMode === 'select') {
    setEditPointsTarget(null);
  }
}

function hitTestOverlay(point: paper.Point) {
  const overlay = getOverlayLayer();
  return overlay.hitTest(point, {
    fill: true,
    stroke: true,
    tolerance: 5,
  });
}

function onMouseDown(event: paper.ToolEvent) {
  dragStartPoint = event.point.clone();
  dragOriginalPositions = new Map();

  if (
    currentMode === 'drawRect' ||
    currentMode === 'drawEllipse' ||
    currentMode === 'drawTriangle' ||
    currentMode === 'drawPentagon' ||
    currentMode === 'drawHexagon' ||
    currentMode === 'drawStar' ||
    currentMode === 'drawLine' ||
    currentMode === 'drawArrow'
  ) {
    drawStart = event.point.clone();
    drawingPath = null;
    return;
  }

  if (currentMode === 'editPoints') {
    const target = getEditPointsTarget();
    if (!target) return;

    // 1. Bezier handle hit takes priority — drag handleIn / handleOut
    const overlayHit = hitTestOverlay(event.point);
    if (
      overlayHit &&
      overlayHit.item &&
      (overlayHit.item.data.handle === 'handleIn' || overlayHit.item.data.handle === 'handleOut')
    ) {
      const bPath = overlayHit.item.data.path as paper.Path;
      pushSnapshot(bPath);
      dragMode = 'bezier';
      dragBezier = {
        path: bPath,
        index: overlayHit.item.data.segmentIndex,
        which: overlayHit.item.data.handle,
      };
      return;
    }

    // 2. Anchor (segment) hit — select it (revealing its bezier handles) and start drag
    if (overlayHit && overlayHit.item && overlayHit.item.data.handle === 'seg') {
      const segPath = overlayHit.item.data.path as paper.Path;
      const idx = overlayHit.item.data.segmentIndex as number;
      setSelectedSegment(segPath, idx);
      pushSnapshot(segPath);
      dragMode = 'segment';
      dragSegment = { path: segPath, index: idx };
      return;
    }

    // 3. Alt-click near an anchor — delete it
    if (event.modifiers.alt) {
      const path = pathFromTarget(target);
      if (path) {
        const nearest = nearestSegmentIndex(path, event.point, 12);
        if (nearest !== -1 && path.segments.length > 3) {
          pushSnapshot(path);
          path.removeSegment(nearest);
          setSelectedSegment(null, null);
          refreshOverlay();
          notifySelectionChanged();
          return;
        }
      }
    }

    // 4. Click on the path stroke — drag to BEND the curve (creates/modifies bezier handles).
    //    Shift+click on stroke = insert a new anchor at that location.
    const path = pathFromTarget(target);
    if (path) {
      const hit = path.hitTest(event.point, { stroke: true, tolerance: 6 });
      if (hit && hit.location) {
        if (event.modifiers.shift) {
          pushSnapshot(path);
          path.insert(hit.location.index + 1, event.point);
          setSelectedSegment(path, hit.location.index + 1);
          refreshOverlay();
          notifySelectionChanged();
          return;
        }
        // Bend the curve — record snapshot and remember which curve to deform.
        pushSnapshot(path);
        dragMode = 'curve';
        dragCurve = { path, curveIndex: hit.location.index };
        return;
      }
    }

    // 5. Click in empty space — deselect the current anchor (handles disappear).
    //    Click again in empty space (with no anchor selected) exits edit-points.
    if (getSelectedSegment()) {
      setSelectedSegment(null, null);
      return;
    }
    setEditPointsTarget(null);
    useEditor.getState().setTool('select');
    return;
  }

  // SELECT mode
  const overlayHit = hitTestOverlay(event.point);
  if (overlayHit && overlayHit.item) {
    const handle = overlayHit.item.data.handle;
    if (handle === 'rotate') {
      dragMode = 'rotate';
      dragOriginalCenter = computeSelectionCenter();
      return;
    }
    if (handle) {
      dragMode = 'resize';
      dragHandle = handle;
      dragOriginalBounds = computeSelectionBounds();
      getSelected().forEach((it) => dragOriginalPositions.set(it.id, it.position.clone()));
      return;
    }
  }

  const hit = hitTestSelectable(event.point);
  if (hit) {
    if (event.modifiers.shift) {
      toggleItem(hit);
    } else if (!getSelected().includes(hit)) {
      selectItem(hit);
    }
    if (getSelected().length > 0) {
      dragMode = 'move';
    }
    return;
  }

  // Empty space → start marquee
  if (!event.modifiers.shift) clearSelection();
  dragMode = 'marquee';
  activateOverlay();
  marqueeRect = new paper.Path.Rectangle(event.point, new paper.Size(1, 1));
  marqueeRect.strokeColor = new paper.Color('#0e639c');
  marqueeRect.strokeWidth = 1;
  marqueeRect.dashArray = [3, 2];
  marqueeRect.fillColor = new paper.Color(14 / 255, 99 / 255, 156 / 255, 0.15);
  marqueeRect.data.overlay = true;
  activateContent();
}

function onMouseDrag(event: paper.ToolEvent) {
  // Drawing
  if (drawStart) {
    if (drawingPath) drawingPath.remove();
    const from = drawStart;
    const to = event.point;
    switch (currentMode) {
      case 'drawRect':
        drawingPath = createRect(from, to);
        break;
      case 'drawEllipse':
        drawingPath = createEllipse(from, to);
        break;
      case 'drawTriangle':
        drawingPath = createRegularPolygon(from, to, 3);
        break;
      case 'drawPentagon':
        drawingPath = createRegularPolygon(from, to, 5);
        break;
      case 'drawHexagon':
        drawingPath = createRegularPolygon(from, to, 6);
        break;
      case 'drawStar':
        drawingPath = createStar(from, to);
        break;
      case 'drawLine':
        drawingPath = createLine(from, to);
        break;
      case 'drawArrow':
        drawingPath = createArrow(from, to);
        break;
    }
    return;
  }

  if (dragMode === 'move') {
    for (const it of getSelected()) it.position = it.position.add(event.delta);
    refreshOverlay();
    return;
  }

  if (dragMode === 'segment' && dragSegment) {
    const { path, index } = dragSegment;
    path.segments[index].point = path.segments[index].point.add(event.delta);
    refreshOverlay();
    return;
  }

  if (dragMode === 'bezier' && dragBezier) {
    const { path, index, which } = dragBezier;
    const seg = path.segments[index];
    const rel = event.point.subtract(seg.point);
    if (which === 'handleIn') {
      seg.handleIn = rel;
      if (event.modifiers.shift) {
        seg.handleOut = rel.multiply(-1);
      }
    } else {
      seg.handleOut = rel;
      if (event.modifiers.shift) {
        seg.handleIn = rel.multiply(-1);
      }
    }
    refreshOverlay();
    return;
  }

  if (dragMode === 'curve' && dragCurve) {
    // Bend the curve by moving its midpoint toward the cursor. Distribute the
    // delta across the two endpoint handles using Bezier midpoint math:
    // for a cubic Bezier with control points P0, P1, P2, P3, the curve at t=0.5
    // is (P0 + 3·P1 + 3·P2 + P3) / 8. We want to move that midpoint by the drag
    // delta, so P1 and P2 each shift by (4/3)·delta to keep the curve smooth.
    const { path, curveIndex } = dragCurve;
    const curve = path.curves[curveIndex];
    if (curve) {
      const scale = 4 / 3;
      const adjust = event.delta.multiply(scale);
      curve.segment1.handleOut = curve.segment1.handleOut.add(adjust);
      curve.segment2.handleIn = curve.segment2.handleIn.add(adjust);
      // Ensure the selected anchor's handles show up
      const sel = getSelectedSegment();
      if (!sel) {
        setSelectedSegment(path, curve.segment1.index);
      }
      refreshOverlay();
    }
    return;
  }

  if (dragMode === 'resize' && dragOriginalBounds && dragStartPoint) {
    const orig = dragOriginalBounds;
    const dx = event.point.x - dragStartPoint.x;
    const dy = event.point.y - dragStartPoint.y;

    let newLeft = orig.left;
    let newTop = orig.top;
    let newRight = orig.right;
    let newBottom = orig.bottom;

    if (dragHandle.includes('w')) newLeft = orig.left + dx;
    if (dragHandle.includes('e')) newRight = orig.right + dx;
    if (dragHandle.includes('n')) newTop = orig.top + dy;
    if (dragHandle.includes('s')) newBottom = orig.bottom + dy;

    const newWidth = Math.max(5, newRight - newLeft);
    const newHeight = Math.max(5, newBottom - newTop);
    if (newRight - newLeft < 5) {
      if (dragHandle.includes('w')) newLeft = newRight - 5;
      else newRight = newLeft + 5;
    }
    if (newBottom - newTop < 5) {
      if (dragHandle.includes('n')) newTop = newBottom - 5;
      else newBottom = newTop + 5;
    }

    const scaleX = (newRight - newLeft) / orig.width;
    const scaleY = (newBottom - newTop) / orig.height;
    const anchor = new paper.Point(
      dragHandle.includes('w') ? orig.right : orig.left,
      dragHandle.includes('n') ? orig.bottom : orig.top,
    );

    // Reset positions then scale uniformly from anchor for the whole selection
    const sel = getSelected();
    // Build a group transform: we cannot easily restore; instead scale each shape from anchor
    for (const it of sel) {
      const original = dragOriginalPositions.get(it.id);
      if (!original) continue;
      it.position = original;
    }

    // Apply scale via direct matrix scale around anchor for each item from original size
    // Easiest: scale each item independently from anchor based on its current bounds being a fraction of original combined bounds
    // We'll just apply scale to each item from anchor, but to make it idempotent, restore original sizes first.
    // To keep simplicity, we compute relative position and apply scale once per drag delta is impractical.
    // Instead, do "live" scaling by using delta-based scaling on each item:
    void scaleX; void scaleY; void anchor; void newWidth; void newHeight;
    // Implementing using bounds set approach:
    let combined: paper.Rectangle | null = null;
    for (const it of sel) {
      combined = combined ? combined.unite(it.bounds) : it.bounds;
    }
    if (!combined) return;

    // Map combined to the new target rectangle
    const target = new paper.Rectangle(
      new paper.Point(newLeft, newTop),
      new paper.Size(newRight - newLeft, newBottom - newTop),
    );
    const sx = target.width / combined.width;
    const sy = target.height / combined.height;
    const anchorPt = new paper.Point(
      dragHandle.includes('w') ? combined.right : combined.left,
      dragHandle.includes('n') ? combined.bottom : combined.top,
    );

    for (const it of sel) {
      it.scale(sx, sy, anchorPt);
    }
    refreshOverlay();
    return;
  }

  if (dragMode === 'rotate' && dragOriginalCenter && dragStartPoint) {
    const center = dragOriginalCenter;
    const a1 = dragStartPoint.subtract(center).angle;
    const a2 = event.point.subtract(center).angle;
    let delta = a2 - a1;
    if (event.modifiers.shift) {
      const step = 15;
      delta = Math.round(delta / step) * step;
    }
    dragStartPoint = event.point.clone();
    for (const it of getSelected()) it.rotate(delta, center);
    refreshOverlay();
    return;
  }

  if (dragMode === 'marquee' && marqueeRect && dragStartPoint) {
    activateOverlay();
    marqueeRect.remove();
    marqueeRect = new paper.Path.Rectangle({
      from: dragStartPoint,
      to: event.point,
      strokeColor: '#0e639c',
      strokeWidth: 1,
      dashArray: [3, 2],
      fillColor: new paper.Color(14 / 255, 99 / 255, 156 / 255, 0.15),
    });
    marqueeRect.data.overlay = true;
    activateContent();
    return;
  }
}

function onMouseUp(event: paper.ToolEvent) {
  if (drawStart) {
    if (!drawingPath) {
      // Click without drag → create default-size shape
      const to = event.point.add(new paper.Point(120, 80));
      switch (currentMode) {
        case 'drawRect':
          drawingPath = createRect(drawStart, to);
          break;
        case 'drawEllipse':
          drawingPath = createEllipse(drawStart, to);
          break;
        case 'drawTriangle':
          drawingPath = createRegularPolygon(drawStart, to, 3);
          break;
        case 'drawPentagon':
          drawingPath = createRegularPolygon(drawStart, to, 5);
          break;
        case 'drawHexagon':
          drawingPath = createRegularPolygon(drawStart, to, 6);
          break;
        case 'drawStar':
          drawingPath = createStar(drawStart, to);
          break;
        case 'drawLine':
          drawingPath = createLine(drawStart, to);
          break;
        case 'drawArrow':
          drawingPath = createArrow(drawStart, to);
          break;
      }
    }
    if (drawingPath) {
      const created = drawingPath;
      drawingPath = null;
      drawStart = null;
      useEditor.getState().setTool('select');
      selectItem(created);
    } else {
      drawStart = null;
    }
    return;
  }

  if (dragMode === 'marquee' && marqueeRect && dragStartPoint) {
    const rect = new paper.Rectangle(dragStartPoint, event.point);
    marqueeRect.remove();
    marqueeRect = null;
    if (rect.width > 2 || rect.height > 2) {
      const inside: paper.PathItem[] = [];
      for (const child of getSelected().length ? [] : []) inside.push(child);
      // collect from content layer
      const layer = (paper.project.layers as paper.Layer[]).find((l) => l.name === 'content');
      if (layer) {
        for (const c of layer.children) {
          if ((c instanceof paper.Path || c instanceof paper.CompoundPath) && rect.contains(c.bounds)) {
            inside.push(c as paper.PathItem);
          }
        }
      }
      if (inside.length > 0) setSelection(inside);
    }
  }

  if (
    dragMode === 'move' ||
    dragMode === 'resize' ||
    dragMode === 'rotate' ||
    dragMode === 'segment' ||
    dragMode === 'bezier' ||
    dragMode === 'curve'
  ) {
    notifySelectionChanged();
  }

  dragMode = 'none';
  dragHandle = '';
  dragStartPoint = null;
  dragOriginalBounds = null;
  dragOriginalCenter = null;
  dragSegment = null;
  dragBezier = null;
  dragCurve = null;
}

function computeSelectionBounds(): paper.Rectangle | null {
  const sel = getSelected();
  let bounds: paper.Rectangle | null = null;
  for (const it of sel) bounds = bounds ? bounds.unite(it.bounds) : it.bounds;
  return bounds;
}

function computeSelectionCenter(): paper.Point | null {
  const b = computeSelectionBounds();
  return b ? b.center : null;
}

function pathFromTarget(target: paper.PathItem): paper.Path | null {
  if (target instanceof paper.Path) return target;
  if (target instanceof paper.CompoundPath && target.children.length > 0) {
    return target.children[0] as paper.Path;
  }
  return null;
}

function nearestSegmentIndex(path: paper.Path, point: paper.Point, tolerance: number): number {
  let best = -1;
  let bestDist = tolerance;
  path.segments.forEach((seg, idx) => {
    const d = seg.point.getDistance(point);
    if (d < bestDist) {
      bestDist = d;
      best = idx;
    }
  });
  return best;
}
