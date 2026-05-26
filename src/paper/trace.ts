import paper from 'paper';
import ImageTracer from 'imagetracerjs';
import { activateContent } from './setup';
import { pushProjectSnapshot } from './editHistory';
import { setSelection, refreshLayerNames, refreshOverlay } from './selection';

export type TraceDetail = 'low' | 'medium' | 'high';

// Tuning:
// - qtres=0.01 ("sharp" preset from imagetracerjs) keeps polygon corners as
//   actual corners instead of curves. Critical for stars / arrows / chevrons.
// - 2 colors at Low/Medium binarizes icons cleanly (foreground + background).
// - rightangleenhance preserves 90° corners that survive antialiasing.
// - blur only on Low (chunky); destroys small details on Medium/High.
const PRESETS: Record<TraceDetail, Record<string, number | boolean>> = {
  low: {
    numberofcolors: 2,
    ltres: 1, qtres: 1,
    pathomit: 24,
    blurradius: 4, blurdelta: 20,
    colorquantcycles: 2,
    rightangleenhance: true,
  },
  medium: {
    numberofcolors: 2,
    ltres: 1, qtres: 0.01,
    pathomit: 8,
    blurradius: 0, blurdelta: 0,
    colorquantcycles: 2,
    rightangleenhance: true,
    linefilter: true,
  },
  high: {
    numberofcolors: 8,
    ltres: 1, qtres: 0.01,
    pathomit: 2,
    blurradius: 0, blurdelta: 0,
    colorquantcycles: 3,
    rightangleenhance: true,
    linefilter: true,
  },
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
  // Pre-composite on white so transparent pixels become white instead of
  // RGBA(0,0,0,0). Without this, transparent-background images have the same
  // RGB(0,0,0) as opaque-black pixels; toCSS(true) then strips alpha and
  // groups both into the same '#000000' bucket, causing them to be merged into
  // a single full-image rectangle instead of the actual shape.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
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
    // Do NOT call simplify() — its spline fitter rounds sharp polygon corners
    // (a star's 36° tips end up looking like bubbles). The trace output is
    // already clean once qtres is low; users can manually simplify via Edit
    // Points if they want fewer anchors.
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

  // Insert paths in order so that the first path (typically the background)
  // lands at rasterIndex and each subsequent path is stacked above it.
  // Inserting everything at the same rasterIndex reverses the order, putting
  // the background on top and covering the foreground shapes.
  const finalPaths: paper.PathItem[] = [];
  let insertIdx = rasterIndex;
  for (const p of temp.children.slice() as paper.PathItem[]) {
    p.remove();
    p.applyMatrix = true;
    if (parent) parent.insertChild(insertIdx++, p);
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
