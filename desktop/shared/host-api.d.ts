/** OS/GPU services only. HTML controls and all input dispatch remain in the shared App. */
export interface NativeFile { name: string; data: string; }
export interface CanvasRectangle { left: number; top: number; width: number; height: number; }
export interface NativePresentation { serial: number; placements: number; draws: number; triangles: number; cpuMs: number; }
export interface NativeHost {
  invoke(method: 'frame', frame: {schema: 1; serial: number; viewport: CanvasRectangle; [key: string]: unknown}): Promise<{accepted: number}>;
  invoke(method: 'open', args: {kind: 'model' | 'image'}): Promise<{files: NativeFile[]}>;
  invoke(method: 'save', args: {name: string; data: string}): Promise<{saved: boolean; name?: string}>;
  invoke(method: 'inflate', args: {data: string; expected: number}): Promise<{data: string}>;
  invoke(method: 'recovery.save', args: {data: string}): Promise<{saved: boolean}>;
  invoke(method: 'recovery.load', args: {}): Promise<{data: string | null}>;
  invoke(method: 'recovery.clear', args: {}): Promise<{cleared: boolean}>;
  invoke(method: 'screenshot', args: {}): Promise<{data: string}>;
  invoke(method: 'reload', args: {}): Promise<{requested: boolean}>;
  invoke(method: 'ready', args: {ui: 'shared'; sources: Record<string,string>}): Promise<{native: true; ui: 'shared'; schema: 1}>;
}
