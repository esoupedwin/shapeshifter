import paper from 'paper';

export const DEFAULT_FILL = '#ED7D31';
export const DEFAULT_STROKE = '#1F3864';
export const DEFAULT_STROKE_WIDTH = 1.5;

let initialized = false;
let overlayLayer: paper.Layer | null = null;
let contentLayer: paper.Layer | null = null;

export function setupPaper(canvas: HTMLCanvasElement) {
  if (initialized) return;
  paper.setup(canvas);
  contentLayer = new paper.Layer();
  contentLayer.name = 'content';
  overlayLayer = new paper.Layer();
  overlayLayer.name = 'overlay';
  contentLayer.activate();
  initialized = true;
  if (import.meta.env.DEV) {
    (window as any).paper = paper;
    (window as any).vd = { paper, getContentLayer, getOverlayLayer };
  }
}

export function getOverlayLayer(): paper.Layer {
  if (!overlayLayer) throw new Error('paper not initialized');
  return overlayLayer;
}

export function getContentLayer(): paper.Layer {
  if (!contentLayer) throw new Error('paper not initialized');
  return contentLayer;
}

export function activateContent() {
  getContentLayer().activate();
}

export function activateOverlay() {
  getOverlayLayer().activate();
}

export { paper };
