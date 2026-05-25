import paper from 'paper';
import { activateContent } from './setup';
import { pushProjectSnapshot } from './editHistory';
import { setSelection, refreshLayerNames, refreshOverlay } from './selection';

const MAX_INITIAL_SIDE_PX = 500;

export function insertImageFromFile(file: File): Promise<paper.Raster | null> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image file'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = reader.result as string;
      activateContent();
      pushProjectSnapshot();
      const raster = new paper.Raster(url);
      raster.name = 'image';
      raster.onLoad = () => {
        // Center on current view, scale down if larger than MAX_INITIAL_SIDE_PX
        const size = raster.size;
        const longest = Math.max(size.width, size.height);
        if (longest > MAX_INITIAL_SIDE_PX) {
          const scale = MAX_INITIAL_SIDE_PX / longest;
          raster.scale(scale);
        }
        raster.position = paper.view.center;
        setSelection([raster]);
        refreshLayerNames();
        refreshOverlay();
        paper.view.update();
        resolve(raster);
      };
      raster.onError = () => {
        raster.remove();
        reject(new Error('Failed to load image'));
      };
    };
    reader.readAsDataURL(file);
  });
}
