import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProjectDocument } from '@/lib/project-document';
import {
  verifyComparison,
  verifySemantic,
  verifyVisual,
  type FinalBoard,
  type McpTrace,
} from './verify-eval';

const documentId = 'document-fixture';
const pageA = 'page-compare-a';
const pageB = 'page-compare-b';
const pageC = 'page-semantic-form';

function call(
  order: number,
  toolName: string,
  options: {
    args?: McpTrace['calls'][number]['args'];
    status?: 'success' | 'error';
    snapshotId?: string;
    freshness?: Array<{ pageNodeId: string; freshness: 'cached' | 'missing' }>;
    createdNodeIds?: string[];
    evidence?: Array<'semantic_confirmation' | 'canvas_target_activated'>;
  } = {},
): McpTrace['calls'][number] {
  return {
    order,
    toolName,
    args: options.args ?? {},
    response: {
      status: options.status ?? 'success',
      ...(options.snapshotId === undefined ? {} : { snapshotId: options.snapshotId }),
      ...(options.freshness === undefined ? {} : { freshness: options.freshness }),
      ...(options.createdNodeIds === undefined ? {} : { createdNodeIds: options.createdNodeIds }),
      ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    },
  };
}

const comparisonBoard: FinalBoard = {
  nodes: [
    { id: 'note-price-a', type: 'stickynote', content: 'Atlas Basic costs $29 monthly.' },
    { id: 'note-price-b', type: 'stickynote', content: 'Beacon Basic costs $24 monthly.' },
  ],
  edges: [
    {
      id: 'existing-product-edge',
      source: pageA,
      target: pageB,
      strokeWidth: 6,
      lineStyle: 'dashed',
      colorPreset: 'warning',
    },
  ],
};

function evidenceText(result: ReturnType<typeof verifyComparison>): string[] {
  return result.map((expectation) => expectation.evidence);
}

