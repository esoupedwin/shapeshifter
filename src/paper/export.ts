import paper from 'paper';
import { getOverlayLayer } from './setup';

function withHiddenOverlay<T>(fn: () => T): T {
  const overlay = getOverlayLayer();
  const wasVisible = overlay.visible;
  overlay.visible = false;
  paper.view.update();
  try {
    return fn();
  } finally {
    overlay.visible = wasVisible;
    paper.view.update();
  }
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportPNG(filename = 'vectordraw.png') {
  withHiddenOverlay(() => {
    const canvas = (paper.view.element as HTMLCanvasElement);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(filename, blob);
    }, 'image/png');
  });
}

export function exportSVG(filename = 'vectordraw.svg') {
  withHiddenOverlay(() => {
    const svg = paper.project.exportSVG({ asString: true }) as string;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    downloadBlob(filename, blob);
  });
}
