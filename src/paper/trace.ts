import paper from 'paper';
import ImageTracer from 'imagetracerjs';
import { activateContent } from './setup';
import { pushProjectSnapshot } from './editHistory';
import { setSelection, refreshLayerNames, refreshOverlay } from './selection';

export type TraceDetail = 'low' | 'medium' | 'high';

// Presets biased toward clean icon-style results. Anti-aliased raster edges
// otherwise produce dozens of slivers per color region; blur + low color count
// merges them into a handful of solid paths.
const PRESETS: Record<TraceDetail, Record<string, number>> = {
  low:    { numberofcolors: 2,  ltres: 1,   qtres: 1,   pathomit: 32, blurradius: 4, blurdelta: 20, colorquantcycles: 3 },
  medium: { numberofcolors: 4,  ltres: 1,   qtres: 1,   pathomit: 16, blurradius: 2, blurdelta: 20, colorquantcycles: 3 },
  high:   { numberofcolors: 16, ltres: 0.5, qtres: 0.5, pathomit: 4,  blurradius: 0, blurdelta: 20, colorquantcycles: 3 },
};

function readImageData(raster: paper.Raster): ImageData | null {
  const img = raster.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | HTMLVideoElement
    | null
    | undefined;
  if (!img) return null;

  // Use natural dimensions when available (HTMLImageElement), fall back to width/height.
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

export async function traceRasterToVector(
  raster: paper.Raster,
  detail: TraceDetail = 'medium',
): Promise<paper.PathItem[] | null> {
  if (!(raster instanceof paper.Raster)) return null;

  const imageData = readImageData(raster);
  if (!imageData) return null;

  // Save the raster's placement BEFORE we mutate anything.
  const center = raster.position.clone();
  const rotation = raster.rotation || 0;
  const renderedWidth = imageData.width * Math.abs(raster.scaling.x);
  const renderedHeight = imageData.height * Math.abs(raster.scaling.y);
  const rasterIndex = raster.index;
  const parent = raster.parent;

  pushProjectSnapshot();

  // Yield so the UI can repaint "Tracing…" before the (sync) trace blocks.
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

  // Consolidate: union paths of the same fill color so each color region
  // becomes one editable path. Then simplify to keep anchor count manageable.
  const byColor = new Map<string, paper.PathItem[]>();
  for (const p of rawPaths) {
    const key = p.fillColor ? p.fillColor.toCSS(true) : 'none';
    if (!byColor.has(key)) byColor.set(key, []);
    byColor.get(key)!.push(p);
  }
  const paths: paper.PathItem[] = [];
  for (const [color, group] of byColor.entries()) {
    let merged: paper.PathItem = group[0];
    for (let i = 1; i < group.length; i++) {
      const next: paper.PathItem = (merged as any).unite(group[i], { insert: false });
      if (merged.parent) merged.remove();
      if (group[i].parent) group[i].remove();
      merged = next;
    }
    if (color !== 'none' && color !== 'transparent') {
      merged.fillColor = new paper.Color(color);
    }
    if (merged instanceof paper.Path) {
      merged.simplify(0.8);
    } else if (merged instanceof paper.CompoundPath) {
      for (const child of merged.children) {
        if (child instanceof paper.Path) child.simplify(0.8);
      }
    }
    paths.push(merged);
  }

  // Wrap the paths in a temporary group so we can transform them as one unit
  // to match the raster's placement, then unwrap.
  const temp = new paper.Group(paths);
  temp.bounds = new paper.Rectangle(
    new paper.Point(0, 0),
    new paper.Size(renderedWidth, renderedHeight),
  );
  temp.position = center;
  if (rotation !== 0) temp.rotate(rotation, center);

  // Move paths out of the temp group into the raster's parent, at the raster's z-slot.
  // Insert above the raster so they land in the same z-position; we'll remove the raster after.
  const finalPaths: paper.PathItem[] = [];
  for (const p of temp.children.slice() as paper.PathItem[]) {
    p.remove(); // detach from temp
    p.applyMatrix = true;
    if (parent) parent.insertChild(rasterIndex, p);
    finalPaths.push(p);
  }
  temp.remove();
  imported.remove();

  // Remove the original raster.
  raster.remove();

  setSelection(finalPaths);
  refreshLayerNames();
  refreshOverlay();
  paper.view.update();

  return finalPaths;
}
