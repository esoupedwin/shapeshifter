import paper from 'paper';
import { activateContent, getContentLayer } from './setup';
import { pushProjectSnapshot } from './editHistory';
import { setSelection, refreshLayerNames, refreshOverlay } from './selection';
import { insertImageFromFile } from './raster';

const PASTE_MAX_SIDE_PX = 500;

function placeAndUnwrap(imported: paper.Item): paper.Item[] {
  // Scale and center the imported tree as a unit so children keep their
  // relative positions. Then flatten Groups into the content layer so each
  // shape is independently selectable / listable. Rasters and Paths within
  // the tree stay intact; only the wrapping Groups are dissolved.
  const layer = getContentLayer();
  if (imported.parent !== layer) layer.addChild(imported);

  const size = imported.bounds.size;
  const longest = Math.max(size.width, size.height);
  if (longest > PASTE_MAX_SIDE_PX) {
    imported.scale(PASTE_MAX_SIDE_PX / longest);
  }
  imported.position = paper.view.center;

  // Bake the transform we just applied into the children before unwrapping,
  // so each child carries the final on-canvas geometry.
  imported.applyMatrix = true;

  const out: paper.Item[] = [];
  collectAndUnwrap(imported, layer, out);
  if (imported.parent) imported.remove();
  return out;
}

function collectAndUnwrap(item: paper.Item, target: paper.Layer, out: paper.Item[]) {
  // Anything that's a leaf (Path / CompoundPath / Raster) gets moved to the
  // target layer. Everything else (Group, etc.) is walked into.
  if (
    item instanceof paper.Path ||
    item instanceof paper.CompoundPath ||
    item instanceof paper.Raster
  ) {
    target.addChild(item);
    out.push(item);
    return;
  }
  // Walk children — but only if the item actually has a children array. Some
  // paper.Item subtypes have `children` in their prototype with an undefined
  // value (e.g. items that haven't been initialized as containers).
  const maybeChildren = (item as paper.Group).children;
  if (!Array.isArray(maybeChildren)) return;
  // Snapshot the list because addChild on each one mutates the source.
  for (const child of maybeChildren.slice()) {
    collectAndUnwrap(child, target, out);
  }
}

function importSvgString(svg: string): paper.Item | null {
  activateContent();
  try {
    const imported = paper.project.importSVG(svg, {
      expandShapes: true,
      applyMatrix: true,
      insert: false,
    }) as paper.Item | null;
    return imported || null;
  } catch (err) {
    console.error('importSVG failed:', err);
    return null;
  }
}

async function readItemAsString(item: DataTransferItem): Promise<string | null> {
  if (item.kind === 'string') {
    return new Promise<string>((resolve) => item.getAsString(resolve));
  }
  if (item.kind === 'file') {
    const file = item.getAsFile();
    if (!file) return null;
    return await file.text();
  }
  return null;
}

async function dataUrlToFile(dataUrl: string, name = 'pasted'): Promise<File | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || 'image/png' });
  } catch {
    return null;
  }
}

async function pasteSvgImported(svg: string): Promise<boolean> {
  pushProjectSnapshot();
  const imp = importSvgString(svg);
  if (!imp) return false;
  const flat = placeAndUnwrap(imp);
  if (flat.length === 0) return false;
  setSelection(flat);
  refreshLayerNames();
  refreshOverlay();
  paper.view.update();
  return true;
}

async function pasteRasterFile(file: File): Promise<boolean> {
  try {
    await insertImageFromFile(file);
    return true;
  } catch (err) {
    console.error('Image paste failed:', err);
    return false;
  }
}

function logClipboardSnapshot(data: DataTransfer | null): void {
  if (!import.meta.env.DEV || !data) return;
  const types = Array.from(data.types || []);
  const items = Array.from(data.items || []).map((it) => `${it.kind}:${it.type}`);
  const files = Array.from(data.files || []).map((f) => `${f.name} (${f.type}, ${f.size}B)`);
  console.log('[paste] clipboard snapshot', { types, items, files });
}

