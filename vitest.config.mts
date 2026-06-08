import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tauri ビルド用の vite.config.mts とは分離し、純ロジックの単体テストだけを対象にする
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
