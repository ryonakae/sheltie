import { describe, expect, it } from 'vitest';

import {
  getDisplayNameFromFilePath,
  getProjectDisplayName,
  getUntitledDisplayName,
} from '@/lib/project-display-name';

describe('getUntitledDisplayName', () => {
  it('index が 1 以下なら連番を付けない', () => {
    expect(getUntitledDisplayName(1)).toBe('Untitled');
    expect(getUntitledDisplayName(0)).toBe('Untitled');
  });

  it('index が 2 以上なら連番を付ける', () => {
    expect(getUntitledDisplayName(2)).toBe('Untitled 2');
    expect(getUntitledDisplayName(10)).toBe('Untitled 10');
  });
});

describe('getDisplayNameFromFilePath', () => {
  it('.sheltie 拡張子を除いた basename を返す', () => {
    expect(getDisplayNameFromFilePath('/Users/me/Documents/board.sheltie')).toBe('board');
  });

  it('拡張子が無ければそのまま basename を返す', () => {
    expect(getDisplayNameFromFilePath('/Users/me/board')).toBe('board');
  });

  it('ドットを含むファイル名では最後の .sheltie だけ除く', () => {
    expect(getDisplayNameFromFilePath('/Users/me/my.board.sheltie')).toBe('my.board');
  });

  it('Windows 形式の区切りも basename として扱う', () => {
    expect(getDisplayNameFromFilePath('C:\\Users\\me\\board.sheltie')).toBe('board');
  });

  it('区切りを含まないパスをそのまま扱う', () => {
    expect(getDisplayNameFromFilePath('board.sheltie')).toBe('board');
  });

  it('basename が空なら Untitled にフォールバックする', () => {
    expect(getDisplayNameFromFilePath('/Users/me/')).toBe('Untitled');
  });

  it('拡張子だけのファイル名は Untitled にフォールバックする', () => {
    expect(getDisplayNameFromFilePath('/Users/me/.sheltie')).toBe('Untitled');
  });
});

describe('getProjectDisplayName', () => {
  it('filePath があれば untitledIndex より優先する', () => {
    expect(getProjectDisplayName({ filePath: '/Users/me/board.sheltie', untitledIndex: 5 })).toBe(
      'board',
    );
  });

  it('filePath が無ければ untitledIndex から導出する', () => {
    expect(getProjectDisplayName({ filePath: undefined, untitledIndex: 3 })).toBe('Untitled 3');
  });
});
