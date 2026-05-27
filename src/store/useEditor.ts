import { create } from 'zustand';
import type { CustomShape } from '../paper/customShapes';
export type { CustomShape };

export type ToolMode =
  | 'select'
  | 'editPoints'
  | 'drawRect'
  | 'drawEllipse'
  | 'drawTriangle'
  | 'drawPentagon'
  | 'drawHexagon'
  | 'drawStar'
  | 'drawLine'
  | 'drawArrow';

// ─── Custom shape persistence ─────────────────────────────────────────────────

const CUSTOM_SHAPES_KEY = 'vd-custom-shapes';

function loadCustomShapes(): CustomShape[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SHAPES_KEY);
    return raw ? (JSON.parse(raw) as CustomShape[]) : [];
  } catch {
    return [];
  }
}

function persistCustomShapes(shapes: CustomShape[]): void {
  try {
    localStorage.setItem(CUSTOM_SHAPES_KEY, JSON.stringify(shapes));
  } catch {}
}

export interface SelectionStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  hasStroke: boolean;
  hasFill: boolean;
}

export interface SelectionTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
}

interface EditorState {
  tool: ToolMode;
  selectionCount: number;
  selectedIds: number[];
  style: SelectionStyle | null;
  transform: SelectionTransform | null;
  layerNames: { id: number; name: string }[];
  selectionVersion: number;
  zoom: number;
  defaultFill: string;
  defaultStroke: string;
  contextMenu: ContextMenuState | null;
  selectionIsRaster: boolean;
  customShapes: CustomShape[];
  setTool: (t: ToolMode) => void;
  setSelection: (
    ids: number[],
    style: SelectionStyle | null,
    transform: SelectionTransform | null,
  ) => void;
  setLayerNames: (n: { id: number; name: string }[]) => void;
  setZoom: (z: number) => void;
  setDefaultFill: (c: string) => void;
  setDefaultStroke: (c: string) => void;
  setContextMenu: (cm: ContextMenuState | null) => void;
  setSelectionIsRaster: (v: boolean) => void;
  bumpSelection: () => void;
  addCustomShape: (shape: CustomShape) => void;
  removeCustomShape: (id: string) => void;
}

export const useEditor = create<EditorState>((set) => ({
  tool: 'select',
  selectionCount: 0,
  selectedIds: [],
  style: null,
  transform: null,
  layerNames: [],
  selectionVersion: 0,
  zoom: 1,
  defaultFill: '#ED7D31',
  defaultStroke: '#1F3864',
  contextMenu: null,
  selectionIsRaster: false,
  customShapes: loadCustomShapes(),
  setTool: (tool) => set({ tool }),
  setSelection: (selectedIds, style, transform) =>
    set({ selectedIds, selectionCount: selectedIds.length, style, transform }),
  setLayerNames: (layerNames) => set({ layerNames }),
  setZoom: (zoom) => set({ zoom }),
  setDefaultFill: (defaultFill) => set({ defaultFill }),
  setDefaultStroke: (defaultStroke) => set({ defaultStroke }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  setSelectionIsRaster: (selectionIsRaster) => set({ selectionIsRaster }),
  bumpSelection: () => set((s) => ({ selectionVersion: s.selectionVersion + 1 })),
  addCustomShape: (shape) =>
    set((s) => {
      const updated = [...s.customShapes, shape];
      persistCustomShapes(updated);
      return { customShapes: updated };
    }),
  removeCustomShape: (id) =>
    set((s) => {
      const updated = s.customShapes.filter((cs) => cs.id !== id);
      persistCustomShapes(updated);
      return { customShapes: updated };
    }),
}));
