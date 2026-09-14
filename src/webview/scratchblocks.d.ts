declare module "scratchblocks" {
  interface ParseOptions {
    languages?: string[];
    inline?: boolean;
  }
  interface RenderOptions {
    style?: string;
    scale?: number;
  }
  interface Scratchblocks {
    parse(code: string, options?: ParseOptions): unknown;
    render(doc: unknown, options?: RenderOptions): SVGElement;
    appendStyles(): void;
  }
  const scratchblocks: Scratchblocks;
  export default scratchblocks;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
