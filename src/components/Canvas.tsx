import { useEffect, useRef } from 'react';
import paper from 'paper';
import { setupPaper, getOverlayLayer } from '../paper/setup';
import { initTools } from '../paper/tools';
import * as selection from '../paper/selection';
import * as boolean from '../paper/boolean';
import * as arrange from '../paper/arrange';
import * as exportMod from '../paper/export';
import * as viewMod from '../paper/view';
import { useEditor } from '../store/useEditor';
import { refreshLayerNames } from '../paper/selection';
import { tryPasteExternal } from '../paper/clipboardExternal';
import { pasteClipboard } from '../paper/clipboard';

function cursorForHandle(handle: string): string {
  switch (handle) {
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'rotate':
      return 'grab';
    case 'seg':
    case 'handleIn':
    case 'handleOut':
      return 'move';
    default:
      return '';
  }
}

export default function Canvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const canvas = ref.current;
    setupPaper(canvas);
    initTools();
    refreshLayerNames();
    if (import.meta.env.DEV) {
      (window as any).vd = {
        ...(window as any).vd,
        selection,
        boolean,
        arrange,
        export: exportMod,
        view: viewMod,
        editor: useEditor,
      };
    }

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const viewPoint = new paper.Point(e.clientX - rect.left, e.clientY - rect.top);
      const projectPoint = paper.view.viewToProject(viewPoint);
      const hit = selection.hitTestSelectable(projectPoint);
      if (hit) {
        if (!selection.isSelected(hit)) selection.selectItem(hit);
      } else {
        selection.clearSelection();
      }
      if (selection.getSelected().length > 0) {
        useEditor.getState().setContextMenu({ x: e.clientX, y: e.clientY });
      } else {
        useEditor.getState().setContextMenu(null);
      }
    };
    canvas.addEventListener('contextmenu', onContextMenu);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const viewPoint = new paper.Point(e.clientX - rect.left, e.clientY - rect.top);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      viewMod.zoomAt(viewPoint, factor);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Pan: space+drag or middle-button drag
    let panning = false;
    let lastClient: { x: number; y: number } | null = null;
    let spaceHeld = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceHeld) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        spaceHeld = true;
        canvas.style.cursor = 'grab';
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = false;
        if (!panning) canvas.style.cursor = '';
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || (spaceHeld && e.button === 0)) {
        panning = true;
        lastClient = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const updateHoverCursor = (e: PointerEvent) => {
      if (panning) {
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (spaceHeld) {
        canvas.style.cursor = 'grab';
        return;
      }
      // Hit-test overlay for selection handles / segment dots / bezier handles.
      const rect = canvas.getBoundingClientRect();
      const viewPt = new paper.Point(e.clientX - rect.left, e.clientY - rect.top);
      const projectPt = paper.view.viewToProject(viewPt);
      const overlay = getOverlayLayer();
      const hit = overlay.hitTest(projectPt, { fill: true, stroke: true, tolerance: 5 });
      const handle = hit && hit.item && (hit.item.data.handle as string | undefined);
      if (handle) {
        canvas.style.cursor = cursorForHandle(handle);
        return;
      }
      // Fall back to the tool's default cursor (crosshair while drawing,
      // default otherwise).
      const tool = useEditor.getState().tool;
      if (tool.startsWith('draw')) canvas.style.cursor = 'crosshair';
      else if (tool === 'editPoints') canvas.style.cursor = 'default';
      else canvas.style.cursor = '';
    };

    const onPointerMove = (e: PointerEvent) => {
      updateHoverCursor(e);
      if (!panning || !lastClient) return;
      const dx = e.clientX - lastClient.x;
      const dy = e.clientY - lastClient.y;
      lastClient = { x: e.clientX, y: e.clientY };
      viewMod.panBy(new paper.Point(dx, dy));
    };
    const onPointerUp = (e: PointerEvent) => {
      if (panning) {
        panning = false;
        lastClient = null;
        canvas.style.cursor = spaceHeld ? 'grab' : '';
        try { canvas.releasePointerCapture(e.pointerId); } catch {}
      }
    };

    // System-clipboard paste — for images / SVG copied from PowerPoint, browsers,
    // screenshot tools, etc. Tries external content first (so a fresh PowerPoint
    // copy beats stale in-app clipboard); falls back to internal Ctrl+C/V buffer
    // when the system clipboard has nothing usable.
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const handledExternal = await tryPasteExternal(e.clipboardData);
      if (handledExternal) {
        e.preventDefault();
        return;
      }

      // Diagnostic: log what was on the clipboard so we can see when an
      // unsupported format slips through (e.g. PowerPoint-only formats).
      if (e.clipboardData && import.meta.env.DEV) {
        const types = Array.from(e.clipboardData.items).map((it) => `${it.kind}:${it.type}`);
        if (types.length > 0) console.warn('[paste] no usable item; clipboard had:', types);
      }

      // Fall back to the in-app clipboard so Ctrl+C/Ctrl+V inside the app still works.
      if (pasteClipboard().length > 0) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerup', onPointerUp, true);

    // Cursor: crosshair while a draw* tool is active
    const applyToolCursor = (tool: string) => {
      if (panning) return;
      if (tool.startsWith('draw')) canvas.style.cursor = 'crosshair';
      else if (tool === 'editPoints') canvas.style.cursor = 'default';
      else canvas.style.cursor = '';
    };
    applyToolCursor(useEditor.getState().tool);
    const unsubTool = useEditor.subscribe((state, prev) => {
      if (state.tool !== prev.tool) applyToolCursor(state.tool);
    });

    return () => {
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('pointerup', onPointerUp, true);
      unsubTool();
    };
  }, []);

  return (
    <div className="canvas-area">
      <canvas
        id="paper-canvas"
        ref={ref}
        data-paper-resize="true"
      />
      <div className="hint">
        Tip: pick a shape from the left, drag on canvas. Wheel = zoom · Space+drag or middle-click = pan · Ctrl+0 reset.
      </div>
    </div>
  );
}
