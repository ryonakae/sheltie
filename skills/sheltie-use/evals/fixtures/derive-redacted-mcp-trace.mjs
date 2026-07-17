import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TOOL_NAMES = new Set([
  'list_documents',
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

const INPUT_KEYS = ['arguments', 'args', 'input', 'params', 'parameters', 'tool_input'];
const TOOL_NAME_KEYS = ['toolName', 'tool_name', 'name'];
const ID_KEYS = ['documentId', 'pageNodeId', 'snapshotId', 'elementRef'];

function usage() {
  throw new Error(
    'Usage: node derive-redacted-mcp-trace.mjs <agent-result.verbose.json> <redacted-mcp-trace.json>',
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonString(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizedToolName(value) {
  if (typeof value !== 'string') return undefined;
  if (TOOL_NAMES.has(value)) return value;
  return [...TOOL_NAMES].find(
    (toolName) =>
      value.endsWith(`__${toolName}`) ||
      value.endsWith(`.${toolName}`) ||
      value.endsWith(`/${toolName}`) ||
      value.endsWith(`_${toolName}`) ||
      value.includes(`__${toolName}__`),
  );
}

function directRecord(value) {
  const parsed = parseJsonString(value);
  return isRecord(parsed) ? parsed : {};
}

function extractArgs(value) {
  const record = directRecord(value);
  const nested = directRecord(record.arguments ?? record.args ?? record.input);
  const input = Object.keys(nested).length > 0 ? nested : record;
  const args = {};
  for (const key of ID_KEYS) {
    const found = input[key];
    if (typeof found === 'string' || typeof found === 'number' || typeof found === 'boolean') {
      args[key] = found;
    }
  }
  for (const key of ['nodeIds', 'pageNodeIds']) {
    const ids = input[key];
    if (Array.isArray(ids) && ids.every((item) => typeof item === 'string')) args[key] = ids;
  }
  return args;
}

function structuredPayload(value) {
  const response = directRecord(value);
  const structured = directRecord(response.structuredContent);
  if (Object.keys(structured).length > 0) return { response, payload: structured };
  const textContent = Array.isArray(response.content)
    ? response.content.find((item) => isRecord(item) && item.type === 'text')
    : undefined;
  const textPayload = directRecord(isRecord(textContent) ? textContent.text : undefined);
  return {
    response,
    payload: Object.keys(textPayload).length > 0 ? textPayload : response,
  };
}

function extractResponse(value) {
  const { response, payload } = structuredPayload(value);
  const status =
    response.isError === true || Object.hasOwn(payload, 'error') || typeof payload.code === 'string'
      ? 'error'
      : 'success';
  const snapshot = directRecord(payload.snapshot);
  const snapshotId = snapshot.snapshotId;
  const compactText = snapshot.compactText;
  const freshness = Array.isArray(payload.screenshots)
    ? payload.screenshots
        .filter(
          (item) =>
            isRecord(item) &&
            typeof item.pageNodeId === 'string' &&
            (item.freshness === 'cached' || item.freshness === 'missing'),
        )
        .map((item) => ({ pageNodeId: item.pageNodeId, freshness: item.freshness }))
    : [];
  const createdNodeIds = payload.createdNodeIds;
  const evidence = [
    ...(typeof compactText === 'string' && compactText.includes('Pro plan confirmed for Ada.')
      ? ['semantic_confirmation']
      : []),
    ...(typeof compactText === 'string' && compactText.includes('Canvas target activated.')
      ? ['canvas_target_activated']
      : []),
  ];
  return {
    status,
    ...(typeof snapshotId === 'string' ? { snapshotId } : {}),
    ...(freshness.length > 0 ? { freshness } : {}),
    ...(Array.isArray(createdNodeIds) && createdNodeIds.every((id) => typeof id === 'string')
      ? { createdNodeIds }
      : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

function callFromRecord(record) {
  const params = directRecord(record.params);
  const toolName = [
    ...TOOL_NAME_KEYS.map((key) => normalizedToolName(record[key])),
    normalizedToolName(params.name),
  ].find(Boolean);
  if (!toolName) return undefined;
  const inputKey = INPUT_KEYS.find((key) => Object.hasOwn(record, key));
  const isExplicitToolCall = record.type === 'tool_call' || record.type === 'tool_use';
  if (!inputKey && !isExplicitToolCall) return undefined;
  const input = inputKey ? record[inputKey] : {};
  const result = record.result ?? record.response ?? record.output ?? record.tool_result ?? {};
  return { toolName, args: extractArgs(input), response: extractResponse(result) };
}

function collectCalls(value, calls, visited = new Set()) {
  const parsed = parseJsonString(value);
  if (!parsed || typeof parsed !== 'object' || visited.has(parsed)) return;
  visited.add(parsed);
  if (Array.isArray(parsed)) {
    parsed.forEach((item) => collectCalls(item, calls, visited));
    return;
  }
  const call = callFromRecord(parsed);
  if (call) calls.push({ order: calls.length + 1, ...call });
  Object.values(parsed).forEach((child) => collectCalls(child, calls, visited));
}

function gatewayCalls(records) {
  if (!Array.isArray(records)) return [];
  const pending = new Map();
  const calls = [];
  for (const record of records) {
    const message = directRecord(record?.message);
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const content of message.content) {
        if (!isRecord(content) || (content.type !== 'toolCall' && content.type !== 'tool_call')) {
          continue;
        }
        if (content.name !== 'mcp' || typeof content.id !== 'string') continue;
        const gatewayArguments = directRecord(content.arguments);
        const toolName = normalizedToolName(gatewayArguments.tool);
        if (!toolName) continue;
        const toolArguments = directRecord(gatewayArguments.args);
        const call = {
          order: calls.length + 1,
          toolName,
          args: extractArgs(toolArguments),
          response: { status: 'error' },
        };
        calls.push(call);
        pending.set(content.id, call);
      }
    }
    if (message.role !== 'toolResult' || typeof message.toolCallId !== 'string') continue;
    const call = pending.get(message.toolCallId);
    if (!call) continue;
    const details = directRecord(message.details);
    call.response = extractResponse(details.mcpResult ?? {});
    if (message.isError === true) call.response.status = 'error';
  }
  return calls;
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) usage();
  const verboseResult = JSON.parse(await readFile(inputPath, 'utf8'));
  const calls = gatewayCalls(verboseResult);
  if (calls.length === 0) collectCalls(verboseResult, calls);
  if (calls.length === 0) {
    throw new Error('Verbose Agent result contains no recognizable MCP tool-call data.');
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ version: 1, calls }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
