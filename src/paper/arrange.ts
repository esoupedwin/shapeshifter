import paper from 'paper';
import { getSelected, refreshLayerNames, refreshOverlay, findItemById } from './selection';
import { pushProjectSnapshot } from './editHistory';

export function bringForward() {
  if (getSelected().length === 0) return;
  pushProjectSnapshot();
  const items = sortedByIndex(getSelected());
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const next = it.nextSibling;
    if (next) it.insertAbove(next);
  }
  refreshOverlay();
  refreshLayerNames();
}

export function sendBackward() {
  if (getSelected().length === 0) return;
  pushProjectSnapshot();
  const items = sortedByIndex(getSelected());
  for (const it of items) {
    const prev = it.previousSibling;
    if (prev) it.insertBelow(prev);
  }
  refreshOverlay();
  refreshLayerNames();
}

export function bringToFront() {
  if (getSelected().length === 0) return;
  pushProjectSnapshot();
  for (const it of sortedByIndex(getSelected())) it.bringToFront();
  refreshOverlay();
  refreshLayerNames();
}

export function sendToBack() {
  if (getSelected().length === 0) return;
  pushProjectSnapshot();
  for (const it of sortedByIndex(getSelected()).reverse()) it.sendToBack();
  refreshOverlay();
  refreshLayerNames();
}

export function deleteSelection() {
  if (getSelected().length === 0) return;
  pushProjectSnapshot();
  for (const it of getSelected()) it.remove();
  refreshLayerNames();
}

export function duplicateSelection() {
  const items = getSelected();
  const clones: paper.PathItem[] = [];
  for (const it of items) {
    const c = it.clone() as paper.PathItem;
    c.position = c.position.add(new paper.Point(20, 20));
    clones.push(c);
  }
  return clones;
}

function sortedByIndex(items: paper.Item[]): paper.Item[] {
  return items.slice().sort((a, b) => a.index - b.index);
}

export { findItemById };
