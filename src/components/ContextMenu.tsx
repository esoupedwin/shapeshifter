import { useEffect, useRef } from 'react';
import { useEditor } from '../store/useEditor';
import {
  bringForward,
  sendBackward,
  bringToFront,
  sendToBack,
  deleteSelection,
} from '../paper/arrange';
import { buildCustomShape } from '../paper/customShapes';
import { copySelectionToClipboard } from '../paper/copyToClipboard';

export default function ContextMenu() {
  const ctx = useEditor((s) => s.contextMenu);
  const setCtx = useEditor((s) => s.setContextMenu);
  const addCustomShape = useEditor((s) => s.addCustomShape);
  const selectionIsRaster = useEditor((s) => s.selectionIsRaster);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ctx) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setCtx(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtx(null);
    };
    // Defer so the click that opened the menu doesn't immediately close it
    const t = setTimeout(() => {
      document.addEventListener('mousedown', close);
      document.addEventListener('contextmenu', close);
    }, 0);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctx, setCtx]);

  if (!ctx) return null;

  const run = (fn: () => void) => () => {
    fn();
    setCtx(null);
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: ctx.x, top: ctx.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!selectionIsRaster && (
        <button
          onClick={() => {
            setCtx(null);
            copySelectionToClipboard().then((result) => {
              if (!result) {
                alert(
                  'Could not copy to clipboard.\n' +
                  'Make sure the app is served over HTTPS (or localhost) and ' +
                  'try again from Chrome or Edge.',
                );
              }
            });
          }}
        >
          📋 Copy for PowerPoint
        </button>
      )}
      <div className="context-menu-sep" />
      <button onClick={run(bringForward)}>↑ Bring Forward</button>
      <button onClick={run(sendBackward)}>↓ Send Backward</button>
      <button onClick={run(bringToFront)}>⇈ Bring to Front</button>
      <button onClick={run(sendToBack)}>⇊ Send to Back</button>
      <div className="context-menu-sep" />
      {!selectionIsRaster && (
        <button
          onClick={() => {
            setCtx(null);
            const defaultName = 'Custom Shape';
            const name = window.prompt('Save shape as:', defaultName);
            if (name === null) return; // user cancelled
            const shape = buildCustomShape(name);
            if (!shape) {
              alert('Could not save — select at least one vector shape (not an image).');
              return;
            }
            addCustomShape(shape);
          }}
        >
          📐 Save as Shape…
        </button>
      )}
      <button onClick={run(deleteSelection)}>🗑 Delete</button>
    </div>
  );
}
