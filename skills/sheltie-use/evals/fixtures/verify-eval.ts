export type TraceArgumentValue = string | string[] | number | boolean;

export type McpTraceCall = {
  order: number;
  toolName: string;
  args: Record<string, TraceArgumentValue>;
  response: {
    status: 'success' | 'error';
    snapshotId?: string;
    freshness?: Array<{ pageNodeId: string; freshness: 'cached' | 'missing' }>;
    createdNodeIds?: string[];
    evidence?: Array<'semantic_confirmation' | 'canvas_target_activated'>;
  };
};

export type McpTrace = { calls: McpTraceCall[] };

export type FinalBoard = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

export type FixtureExpectation = {
  text: string;
  passed: boolean;
  evidence: string;
};

export type ExpectedFixture = {
  id: 'comparison' | 'semantic' | 'visual';
  requiredFinalNoteTextFragments: string[];
  requiredCreatedNoteCount: number;
  requiredFinalEdgeStyle?: {
    edgeId: string;
    strokeWidth: number;
    lineStyle: string;
    colorPreset: string;
  };
  requiredToolCategories: string[];
  forbiddenToolCategories: string[];
  requiredBrowserEvidence: string[];
  focusNodes: 'forbidden' | 'required';
};

const comparisonExpected: ExpectedFixture = {
  id: 'comparison',
  requiredFinalNoteTextFragments: ['Atlas Basic costs $29', 'Beacon Basic costs $24'],
  requiredCreatedNoteCount: 2,
  requiredFinalEdgeStyle: {
    edgeId: 'existing-product-edge',
    strokeWidth: 6,
    lineStyle: 'dashed',
    colorPreset: 'warning',
  },
  requiredToolCategories: [
    'list_documents',
    'get_editor_state',
    'get_webpage_screenshots',
    'get_board_screenshot',
    'batch_edit_board',
  ],
  forbiddenToolCategories: ['save'],
  requiredBrowserEvidence: ['2 cached and 1 missing screenshot records'],
  focusNodes: 'forbidden',
};

const semanticExpected: ExpectedFixture = {
  id: 'semantic',
  requiredFinalNoteTextFragments: ['Pro plan confirmed for Ada'],
  requiredCreatedNoteCount: 1,
  requiredToolCategories: ['browser_snapshot', 'typed_action', 'batch_edit_board'],
  forbiddenToolCategories: ['browser_click_coordinates', 'browser_evaluate', 'save'],
  requiredBrowserEvidence: ['latest snapshot ref after every state-changing action'],
  focusNodes: 'forbidden',
};

const visualExpected: ExpectedFixture = {
  id: 'visual',
  requiredFinalNoteTextFragments: ['Canvas target activated'],
  requiredCreatedNoteCount: 1,
  requiredToolCategories: [
    'browser_snapshot',
    'browser_screenshot',
    'browser_click_coordinates',
    'batch_edit_board',
    'focus_nodes',
  ],
  forbiddenToolCategories: ['browser_evaluate', 'save'],
  requiredBrowserEvidence: ['semantic snapshot before screenshot-coordinate action'],
  focusNodes: 'required',
};

const MCP_TOOLS_REQUIRING_DOCUMENT_ID = new Set([
  'get_editor_state',
  'get_board',
  'batch_edit_board',
  'focus_nodes',
  'get_webpage_screenshots',
  'get_board_screenshot',
  'browser_snapshot',
  'browser_navigate',
  'browser_go_back',
  'browser_go_forward',
  'browser_reload',
  'browser_click',
  'browser_hover',
  'browser_fill',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
  'browser_scroll',
  'browser_wait',
  'browser_screenshot',
  'browser_click_coordinates',
  'browser_evaluate',
  'browser_upload_file',
  'browser_handle_dialog',
]);

const BROWSER_TOOLS_REQUIRING_PAGE_ID = new Set(
  [...MCP_TOOLS_REQUIRING_DOCUMENT_ID].filter((toolName) => toolName.startsWith('browser_')),
);

