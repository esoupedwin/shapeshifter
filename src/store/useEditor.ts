import { create } from 'zustand';

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
  bumpSelection: () => void;
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
  setTool: (tool) => set({ tool }),
  setSelection: (selectedIds, style, transform) =>
    set({ selectedIds, selectionCount: selectedIds.length, style, transform }),
  setLayerNames: (layerNames) => set({ layerNames }),
  setZoom: (zoom) => set({ zoom }),
  setDefaultFill: (defaultFill) => set({ defaultFill }),
  setDefaultStroke: (defaultStroke) => set({ defaultStroke }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  bumpSelection: () => set((s) => ({ selectionVersion: s.selectionVersion + 1 })),
}));
