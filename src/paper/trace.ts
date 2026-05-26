import paper from 'paper';
import ImageTracer from 'imagetracerjs';
import { activateContent } from './setup';
import { pushProjectSnapshot } from './editHistory';
import { setSelection, refreshLayerNames, refreshOverlay } from './selection';

export type TraceDetail = 'low' | 'medium' | 'high';

// Tuning: lower numberofcolors = chunkier; higher pathomit = drops more noise;
// blur only on "low" because it loses small detail (e.g. cone tip, drips).
const PRESETS: Record<TraceDetail, Record<string, number>> = {
  low:    { numberofcolors: 2,  ltres: 1,   qtres: 1,   pathomit: 16, blurradius: 3, blurdelta: 20, colorquantcycles: 3 },
  medium: { numberofcolors: 8,  ltres: 1,   qtres: 1,   pathomit: 4,  blurradius: 0, blurdelta: 0,  colorquantcycles: 3 },
  high:   { numberofcolors: 16, ltres: 0.5, qtres: 0.5, pathomit: 1,  blurradius: 0, blurdelta: 0,  colorquantcycles: 4 },
};

function readImageData(raster: paper.Raster): ImageData | null {
  const img = raster.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | HTMLVideoElement
    | null
    | undefined;
  if (!img) return null;

  const w =
    (img as HTMLImageElement).naturalWidth ||
    (img as HTMLCanvasElement).width ||
    0;
  const h =
    (img as HTMLImageElement).naturalHeight ||
    (img as HTMLCanvasElement).height ||
    0;
  if (w === 0 || h === 0) return null;

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

function collectPaths(item: paper.Item, out: paper.PathItem[]) {
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

function uniteGroup(group: paper.PathItem[]): paper.PathItem | null {
  if (group.length === 0) return null;
  if (group.length === 1) return group[0];
  let merged: paper.PathItem = group[0];
  for (let i = 1; i < group.length; i++) {
    const next: paper.PathItem = (merged as any).unite(group[i], { insert: false });
    if (merged.parent) merged.remove();
    if (group[i].parent) group[i].remove();
    merged = next;
  }
  return merged;
}

function segmentCount(path: paper.PathItem): number {
  if (path instanceof paper.Path) return path.segments.length;
  if (path instanceof paper.CompoundPath) {
    let n = 0;
    for (const c of path.children) if (c instanceof paper.Path) n += c.segments.length;
    return n;
  }
  return 0;
}

export async function traceRasterToVector(
  raster: paper.Raster,
  detail: TraceDetail = 'medium',
): Promise<paper.PathItem[] | null> {
  if (!(raster instanceof paper.Raster)) return null;

  const imageData = readImageData(raster);
  if (!imageData) return null;

  const imgW = imageData.width;
  const imgH = imageData.height;
  // Pre-rotation scale that maps image pixel space onto the rendered raster
  const sx = raster.scaling.x;
  const sy = raster.scaling.y;
  const center = raster.position.clone();
  const rotation = raster.rotation || 0;
  const rasterIndex = raster.index;
  const parent = raster.parent;

  pushProjectSnapshot();

  // Yield so the UI can paint "Tracing…" before the (sync) trace blocks.
  await new Promise<void>((r) => setTimeout(r, 0));

  const options = PRESETS[detail];
  const svg = ImageTracer.imagedataToSVG(imageData, options);
  if (!svg) return null;

  activateContent();
  const imported = paper.project.importSVG(svg, {
    expandShapes: true,
    applyMatrix: true,
    insert: false,
  }) as paper.Item | null;
  if (!imported) return null;

  const rawPaths: paper.PathItem[] = [];
  collectPaths(imported, rawPaths);
  if (rawPaths.length === 0) {
    imported.remove();
    return null;
  }

  // Drop tiny "noise" sub-paths (slivers from antialiasing) before merging.
  // Threshold: bbox area < 0.05% of image area.
  const minArea = (imgW * imgH) * 0.0005;
  const filtered = rawPaths.filter((p) => {
    const b = p.bounds;
    return b.width * b.height >= minArea;
  });
  // Remove dropped paths from the imported tree
  for (const p of rawPaths) {
    if (!filtered.includes(p) && p.parent) p.remove();
  }
  const usable = filtered.length > 0 ? filtered : rawPaths;

  // Group by fill color so each region becomes one editable path.
  const byColor = new Map<string, paper.PathItem[]>();
  for (const p of usable) {
    const key = p.fillColor ? p.fillColor.toCSS(true) : 'none';
    if (!byColor.has(key)) byColor.set(key, []);
    byColor.get(key)!.push(p);
  }

  const paths: paper.PathItem[] = [];
  for (const [color, group] of byColor.entries()) {
    const merged = uniteGroup(group);
    if (!merged) continue;
    if (color !== 'none' && color !== 'transparent') {
      merged.fillColor = new paper.Color(color);
    }
    // Only simplify if there's a lot of redundant geometry. Aggressive
    // simplification on already-clean paths destroys corners.
    const segs = segmentCount(merged);
    if (segs > 60) {
      if (merged instanceof paper.Path) merged.simplify(0.8);
      else if (merged instanceof paper.CompoundPath) {
        for (const c of merged.children) {
          if (c instanceof paper.Path) c.simplify(0.8);
        }
      }
    }
    paths.push(merged);
  }

  // Re-anchor: paths are currently in image pixel space [0..imgW] x [0..imgH].
  // We want to place them so they coincide with where the raster sits on the
  // canvas. Apply the raster's transform in image-pixel space (not the
  // bbox-of-content space — that's the bug that stretched a partial-fill
  // image to fill the whole rendered area).
  //
  // Transform chain (applied in order):
  //   1. translate so image center is at origin
  //   2. scale by (sx, sy) — pixel → rendered pixel
  //   3. rotate around origin
  //   4. translate to raster.position
  const temp = new paper.Group(paths);
  temp.applyMatrix = false; // accumulate transforms first
  temp.translate(new paper.Point(-imgW / 2, -imgH / 2));
  temp.scale(sx, sy, new paper.Point(0, 0));
  if (rotation !== 0) temp.rotate(rotation, new paper.Point(0, 0));
  temp.translate(center);
  temp.applyMatrix = true; // bake transforms into children

  const finalPaths: paper.PathItem[] = [];
  for (const p of temp.children.slice() as paper.PathItem[]) {
    p.remove();
    p.applyMatrix = true;
    if (parent) parent.insertChild(rasterIndex, p);
    finalPaths.push(p);
  }
  temp.remove();
  imported.remove();

  raster.remove();

  setSelection(finalPaths);
  refreshLayerNames();
  refreshOverlay();
  paper.view.update();

  return finalPaths;
}