describe('redacted trace derivation', () => {
  it('retains explicit IDs and freshness while removing page data', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sheltie-trace-'));
    try {
      const inputPath = path.join(directory, 'verbose.json');
      const outputPath = path.join(directory, 'trace.json');
      writeFileSync(
        inputPath,
        JSON.stringify({
          messages: [
            {
              type: 'tool_call',
              name: 'sheltie__get_webpage_screenshots',
              arguments: {
                documentId,
                pageNodeIds: [pageA, pageB, pageC],
                secret: 'must-not-survive',
              },
              result: {
                structuredContent: {
                  screenshots: [
                    { pageNodeId: pageA, freshness: 'cached', capturedUrl: 'secret-url' },
                    { pageNodeId: pageB, freshness: 'cached' },
                    { pageNodeId: pageC, freshness: 'missing' },
                  ],
                },
              },
            },
            {
              type: 'tool_call',
              name: 'browser_click',
              arguments: {
                documentId,
                pageNodeId: pageC,
                snapshotId: 'snapshot-3',
                elementRef: 'submit',
              },
              result: {
                structuredContent: {
                  snapshot: {
                    snapshotId: 'snapshot-4',
                    compactText: 'status Pro plan confirmed for Ada.',
                  },
                },
              },
            },
            {
              type: 'tool_call',
              name: 'browser_evaluate',
              arguments: { documentId, pageNodeId: pageC, script: 'redacted' },
              result: {
                structuredContent: {
                  value: {
                    snapshotId: 'page-secret-id',
                    screenshots: [{ pageNodeId: 'page-secret', freshness: 'cached' }],
                    compactText: 'page-secret-text',
                  },
                  snapshot: { snapshotId: 'snapshot-5', compactText: 'ordinary state' },
                },
              },
            },
            {
              type: 'tool_call',
              name: 'batch_edit_board',
              arguments: { documentId, operations: ['redacted'] },
              result: {
                structuredContent: { changed: true, createdNodeIds: ['form-note'] },
              },
            },
          ],
        }),
      );

      execFileSync('node', [
        new URL('./derive-redacted-mcp-trace.mjs', import.meta.url).pathname,
        inputPath,
        outputPath,
      ]);
      const traceText = readFileSync(outputPath, 'utf8');
      const trace = JSON.parse(traceText) as McpTrace;

      expect(trace.calls).toHaveLength(4);
      expect(trace.calls[0]).toMatchObject({
        toolName: 'get_webpage_screenshots',
        args: { documentId, pageNodeIds: [pageA, pageB, pageC] },
        response: {
          status: 'success',
          freshness: [
            { pageNodeId: pageA, freshness: 'cached' },
            { pageNodeId: pageB, freshness: 'cached' },
            { pageNodeId: pageC, freshness: 'missing' },
          ],
        },
      });
      expect(trace.calls[1]).toMatchObject({
        toolName: 'browser_click',
        args: {
          documentId,
          pageNodeId: pageC,
          snapshotId: 'snapshot-3',
          elementRef: 'submit',
        },
        response: {
          snapshotId: 'snapshot-4',
          evidence: ['semantic_confirmation'],
        },
      });
      expect(trace.calls[2]).toMatchObject({
        toolName: 'browser_evaluate',
        response: { snapshotId: 'snapshot-5' },
      });
      expect(trace.calls[2]?.response).not.toHaveProperty('freshness');
      expect(trace.calls[2]?.response).not.toHaveProperty('evidence');
      expect(trace.calls[3]).toMatchObject({
        toolName: 'batch_edit_board',
        response: { createdNodeIds: ['form-note'] },
      });
      expect(traceText).not.toContain('must-not-survive');
      expect(traceText).not.toContain('secret-url');
      expect(traceText).not.toContain('Pro plan confirmed for Ada.');
      expect(traceText).not.toContain('operations');
      expect(traceText).not.toContain('page-secret');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('pairs Pi MCP gateway calls with their separate tool results', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sheltie-gateway-trace-'));
    try {
      const inputPath = path.join(directory, 'verbose.json');
      const outputPath = path.join(directory, 'trace.json');
      writeFileSync(
        inputPath,
        JSON.stringify([
          {
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'toolCall',
                  id: 'call-1',
                  name: 'mcp',
                  arguments: {
                    tool: 'sheltie_browser_snapshot',
                    args: JSON.stringify({ documentId, pageNodeId: pageC }),
                  },
                },
              ],
            },
          },
          {
            message: {
              role: 'toolResult',
              toolCallId: 'call-1',
              toolName: 'mcp',
              details: {
                mode: 'call',
                mcpResult: {
                  structuredContent: {
                    documentId,
                    pageNodeId: pageC,
                    snapshot: { snapshotId: 'snapshot-1', compactText: 'safe fixture state' },
                  },
                },
              },
            },
          },
        ]),
      );

      execFileSync('node', [
        new URL('./derive-redacted-mcp-trace.mjs', import.meta.url).pathname,
        inputPath,
        outputPath,
      ]);
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({
        version: 1,
        calls: [
          {
            order: 1,
            toolName: 'browser_snapshot',
            args: { documentId, pageNodeId: pageC },
            response: { status: 'success', snapshotId: 'snapshot-1' },
          },
        ],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('deterministic canvas fixture', () => {
  it('anchors the target center to a fixed CSS viewport coordinate', () => {
    const contents = readFileSync(
      new URL('./sites/canvas-fallback/index.html', import.meta.url),
      'utf8',
    );

    expect(contents).toContain('left: 40px');
    expect(contents).toContain('top: 180px');
    expect(contents).toContain('data-target-center-x="381"');
    expect(contents).toContain('data-target-center-y="337"');
  });
});

describe('fixture board', () => {
  it('loads through the production Sheltie document parser', () => {
    const contents = readFileSync(
      new URL('./boards/comparison-board.sheltie', import.meta.url),
      'utf8',
    );

    expect(parseProjectDocument(contents)).toMatchObject({
      schemaVersion: 2,
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: pageA, type: 'webpage' }),
        expect.objectContaining({ id: pageB, type: 'webpage' }),
      ]),
      edges: [expect.objectContaining({ id: 'existing-product-edge' })],
    });
  });
});

describe('verifyComparison', () => {
  it('accepts the required explicit-ID overview and one atomic board edit', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'list_documents'),
        call(2, 'get_editor_state', { args: { documentId } }),
        call(3, 'get_board', { args: { documentId } }),
        call(4, 'get_webpage_screenshots', {
          args: { documentId },
          freshness: [
            { pageNodeId: pageA, freshness: 'cached' },
            { pageNodeId: pageB, freshness: 'cached' },
            { pageNodeId: pageC, freshness: 'missing' },
          ],
        }),
        call(5, 'get_board_screenshot', { args: { documentId } }),
        call(6, 'batch_edit_board', {
          args: { documentId },
          createdNodeIds: ['note-price-a', 'note-price-b'],
        }),
      ],
    };

    expect(
      verifyComparison(trace, comparisonBoard).every((expectation) => expectation.passed),
    ).toBe(true);

    const overwrittenExistingNote: McpTrace = {
      calls: trace.calls.map((item) =>
        item.toolName === 'batch_edit_board'
          ? { ...item, response: { ...item.response, createdNodeIds: [] } }
          : item,
      ),
    };
    const fabricatedBoard: FinalBoard = {
      ...comparisonBoard,
      nodes: [
        {
          id: 'existing-comparison-note',
          type: 'stickynote',
          content: 'Atlas Basic costs $29; Beacon Basic costs $24',
        },
      ],
    };
    expect(
      verifyComparison(overwrittenExistingNote, fabricatedBoard).find((item) =>
        item.text.startsWith('The successful batch created'),
      )?.passed,
    ).toBe(false);
  });

  it('rejects incorrect initial ordering and incomplete screenshot freshness evidence', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'get_editor_state', { args: { documentId } }),
        call(2, 'list_documents'),
        call(3, 'get_webpage_screenshots', {
          args: { documentId },
          freshness: [{ pageNodeId: pageA, freshness: 'cached' }],
        }),
      ],
    };

    const result = verifyComparison(trace, comparisonBoard);
    expect(result.some((expectation) => !expectation.passed)).toBe(true);
    expect(evidenceText(result)).toContain(
      'comparison: expected list_documents → get_editor_state(documentId) → get_board(documentId)',
    );
    expect(evidenceText(result)).toContain(
      'comparison: expected 2 cached and 1 missing screenshot records',
    );
  });
});

