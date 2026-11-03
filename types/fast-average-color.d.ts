declare module "fast-average-color" {
  export interface FastAverageColorColorResult {
    hex: string;
    isDark: boolean;
    isLight: boolean;
    rgba: string;
    rgb: string;
    value: number[]; // [r,g,b,a]
  }

  export class FastAverageColor {
    constructor(options?: Record<string, unknown>);
    getColorAsync(source: string | HTMLImageElement | HTMLCanvasElement | ImageBitmap | File): Promise<FastAverageColorColorResult>;
    destroy(): void;
  }

  export default FastAverageColor;
}
