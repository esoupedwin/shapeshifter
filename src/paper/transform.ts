import paper from 'paper';
import { getSelected, notifySelectionChanged } from './selection';
import { pushProjectSnapshot } from './editHistory';

function combinedCenter(items: paper.Item[]): paper.Point | null {
  let bounds: paper.Rectangle | null = null;
  for (const it of items) {
    bounds = bounds ? bounds.unite(it.bounds) : it.bounds;
  }
  return bounds ? bounds.center : null;
}

function rotateBy(deg: number) {
  const items = getSelected();
  if (items.length === 0) return;
  const center = combinedCenter(items);
  if (!center) return;
  pushProjectSnapshot();
  for (const it of items) it.rotate(deg, center);
  notifySelectionChanged();
  paper.view.update();
}

function flipBy(scaleX: number, scaleY: number) {
  const items = getSelected();
  if (items.length === 0) return;
  const center = combinedCenter(items);
  if (!center) return;
  pushProjectSnapshot();
  for (const it of items) it.scale(scaleX, scaleY, center);
  notifySelectionChanged();
  paper.view.update();
}

export const rotateRight90 = () => rotateBy(90);
export const rotateLeft90 = () => rotateBy(-90);
export const flipHorizontal = () => flipBy(-1, 1);
export const flipVertical = () => flipBy(1, -1);
