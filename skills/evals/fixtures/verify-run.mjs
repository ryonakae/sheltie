import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

function usage() {
  throw new Error(
    'Usage: node verify-run.mjs <comparison|semantic|visual> <redacted-trace.json> <final-board.json> <expected.json> [executor-notes.md]',
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findBoard(value, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return undefined;
  visited.add(value);
  if (isRecord(value) && Array.isArray(value.nodes) && Array.isArray(value.edges)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const board = findBoard(child, visited);
    if (board) return board;
  }
  return undefined;
}

async function loadVerifier() {
  const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
  const source = await readFile(path.join(fixtureDirectory, 'verify-eval.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    fileName: 'verify-eval.ts',
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
  );
}

function renderUserNotes(evaluation, expectations) {
  const lines = [`# ${evaluation} verification`, ''];
  for (const item of expectations)
    lines.push(`- ${item.passed ? 'PASS' : 'FAIL'} — ${item.text}: ${item.evidence}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const [evaluation, tracePath, boardPath, expectedPath, executorNotesPath] = process.argv.slice(2);
  if (!evaluation || !tracePath || !boardPath || !expectedPath) usage();
  if (!['comparison', 'semantic', 'visual'].includes(evaluation)) usage();

  const [trace, rawBoard, expected] = await Promise.all(
    [tracePath, boardPath, expectedPath].map(async (filePath) =>
      JSON.parse(await readFile(filePath, 'utf8')),
    ),
  );
  if (!isRecord(expected) || expected.id !== evaluation) {
    throw new Error(`Expected fixture must declare id ${evaluation}.`);
  }
  const board = findBoard(rawBoard);
  if (!board) throw new Error('final-board.json does not contain a nodes/edges board result.');

  const verifier = await loadVerifier();
  const expectations = verifier.verifyEvaluation(evaluation, trace, board, expected);
  const outputDirectory = path.dirname(tracePath);
  const verification = {
    evaluation,
    passed: expectations.every((item) => item.passed),
    expectations,
  };
  await writeFile(
    path.join(outputDirectory, 'verification.json'),
    `${JSON.stringify(verification, null, 2)}\n`,
  );
  await writeFile(
    path.join(outputDirectory, 'user_notes.md'),
    renderUserNotes(evaluation, expectations) +
      (executorNotesPath ? `\nExecutor notes: ${executorNotesPath}\n` : ''),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
