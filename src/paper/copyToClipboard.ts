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
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    ...parts,
    `</svg>`,
  ].join('');

  return { svg, w, h };
}

// ─── PNG rendering ────────────────────────────────────────────────────────────

function svgToPNGBlob(svgStr: string, renderW: number, renderH: number): Promise<Blob | null> {
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
 * Copy the current vector selection to the system clipboard as a PNG so it
 * can be pasted into PowerPoint (or any other app) with Ctrl+V.
 *
 * IMPORTANT — this function must be called synchronously inside a user-gesture
 * handler (click / keydown). It is deliberately NOT an async function: it calls
 * navigator.clipboard.write() before yielding to the event loop, which keeps
 * the browser's user-gesture permission grant alive.  Passing a Promise<Blob>
 * to ClipboardItem is the correct pattern — the browser resolves the blob
 * after the write() call is accepted.
 *
 * Returns a Promise<boolean>: true = written successfully, false = failed
 * (clipboard API unavailable, permission denied, or selection is empty).
 */
export function copySelectionToClipboard(): Promise<boolean> {
  // Guard: Clipboard API must be available (requires HTTPS or localhost).
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return Promise.resolve(false);
  }

  const items = getSelected().filter(
    (i): i is paper.PathItem =>
      i instanceof paper.Path || i instanceof paper.CompoundPath,
  );
  if (items.length === 0) return Promise.resolve(false);

  const built = buildSVG(items);
  if (!built) return Promise.resolve(false);

  const { svg, w, h } = built;

  // Render at 2× for crisp edges; cap at 4 000 px to avoid huge bitmaps.
  const renderScale = Math.min(2, 4000 / Math.max(w, h));
  const renderW = Math.max(1, Math.round(w * renderScale));
  const renderH = Math.max(1, Math.round(h * renderScale));

  // Start the async PNG render and pass the Promise straight into ClipboardItem.
  // The write() call below happens synchronously — the browser records the
  // user-gesture grant now and resolves the blob internally afterwards.
  const pngPromise: Promise<Blob> = svgToPNGBlob(svg, renderW, renderH).then(
    (b) => b ?? new Blob([], { type: 'image/png' }),
  );

  // ← navigator.clipboard.write() is called here, synchronously, so the
  //   user-gesture context is still active when the browser checks permission.
  return navigator.clipboard
    .write([new ClipboardItem({ 'image/png': pngPromise })])
    .then(() => true)
    .catch(() => false);
}
