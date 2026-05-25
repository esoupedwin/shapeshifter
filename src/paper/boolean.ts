import paper from 'paper';
import { getSelected, setSelection, notifySelectionChanged } from './selection';
import { activateContent } from './setup';
import { pushProjectSnapshot } from './editHistory';

type BoolOp = 'unite' | 'exclude' | 'divide' | 'intersect' | 'subtract';

function ensurePathItem(item: paper.Item): paper.PathItem | null {
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) return item;
  return null;
}

function toColor(v: any): paper.Color | null {
  if (!v) return null;
  if (v instanceof paper.Color) return v.clone();
  // String, array, or {hue,saturation,...} object — wrap fresh
  try {
    return new paper.Color(v);
  } catch {
    return null;
  }
}

function styleFrom(source: paper.PathItem, target: paper.PathItem) {
  target.fillColor = toColor(source.fillColor);
  target.strokeColor = toColor(source.strokeColor);
  target.strokeWidth = source.strokeWidth ?? 0;
  target.strokeJoin = source.strokeJoin ?? 'miter';
  target.opacity = source.opacity ?? 1;
}

function reduceBoolean(op: BoolOp): paper.PathItem | null {
  activateContent();
  const items = getSelected().filter(
    (i): i is paper.PathItem => i instanceof paper.Path || i instanceof paper.CompoundPath,
  );
  if (items.length < 2) return null;
  pushProjectSnapshot();

  // Sort by z-order so first selected stays on top of the operation chain
  const styleSource = items[0];
  let result: paper.PathItem | null = null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i === 0) {
      result = item.clone({ insert: true }) as paper.PathItem;
      continue;
    }
    if (!result) break;
    const next: paper.PathItem = (result as any)[op](item, { insert: false });
    result.remove();
    next.insertAbove(item);
    result = next;
  }

  if (!result) return null;

  styleFrom(styleSource, result);
  // Remove originals
  for (const it of items) it.remove();
  return result;
}

export function applyUnion() {
  const result = reduceBoolean('unite');
  if (result) {
    setSelection([result]);
    notifySelectionChanged();
  }
}

export function applyCombine() {
  const result = reduceBoolean('exclude');
  if (result) {
    setSelection([result]);
    notifySelectionChanged();
  }
}

export function applyIntersect() {
  const result = reduceBoolean('intersect');
  if (result) {
    setSelection([result]);
    notifySelectionChanged();
  }
}

export function applySubtract() {
  const result = reduceBoolean('subtract');
  if (result) {
    setSelection([result]);
    notifySelectionChanged();
  }
}

export function applyFragment() {
  activateContent();
  const items = getSelected().filter(
    (i): i is paper.PathItem => i instanceof paper.Path || i instanceof paper.CompoundPath,
  );
  if (items.length < 2) return;
  pushProjectSnapshot();

  const styleSource = items[0];
  const pieces: paper.PathItem[] = [];

  // For each item, subtract all others and add the result, then add intersection slices
  // A simpler/robust approach: pairwise divide then collect unique pieces.
  // We use: for each item, the "remaining" after subtracting all others, plus pairwise intersects.
  const remainders: paper.PathItem[] = [];
  for (let i = 0; i < items.length; i++) {
    let remainder: paper.PathItem = items[i].clone({ insert: false }) as paper.PathItem;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const next: paper.PathItem = (remainder as any).subtract(items[j], { insert: false });
      remainder = next;
    }
    if (!remainder.isEmpty || (remainder instanceof paper.Path && remainder.length > 0)) {
      remainders.push(remainder);
    }
  }

  // Pairwise intersections
  const intersections: paper.PathItem[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const inter: paper.PathItem = (items[i] as any).intersect(items[j], { insert: false });
      if (!inter.isEmpty || (inter instanceof paper.Path && inter.length > 0)) {
        intersections.push(inter);
      }
    }
  }

  for (const piece of [...remainders, ...intersections]) {
    styleFrom(styleSource, piece);
    paper.project.activeLayer.addChild(piece);
    pieces.push(piece);
  }

  // Remove originals
  for (const it of items) it.remove();

  if (pieces.length > 0) {
    setSelection(pieces);
    notifySelectionChanged();
  }
}