describe('verifySemantic', () => {
  it('accepts typed actions that always use the latest snapshot reference', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'browser_snapshot', {
          args: { documentId, pageNodeId: pageC },
          snapshotId: 'snapshot-1',
        }),
        call(2, 'browser_select_option', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-1', elementRef: 'plan' },
          snapshotId: 'snapshot-2',
        }),
        call(3, 'browser_fill', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-2', elementRef: 'name' },
          snapshotId: 'snapshot-3',
        }),
        call(4, 'browser_click', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-3', elementRef: 'submit' },
          snapshotId: 'snapshot-4',
          evidence: ['semantic_confirmation'],
        }),
        call(5, 'batch_edit_board', {
          args: { documentId },
          createdNodeIds: ['form-note'],
        }),
      ],
    };
    const board: FinalBoard = {
      nodes: [{ id: 'form-note', type: 'stickynote', content: 'Pro plan confirmed for Ada.' }],
      edges: [],
    };

    expect(verifySemantic(trace, board).every((expectation) => expectation.passed)).toBe(true);

    const earlyBatch: McpTrace = {
      calls: trace.calls.map((item) =>
        item.toolName === 'batch_edit_board' ? { ...item, order: 3.5 } : item,
      ),
    };
    expect(
      verifySemantic(earlyBatch, board).find((item) => item.text.startsWith('Semantic form'))
        ?.passed,
    ).toBe(false);
  });

  it('rejects stale refs and coordinate or evaluate fallbacks for semantic controls', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'browser_snapshot', {
          args: { documentId, pageNodeId: pageC },
          snapshotId: 'snapshot-1',
        }),
        call(2, 'browser_fill', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-1', elementRef: 'name' },
          snapshotId: 'snapshot-2',
        }),
        call(3, 'browser_click', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-1', elementRef: 'submit' },
          snapshotId: 'snapshot-3',
        }),
        call(4, 'browser_click_coordinates', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-3' },
          snapshotId: 'snapshot-4',
        }),
        call(5, 'browser_evaluate', { args: { documentId, pageNodeId: pageC } }),
      ],
    };

    const result = verifySemantic(trace, { nodes: [], edges: [] });
    expect(evidenceText(result)).toContain(
      'semantic: browser_click used stale snapshot snapshot-1; latest for page-semantic-form was snapshot-2',
    );
    expect(result.find((item) => item.text.startsWith('Semantic form'))?.passed).toBe(false);
  });

  it('rejects stale refs after any newer action snapshot', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'browser_snapshot', {
          args: { documentId, pageNodeId: pageC },
          snapshotId: 'snapshot-1',
        }),
        call(2, 'browser_fill', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-1', elementRef: 'name' },
          snapshotId: 'snapshot-2',
        }),
        call(3, 'browser_wait', {
          args: { documentId, pageNodeId: pageC },
          snapshotId: 'snapshot-3',
        }),
        call(4, 'browser_click', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-2', elementRef: 'submit' },
          snapshotId: 'snapshot-4',
        }),
      ],
    };

    expect(evidenceText(verifySemantic(trace, { nodes: [], edges: [] }))).toContain(
      'semantic: browser_click used stale snapshot snapshot-2; latest for page-semantic-form was snapshot-3',
    );
  });

  it('tracks current snapshots independently for interleaved pages', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'browser_snapshot', {
          args: { documentId, pageNodeId: pageA },
          snapshotId: 'page-a-1',
        }),
        call(2, 'browser_snapshot', {
          args: { documentId, pageNodeId: pageB },
          snapshotId: 'page-b-1',
        }),
        call(3, 'browser_fill', {
          args: { documentId, pageNodeId: pageA, snapshotId: 'page-a-1', elementRef: 'a-field' },
          snapshotId: 'page-a-2',
        }),
        call(4, 'browser_click', {
          args: { documentId, pageNodeId: pageB, snapshotId: 'page-b-1', elementRef: 'b-button' },
          snapshotId: 'page-b-2',
        }),
      ],
    };

    expect(
      verifySemantic(trace, { nodes: [], edges: [] }).find((item) =>
        item.text.startsWith('Every browser action'),
      )?.passed,
    ).toBe(true);
  });

  it('rejects a fabricated final note when submit confirmation evidence is absent', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'browser_snapshot', {
          args: { documentId, pageNodeId: pageC },
          snapshotId: 'snapshot-1',
        }),
        call(2, 'browser_select_option', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-1', elementRef: 'plan' },
          snapshotId: 'snapshot-2',
        }),
        call(3, 'browser_fill', {
          args: { documentId, pageNodeId: pageC, snapshotId: 'snapshot-2', elementRef: 'name' },
          snapshotId: 'snapshot-3',
        }),
        call(4, 'batch_edit_board', {
          args: { documentId },
          createdNodeIds: ['form-note'],
        }),
      ],
    };
    const board: FinalBoard = {
      nodes: [{ id: 'form-note', type: 'stickynote', content: 'Pro plan confirmed for Ada.' }],
      edges: [],
    };

    expect(
      verifySemantic(trace, board).find((item) => item.text.startsWith('Semantic form'))?.passed,
    ).toBe(false);
  });
});

