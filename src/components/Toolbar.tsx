import paper from 'paper';
import Dropdown from './Dropdown';
import { useEditor } from '../store/useEditor';
import { applyUnion, applyCombine, applyFragment, applyIntersect, applySubtract } from '../paper/boolean';
import { exportPNG, exportSVG } from '../paper/export';
import { copySelectionToClipboard } from '../paper/copyToClipboard';
import { bringForward, sendBackward, bringToFront, sendToBack, deleteSelection } from '../paper/arrange';
import { getSelected, setEditPointsTarget } from '../paper/selection';
import { zoomIn, zoomOut, resetView, fitContent, setZoom } from '../paper/view';
import { rotateRight90, rotateLeft90, flipHorizontal, flipVertical } from '../paper/transform';

export default function Toolbar() {
  const selectionCount = useEditor((s) => s.selectionCount);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const zoom = useEditor((s) => s.zoom);

  const mergeDisabled = selectionCount < 2;
  const singleSelectionDisabled = selectionCount !== 1;

  const enterEditPoints = () => {
    const sel = getSelected();
    if (sel.length !== 1) return;
    const item = sel[0];
    if (!(item instanceof paper.Path) && !(item instanceof paper.CompoundPath)) return;
    setEditPointsTarget(item);
    setTool('editPoints');
  };

  const exitEditPoints = () => {
    setEditPointsTarget(null);
    setTool('select');
  };

  return (
    <div className="toolbar">
      <div className="group">
        <strong style={{ fontSize: 13, color: '#fff' }}>VectorDraw</strong>
      </div>

      <div className="group">
        <button
          className="btn"
          onClick={tool === 'editPoints' ? exitEditPoints : enterEditPoints}
          disabled={tool !== 'editPoints' && singleSelectionDisabled}
          style={{ fontWeight: tool === 'editPoints' ? 'bold' : undefined }}
          title={tool === 'editPoints' ? 'Click to exit anchor editing' : 'Edit anchor points of the selected shape'}
        >
          {tool === 'editPoints' ? '✓ Edit Anchors' : '✎ Edit Anchors'}
        </button>

        <Dropdown label="Merge Shapes" disabled={mergeDisabled}>
          <button onClick={applyUnion} disabled={mergeDisabled}>⬭ Union</button>
          <button onClick={applyCombine} disabled={mergeDisabled}>⊝ Combine</button>
          <button onClick={applyFragment} disabled={mergeDisabled}>◈ Fragment</button>
          <button onClick={applyIntersect} disabled={mergeDisabled}>⌒ Intersect</button>
          <button onClick={applySubtract} disabled={mergeDisabled}>⊖ Subtract</button>
        </Dropdown>
      </div>

      <div className="group">
        <Dropdown label="Arrange" disabled={selectionCount === 0}>
          <button onClick={bringForward}>↑ Bring Forward</button>
          <button onClick={sendBackward}>↓ Send Backward</button>
          <button onClick={bringToFront}>⇈ Bring to Front</button>
          <button onClick={sendToBack}>⇊ Send to Back</button>
          <button onClick={deleteSelection}>🗑 Delete</button>
        </Dropdown>

        <Dropdown label="Rotate" disabled={selectionCount === 0}>
          <button onClick={rotateRight90}>↻ Rotate Right 90°</button>
          <button onClick={rotateLeft90}>↺ Rotate Left 90°</button>
          <button onClick={flipVertical}>⇕ Flip Vertical</button>
          <button onClick={flipHorizontal}>⇔ Flip Horizontal</button>
        </Dropdown>
      </div>

      <div className="group">
        <Dropdown label="Export">
          <button onClick={() => exportPNG()}>🖼 Export PNG</button>
          <button onClick={() => exportSVG()}>📄 Export SVG</button>
          <button
            disabled={selectionCount === 0}
            onClick={() => {
              // Call synchronously inside the click handler so the browser
              // grants the clipboard-write permission before yielding.
              const writePromise = copySelectionToClipboard();
              writePromise.then((ok) => {
                if (!ok)
                  alert(
                    'Could not copy to clipboard.\n' +
                    'Make sure the app is running on localhost or HTTPS and try again.',
                  );
              });
            }}
            title="Copy selected shapes to the system clipboard as PNG — paste directly into PowerPoint with Ctrl+V"
          >
            📋 Copy for PowerPoint
          </button>
        </Dropdown>
      </div>

      <div className="group" style={{ marginLeft: 'auto' }}>
        <button className="btn" title="Zoom out (Ctrl+-)" onClick={zoomOut}>−</button>
        <button
          className="btn"
          title="Reset zoom to 100% (Ctrl+0)"
          onClick={() => setZoom(1)}
          style={{ minWidth: 56, justifyContent: 'center' }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="btn" title="Zoom in (Ctrl+=)" onClick={zoomIn}>+</button>
        <button className="btn" title="Fit content (Ctrl+1)" onClick={fitContent}>⤢ Fit</button>
      </div>

      <div className="group" style={{ fontSize: 11, color: '#888' }}>
        {tool === 'editPoints' && (
          <span>
            Edit Anchors: click anchor to select • ctrl+click anchor to delete • drag curve to bend • shift+click edge to insert • Ctrl+Z undo • click "✎ Edit Anchors" to exit
          </span>
        )}
        {tool !== 'editPoints' && selectionCount === 1 && (
          <span>1 selected — shift+click to add more (order matters for Subtract &amp; Intersect)</span>
        )}
        {tool !== 'editPoints' && selectionCount > 1 && (
          <span>{selectionCount} selected in order — shift+click to add/remove</span>
        )}
      </div>
    </div>
  );
}
