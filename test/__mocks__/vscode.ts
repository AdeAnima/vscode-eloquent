// Minimal vscode mock for tests
export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
  }),
};

export enum TextToSpeechStatus {
  Started = 1,
  Stopped = 2,
  Error = 3,
}

export const EventEmitter = class {
  event = () => {};
  fire() {}
  dispose() {}
};
