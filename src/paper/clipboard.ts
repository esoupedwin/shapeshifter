import paper from 'paper';
import { activateContent, getContentLayer } from './setup';
import { pushProjectSnapshot } from './editHistory';
import {
  getSelected,
  setSelection,
  refreshLayerNames,
  refreshOverlay,
} from './selection';

// In-memory clipboard: array of serialized paper.Item JSON strings. Survives
// across Ctrl+C / Ctrl+V within the same session; not cross-tab (deliberately
// avoids touching the system clipboard, which has security/permission gates).
let clipboard: string[] = [];

const PASTE_OFFSET_PX = 12;

export function copySelection(): number {
  const items = getSelected();
  if (items.length === 0) return 0;
  clipboard = items.map((it) => it.exportJSON({ asString: true }) as string);
  return items.length;
}

export function pasteClipboard(): paper.Item[] {
  if (clipboard.length === 0) return [];
  activateContent();
  pushProjectSnapshot();
  const layer = getContentLayer();
  const restored: paper.Item[] = [];
  for (const json of clipboard) {
    const item = paper.project.importJSON(json) as paper.Item | null;
    if (!item) continue;
    // importJSON returns the item but doesn't necessarily attach it to the
    // active layer — add it explicitly if it isn't already there.
    if (item.parent !== layer) layer.addChild(item);
    // Offset slightly so the paste is visually distinct from the original.
    item.position = item.position.add(new paper.Point(PASTE_OFFSET_PX, PASTE_OFFSET_PX));
    restored.push(item);
  }
  if (restored.length > 0) {
    setSelection(restored);
    refreshLayerNames();
    refreshOverlay();
    paper.view.update();
    // After paste, the new items become the "next paste source" so repeated
    // Ctrl+V cascades each copy further down-right.
    clipboard = restored.map((it) => it.exportJSON({ asString: true }) as string);
  }
  return restored;
}

export function hasClipboardContents(): boolean {
  return clipboard.length > 0;
}
