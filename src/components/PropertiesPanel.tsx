import { useEditor } from '../store/useEditor';
import { getSelected, notifySelectionChanged } from '../paper/selection';
import paper from 'paper';

export default function PropertiesPanel() {
  const style = useEditor((s) => s.style);
  const transform = useEditor((s) => s.transform);
  const selectionCount = useEditor((s) => s.selectionCount);

  if (selectionCount === 0 || !style || !transform) {
    return (
      <div className="panel right">
        <h3>Shape Format</h3>
        <p style={{ fontSize: 12, color: '#888' }}>No selection. Click a shape to edit.</p>
      </div>
    );
  }

  const updateFill = (color: string) => {
    for (const it of getSelected()) it.fillColor = new paper.Color(color);
    notifySelectionChanged();
  };

  const updateStroke = (color: string) => {
    for (const it of getSelected()) it.strokeColor = new paper.Color(color);
    notifySelectionChanged();
  };

  const updateStrokeWidth = (w: number) => {
    for (const it of getSelected()) it.strokeWidth = w;
    notifySelectionChanged();
  };

  const removeFill = () => {
    for (const it of getSelected()) it.fillColor = null;
    notifySelectionChanged();
  };

  const removeStroke = () => {
    for (const it of getSelected()) it.strokeColor = null;
    notifySelectionChanged();
  };

  const applyTransform = (field: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number) => {
    const sel = getSelected();
    if (sel.length !== 1) return;
    const it = sel[0];
    if (field === 'x') it.position = new paper.Point(value + it.bounds.width / 2, it.position.y);
    else if (field === 'y') it.position = new paper.Point(it.position.x, value + it.bounds.height / 2);
    else if (field === 'width') {
      const ratio = value / it.bounds.width;
      it.scale(ratio, 1, it.bounds.topLeft);
    } else if (field === 'height') {
      const ratio = value / it.bounds.height;
      it.scale(1, ratio, it.bounds.topLeft);
    } else if (field === 'rotation') {
      const current = it.rotation ?? 0;
      it.rotate(value - current);
    }
    notifySelectionChanged();
  };

  return (
    <div className="panel right">
      <h3>Shape Fill</h3>
      <div className="row">
        <div className="field">
          <input
            type="color"
            value={style.fill}
            onChange={(e) => updateFill(e.target.value)}
          />
        </div>
        <button className="btn" onClick={removeFill} title="No fill">
          ✕
        </button>
      </div>

      <h3>Shape Outline</h3>
      <div className="row">
        <div className="field">
          <input
            type="color"
            value={style.stroke}
            onChange={(e) => updateStroke(e.target.value)}
          />
        </div>
        <button className="btn" onClick={removeStroke} title="No outline">
          ✕
        </button>
      </div>
      <div className="field">
        <label>Outline width: {style.strokeWidth.toFixed(1)}pt</label>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={style.strokeWidth}
          onChange={(e) => updateStrokeWidth(Number(e.target.value))}
        />
      </div>

      <h3>Position &amp; Size</h3>
      <div className="row">
        <div className="field">
          <label>X</label>
          <input
            type="number"
            value={transform.x}
            onChange={(e) => applyTransform('x', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>Y</label>
          <input
            type="number"
            value={transform.y}
            onChange={(e) => applyTransform('y', Number(e.target.value))}
          />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>W</label>
          <input
            type="number"
            value={transform.width}
            onChange={(e) => applyTransform('width', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>H</label>
          <input
            type="number"
            value={transform.height}
            onChange={(e) => applyTransform('height', Number(e.target.value))}
          />
        </div>
      </div>
      <div className="field">
        <label>Rotation (°)</label>
        <input
          type="number"
          value={transform.rotation}
          onChange={(e) => applyTransform('rotation', Number(e.target.value))}
        />
      </div>
    </div>
  );
}
