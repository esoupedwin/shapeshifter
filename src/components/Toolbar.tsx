import paper from 'paper';
import Dropdown from './Dropdown';
import { useEditor } from '../store/useEditor';
import { applyUnion, applyCombine, applyFragment, applyIntersect, applySubtract } from '../paper/boolean';
import { exportPNG, exportSVG } from '../paper/export';
import { bringForward, sendBackward, bringToFront, sendToBack, deleteSelection } from '../paper/arrange';
import { getSelected, setEditPointsTarget } from '../paper/selection';
import { zoomIn, zoomOut, resetView, fitContent, setZoom } from '../paper/view';

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
        <Dropdown label="Edit Shape" disabled={singleSelectionDisabled}>
          {tool === 'editPoints' ? (
            <button onClick={exitEditPoints}>✓ Exit Edit Points</button>
          ) : (
            <button onClick={enterEditPoints} disabled={singleSelectionDisabled}>
              ✎ Edit Points
            </button>
          )}
        </Dropdown>

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
      </div>

      <div className="group">
        <Dropdown label="Export">
          <button onClick={() => exportPNG()}>🖼 Export PNG</button>
          <button onClick={() => exportSVG()}>📄 Export SVG</button>
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
            Edit Points: click anchor to select • drag curve to bend • shift+click edge to insert • alt+click delete • Ctrl+Z undo
          </span>
        )}
        {tool !== 'editPoints' && selectionCount > 0 && (
          <span>{selectionCount} selected</span>
        )}
      </div>
    </div>
  );
}
