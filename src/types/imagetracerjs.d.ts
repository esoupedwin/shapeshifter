declare module 'imagetracerjs' {
  interface TraceOptions {
    numberofcolors?: number;
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    colorsampling?: number;
    mincolorratio?: number;
    blurradius?: number;
    blurdelta?: number;
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    [key: string]: unknown;
  }

  interface ImageTracerAPI {
    imagedataToSVG(imageData: ImageData, options?: TraceOptions | string): string;
    imageToSVG(
      url: string,
      callback: (svg: string) => void,
      options?: TraceOptions | string,
    ): void;
  }

  const ImageTracer: ImageTracerAPI;
  export default ImageTracer;
}
