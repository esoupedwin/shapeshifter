import paper from 'paper';
import { getSelected } from './selection';

// ─── SVG serialisation ────────────────────────────────────────────────────────

function buildSVG(items: paper.PathItem[]): { svg: string; w: number; h: number } | null {
  let bounds: paper.Rectangle | null = null;
  for (const item of items) {
    const b = item.strokeBounds;
    bounds = bounds ? bounds.unite(b) : b;
  }
  if (!bounds || bounds.width < 1 || bounds.height < 1) return null;

  // Clone each item and translate so top-left is at (0, 0).
  const offset = bounds.topLeft;
  const clones = items.map((item) => {
    const c = item.clone({ insert: false });
    c.translate(offset.multiply(-1));
    return c;
  });

  const serializer = new XMLSerializer();
  const parts = clones.map((c) => serializer.serializeToString(c.exportSVG() as Element));

  const w = Math.round(bounds.width);
  const h = Math.round(bounds.height);

  // Explicit width/height in addition to viewBox so PowerPoint knows the
  // intended physical size when it pastes the shape.
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    ...parts,
    `</svg>`,
  ].join('');

  return { svg, w, h };
}

// ─── PNG rendering ────────────────────────────────────────────────────────────

function svgToPNG(svgStr: string, renderW: number, renderH: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = renderW;
      canvas.height = renderH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
      ctx.drawImage(img, 0, 0, renderW, renderH);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => resolve(b), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Copy the current vector selection to the system clipboard so it can be
 * pasted directly into PowerPoint (or any other app that accepts SVG or PNG).
 *
 * Two formats are written simultaneously:
 *   • image/svg+xml — PowerPoint 2016/365 pastes this as an editable vector
 *     group; keeps fill/stroke colours and anchor geometry exactly.
 *   • image/png — universal raster fallback for apps that don't support SVG.
 *     Rendered at 2× the shape's project dimensions (capped at 4 000 px) for
 *     crisp edges when inserted at smaller sizes.
 *
 * Falls back to PNG-only if the browser doesn't support SVG in ClipboardItem
 * (Firefox, older Chrome). Returns null when the API is unavailable or the
 * selection contains no vector paths.
 */
export async function copySelectionToClipboard(): Promise<'svg+png' | 'png' | null> {
  const items = getSelected().filter(
    (i): i is paper.PathItem =>
      i instanceof paper.Path || i instanceof paper.CompoundPath,
  );
  if (items.length === 0) return null;

  const built = buildSVG(items);
  if (!built) return null;
  const { svg, w, h } = built;

  // Render PNG at 2× resolution, capped to avoid huge bitmaps.
  const scale = Math.min(1, 4000 / Math.max(w * 2, h * 2));
  const pngW = Math.max(1, Math.round(w * 2 * scale));
  const pngH = Math.max(1, Math.round(h * 2 * scale));

  const [svgBlob, pngBlob] = await Promise.all([
    Promise.resolve(new Blob([svg], { type: 'image/svg+xml' })),
    svgToPNG(svg, pngW, pngH),
  ]);

  // Try SVG + PNG together first (Chrome 101+, Edge, Safari 15.4+).
  if (pngBlob) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/svg+xml': svgBlob, 'image/png': pngBlob }),
      ]);
      return 'svg+png';
    } catch {
      // SVG type not allowed — fall through to PNG-only.
    }
  }

  // PNG-only fallback.
  if (pngBlob) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob }),
      ]);
      return 'png';
    } catch {
      // Clipboard API unavailable (non-HTTPS without localhost, or denied).
    }
  }

  return null;
}
