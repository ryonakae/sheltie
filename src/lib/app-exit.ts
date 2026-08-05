import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Window, getCurrentWindow } from '@tauri-apps/api/window';

import {
  promptUnsavedChangesDialog,
  type UnsavedChangesDecision,
} from '@/components/Common/UnsavedChangesDialog';
import { saveCurrentProject } from '@/lib/file-commands';
import { getProjectDisplayName } from '@/lib/project-display-name';
import { isProjectDirty } from '@/lib/project-document';
import {
  api,
  onAppExitRequested,
  type AppExitSaveRequest,
  type AppExitSaveResponse,
  type AppExitStateRequest,
  type AppExitStateResponse,
  type AppExitStateSnapshot,
  type SaveProjectStatus,
} from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';
import type { Project } from '@/types';

const DOCUMENT_WINDOW_LABEL_PREFIX = 'document-';
const EVENT_APP_EXIT_STATE_REQUEST = 'app-exit-state-request';
const EVENT_APP_EXIT_STATE_RESPONSE = 'app-exit-state-response';
const EVENT_APP_EXIT_SAVE_REQUEST = 'app-exit-save-request';
const EVENT_APP_EXIT_SAVE_RESPONSE = 'app-exit-save-response';
const APP_EXIT_RESPONSE_TIMEOUT_MS = 10_000;

let inFlightAppExitOperation: Promise<void> | null = null;

function normalizeError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

function runExclusiveAppExitOperation(operation: () => Promise<void>): Promise<void> {
  if (inFlightAppExitOperation) {
    return inFlightAppExitOperation;
  }

  const execution = operation().finally(() => {
    if (inFlightAppExitOperation === execution) {
      inFlightAppExitOperation = null;
    }
  });

  inFlightAppExitOperation = execution;
  return execution;
}

function getProject(): Project | null {
  return useProjectStore.getState().project;
}

function getCurrentWindowLabel(): string {
  return getCurrentWindow().label;
}

function createCurrentWindowStateSnapshot(): AppExitStateSnapshot {
  const project = getProject();
  return {
    windowLabel: getCurrentWindowLabel(),
    projectTitle: project ? getProjectDisplayName(project) : 'Untitled',
    dirty: project ? isProjectDirty(project) : false,
  };
}

function isDocumentWindowLabel(label: string): boolean {
  return label.startsWith(DOCUMENT_WINDOW_LABEL_PREFIX);
}

async function getDocumentWindowLabels(): Promise<string[]> {
  const windows = await Window.getAll();
  return windows
    .map((window) => window.label)
    .filter((label) => isDocumentWindowLabel(label))
    .sort();
}

async function requestWindowResponses<
  TRequest,
  TResponse extends { requestId: string; windowLabel: string },
>(
  responseEvent: string,
  requestEvent: string,
  windowLabels: string[],
  createRequest: (label: string, requestId: string, coordinatorLabel: string) => TRequest,
): Promise<Map<string, TResponse>> {
  const currentWindow = getCurrentWindow();
  const currentWebviewWindow = getCurrentWebviewWindow();
  const coordinatorLabel = currentWindow.label;
  const requestId = crypto.randomUUID();
  const pendingLabels = new Set(windowLabels);
  const responses = new Map<string, TResponse>();

  if (windowLabels.length === 0) {
    return responses;
  }

  let resolveResponses: ((value: Map<string, TResponse>) => void) | null = null;
  let clearResponseTimeout = () => undefined;
  const responsePromise = new Promise<Map<string, TResponse>>((resolve, reject) => {
    resolveResponses = resolve;
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`timed out waiting for ${requestEvent} response`));
    }, APP_EXIT_RESPONSE_TIMEOUT_MS);
    clearResponseTimeout = () => {
      window.clearTimeout(timeoutId);
    };
  });
  const unlisten = await currentWebviewWindow.listen<TResponse>(responseEvent, (event) => {
    const payload = event.payload;
    if (payload.requestId !== requestId || !pendingLabels.has(payload.windowLabel)) {
      return;
    }

    responses.set(payload.windowLabel, payload);
    pendingLabels.delete(payload.windowLabel);

    if (pendingLabels.size === 0 && resolveResponses) {
      resolveResponses(responses);
    }
  });

  try {
    await Promise.all(
      windowLabels.map((label) =>
        currentWindow.emitTo(
          label,
          requestEvent,
          createRequest(label, requestId, coordinatorLabel),
        ),
      ),
    );
    if (pendingLabels.size === 0) {
      return responses;
    }

    return await responsePromise;
  } catch (error) {
    throw normalizeError(error, `failed to emit ${requestEvent}`);
  } finally {
    clearResponseTimeout();
    unlisten();
  }
}