function orderedCalls(trace: McpTrace): McpTraceCall[] {
  return [...trace.calls].sort((left, right) => left.order - right.order);
}

function isSuccessful(call: McpTraceCall): boolean {
  return call.response.status === 'success';
}

function expectation(text: string, passed: boolean, evidence: string): FixtureExpectation {
  return { text, passed, evidence };
}

function toolCalls(trace: McpTrace, toolName: string): McpTraceCall[] {
  return orderedCalls(trace).filter((call) => call.toolName === toolName);
}

function hasExplicitIds(trace: McpTrace): FixtureExpectation {
  const invalidCall = orderedCalls(trace).find((call) => {
    if (!MCP_TOOLS_REQUIRING_DOCUMENT_ID.has(call.toolName)) return false;
    if (typeof call.args.documentId !== 'string' || call.args.documentId.length === 0) return true;
    return (
      BROWSER_TOOLS_REQUIRING_PAGE_ID.has(call.toolName) &&
      (typeof call.args.pageNodeId !== 'string' || call.args.pageNodeId.length === 0)
    );
  });

  return expectation(
    'MCP calls use explicit document and page IDs',
    invalidCall === undefined,
    invalidCall === undefined
      ? 'workflow: every document-scoped and browser call names its explicit target IDs'
      : `workflow: ${invalidCall.toolName} omitted documentId or pageNodeId`,
  );
}

function successfulBatch(trace: McpTrace): McpTraceCall | undefined {
  const batches = toolCalls(trace, 'batch_edit_board');
  return batches.length === 1 && isSuccessful(batches[0]) ? batches[0] : undefined;
}

function hasSingleSuccessfulBatch(trace: McpTrace): FixtureExpectation {
  const batch = successfulBatch(trace);
  return expectation(
    'One successful batch_edit_board represents all related board writes',
    batch !== undefined,
    batch !== undefined
      ? 'board: exactly one batch_edit_board was recorded and succeeded'
      : 'board: expected one batch attempt total and it must succeed',
  );
}

function createdNodeIds(trace: McpTrace): string[] {
  return successfulBatch(trace)?.response.createdNodeIds ?? [];
}

function hasNoSaveAttempt(trace: McpTrace): FixtureExpectation {
  const saveCall = orderedCalls(trace).find((call) => /save|export/i.test(call.toolName));
  return expectation(
    'No nonexistent save or export MCP tool is invoked',
    saveCall === undefined,
    saveCall === undefined
      ? 'workflow: no save or export MCP tool was attempted'
      : `workflow: attempted nonexistent save tool: ${saveCall.toolName}`,
  );
}

function focusExpectation(
  trace: McpTrace,
  mode: ExpectedFixture['focusNodes'],
): FixtureExpectation {
  const focusCalls = toolCalls(trace, 'focus_nodes').filter(isSuccessful);
  const createdIds = new Set(createdNodeIds(trace));
  const focusedIds = focusCalls[0]?.args.nodeIds;
  const requiredFocusPassed =
    focusCalls.length === 1 &&
    Array.isArray(focusedIds) &&
    focusedIds.length === 1 &&
    createdIds.has(focusedIds[0]);
  const passed = mode === 'required' ? requiredFocusPassed : focusCalls.length === 0;
  const evidence =
    mode === 'required'
      ? passed
        ? 'workflow: one explicit reveal focused only the created result note'
        : 'workflow: explicit reveal must focus exactly the created result note'
      : passed
        ? 'workflow: focus_nodes was not used without an explicit reveal request'
        : 'workflow: focus_nodes was not explicitly permitted';
  return expectation('focus_nodes follows the prompt-specific viewport rule', passed, evidence);
}

function collectNodeText(node: Record<string, unknown>): string {
  const values: string[] = [];
  if (typeof node.content === 'string') values.push(node.content);
  if (typeof node.text === 'string') values.push(node.text);
  collectTiptapText(node.tiptapContent, values);
  return values.join(' ');
}

