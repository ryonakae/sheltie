import { invoke } from '@tauri-apps/api/core';

export const clipboardApi = {
  async writeBoardClipboard(payloadJson: string, plainText: string): Promise<void> {
    await invoke('write_board_clipboard', { payloadJson, plainText });
  },
  async readBoardClipboard(): Promise<string | null> {
    return await invoke<string | null>('read_board_clipboard');
  },
};
