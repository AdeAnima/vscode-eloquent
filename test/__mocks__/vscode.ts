// Minimal vscode mock for tests
export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
  }),
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: () => {},
    show: () => {},
    dispose: () => {},
  }),
  createStatusBarItem: (
    _alignment?: StatusBarAlignment,
    _priority?: number
  ) => ({
    text: "",
    tooltip: "",
    command: "",
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  showInformationMessage: () => {},
  showErrorMessage: () => {},
};

export enum TextToSpeechStatus {
  Started = 1,
  Stopped = 2,
  Error = 3,
}

type Listener<T> = (e: T) => void;

export class EventEmitter<T = void> {
  private listeners: Listener<T>[] = [];

  event = (listener: Listener<T>): { dispose: () => void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
      },
    };
  };

  fire(data: T): void {
    for (const fn of this.listeners) fn(data);
  }

  dispose(): void {
    this.listeners = [];
  }
}

/** Controllable CancellationTokenSource for tests. */
export class CancellationTokenSource {
  private _cancelled = false;
  private readonly emitter = new EventEmitter<void>();

  get token(): CancellationToken {
    return {
      isCancellationRequested: this._cancelled,
      onCancellationRequested: (fn: () => void) => this.emitter.event(fn),
    };
  }

  cancel(): void {
    this._cancelled = true;
    this.emitter.fire(undefined as unknown as void);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => void) => { dispose: () => void };
}