function collectTiptapText(value: unknown, values: string[]): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') values.push(record.text);
  if (Array.isArray(record.content))
    record.content.forEach((child) => collectTiptapText(child, values));
}

function finalBoardExpectation(
  trace: McpTrace,
  board: FinalBoard,
  expected: ExpectedFixture,
): FixtureExpectation {
  const createdIds = createdNodeIds(trace);
  const createdNotes = createdIds
    .map((id) => board.nodes.find((node) => node.id === id))
    .filter((node): node is Record<string, unknown> => node?.type === 'stickynote');
  const matchedNoteIndexes = new Set<number>();
  const fragmentsMatchedByDistinctNotes = expected.requiredFinalNoteTextFragments.every(
    (fragment) => {
      const index = createdNotes.findIndex(
        (node, candidateIndex) =>
          !matchedNoteIndexes.has(candidateIndex) && collectNodeText(node).includes(fragment),
      );
      if (index < 0) return false;
      matchedNoteIndexes.add(index);
      return true;
    },
  );
  const passed =
    createdIds.length === expected.requiredCreatedNoteCount &&
    createdNotes.length === expected.requiredCreatedNoteCount &&
    fragmentsMatchedByDistinctNotes;
  return expectation(
    'The successful batch created the expected finding notes',
    passed,
    passed
      ? `board: batch created ${createdNotes.length} sticky notes with all expected fragments`
      : `board: expected ${expected.requiredCreatedNoteCount} created sticky notes containing the required fragments`,
  );
}

function finalEdgeExpectation(board: FinalBoard, expected: ExpectedFixture): FixtureExpectation {
  if (!expected.requiredFinalEdgeStyle) {
    return expectation(
      'Final board edge contract is preserved',
      true,
      'board: no edge style required',
    );
  }
  const required = expected.requiredFinalEdgeStyle;
  const edge = board.edges.find((candidate) => candidate.id === required.edgeId);
  const passed =
    edge?.strokeWidth === required.strokeWidth &&
    edge?.lineStyle === required.lineStyle &&
    edge?.colorPreset === required.colorPreset;
  return expectation(
    'Final board contains the expected WebPage comparison edge style',
    passed,
    passed
      ? `board: ${required.edgeId} uses ${required.colorPreset}/${required.lineStyle}/${required.strokeWidth}`
      : `board: ${required.edgeId} does not have the expected edge style`,
  );
}

function comparisonOrderExpectation(trace: McpTrace): FixtureExpectation {
  const calls = orderedCalls(trace);
  const first = calls[0];
  const second = calls[1];
  const third = calls[2];
  const passed =
    first?.toolName === 'list_documents' &&
    second?.toolName === 'get_editor_state' &&
    third?.toolName === 'get_board' &&
    typeof second.args.documentId === 'string' &&
    typeof third.args.documentId === 'string';
  return expectation(
    'Comparison begins by listing documents, reading editor state, and reading the board',
    passed,
    passed
      ? 'comparison: list_documents → get_editor_state → get_board established the target document'
      : 'comparison: expected list_documents → get_editor_state(documentId) → get_board(documentId)',
  );
}

