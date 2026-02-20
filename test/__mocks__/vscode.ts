// Minimal vscode mock for tests
import { vi } from "vitest";

const configOverrides: Record<string, Record<string, unknown>> = {};

/** Set a config value in the mock. Call with no value to clear. */
export function setMockConfig(section: string, key: string, value?: unknown): void {
  if (value === undefined) {
    delete configOverrides[section]?.[key];
  } else {
    (configOverrides[section] ??= {})[key] = value;
  }
}

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      const overrides = section ? configOverrides[section] : undefined;
      if (overrides && key in overrides) return overrides[key] as T;
      return defaultValue;
    },
    update: vi.fn().mockResolvedValue(undefined),
  }),
  onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: () => {} }),
};

export const commands = {
  registerCommand: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
};

export const speech = {
  registerSpeechProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export const window = {
  createOutputChannel: (_name: string, _options?: { log: true }) => ({
    appendLine: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
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
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  }),
  showInformationMessage: () => {},
  showErrorMessage: () => {},
  withProgress: (_opts: any, task: (progress: any) => Promise<any>) =>
    task({ report: () => {} }),
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
