import * as vscode from 'vscode';

export const MEO_NOTIFICATION_TIMEOUT_MS = 3000;

type TimedQuickPickOptions = Omit<vscode.QuickPickOptions, 'canPickMany'>;

const notificationCloseCommands = [
  'notifications.hideToasts',
  'workbench.action.closeMessages'
] as const;

async function closeVisibleNotifications(): Promise<void> {
  for (const command of notificationCloseCommands) {
    try {
      await vscode.commands.executeCommand(command);
      return;
    } catch {
      // Ignore unknown command errors; try the next fallback command.
    }
  }
}

function createUiTimeout(timeoutMs: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void closeVisibleNotifications();
  }, timeoutMs);
}

export async function runWithTimedUiTimeout<T>(
  run: () => Thenable<T> | Promise<T>,
  timeoutMs = MEO_NOTIFICATION_TIMEOUT_MS
): Promise<T> {
  const timeoutHandle = createUiTimeout(timeoutMs);
  try {
    return await run();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function showTimedInformationMessage(message: string, timeoutMs = MEO_NOTIFICATION_TIMEOUT_MS): Promise<string | undefined> {
  return runWithTimedUiTimeout(() => vscode.window.showInformationMessage(message), timeoutMs);
}

export function showTimedWarningMessage(message: string, timeoutMs = MEO_NOTIFICATION_TIMEOUT_MS): Promise<string | undefined> {
  return runWithTimedUiTimeout(() => vscode.window.showWarningMessage(message), timeoutMs);
}

export function showTimedWarningMessageWithItems<T extends string>(
  message: string,
  options: vscode.MessageOptions,
  items: readonly T[],
  timeoutMs = MEO_NOTIFICATION_TIMEOUT_MS
): Promise<T | undefined> {
  return runWithTimedUiTimeout(() => vscode.window.showWarningMessage(message, options, ...items), timeoutMs);
}

export function showTimedErrorMessage(message: string, timeoutMs = MEO_NOTIFICATION_TIMEOUT_MS): Promise<string | undefined> {
  return runWithTimedUiTimeout(() => vscode.window.showErrorMessage(message), timeoutMs);
}

export function showTimedQuickPick<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options?: TimedQuickPickOptions,
  timeoutMs: number | null = MEO_NOTIFICATION_TIMEOUT_MS
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const quickPick = vscode.window.createQuickPick<T>();
    const disposables: vscode.Disposable[] = [quickPick];
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const dispose = (): void => {
      while (disposables.length) {
        const disposable = disposables.pop();
        disposable?.dispose();
      }
    };

    const finish = (value: T | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      dispose();
      resolve(value);
    };

    if (options?.onDidSelectItem) {
      disposables.push(
        quickPick.onDidChangeSelection((selection) => {
          const selected = selection[0];
          if (selected) {
            options.onDidSelectItem?.(selected);
          }
        })
      );
    }

    disposables.push(
      quickPick.onDidAccept(() => {
        finish(quickPick.selectedItems[0]);
      })
    );
    disposables.push(quickPick.onDidHide(() => finish(undefined)));

    quickPick.items = items;
    quickPick.title = options?.title;
    quickPick.placeholder = options?.placeHolder;
    quickPick.matchOnDescription = options?.matchOnDescription ?? false;
    quickPick.matchOnDetail = options?.matchOnDetail ?? false;
    quickPick.ignoreFocusOut = options?.ignoreFocusOut ?? false;

    quickPick.show();
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        quickPick.hide();
      }, timeoutMs);
    }
  });
}
