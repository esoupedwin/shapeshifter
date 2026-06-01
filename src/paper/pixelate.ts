import paper from 'paper';
import {
  getSelected,
  setSelection,
  refreshLayerNames,
  refreshOverlay,
  notifySelectionChanged,
} from './selection';
import { activateContent, getContentLayer } from './setup';
import { pushProjectSnapshot } from './editHistory';

// ─── SVG → pixel data ─────────────────────────────────────────────────────────

/**
 * Render an SVG string (with explicit width/height) onto a white off-screen
 * canvas and return the raw RGBA pixel data.
 */
function renderSVGToImageData(
  svgStr: string,
  w: number,
  h: number,
): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      // Pre-fill white so transparent SVG areas become white rather than black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert the current path selection into a pixel-art grid of solid-colour
 * rectangles.
 *
 * Algorithm:
 *   1. Export selected paths as SVG, translated to origin.
 *   2. Render onto a white off-screen canvas.
 *   3. Divide the canvas into gridCols × gridRows cells (square pixels).
 *   4. Average the RGBA of each cell; skip near-white cells (background).
 *   5. Replace the original paths with Paper.js Path.Rectangles, one per
 *      non-background cell, coloured with the sampled average.
 *
 * @param gridCols  Pixel columns across the shape's bounding box.
 *                  Rows are derived automatically so each cell is square.
 */
export async function pixelateSelection(gridCols: number): Promise<boolean> {
  const items = getSelected().filter(
    (i) => i instanceof paper.Path || i instanceof paper.CompoundPath,
  );
  if (items.length === 0) return false;

  // Combined stroke-bounds so thick outlines are included.
  let bounds: paper.Rectangle | null = null;
  for (const item of items) {
    const b = item.strokeBounds;
    bounds = bounds ? bounds.unite(b) : b;
  }
  if (!bounds || bounds.width < 1 || bounds.height < 1) return false;

  const { x, y, width, height } = bounds;

  // Square pixel cells: derive row count from shape aspect ratio.
  const cellSize = width / gridCols;
  const gridRows = Math.max(1, Math.round(height / cellSize));

  // Render resolution: aim for ~512 px on the longer axis, never below 4 px
  // per cell (gives good colour averaging even for coarse grids).
  const longerAxis = Math.max(gridCols, gridRows);
  const renderScale = Math.max(4, Math.round(512 / longerAxis));
  const renderW = gridCols * renderScale;
  const renderH = gridRows * renderScale;

  // ── Build the SVG for off-screen rendering ───────────────────────────────────
  // Clone each item, translate so the combined top-left is at (0, 0).
  const offset = bounds.topLeft;
  const clones = items.map((item) => {
    const c = item.clone({ insert: false });
    c.translate(offset.multiply(-1));
    return c;
  });

  const serializer = new XMLSerializer();
  const pathParts = clones.map((c) =>
    serializer.serializeToString(c.exportSVG() as Element),
  );

  // Explicit width/height make browsers scale the SVG content to the render
  // canvas dimensions (the viewBox maps project-unit space → render pixels).
  const svgStr = [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` viewBox="0 0 ${width} ${height}"`,
    ` width="${renderW}" height="${renderH}">`,
    ...pathParts,
    `</svg>`,
  ].join('');

  // Yield so React can repaint the "Pixelating…" label before the heavy work.
  await new Promise<void>((r) => setTimeout(r, 0));

  const imageData = await renderSVGToImageData(svgStr, renderW, renderH);
  if (!imageData) return false;
  const { data } = imageData;

  // ── Sample cells and create pixel rectangles ─────────────────────────────────
  pushProjectSnapshot();
  activateContent();
  const layer = getContentLayer();

  // Remove the originals AFTER snapshotting so Ctrl+Z restores them.
  for (const item of items) item.remove();

  const pixelItems: paper.Item[] = [];

  for (let ri = 0; ri < gridRows; ri++) {
    for (let ci = 0; ci < gridCols; ci++) {
      // Average all rendered pixels that fall inside this cell.
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      const rowStart = ri * renderScale;
      const colStart = ci * renderScale;

      for (let py = rowStart; py < rowStart + renderScale; py++) {
        for (let px = colStart; px < colStart + renderScale; px++) {
          const base = (py * renderW + px) * 4;
          rSum += data[base];
          gSum += data[base + 1];
          bSum += data[base + 2];
        }
      }

      const n = renderScale * renderScale;
      const avgR = rSum / n;
      const avgG = gSum / n;
      const avgB = bSum / n;

      // Skip cells that are indistinguishable from the white background.
      // Threshold 250/255 (≈ 98% brightness) excludes white + near-white
      // antialiasing fringe while keeping very light coloured shapes.
      if ((avgR + avgG + avgB) / 3 > 250) continue;

      const rect = new paper.Path.Rectangle(
        new paper.Rectangle(
          new paper.Point(x + ci * cellSize, y + ri * cellSize),
          new paper.Size(cellSize, cellSize),
        ),
      );
      rect.fillColor = new paper.Color(avgR / 255, avgG / 255, avgB / 255);
      rect.strokeColor = null;
      layer.addChild(rect);
      pixelItems.push(rect);
    }
  }

  if (pixelItems.length === 0) return false;

  setSelection(pixelItems);
  refreshLayerNames();
  refreshOverlay();
  notifySelectionChanged();
  paper.view.update();
  return true;
}
