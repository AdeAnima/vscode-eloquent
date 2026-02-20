import * as vscode from "vscode";

/**
 * Create a fake ExtensionContext for tests.
 * Accepts optional overrides for extensionPath and globalStorageUri.
 */
export function makeContext(
  extensionPath = "/fake/ext",
  storagePath = "/fake/storage"
): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionPath,
    globalStorageUri: { fsPath: storagePath },
  } as unknown as vscode.ExtensionContext;
}
