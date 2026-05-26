import { useEffect } from 'react';
import Toolbar from './components/Toolbar';
import ShapePalette from './components/ShapePalette';
import Canvas from './components/Canvas';
import PropertiesPanel from './components/PropertiesPanel';
import LayersPanel from './components/LayersPanel';
import ContextMenu from './components/ContextMenu';
import paper from 'paper';
import { deleteSelection } from './paper/arrange';
import { useEditor } from './store/useEditor';
import { zoomIn, zoomOut, setZoom, fitContent } from './paper/view';
import { undo as undoEdit, undoProject, pushSnapshot } from './paper/editHistory';
import { copySelection } from './paper/clipboard';
import {
  getEditPointsTarget,
  getSelectedSegment,
  setSelectedSegment,
  notifySelectionChanged,
  refreshOverlay,
  clearSelection,
  refreshLayerNames,
} from './paper/selection';

function findPathById(target: paper.PathItem, pathId: number): paper.Path | null {
  if (target instanceof paper.Path && target.id === pathId) return target;
  if (target instanceof paper.CompoundPath) {
    for (const child of target.children) {
      if (child instanceof paper.Path && child.id === pathId) return child;
    }
  }
  return null;
}

export default function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // In edit-points mode with an anchor selected, Delete removes that
        // anchor (not the whole shape). Falls through to deleteSelection
        // when no anchor is selected.
        if (useEditor.getState().tool === 'editPoints') {
          const editTarget = getEditPointsTarget();
          const segSel = getSelectedSegment();
          if (editTarget && segSel) {
            const path = findPathById(editTarget, segSel.pathId);
            if (path && path.segments.length > 3) {
              e.preventDefault();
              pushSnapshot(path);
              path.removeSegment(segSel.index);
              setSelectedSegment(null, null);
              refreshOverlay();
              notifySelectionChanged();
              return;
            }
          }
        }
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'Escape') {
        useEditor.getState().setTool('select');
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setZoom(1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        fitContent();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (copySelection() > 0) e.preventDefault();
      }
      // Note: Ctrl+V is intentionally NOT handled here. The browser will fire
      // a `paste` event in response, which we handle in Canvas.tsx — there we
      // can inspect ClipboardData (PowerPoint shapes arrive as image/png) and
      // fall back to the in-app clipboard if the system clipboard is empty.
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        if (useEditor.getState().tool === 'editPoints') {
          const target = getEditPointsTarget();
          if (target) {
            const path = target instanceof paper.Path
              ? target
              : target instanceof paper.CompoundPath && target.children.length > 0
                ? (target.children[0] as paper.Path)
                : null;
            if (path && undoEdit(path)) {
              e.preventDefault();
              refreshOverlay();
              notifySelectionChanged();
            }
          }
        } else {
          // Project-level undo: merge ops, delete, arrange
          if (undoProject()) {
            e.preventDefault();
            clearSelection();
            refreshLayerNames();
            refreshOverlay();
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <ShapePalette />
        <Canvas />
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <PropertiesPanel />
          </div>
          <LayersPanel />
        </div>
      </div>
      <ContextMenu />
    </div>
  );
}