describe('verifyVisual', () => {
  it('accepts semantic inspection, screenshot coordinates, one atomic edit, and explicit reveal', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'browser_snapshot', {
          args: { documentId, pageNodeId: 'page-canvas' },
          snapshotId: 'snapshot-1',
        }),
        call(2, 'browser_screenshot', {
          args: { documentId, pageNodeId: 'page-canvas', mode: 'viewport' },
        }),
        call(3, 'browser_click_coordinates', {
          args: { documentId, pageNodeId: 'page-canvas', snapshotId: 'snapshot-1' },
          snapshotId: 'snapshot-2',
          evidence: ['canvas_target_activated'],
        }),
        call(4, 'batch_edit_board', {
          args: { documentId },
          createdNodeIds: ['canvas-note'],
        }),
        call(5, 'focus_nodes', { args: { documentId, nodeIds: ['canvas-note'] } }),
      ],
    };
    const board: FinalBoard = {
      nodes: [{ id: 'canvas-note', type: 'stickynote', content: 'Canvas target activated.' }],
      edges: [],
    };

    expect(verifyVisual(trace, board).every((expectation) => expectation.passed)).toBe(true);

    const wrongFocus: McpTrace = {
      calls: trace.calls.map((item) =>
        item.toolName === 'focus_nodes'
          ? { ...item, args: { documentId, nodeIds: ['unrelated-node'] } }
          : item,
      ),
    };
    expect(
      verifyVisual(wrongFocus, board).find((item) => item.text.startsWith('focus_nodes'))?.passed,
    ).toBe(false);

    const earlyBatch: McpTrace = {
      calls: trace.calls.map((item) =>
        item.toolName === 'batch_edit_board' ? { ...item, order: 2.5 } : item,
      ),
    };
    expect(
      verifyVisual(earlyBatch, board).find((item) => item.text.startsWith('Canvas interaction'))
        ?.passed,
    ).toBe(false);
  });

  it('rejects a partial board-write sequence, nonexistent save, and unrequested focus', () => {
    const trace: McpTrace = {
      calls: [
        call(1, 'browser_snapshot', {
          args: { documentId, pageNodeId: 'page-canvas' },
          snapshotId: 'snapshot-1',
        }),
        call(2, 'batch_edit_board', { args: { documentId }, status: 'error' }),
        call(3, 'batch_edit_board', { args: { documentId } }),
        call(4, 'save_board', { args: { documentId } }),
        call(5, 'focus_nodes', { args: { documentId, nodeIds: ['canvas-note'] } }),
      ],
    };

    const result = verifyComparison(trace, { nodes: [], edges: [] });
    expect(evidenceText(result)).toContain(
      'board: expected one batch attempt total and it must succeed',
    );
    expect(evidenceText(result)).toContain('workflow: attempted nonexistent save tool: save_board');
    expect(evidenceText(result)).toContain('workflow: focus_nodes was not explicitly permitted');
  });
});