async function tryHtml(html: string | null): Promise<boolean> {
  if (!html) return false;
  // 1. Inline <svg>...</svg> → editable paths
  const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch && (await pasteSvgImported(svgMatch[0]))) return true;

  // 2. <img src="..."> — try data URLs (PowerPoint sometimes inlines them),
  //    then any other URL the browser can fetch (blob:, http:, etc.). file://
  //    URLs from PowerPoint's temp paste cache typically fail but cost little.
  const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1];
    if (src.startsWith('data:image/')) {
      const file = await dataUrlToFile(src);
      if (file && (await pasteRasterFile(file))) return true;
    } else if (src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        if (blob.type.startsWith('image/')) {
          const file = new File([blob], 'pasted', { type: blob.type });
          if (await pasteRasterFile(file)) return true;
        }
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[paste] failed to fetch img src:', src, err);
      }
    }
  }
  return false;
}

export async function pasteFromSystemClipboard(): Promise<boolean> {
  // Public entry-point that uses the Async Clipboard API. Must be called from
  // a user gesture (e.g. button click) so the browser will grant access.
  return await tryAsyncClipboard();
}

async function tryAsyncClipboard(): Promise<boolean> {
  const nav = navigator as Navigator & {
    clipboard?: { read?: () => Promise<{ types: string[]; getType: (t: string) => Promise<Blob> }[]> };
  };
  if (!nav.clipboard || !nav.clipboard.read) return false;
  try {
    const items = await nav.clipboard.read();
    // Pass 1: SVG
    for (const item of items) {
      if (item.types.includes('image/svg+xml')) {
        const blob = await item.getType('image/svg+xml');
        const text = await blob.text();
        if (await pasteSvgImported(text)) return true;
      }
    }
    // Pass 2: any image
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          const file = new File([blob], 'pasted', { type });
          if (await pasteRasterFile(file)) return true;
        }
      }
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[paste] navigator.clipboard.read failed:', err);
  }
  return false;
}

// Returns true if it handled the paste (caller should preventDefault).
export async function tryPasteExternal(data: DataTransfer | null): Promise<boolean> {
  logClipboardSnapshot(data);
  if (!data) {
    // No DataTransfer at all — try the async clipboard API.
    return await tryAsyncClipboard();
  }
  const items = Array.from(data.items);

  // 1) Inline SVG via items (Figma, Inkscape, modern browsers).
  for (const item of items) {
    if (item.type === 'image/svg+xml') {
      const svg = await readItemAsString(item);
      if (svg && (await pasteSvgImported(svg))) return true;
    }
  }

  // 2) Raster image as a File via DataTransferItemList — what Chrome typically
  //    synthesizes for Office paste (CF_DIB → image/png).
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file && (await pasteRasterFile(file))) return true;
    }
  }

  // 3) Raster image via DataTransfer.files.
  for (const file of Array.from(data.files || [])) {
    if (file.type.startsWith('image/')) {
      if (await pasteRasterFile(file)) return true;
    }
  }

  // 4) text/html — PowerPoint's most reliable format. Use getData() (sync,
  //    universally supported) in addition to scanning items, since some
  //    browsers don't expose HTML through DataTransferItemList.
  let html: string | null = null;
  if (data.types && Array.from(data.types).includes('text/html')) {
    try {
      html = data.getData('text/html');
    } catch {
      // fall through
    }
  }
  if (!html) {
    const htmlItem = items.find((it) => it.type === 'text/html');
    if (htmlItem) html = await readItemAsString(htmlItem);
  }
  if (await tryHtml(html)) return true;

  // 5) Async Clipboard API as a last resort — pulls PNGs out of OS clipboard
  //    that the synchronous paste event didn't surface. Requires permission.
  if (await tryAsyncClipboard()) return true;

  return false;
}
