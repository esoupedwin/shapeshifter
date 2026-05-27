import paper from 'paper';
import {
  getSelected,
  setSelection,
  refreshLayerNames,
  refreshOverlay,
  notifySelectionChanged,
} from './selection';
import { activateContent, getContentLayer } from './setup';

// ─── Type ────────────────────────────────────────────────────────────────────

export interface CustomShape {
  id: string;
  name: string;
  /** Full SVG element string with a viewBox matching the shape's bounding box. */
  svg: string;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Export the current canvas selection as a self-contained SVG string.
 * The viewBox is set to the selection's stroke-bounding box so the SVG
 * renders correctly as both a thumbnail and re-insertable content.
 *
 * Returns null when the selection is empty, contains only rasters, or has
 * effectively zero area.
 */
export function buildCustomShape(name: string): CustomShape | null {
  const items = getSelected().filter(
    (i) => i instanceof paper.Path || i instanceof paper.CompoundPath,
  );
  if (items.length === 0) return null;

  let bounds: paper.Rectangle | null = null;
  for (const item of items) {
    const b = item.strokeBounds;
    bounds = bounds ? bounds.unite(b) : b;
  }
  if (!bounds || bounds.width < 1 || bounds.height < 1) return null;

  // Clone each item and translate it so the top-left of the combined bounds
  // lands at the SVG origin (0, 0). The clones are never inserted into the
  // project (insert: false equivalent — we just don't add them to a layer).
  const offset = bounds.topLeft;
  const clones = items.map((item) => {
    const c = item.clone({ insert: false });
    c.translate(offset.multiply(-1));
    return c;
  });

  const w = Math.round(bounds.width * 100) / 100;
  const h = Math.round(bounds.height * 100) / 100;

  const serializer = new XMLSerializer();
  const parts = clones.map((c) => {
    const el = c.exportSVG() as Element;
    return serializer.serializeToString(el);
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
  const id = `cs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return { id, name: name.trim() || 'Custom Shape', svg };
}

// ─── Insertion ────────────────────────────────────────────────────────────────

/**
 * Import a stored custom shape SVG onto the content layer.
 * The shape is centered on the current viewport and selected automatically.
 *
 * The insertion preserves the original colors and dimensions. If multiple
 * paths were saved together they are all inserted and selected as a group.
 */
export function insertCustomShape(svg: string): void {
  activateContent();

  // Import off-canvas so we can position before the paths become visible.
  const imported = paper.project.importSVG(svg, {
    expandShapes: true,
    applyMatrix: true,
    insert: false,
  }) as paper.Item | null;
  if (!imported) return;

  // Gather leaf paths from whatever hierarchy importSVG created.
  const paths: paper.PathItem[] = [];
  collectPaths(imported, paths);

  if (paths.length === 0) {
    imported.remove();
    return;
  }

  // Compute combined bounds so we can center the shape on the viewport.
  let combinedBounds: paper.Rectangle | null = null;
  for (const p of paths) {
    combinedBounds = combinedBounds ? combinedBounds.unite(p.bounds) : p.bounds;
  }
  const delta = combinedBounds
    ? paper.view.center.subtract(combinedBounds.center)
    : new paper.Point(0, 0);

  // Translate and add to the content layer.
  const layer = getContentLayer();
  for (const p of paths) {
    p.translate(delta);
    layer.addChild(p);
  }
  imported.remove();

  setSelection(paths);
  refreshLayerNames();
  refreshOverlay();
  notifySelectionChanged();
  paper.view.update();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectPaths(item: paper.Item, out: paper.PathItem[]): void {
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    out.push(item);
    return;
  }
  if ('children' in item && Array.isArray((item as paper.Group).children)) {
    for (const child of (item as paper.Group).children.slice()) {
      collectPaths(child, out);
    }
  }
}
