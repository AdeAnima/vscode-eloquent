import { TextToSpeechStatus } from "../__mocks__/vscode";

/**
 * Collect status events from a TextToSpeechSession until Stopped or Error.
 * Rejects after timeoutMs if no terminal event arrives.
 */
export function collectEvents(
  session: { onDidChange: (listener: (e: any) => void) => { dispose: () => void } },
  timeoutMs = 2000,
): Promise<{ status: number; text?: string }[]> {
  return new Promise((resolve, reject) => {
    const events: { status: number; text?: string }[] = [];
    const timeout = setTimeout(() => {
      sub.dispose();
      reject(new Error(`Timed out after ${timeoutMs}ms. Events so far: ${JSON.stringify(events)}`));
    }, timeoutMs);

    const sub = session.onDidChange((e: any) => {
      events.push({ status: e.status, text: e.text });
      if (e.status === TextToSpeechStatus.Stopped || e.status === TextToSpeechStatus.Error) {
        clearTimeout(timeout);
        sub.dispose();
        resolve(events);
      }
    });
  });
}
