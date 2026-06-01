import paper from 'paper';
import { getSelected } from './selection';
import { getOverlayLayer } from './setup';

/**
 * Copy the current vector selection to the system clipboard as a PNG so it
 * can be pasted into PowerPoint (or any other app) with Ctrl+V.
 *
 * Strategy — capture directly from the rendered Paper.js canvas:
 *   1. Hide the selection-handles overlay so it doesn't appear in the copy.
 *   2. Force Paper.js to re-draw (synchronous Canvas 2D API calls).
 *   3. Crop the relevant canvas region with drawImage (synchronous).
 *   4. Read the pixel data with canvas.toDataURL() (synchronous).
 *   5. Convert the data URL to a Blob (synchronous).
 *   6. Restore the overlay.
 *   7. Call navigator.clipboard.write() with a real Blob — NOT a Promise<Blob>.
 *
 * Steps 1-6 are all synchronous so by the time clipboard.write() is called
 * no event-loop yield has occurred and the browser still considers this call
 * to be within the original user-gesture context.
 *
 * This avoids the SVG→Image→Canvas async pipeline entirely, which was the
 * root cause of previous failures (silent empty-blob on onerror, user-gesture
 * expiry, and Chrome's limited ClipboardItem type support).
 *
 * Returns a Promise<boolean>: true = written successfully, false = failed.
 * Must be called synchronously inside a user-gesture handler (click/keydown).
 */
export function copySelectionToClipboard(): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return Promise.resolve(false);
  }

  const items = getSelected().filter(
    (i): i is paper.PathItem =>
      i instanceof paper.Path || i instanceof paper.CompoundPath,
  );
  if (items.length === 0) return Promise.resolve(false);

  // Combined stroke bounds — includes thick outlines so they aren't clipped.
  let bounds: paper.Rectangle | null = null;
  for (const item of items) {
    const b = item.strokeBounds;
    bounds = bounds ? bounds.unite(b) : b;
  }
  if (!bounds || bounds.width < 1 || bounds.height < 1) return Promise.resolve(false);

  // Get the canvas element Paper.js renders into.
  const paperCanvas = document.getElementById('paper-canvas') as HTMLCanvasElement | null;
  if (!paperCanvas) return Promise.resolve(false);

  // ── 1-2. Hide overlay and re-render synchronously ──────────────────────────
  const overlay = getOverlayLayer();
  overlay.visible = false;
  paper.view.update(); // writes to canvas immediately via Canvas 2D API

  // ── 3. Crop the canvas region that covers the selection ────────────────────
  // projectToView gives CSS-pixel coordinates; multiply by devicePixelRatio to
  // get physical canvas pixel coordinates (Paper.js uses a HiDPI canvas).
  const tl = paper.view.projectToView(bounds.topLeft);
  const br = paper.view.projectToView(bounds.bottomRight);
  const dpr = window.devicePixelRatio || 1;

  const srcX = Math.round(Math.max(0, tl.x * dpr));
  const srcY = Math.round(Math.max(0, tl.y * dpr));
  const srcW = Math.round(Math.min((br.x - tl.x) * dpr, paperCanvas.width  - srcX));
  const srcH = Math.round(Math.min((br.y - tl.y) * dpr, paperCanvas.height - srcY));

  let pngBlob: Blob | null = null;

  if (srcW > 0 && srcH > 0) {
    // Scale the output to ~2× the view-space size for crisp edges in PowerPoint,
    // capped at 4 000 px so we don't produce absurdly large bitmaps.
    const outScale = Math.min(2, 4000 / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * outScale));
    const outH = Math.max(1, Math.round(srcH * outScale));

    const outCanvas = document.createElement('canvas');
    outCanvas.width  = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext('2d');

    if (ctx) {
      ctx.drawImage(paperCanvas, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

      // ── 4. Read pixels synchronously as a data URL ─────────────────────────
      const dataURL = outCanvas.toDataURL('image/png');

      // ── 5. Convert data URL → Blob synchronously ───────────────────────────
      const b64 = dataURL.slice('data:image/png;base64,'.length);
      const byteChars = atob(b64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      pngBlob = new Blob([bytes], { type: 'image/png' });
    }
  }

  // ── 6. Restore overlay ─────────────────────────────────────────────────────
  overlay.visible = true;
  paper.view.update();

  if (!pngBlob) return Promise.resolve(false);

  // ── 7. Write real Blob to clipboard (still within user-gesture context) ────
  return navigator.clipboard
    .write([new ClipboardItem({ 'image/png': pngBlob })])
    .then(() => true)
    .catch((err) => {
      console.error('[copy] clipboard.write failed:', err);
      return false;
    });
}
