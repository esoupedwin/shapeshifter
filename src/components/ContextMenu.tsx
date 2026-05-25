import { useEffect, useRef } from 'react';
import { useEditor } from '../store/useEditor';
import {
  bringForward,
  sendBackward,
  bringToFront,
  sendToBack,
  deleteSelection,
} from '../paper/arrange';

export default function ContextMenu() {
  const ctx = useEditor((s) => s.contextMenu);
  const setCtx = useEditor((s) => s.setContextMenu);
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
      <button onClick={run(bringForward)}>↑ Bring Forward</button>
      <button onClick={run(sendBackward)}>↓ Send Backward</button>
      <button onClick={run(bringToFront)}>⇈ Bring to Front</button>
      <button onClick={run(sendToBack)}>⇊ Send to Back</button>
      <div className="context-menu-sep" />
      <button onClick={run(deleteSelection)}>🗑 Delete</button>
    </div>
  );
}
