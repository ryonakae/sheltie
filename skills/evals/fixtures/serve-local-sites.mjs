import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 4174;
const sitesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sites');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
]);

function respond(response, statusCode, body = '') {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function resolveFixturePath(urlPathname) {
  const requestedPath = decodeURIComponent(urlPathname);
  const relativePath = requestedPath === '/' ? 'compare-a/index.html' : requestedPath.slice(1);
  const candidate = path.resolve(sitesRoot, relativePath);
  if (candidate !== sitesRoot && !candidate.startsWith(`${sitesRoot}${path.sep}`)) return undefined;
  const candidateStats = await stat(candidate).catch(() => undefined);
  if (candidateStats?.isDirectory()) return path.join(candidate, 'index.html');
  return candidate;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    respond(response, 405, 'Method not allowed');
    return;
  }

  let fixturePath;
  try {
    fixturePath = await resolveFixturePath(new URL(request.url ?? '/', `http://${host}`).pathname);
    if (!fixturePath) {
      respond(response, 403, 'Forbidden');
      return;
    }
    await access(fixturePath);
  } catch {
    respond(response, 404, 'Fixture not found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': contentTypes.get(path.extname(fixturePath)) ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(fixturePath).pipe(response);
});

function closeServer(signal) {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
  process.once(signal, () => process.exit(0));
}

server.listen(port, host, () => {
  console.log(`http://${host}:${port}`);
});
server.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
process.once('SIGINT', () => closeServer('SIGINT'));
process.once('SIGTERM', () => closeServer('SIGTERM'));
