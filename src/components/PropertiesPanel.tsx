import { useState } from 'react';
import { useEditor } from '../store/useEditor';
import { getSelected, notifySelectionChanged } from '../paper/selection';
import { traceRasterToVector, TraceDetail } from '../paper/trace';
import { smoothSelection, DEFAULT_CORNER_THRESHOLD } from '../paper/smooth';
import { pushProjectSnapshot } from '../paper/editHistory';
import paper from 'paper';

// Coalesce rapid Properties-Panel edits into one undo entry. Slider drags and
// repeated arrow-key bumps within 500 ms collapse to a single snapshot; the
// next change after a 500 ms idle starts a fresh undo entry.
let lastPropertiesSnapshotAt = 0;
const PROPERTIES_COALESCE_MS = 500;
function snapshotForPropertyEdit() {
  const now = Date.now();
  if (now - lastPropertiesSnapshotAt > PROPERTIES_COALESCE_MS) {
    pushProjectSnapshot();
    lastPropertiesSnapshotAt = now;
  }
}

export default function PropertiesPanel() {
  const style = useEditor((s) => s.style);
  const transform = useEditor((s) => s.transform);
  const selectionCount = useEditor((s) => s.selectionCount);
  const selectionIsRaster = useEditor((s) => s.selectionIsRaster);
  const [detail, setDetail] = useState<TraceDetail>('medium');
  const [tracing, setTracing] = useState(false);
  const [cornerThreshold, setCornerThreshold] = useState<number>(DEFAULT_CORNER_THRESHOLD);

  if (selectionCount === 0 || !style || !transform) {
    return (
      <div className="panel right">
        <h3>Shape Format</h3>
        <p style={{ fontSize: 12, color: '#888' }}>No selection. Click a shape to edit.</p>
      </div>
    );
  }

  const runTrace = async () => {
    const sel = getSelected();
    if (sel.length !== 1) return;
    const raster = sel[0];
    if (!(raster instanceof paper.Raster)) return;
    setTracing(true);
    try {
      await traceRasterToVector(raster, detail);
    } catch (err) {
      console.error('Trace failed:', err);
      alert('Could not trace this image.');
    } finally {
      setTracing(false);
    }
  };

  const hasPathSelection = !selectionIsRaster && getSelected().some(
    (it) => it instanceof paper.Path || it instanceof paper.CompoundPath,
  );

  const runSmooth = () => {
    smoothSelection(cornerThreshold);
  };

  const updateFill = (color: string) => {
    snapshotForPropertyEdit();
    for (const it of getSelected()) it.fillColor = new paper.Color(color);
    notifySelectionChanged();
  };

  const updateStroke = (color: string) => {
    snapshotForPropertyEdit();
    for (const it of getSelected()) it.strokeColor = new paper.Color(color);
    notifySelectionChanged();
  };

  const updateStrokeWidth = (w: number) => {
    snapshotForPropertyEdit();
    for (const it of getSelected()) it.strokeWidth = w;
    notifySelectionChanged();
  };

  const removeFill = () => {
    snapshotForPropertyEdit();
    for (const it of getSelected()) it.fillColor = null;
    notifySelectionChanged();
  };

  const removeStroke = () => {
    snapshotForPropertyEdit();
    for (const it of getSelected()) it.strokeColor = null;
    notifySelectionChanged();
  };

  const applyTransform = (field: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number) => {
    const sel = getSelected();
    if (sel.length !== 1) return;
    snapshotForPropertyEdit();
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
      {selectionIsRaster && (
        <>
          <h3>Convert to Shape</h3>
          <div className="field">
            <label>Detail</label>
            <select
              value={detail}
              onChange={(e) => setDetail(e.target.value as TraceDetail)}
              disabled={tracing}
              style={{
                background: '#383838',
                border: '1px solid #4a4a4a',
                color: '#e6e6e6',
                padding: '4px 6px',
                fontSize: 12,
                borderRadius: 3,
                width: '100%',
              }}
            >
              <option value="low">Low — fewer, chunkier paths</option>
              <option value="medium">Medium — balanced</option>
              <option value="high">High — denser anchors</option>
            </select>
          </div>
          <button
            className="btn"
            onClick={runTrace}
            disabled={tracing}
            style={{ width: '100%' }}
          >
            {tracing ? 'Tracing…' : '✎ Convert to editable vector'}
          </button>
        </>
      )}

      {hasPathSelection && (
        <>
          <h3>Smooth Curves</h3>
          <div className="field">
            <label>Corner threshold: {cornerThreshold}°</label>
            <input
              type="range"
              min={20}
              max={170}
              step={5}
              value={cornerThreshold}
              onChange={(e) => setCornerThreshold(Number(e.target.value))}
            />
          </div>
          <button
            className="btn"
            onClick={runSmooth}
            style={{ width: '100%' }}
            title="Smooth polygonal arcs while keeping sharp corners. Lower the threshold (~60°) to preserve sharp polygon corners; raise it (~120°) to fully smooth rounded shapes."
          >
            ⌒ Smooth curves
          </button>
        </>
      )}

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
