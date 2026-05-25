import { useRef } from 'react';
import { useEditor, ToolMode } from '../store/useEditor';
import { insertImageFromFile } from '../paper/raster';

interface ShapeDef {
  id: ToolMode;
  label: string;
  icon: JSX.Element;
}

const shapes: ShapeDef[] = [
  {
    id: 'drawRect',
    label: 'Rectangle',
    icon: <rect x="3" y="6" width="18" height="12" />,
  },
  {
    id: 'drawEllipse',
    label: 'Ellipse',
    icon: <ellipse cx="12" cy="12" rx="9" ry="6" />,
  },
  {
    id: 'drawTriangle',
    label: 'Triangle',
    icon: <polygon points="12,3 22,21 2,21" />,
  },
  {
    id: 'drawPentagon',
    label: 'Pentagon',
    icon: <polygon points="12,3 22,10 18,21 6,21 2,10" />,
  },
  {
    id: 'drawHexagon',
    label: 'Hexagon',
    icon: <polygon points="7,4 17,4 22,12 17,20 7,20 2,12" />,
  },
  {
    id: 'drawStar',
    label: 'Star',
    icon: <polygon points="12,2 14.6,9 22,9 16,13.5 18,21 12,16.7 6,21 8,13.5 2,9 9.4,9" />,
  },
  {
    id: 'drawLine',
    label: 'Line',
    icon: <line x1="3" y1="21" x2="21" y2="3" strokeWidth="2" />,
  },
  {
    id: 'drawArrow',
    label: 'Arrow',
    icon: (
      <g>
        <line x1="3" y1="12" x2="17" y2="12" strokeWidth="2" />
        <polygon points="21,12 15,8 15,16" fill="currentColor" />
      </g>
    ),
  },
];

export default function ShapePalette() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const defaultFill = useEditor((s) => s.defaultFill);
  const defaultStroke = useEditor((s) => s.defaultStroke);
  const setDefaultFill = useEditor((s) => s.setDefaultFill);
  const setDefaultStroke = useEditor((s) => s.setDefaultStroke);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    insertImageFromFile(file).catch((err) => {
      console.error('Image insert failed:', err);
      alert('Could not load that image.');
    });
  };

  return (
    <div className="panel">
      <h3>Insert Shapes</h3>
      <div className="shape-grid">
        {shapes.map((s) => (
          <button
            key={s.id}
            className={`shape-tile ${tool === s.id ? 'active' : ''}`}
            title={s.label}
            onClick={() => setTool(s.id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {s.icon}
            </svg>
          </button>
        ))}
      </div>

      <h3>Insert Picture</h3>
      <button
        className="btn"
        onClick={() => fileInputRef.current?.click()}
        style={{ width: '100%' }}
      >
        🖼 From file…
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onPickFile}
        style={{ display: 'none' }}
      />

      <h3>Default Colors</h3>
      <div className="field">
        <label>Fill</label>
        <input
          type="color"
          value={defaultFill}
          onChange={(e) => setDefaultFill(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Outline</label>
        <input
          type="color"
          value={defaultStroke}
          onChange={(e) => setDefaultStroke(e.target.value)}
        />
      </div>

      <h3>Cursor</h3>
      <button
        className={`btn ${tool === 'select' ? 'active' : ''}`}
        onClick={() => setTool('select')}
        style={{ width: '100%' }}
      >
        Select / Move
      </button>
    </div>
  );
}
