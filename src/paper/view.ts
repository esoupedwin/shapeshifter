import paper from 'paper';
import { useEditor } from '../store/useEditor';
import { refreshOverlay, getSelected } from './selection';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 20;

function clamp(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

function publishZoom() {
  useEditor.getState().setZoom(paper.view.zoom);
}

export function setZoom(z: number, anchor?: paper.Point) {
  const newZoom = clamp(z);
  if (anchor) {
    const beta = paper.view.zoom / newZoom;
    const newCenter = anchor.subtract(anchor.subtract(paper.view.center).multiply(beta));
    paper.view.zoom = newZoom;
    paper.view.center = newCenter;
  } else {
    paper.view.zoom = newZoom;
  }
  refreshOverlay();
  publishZoom();
}

export function zoomAt(viewPoint: paper.Point, factor: number) {
  const projectPoint = paper.view.viewToProject(viewPoint);
  setZoom(paper.view.zoom * factor, projectPoint);
}

function selectionCenter(): paper.Point | null {
  const items = getSelected();
  if (items.length === 0) return null;
  let bounds: paper.Rectangle | null = null;
  for (const it of items) bounds = bounds ? bounds.unite(it.bounds) : it.bounds;
  return bounds ? bounds.center : null;
}

// Like setZoom, but when a shape is selected, the new view center is the
// selection's bbox center — so zooming via +/- (or Ctrl+=) draws the selection
// toward the middle of the canvas, the way PowerPoint does. Falls through to
// the plain setZoom when nothing is selected.
function setZoomCenteredOnSelection(z: number) {
  const center = selectionCenter();
  if (!center) {
    setZoom(z);
    return;
  }
  paper.view.zoom = clamp(z);
  paper.view.center = center;
  refreshOverlay();
  publishZoom();
}

export function zoomIn() {
  setZoomCenteredOnSelection(paper.view.zoom * 1.25);
}

export function zoomOut() {
  setZoomCenteredOnSelection(paper.view.zoom / 1.25);
}

export function resetView() {
  paper.view.zoom = 1;
  paper.view.center = new paper.Point(paper.view.viewSize.width / 2, paper.view.viewSize.height / 2);
  refreshOverlay();
  publishZoom();
}

export function fitContent() {
  const layer = paper.project.layers.find((l) => l.name === 'content');
  if (!layer || layer.children.length === 0) {
    resetView();
    return;
  }
  let bounds: paper.Rectangle | null = null;
  for (const child of layer.children) {
    bounds = bounds ? bounds.unite(child.strokeBounds) : child.strokeBounds;
  }
  if (!bounds) return;
  const padding = 40;
  const vw = paper.view.viewSize.width - padding * 2;
  const vh = paper.view.viewSize.height - padding * 2;
  const zoom = clamp(Math.min(vw / bounds.width, vh / bounds.height));
  paper.view.zoom = zoom;
  paper.view.center = bounds.center;
  refreshOverlay();
  publishZoom();
}

export function panBy(deltaView: paper.Point) {
  // deltaView is in view (screen) pixels — convert to project distance
  const projectDelta = deltaView.divide(paper.view.zoom);
  paper.view.center = paper.view.center.subtract(projectDelta);
  refreshOverlay();
}
