import { requestCurrentWindowClose } from '@/lib/project-close';
import { parseProjectDocument } from '@/lib/project-document';
import { api } from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';

let initialized = false;

export function setupProjectPersistence(): void {
  if (initialized) return;
  initialized = true;

  api
    .loadWindowContext()
    .then(async (context) => {
      let document;
      if (context.filePath) {
        try {
          const contents = await api.loadProjectFile(context.filePath);
          document = parseProjectDocument(contents);
        } catch {
          document = undefined;
        }
      }

      useProjectStore.getState().initializeProject({
        filePath: context.filePath ?? undefined,
        untitledIndex: context.untitledIndex,
        document,
      });
      useProjectStore.getState()._setLoaded();
    })
    .catch(() => {
      useProjectStore.getState().initializeProject({ untitledIndex: 1 });
      useProjectStore.getState()._setLoaded();
    });

  api.onSaveBeforeClose(async () => {
    await requestCurrentWindowClose();
  });
}
