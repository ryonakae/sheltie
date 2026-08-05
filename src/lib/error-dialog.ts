import { message } from '@tauri-apps/plugin-dialog';

/** ネイティブのエラーダイアログを表示する */
export async function showErrorDialog(messageText: string): Promise<void> {
  await message(messageText, {
    title: 'Sheltie',
    kind: 'error',
  });
}