async function collectAppExitStates(windowLabels: string[]): Promise<AppExitStateSnapshot[]> {
  const responses = await requestWindowResponses<AppExitStateRequest, AppExitStateResponse>(
    EVENT_APP_EXIT_STATE_RESPONSE,
    EVENT_APP_EXIT_STATE_REQUEST,
    windowLabels,
    (_label, requestId, coordinatorLabel) => ({
      coordinatorLabel,
      requestId,
    }),
  );

  return windowLabels
    .map((label) => responses.get(label))
    .filter((response): response is AppExitStateResponse => response !== undefined)
    .map(({ dirty, projectTitle, windowLabel }) => ({
      dirty,
      projectTitle,
      windowLabel,
    }));
}

async function requestAppExitSave(windowLabel: string): Promise<SaveProjectStatus> {
  const responses = await requestWindowResponses<AppExitSaveRequest, AppExitSaveResponse>(
    EVENT_APP_EXIT_SAVE_RESPONSE,
    EVENT_APP_EXIT_SAVE_REQUEST,
    [windowLabel],
    (_label, requestId, coordinatorLabel) => ({
      coordinatorLabel,
      requestId,
    }),
  );

  return responses.get(windowLabel)?.status ?? 'error';
}

async function focusDocumentWindow(windowLabel: string): Promise<void> {
  const targetWindow = await Window.getByLabel(windowLabel);
  if (!targetWindow) {
    throw new Error(`target window not found: ${windowLabel}`);
  }
  await targetWindow.setFocus();
}

async function saveCurrentWindowForAppExit(): Promise<SaveProjectStatus> {
  const project = getProject();
  if (!project || !isProjectDirty(project)) {
    return 'saved';
  }

  const result = await saveCurrentProject();
  return result.status;
}

async function handleAppExitStateRequest(payload: AppExitStateRequest): Promise<void> {
  try {
    await getCurrentWindow().emitTo(payload.coordinatorLabel, EVENT_APP_EXIT_STATE_RESPONSE, {
      ...createCurrentWindowStateSnapshot(),
      requestId: payload.requestId,
    } satisfies AppExitStateResponse);
  } catch (error) {
    console.error('[app-exit] failed to send state response:', error);
  }
}

async function handleAppExitSaveRequest(payload: AppExitSaveRequest): Promise<void> {
  try {
    const status = await saveCurrentWindowForAppExit();
    await getCurrentWindow().emitTo(payload.coordinatorLabel, EVENT_APP_EXIT_SAVE_RESPONSE, {
      requestId: payload.requestId,
      status,
      windowLabel: getCurrentWindowLabel(),
    } satisfies AppExitSaveResponse);
  } catch (error) {
    console.error('[app-exit] failed to send save response:', error);
    try {
      await getCurrentWindow().emitTo(payload.coordinatorLabel, EVENT_APP_EXIT_SAVE_RESPONSE, {
        requestId: payload.requestId,
        status: 'error',
        windowLabel: getCurrentWindowLabel(),
      } satisfies AppExitSaveResponse);
    } catch (emitError) {
      console.error('[app-exit] failed to send error response as well:', emitError);
    }
  }
}

async function confirmAppExit(states: AppExitStateSnapshot[]): Promise<UnsavedChangesDecision> {
  return promptUnsavedChangesDialog({
    kind: 'app-exit',
    projectTitles: states.map((state) => state.projectTitle),
  });
}

async function runAppExitFlow(): Promise<void> {
  const windowLabels = await getDocumentWindowLabels();
  const states = await collectAppExitStates(windowLabels);
  const dirtyStates = states.filter((state) => state.dirty);

  if (dirtyStates.length === 0) {
    await api.completeAppExit(windowLabels);
    return;
  }

  const decision = await confirmAppExit(dirtyStates);
  if (decision === 'cancel') {
    await api.abortAppExit();
    return;
  }

  if (decision === 'save') {
    for (const state of dirtyStates) {
      await focusDocumentWindow(state.windowLabel);
      const status = await requestAppExitSave(state.windowLabel);
      if (status !== 'saved') {
        await api.abortAppExit();
        return;
      }
    }
  }

  await api.completeAppExit(windowLabels);
}

async function requestAggregatedAppExit(): Promise<void> {
  await runExclusiveAppExitOperation(async () => {
    try {
      await runAppExitFlow();
    } catch (error) {
      console.error('[app-exit] failed to coordinate Quit:', error);
      await api.abortAppExit();
    }
  });
}

export async function setupAppExitCoordinator(): Promise<() => void> {
  const currentWebviewWindow = getCurrentWebviewWindow();
  const [unlistenExitRequested, unlistenStateRequest, unlistenSaveRequest] = await Promise.all([
    onAppExitRequested(() => {
      void requestAggregatedAppExit();
    }),
    currentWebviewWindow.listen<AppExitStateRequest>(EVENT_APP_EXIT_STATE_REQUEST, (event) => {
      void handleAppExitStateRequest(event.payload);
    }),
    currentWebviewWindow.listen<AppExitSaveRequest>(EVENT_APP_EXIT_SAVE_REQUEST, (event) => {
      void handleAppExitSaveRequest(event.payload);
    }),
  ]);

  return () => {
    unlistenExitRequested();
    unlistenStateRequest();
    unlistenSaveRequest();
  };
}
