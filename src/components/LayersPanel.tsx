import { useEditor } from '../store/useEditor';
import { findItemById, selectItem } from '../paper/selection';
import { bringForward, sendBackward, bringToFront, sendToBack, deleteSelection } from '../paper/arrange';

export default function LayersPanel() {
  const layers = useEditor((s) => s.layerNames);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectionCount = useEditor((s) => s.selectionCount);
  const tool = useEditor((s) => s.tool);

  // While editing anchor points, block all arrange/layer interactions so the
  // user cannot move, delete, or select other shapes.
  const editMode = tool === 'editPoints';

  return (
    <div className="panel right" style={{ borderTop: '1px solid #3a3a3a' }}>
      <h3>Arrange</h3>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn" disabled={selectionCount === 0 || editMode} onClick={bringForward}>↑ Forward</button>
        <button className="btn" disabled={selectionCount === 0 || editMode} onClick={sendBackward}>↓ Backward</button>
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn" disabled={selectionCount === 0 || editMode} onClick={bringToFront}>To Front</button>
        <button className="btn" disabled={selectionCount === 0 || editMode} onClick={sendToBack}>To Back</button>
      </div>
      <button className="btn" disabled={selectionCount === 0 || editMode} onClick={deleteSelection} style={{ width: '100%' }}>
        Delete
      </button>

      <h3>Layers</h3>
      <div className="layers-list">
        {layers.length === 0 && <p style={{ fontSize: 12, color: '#888' }}>(empty)</p>}
        {layers.map((l) => (
          <div
            key={l.id}
            className={`layer-item ${selectedIds.includes(l.id) ? 'selected' : ''}`}
            style={editMode ? { pointerEvents: 'none', opacity: 0.5 } : undefined}
            onClick={() => {
              if (editMode) return;
              const item = findItemById(l.id);
              if (item) selectItem(item);
            }}
          >
            <span>{l.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
