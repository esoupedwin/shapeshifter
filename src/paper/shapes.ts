import paper from 'paper';
import { DEFAULT_STROKE_WIDTH, activateContent } from './setup';
import { useEditor } from '../store/useEditor';

function styleDefaults(item: paper.PathItem) {
  const { defaultFill, defaultStroke } = useEditor.getState();
  item.fillColor = new paper.Color(defaultFill);
  item.strokeColor = new paper.Color(defaultStroke);
  item.strokeWidth = DEFAULT_STROKE_WIDTH;
  item.strokeJoin = 'round';
  item.name = 'shape';
}

export function createRect(from: paper.Point, to: paper.Point): paper.Path {
  activateContent();
  const rect = new paper.Rectangle(from, to);
  const path = new paper.Path.Rectangle(rect);
  styleDefaults(path);
  return path;
}

export function createEllipse(from: paper.Point, to: paper.Point): paper.Path {
  activateContent();
  const rect = new paper.Rectangle(from, to);
  const path = new paper.Path.Ellipse(rect);
  styleDefaults(path);
  return path;
}

export function createRegularPolygon(
  from: paper.Point,
  to: paper.Point,
  sides: number,
): paper.Path {
  activateContent();
  const rect = new paper.Rectangle(from, to);
  const radius = Math.min(rect.width, rect.height) / 2;
  const center = rect.center;
  const path = new paper.Path.RegularPolygon(center, sides, radius);
  styleDefaults(path);
  return path;
}

export function createStar(from: paper.Point, to: paper.Point): paper.Path {
  activateContent();
  const rect = new paper.Rectangle(from, to);
  const radius = Math.min(rect.width, rect.height) / 2;
  const center = rect.center;
  const path = new paper.Path.Star(center, 5, radius, radius / 2.5);
  styleDefaults(path);
  return path;
}

export function createLine(from: paper.Point, to: paper.Point): paper.Path {
  activateContent();
  const path = new paper.Path.Line(from, to);
  path.strokeColor = new paper.Color(useEditor.getState().defaultStroke);
  path.strokeWidth = DEFAULT_STROKE_WIDTH * 1.5;
  path.strokeJoin = 'round';
  path.strokeCap = 'round';
  path.name = 'shape';
  return path;
}

export function createArrow(from: paper.Point, to: paper.Point): paper.Path {
  activateContent();
  const vector = to.subtract(from);
  if (vector.length < 1) vector.length = 1;
  const headLength = Math.min(20, vector.length * 0.4);
  const headWidth = headLength * 0.7;
  const shaftWidth = headWidth * 0.4;

  const unit = vector.normalize();
  const perp = new paper.Point(-unit.y, unit.x);

  const shaftEnd = to.subtract(unit.multiply(headLength));
  const p1 = from.add(perp.multiply(shaftWidth / 2));
  const p2 = shaftEnd.add(perp.multiply(shaftWidth / 2));
  const p3 = shaftEnd.add(perp.multiply(headWidth / 2));
  const p4 = to;
  const p5 = shaftEnd.subtract(perp.multiply(headWidth / 2));
  const p6 = shaftEnd.subtract(perp.multiply(shaftWidth / 2));
  const p7 = from.subtract(perp.multiply(shaftWidth / 2));

  const path = new paper.Path([p1, p2, p3, p4, p5, p6, p7]);
  path.closed = true;
  styleDefaults(path);
  return path;
}
