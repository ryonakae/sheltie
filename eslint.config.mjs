// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';

export default tseslint.config(
  // ビルド成果物・エージェントスクリプトを除外
  {
    ignores: ['.vite/', 'out/', 'dist/', 'src/renderer/.vite/', '.agents/'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  betterTailwindcss.configs['recommended'],

  // Tailwind CSS エントリーポイントを指定してクラス順序チェックを有効化
  {
    settings: {
      'better-tailwindcss': {
        entryPoint: 'src/renderer/index.css',
      },
    },
  },

  // Main / Preload プロセス（Node.js 環境）
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Renderer プロセス（ブラウザ環境）
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
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

  // enforce-consistent-line-wrapping は Prettier のフォーマットと競合するため無効化
  {
    rules: {
      'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
    },
  },
);