function overviewExpectation(trace: McpTrace): FixtureExpectation[] {
  const calls = orderedCalls(trace);
  const screenshotIndex = calls.findIndex(
    (call) => call.toolName === 'get_webpage_screenshots' && isSuccessful(call),
  );
  const boardScreenshotIndex = calls.findIndex(
    (call) => call.toolName === 'get_board_screenshot' && isSuccessful(call),
  );
  const batchIndex = calls.findIndex(
    (call) => call.toolName === 'batch_edit_board' && isSuccessful(call),
  );
  const screenshots = calls[screenshotIndex];
  const freshness = screenshots?.response.freshness ?? [];
  const cached = freshness.filter((record) => record.freshness === 'cached').length;
  const missing = freshness.filter((record) => record.freshness === 'missing').length;
  return [
    expectation(
      'Comparison reads webpage and composed-board screenshots',
      screenshotIndex >= 0 &&
        boardScreenshotIndex >= 0 &&
        batchIndex > screenshotIndex &&
        batchIndex > boardScreenshotIndex,
      screenshotIndex >= 0 &&
        boardScreenshotIndex >= 0 &&
        batchIndex > screenshotIndex &&
        batchIndex > boardScreenshotIndex
        ? 'comparison: both overview screenshots were recorded before the board batch'
        : 'comparison: expected get_webpage_screenshots and get_board_screenshot before batch_edit_board',
    ),
    expectation(
      'Overview records two cached pages and one missing page',
      cached === 2 && missing === 1,
      cached === 2 && missing === 1
        ? 'comparison: screenshot freshness recorded 2 cached and 1 missing page'
        : 'comparison: expected 2 cached and 1 missing screenshot records',
    ),
  ];
}

function semanticSnapshotExpectation(trace: McpTrace): FixtureExpectation {
  const latestSnapshots = new Map<string, string>();
  for (const call of orderedCalls(trace)) {
    if (!call.toolName.startsWith('browser_')) continue;
    const documentId = call.args.documentId;
    const pageNodeId = call.args.pageNodeId;
    if (typeof documentId !== 'string' || typeof pageNodeId !== 'string') continue;
    const pageKey = `${documentId}\u0000${pageNodeId}`;
    const latestSnapshotId = latestSnapshots.get(pageKey);
    const suppliedSnapshotId = call.args.snapshotId;
    if (typeof suppliedSnapshotId === 'string') {
      if (typeof latestSnapshotId !== 'string') {
        return expectation(
          'Every browser action uses that page’s current snapshot reference',
          false,
          `semantic: ${call.toolName} occurred before a successful snapshot for ${pageNodeId}`,
        );
      }
      if (suppliedSnapshotId !== latestSnapshotId) {
        return expectation(
          'Every browser action uses that page’s current snapshot reference',
          false,
          `semantic: ${call.toolName} used stale snapshot ${suppliedSnapshotId}; latest for ${pageNodeId} was ${latestSnapshotId}`,
        );
      }
    }
    if (isSuccessful(call) && typeof call.response.snapshotId === 'string') {
      latestSnapshots.set(pageKey, call.response.snapshotId);
    }
  }
  return expectation(
    'Every browser action uses that page’s current snapshot reference',
    true,
    'semantic: every supplied snapshot ID matched the newest successful response for the same page',
  );
}

function semanticActionExpectation(trace: McpTrace): FixtureExpectation {
  const calls = orderedCalls(trace);
  const successfulIndex = (toolName: string, after = -1) =>
    calls.findIndex(
      (call, index) => index > after && call.toolName === toolName && isSuccessful(call),
    );
  const snapshotIndex = successfulIndex('browser_snapshot');
  const selectIndex = successfulIndex('browser_select_option', snapshotIndex);
  const fillIndex = successfulIndex('browser_fill', selectIndex);
  const clickIndex = successfulIndex('browser_click', fillIndex);
  const batchIndex = calls.findIndex(
    (call) => call.toolName === 'batch_edit_board' && isSuccessful(call),
  );
  const confirmation = calls[clickIndex]?.response.evidence?.includes('semantic_confirmation');
  const fallback = calls.find(
    (call) => call.toolName === 'browser_click_coordinates' || call.toolName === 'browser_evaluate',
  );
  const passed =
    snapshotIndex >= 0 &&
    selectIndex > snapshotIndex &&
    fillIndex > selectIndex &&
    clickIndex > fillIndex &&
    confirmation === true &&
    batchIndex > clickIndex &&
    fallback === undefined;
  return expectation(
    'Semantic form uses snapshot, select, fill, submit, and returned confirmation evidence',
    passed,
    passed
      ? 'semantic: successful typed actions completed in order, confirmation was observed, then the board batch ran'
      : 'semantic: expected successful snapshot → select → fill → submit confirmation → batch with no fallback',
  );
}

