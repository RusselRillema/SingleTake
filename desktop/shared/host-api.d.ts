/** Reviewed native boundary. All model operations remain in the shared JavaScript kernel. */
export interface NativeInput {
  kind: 'down' | 'move' | 'up' | 'wheel' | 'keyDown' | 'keyUp' | 'blur' | 'resize' | 'reset' | 'action';
  x?: number; y?: number; width?: number; height?: number;
  button?: number; buttons?: number; deltaY?: number; pointerId?: number;
  key?: string; repeat?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean;
  action?: string;
}
export interface NativeFile { name: string; data: string; }
export interface NativeHost {
  invoke(method: 'frame', frame: unknown): Promise<{accepted: number}>;
  invoke(method: 'open', args: {}): Promise<{files: NativeFile[]}>;
  invoke(method: 'save', args: {name: string; data: string}): Promise<{saved: boolean; name?: string}>;
  invoke(method: 'inflate', args: {data: string; expected: number}): Promise<{data: string}>;
  invoke(method: 'confirmDiscard', args: {}): Promise<{discard: boolean}>;
  invoke(method: 'focusViewport' | 'focusPanel' | 'ready', args: {}): Promise<unknown>;
  invoke(method: 'status', args: {text: string}): Promise<unknown>;
}
