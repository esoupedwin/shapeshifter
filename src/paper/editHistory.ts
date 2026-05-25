import paper from 'paper';
import { getContentLayer, activateContent } from './setup';

interface SegmentSnapshot {
  point: { x: number; y: number };
  handleIn: { x: number; y: number };
  handleOut: { x: number; y: number };
}

interface PathSnapshot {
  segments: SegmentSnapshot[];
  closed: boolean;
}

const stacks: Map<number, PathSnapshot[]> = new Map();
const MAX_DEPTH = 100;

// Project-level undo: full snapshots of the content layer (used for boolean ops,
// delete, arrange, and other actions that change *which* paths exist).
const projectStack: string[][] = [];

function capture(path: paper.Path): PathSnapshot {
  return {
    closed: path.closed,
    segments: path.segments.map((s) => ({
      point: { x: s.point.x, y: s.point.y },
      handleIn: { x: s.handleIn.x, y: s.handleIn.y },
      handleOut: { x: s.handleOut.x, y: s.handleOut.y },
    })),
  };
}

function apply(path: paper.Path, snap: PathSnapshot) {
  path.removeSegments();
  for (const s of snap.segments) {
    const seg = new paper.Segment(
      new paper.Point(s.point.x, s.point.y),
      new paper.Point(s.handleIn.x, s.handleIn.y),
      new paper.Point(s.handleOut.x, s.handleOut.y),
    );
    path.add(seg);
  }
  path.closed = snap.closed;
}

export function pushSnapshot(path: paper.Path) {
  let stack = stacks.get(path.id);
  if (!stack) {
    stack = [];
    stacks.set(path.id, stack);
  }
  stack.push(capture(path));
  if (stack.length > MAX_DEPTH) stack.shift();
}

export function undo(path: paper.Path): boolean {
  const stack = stacks.get(path.id);
  if (!stack || stack.length === 0) return false;
  const snap = stack.pop()!;
  apply(path, snap);
  return true;
}

export function canUndo(path: paper.Path): boolean {
  const stack = stacks.get(path.id);
  return !!stack && stack.length > 0;
}

export function clearHistory(pathId?: number) {
  if (pathId == null) stacks.clear();
  else stacks.delete(pathId);
}

export function pushProjectSnapshot() {
  const layer = getContentLayer();
  const items = layer.children
    .filter((c) => c instanceof paper.Path || c instanceof paper.CompoundPath)
    .map((c) => c.exportJSON({ asString: true }) as string);
  projectStack.push(items);
  if (projectStack.length > MAX_DEPTH) projectStack.shift();
}

export function undoProject(): boolean {
  if (projectStack.length === 0) return false;
  const snap = projectStack.pop()!;
  const layer = getContentLayer();
  layer.removeChildren();
  activateContent();
  for (const json of snap) {
    const restored = paper.project.importJSON(json) as paper.Item | null;
    if (restored && restored.parent !== layer) {
      layer.addChild(restored);
    }
  }
  return true;
}

export function canUndoProject(): boolean {
  return projectStack.length > 0;
}

export function clearProjectHistory() {
  projectStack.length = 0;
}
