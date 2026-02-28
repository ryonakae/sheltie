// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // ビルド成果物・エージェントスクリプト・Rust ビルド成果物を除外
  {
    ignores: ['.vite/', 'out/', 'dist/', 'src/renderer/.vite/', '.agents/', 'src-tauri/'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  betterTailwindcss.configs['recommended'],

  // React Hooks ルール
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: reactHooks.configs.recommended.rules,
  },

  // Tailwind CSS エントリーポイントを指定してクラス順序チェックを有効化
  {
    settings: {
      'better-tailwindcss': {
        entryPoint: 'src/renderer/index.css',
      },
    },
  },

  // Renderer プロセス（ブラウザ環境）
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // 設定ファイル（Node.js 環境）
  {
    files: ['*.config.ts', '*.config.mts', '*.config.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Prettier との競合ルールを無効化（必ず最後に配置）
  eslintConfigPrettier,

  // プロジェクト共通のルール設定
  {
    rules: {
      // Prettier のフォーマットと競合するため無効化
      'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
      // _ プレフィックス変数は意図的な未使用として許可
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
);
