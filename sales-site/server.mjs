import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_SOFTWARE_BASE_URL = process.env.SOFTWARE_BASE_URL || 'http://localhost:3003';

export const defaultPublicRoot = new URL('./public/', import.meta.url);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const PUBLIC_ROOT_FILES = new Set([
  '/404.html',
  '/faq.html',
  '/how-it-works.html',
  '/index.html',
  '/integration.html',
  '/changelog.html',
  '/pricing.html',
  '/product.html',
  '/privacy.html',
  '/robots.txt',
  '/site.webmanifest',
  '/signup-success.html',
  '/sitemap.xml',
  '/terms.html',
]);

function toRootPath(rootUrl) {
  return path.resolve(fileURLToPath(rootUrl));
}

function responseJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return '';
  }
}

export function resolveStaticRequest(requestUrl, rootUrl = defaultPublicRoot) {
  const parsed = new URL(requestUrl, 'http://trennen-sales.local');
  let pathname = safeDecodePathname(parsed.pathname);
  if (!pathname || pathname.includes('\0') || pathname.includes('\\')) {
    return { status: 404 };
  }
  if (pathname === '/') pathname = '/index.html';

  const isAsset = pathname.startsWith('/assets/');
  if (!PUBLIC_ROOT_FILES.has(pathname) && !isAsset) {
    return { status: 404 };
  }

  const rootPath = toRootPath(rootUrl);
  const filePath = path.resolve(rootPath, `.${pathname}`);
  const insideRoot = filePath === rootPath || filePath.startsWith(`${rootPath}${path.sep}`);
  if (!insideRoot) return { status: 404 };

  return {
    status: 200,
    filePath,
    contentType: MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
  };
}

export function cacheControlForStaticFile(filePath, nodeEnv = process.env.NODE_ENV || 'development') {
  if (filePath.endsWith('.html') || nodeEnv !== 'production') {
    return 'no-store';
  }
  return 'public, max-age=300';
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function proxyHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (['connection', 'content-length', 'host', 'transfer-encoding'].includes(lower)) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

async function proxyApiRequest(req, res, softwareBaseUrl) {
  const target = new URL(req.url || '/', softwareBaseUrl);
  const method = req.method || 'GET';
  const hasBody = !['GET', 'HEAD'].includes(method);
  const body = hasBody ? await readRequestBody(req) : undefined;

  try {
    const upstream = await fetch(target, {
      method,
      headers: proxyHeaders(req),
      body,
      redirect: 'manual',
    });
    const responseHeaders = {};
    for (const [key, value] of upstream.headers.entries()) {
      const lower = key.toLowerCase();
      if (['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(lower)) continue;
      responseHeaders[key] = value;
    }
    res.writeHead(upstream.status, responseHeaders);
    if (method === 'HEAD') {
      res.end();
      return;
    }
    const arrayBuffer = await upstream.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch {
    responseJson(res, 502, {
      ok: false,
      error: 'software_api_unavailable',
      message: 'The Trennen software API is not available. Start the software app on port 3003 and try again.',
    });
  }
}

async function serveStatic(req, res, rootUrl) {
  const resolved = resolveStaticRequest(req.url || '/', rootUrl);
  if (resolved.status !== 200) {
    const notFound = resolveStaticRequest('/404.html', rootUrl);
    if (notFound.status === 200) {
      try {
        const body = await readFile(notFound.filePath);
        res.writeHead(404, {
          'Content-Type': notFound.contentType,
          'Cache-Control': 'no-store',
        });
        res.end(body);
        return;
      } catch {
        // Fall through to plain response if the branded 404 is unavailable.
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  try {
    const body = await readFile(resolved.filePath);
    res.writeHead(200, {
      'Content-Type': resolved.contentType,
      'Cache-Control': cacheControlForStaticFile(resolved.filePath),
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

export function createSalesSiteServer({
  root = defaultPublicRoot,
  softwareBaseUrl = DEFAULT_SOFTWARE_BASE_URL,
} = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://trennen-sales.local');
    if (url.pathname.startsWith('/api/')) {
      await proxyApiRequest(req, res, softwareBaseUrl);
      return;
    }
    await serveStatic(req, res, root);
  });
}

export function formatListenError(error, host, port) {
  if (error?.code === 'EADDRINUSE') {
    return [
      `Port ${port} is already in use, so the Trennen sales site cannot start at http://${host}:${port}.`,
      `Run: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
      'Then stop the old Node process and run: PORT=3000 npm start',
    ].join('\n');
  }

  if (error?.code === 'EPERM') {
    return [
      `This environment is not allowed to bind http://${host}:${port}.`,
      'Start the sales site from your normal Mac Terminal instead:',
      `cd ${process.cwd()}`,
      'PORT=3000 npm start',
    ].join('\n');
  }

  return `Could not start Trennen sales site on http://${host}:${port}: ${error?.message || error}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  const server = createSalesSiteServer();
  server.listen(port, host, () => {
    console.log(`Trennen sales site running on http://${host}:${port}`);
    console.log(`Proxying /api/* to ${DEFAULT_SOFTWARE_BASE_URL}`);
  });
  server.on('error', (error) => {
    console.error(formatListenError(error, host, port));
    process.exitCode = 1;
  });
}
