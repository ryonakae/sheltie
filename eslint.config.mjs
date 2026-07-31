// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // ビルド成果物・エージェントスクリプト・Rust ビルド成果物を除外
  {
    ignores: ['.vite/', 'out/', 'dist/', '.agents/', 'src-tauri/'],
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
      callees: ['classnames', 'clsx', 'ctl'],
      'better-tailwindcss': {
        entryPoint: 'src/index.css',
      },
    },
  },

  // Renderer プロセス（ブラウザ環境）
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx', '.d.ts', '.mts', '.cts'],
      },
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx', '.d.ts', '.mjs', '.cjs', '.mts', '.cts'],
        },
      },
    },
    rules: {
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          pathGroups: [{ pattern: '@/**', group: 'internal', position: 'after' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
          warnOnUnassignedImports: true,
        },
      ],
      'import/no-unresolved': 'error',
      'import/no-duplicates': 'error',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/default': 'off',
      'import/namespace': 'off',
    },
  },

  // index.html から直接読む静的スクリプト（バンドルを通さないブラウザ環境）
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // 評価フィクスチャの Node.js スクリプト
  {
    files: ['skills/sheltie-use/evals/fixtures/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // 設定ファイル側は import-plugin の誤検知を抑制
  {
    files: ['*.config.ts', '*.config.mts', '*.config.mjs', 'vite.config.mts'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-unresolved': 'off',
      'import/order': 'off',
      'import/no-duplicates': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/default': 'off',
      'import/namespace': 'off',
    },
  },

  // Prettier との競合ルールを無効化（必ず最後に配置）
  eslintConfigPrettier,

  // プロジェクト共通のルール設定
  {
    rules: {
      // Prettier のフォーマットと競合するため無効化
      'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
      // React Flow 固有クラス（nodrag: ドラッグ抑制, nopan: パン抑制）と
      // カスタムドラッグハンドルクラス（node-drag-handle: dragHandle セレクター用）を許可
      'better-tailwindcss/no-unknown-classes': [
        'error',
        { ignore: ['nodrag', 'nopan', 'node-drag-handle'] },
      ],
      // _ プレフィックス変数は意図的な未使用として許可
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
);
