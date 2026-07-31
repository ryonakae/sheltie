import { showErrorDialog } from '@/lib/error-dialog';
import { requestCurrentWindowClose } from '@/lib/project-close';
import { parseProjectDocument } from '@/lib/project-document';
import { api } from '@/lib/tauri-bridge';
import { useProjectStore } from '@/store/tab-store';

let initialized = false;

/**
 * 読み込み・パースに失敗したファイルは開かない。filePath を保持したまま空文書で開くと、
 * ユーザーが気付かず保存した時点で元ファイルを空文書で上書きしてしまう。
 */
const LOAD_FAILURE_MESSAGE =
  'The file could not be opened. It may be damaged or created by a newer version of Sheltie.';

export function setupProjectPersistence(): void {
  if (initialized) return;
  initialized = true;

  api
    .loadWindowContext()
    .then(async (context) => {
      if (context.filePath) {
        let contents: string;
        try {
          contents = await api.loadProjectFile(context.filePath);
        } catch {
          await showErrorDialog(LOAD_FAILURE_MESSAGE);
          await api.closeReady();
          return;
        }

        let document;
        try {
          document = parseProjectDocument(contents);
        } catch {
          await showErrorDialog(LOAD_FAILURE_MESSAGE);
          await api.closeReady();
          return;
        }

        useProjectStore.getState().initializeProject({
          filePath: context.filePath,
          untitledIndex: context.untitledIndex,
          document,
        });
      } else {
        useProjectStore.getState().initializeProject({
          untitledIndex: context.untitledIndex,
        });
      }

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
