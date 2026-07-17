/* global URL, console, process */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const ports = process.argv.includes('--primary-only') ? [1420] : [1420, 1421];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(scriptDir, '..', '..', 'public');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function resolveRequestPath(requestUrl) {
  let decodedRequestPath = requestUrl.split('?', 1)[0];
  for (let pass = 0; pass < 2; pass += 1) {
    const decoded = decodeURIComponent(decodedRequestPath);
    if (decoded === decodedRequestPath) break;
    decodedRequestPath = decoded;
  }
  if (decodedRequestPath.split('/').includes('..')) return null;

  const pathname = decodeURIComponent(new URL(requestUrl, `http://${host}`).pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(publicDir, relativePath);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${sep}`)) return null;
  return filePath;
}

function createFixtureServer() {
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
      return;
    }

    let filePath;
    try {
      filePath = resolveRequestPath(request.url ?? '/');
    } catch {
      response.writeHead(400).end('Bad Request');
      return;
    }
    if (!filePath) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const metadata = await stat(filePath);
      if (!metadata.isFile()) throw new Error('not a file');
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': metadata.size,
        'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
      });
      if (request.method === 'HEAD') {
        response.end();
      } else {
        createReadStream(filePath).pipe(response);
      }
    } catch {
      response.writeHead(404).end('Not Found');
    }
  });
}

const servers = [];
try {
  for (const port of ports) {
    const server = createFixtureServer();
    await new Promise((resolveReady, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolveReady();
      });
    });
    servers.push(server);
    console.log(`Semantic fixtures ready: http://${host}:${port}`);
  }
} catch (error) {
  await Promise.all(
    servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))),
  );
  console.error(`Failed to start semantic fixtures: ${error.message}`);
  process.exitCode = 1;
}

async function shutdown() {
  await Promise.all(
    servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))),
  );
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