function visualEvidenceExpectation(trace: McpTrace): FixtureExpectation {
  const calls = orderedCalls(trace);
  const semanticSnapshot = calls.findIndex(
    (call) => call.toolName === 'browser_snapshot' && isSuccessful(call),
  );
  const screenshot = calls.findIndex(
    (call) => call.toolName === 'browser_screenshot' && isSuccessful(call),
  );
  const coordinateAction = calls.findIndex(
    (call) =>
      call.toolName === 'browser_click_coordinates' &&
      isSuccessful(call) &&
      call.response.evidence?.includes('canvas_target_activated'),
  );
  const batch = calls.findIndex(
    (call) => call.toolName === 'batch_edit_board' && isSuccessful(call),
  );
  const focus = calls.findIndex((call) => call.toolName === 'focus_nodes' && isSuccessful(call));
  const passed =
    semanticSnapshot >= 0 &&
    screenshot > semanticSnapshot &&
    coordinateAction > screenshot &&
    batch > coordinateAction &&
    focus > batch;
  return expectation(
    'Canvas interaction inspects semantics before screenshot-coordinate fallback',
    passed,
    passed
      ? 'visual: snapshot, screenshot, activation, board batch, and explicit focus were recorded in order'
      : 'visual: expected snapshot → screenshot → coordinate activation → batch → focus',
  );
}

export function verifyComparison(
  trace: McpTrace,
  board: FinalBoard,
  expected: ExpectedFixture = comparisonExpected,
): FixtureExpectation[] {
  return [
    comparisonOrderExpectation(trace),
    hasExplicitIds(trace),
    ...overviewExpectation(trace),
    hasSingleSuccessfulBatch(trace),
    hasNoSaveAttempt(trace),
    focusExpectation(trace, expected.focusNodes),
    finalBoardExpectation(trace, board, expected),
    finalEdgeExpectation(board, expected),
  ];
}

export function verifySemantic(
  trace: McpTrace,
  board: FinalBoard,
  expected: ExpectedFixture = semanticExpected,
): FixtureExpectation[] {
  return [
    hasExplicitIds(trace),
    semanticSnapshotExpectation(trace),
    semanticActionExpectation(trace),
    hasSingleSuccessfulBatch(trace),
    hasNoSaveAttempt(trace),
    focusExpectation(trace, expected.focusNodes),
    finalBoardExpectation(trace, board, expected),
  ];
}

export function verifyVisual(
  trace: McpTrace,
  board: FinalBoard,
  expected: ExpectedFixture = visualExpected,
): FixtureExpectation[] {
  const evaluateCall = toolCalls(trace, 'browser_evaluate')[0];
  return [
    hasExplicitIds(trace),
    visualEvidenceExpectation(trace),
    expectation(
      'Canvas fallback does not use browser_evaluate',
      evaluateCall === undefined,
      evaluateCall === undefined
        ? 'visual: browser_evaluate was not used'
        : 'visual: browser_evaluate bypassed the required coordinate fallback',
    ),
    hasSingleSuccessfulBatch(trace),
    hasNoSaveAttempt(trace),
    focusExpectation(trace, expected.focusNodes),
    finalBoardExpectation(trace, board, expected),
  ];
}

export function verifyEvaluation(
  evaluation: ExpectedFixture['id'],
  trace: McpTrace,
  board: FinalBoard,
  expected?: ExpectedFixture,
): FixtureExpectation[] {
  if (evaluation === 'comparison') return verifyComparison(trace, board, expected);
  if (evaluation === 'semantic') return verifySemantic(trace, board, expected);
  return verifyVisual(trace, board, expected);
}
