// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';

export default tseslint.config(
  // ビルド成果物を除外
  {
    ignores: ['.vite/', 'out/', 'dist/'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  betterTailwindcss.configs['recommended'],

  // Main / Preload プロセス（Node.js 環境）
  {
    files: ['src/main.ts', 'src/preload.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Renderer プロセス（ブラウザ環境）
  {
    files: ['src/renderer.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // 設定ファイル（Node.js 環境）
  {
    files: ['*.config.ts', '*.config.mts', '*.config.mjs', 'forge.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Prettier との競合ルールを無効化（必ず最後に配置）
  eslintConfigPrettier,
);
