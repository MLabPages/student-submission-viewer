'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3210);
let activePort = PORT;
const ROOT = __dirname;
const PACKAGED_ROOT = ROOT.toLowerCase().endsWith('app.asar')
  ? `${ROOT.slice(0, -'app.asar'.length)}app.asar.unpacked`
  : ROOT;
const SCRIPTS_DIR = path.join(PACKAGED_ROOT, 'scripts');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'StudentSubmissionViewer');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const EVALUATIONS_FILE = path.join(DATA_DIR, 'evaluations.json');
const PORT_FILE = path.join(DATA_DIR, 'port.txt');
const IMAGE_MIME_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.jfif', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.apng', 'image/apng'],
  ['.ico', 'image/x-icon']
]);
const WORD_FORMATS = ['.doc', '.docx', '.docm', '.rtf', '.odt', '.txt'];
const POWERPOINT_FORMATS = ['.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.odp'];
const SPREADSHEET_FORMATS = ['.xls', '.xlsx', '.xlsm', '.xlsb', '.csv', '.ods'];
const DIRECT_PREVIEW = new Set(['.pdf', ...IMAGE_MIME_TYPES.keys()]);
const SUPPORTED = new Set([
  ...DIRECT_PREVIEW,
  ...WORD_FORMATS,
  ...POWERPOINT_FORMATS,
  ...SPREADSHEET_FORMATS
]);
const IGNORED_FILES = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

let currentFolder = '';
let files = [];
let evaluations = {};
const jobs = new Map();
const queue = [];
let queueRunning = false;

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function sendText(res, status, value) {
  const body = Buffer.from(value);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error('リクエストが大きすぎます。');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function fileId(absolutePath) {
  return crypto.createHash('sha256').update(absolutePath).digest('hex').slice(0, 24);
}

function cachePathFor(file) {
  const key = crypto.createHash('sha256')
    .update(`${file.path}\n${file.size}\n${file.mtimeMs}`)
    .digest('hex');
  return path.join(CACHE_DIR, `${key}.pdf`);
}

function publicFile(file) {
  const job = jobs.get(file.id);
  const cached = DIRECT_PREVIEW.has(file.ext) || fs.existsSync(cachePathFor(file));
  return {
    id: file.id,
    name: file.name,
    relativePath: file.relativePath,
    ext: file.ext,
    size: file.size,
    mtimeMs: file.mtimeMs,
    supported: file.supported,
    status: !file.supported ? 'unsupported' : cached ? 'ready' : (job?.status || 'waiting'),
    error: job?.error || '',
    evaluation: evaluations[file.path] || {}
  };
}

async function scanDirectory(root, recursive) {
  const found = [];

  async function walk(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (recursive) await walk(absolutePath);
        continue;
      }
      if (entry.name.startsWith('~$') || IGNORED_FILES.has(entry.name.toLowerCase())) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const stat = await fsp.stat(absolutePath);
      found.push({
        id: fileId(absolutePath),
        path: absolutePath,
        name: entry.name,
        relativePath: path.relative(root, absolutePath),
        ext,
        supported: SUPPORTED.has(ext),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
    }
  }

  await walk(root);
  return found;
}

function findFile(id) {
  return files.find((file) => file.id === id);
}

function runPowerShell(script, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      ...(options.sta ? ['-STA'] : []),
      '-File', script,
      ...args
    ], {
      windowsHide: !options.visible,
      cwd: PACKAGED_ROOT
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8').trim();
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) resolve(out);
      else reject(new Error(err || `PowerShellが終了コード ${code} で停止しました。`));
    });
  });
}

function enqueue(file, priority = false) {
  if (!file || !file.supported || DIRECT_PREVIEW.has(file.ext) || fs.existsSync(cachePathFor(file))) return;
  const existing = jobs.get(file.id);
  if (existing?.status === 'converting') return;
  if (existing?.status === 'queued') {
    if (priority) {
      const index = queue.indexOf(file.id);
      if (index >= 0) queue.splice(index, 1);
      queue.unshift(file.id);
    }
    return;
  }
  jobs.set(file.id, { status: 'queued', error: '' });
  if (priority) queue.unshift(file.id);
  else queue.push(file.id);
  processQueue().catch((error) => console.error(error));
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  while (queue.length) {
    const id = queue.shift();
    const file = findFile(id);
    if (!file) continue;
    const output = cachePathFor(file);
    if (fs.existsSync(output)) {
      jobs.set(id, { status: 'ready', error: '' });
      continue;
    }
    jobs.set(id, { status: 'converting', error: '' });
    try {
      await runPowerShell(path.join(SCRIPTS_DIR, 'convert-office.ps1'), [
        '-Source', file.path,
        '-Output', output
      ]);
      if (!fs.existsSync(output)) throw new Error('PDFファイルが作成されませんでした。');
      jobs.set(id, { status: 'ready', error: '' });
    } catch (error) {
      jobs.set(id, { status: 'error', error: error.message });
    }
  }
  queueRunning = false;
}

async function servePreview(req, res, filePath, extension) {
  const stat = await fsp.stat(filePath);
  const range = req.headers.range;
  const contentType = extension === '.pdf'
    ? 'application/pdf'
    : IMAGE_MIME_TYPES.get(extension) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (!range) {
    res.writeHead(200, { 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  if (start > end || start >= stat.size) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Content-Length': end - start + 1
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    sendText(res, 404, 'Not found');
    return;
  }
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  };
  const body = await fsp.readFile(filePath);
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'"
  );
  res.writeHead(200, {
    'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': body.length
  });
  res.end(body);
}

async function loadEvaluations() {
  try {
    evaluations = JSON.parse(await fsp.readFile(EVALUATIONS_FILE, 'utf8'));
  } catch {
    evaluations = {};
  }
}

async function saveEvaluations() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(EVALUATIONS_FILE, JSON.stringify(evaluations, null, 2), 'utf8');
}

function csvEscape(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const allowedHosts = new Set([`${HOST}:${activePort}`, `localhost:${activePort}`]);
    if (!allowedHosts.has(req.headers.host || '')) {
      return sendJson(res, 403, { error: 'Invalid local host.' });
    }
    const origin = req.headers.origin;
    const allowedOrigins = new Set([`http://${HOST}:${activePort}`, `http://localhost:${activePort}`]);
    if (origin && !allowedOrigins.has(origin)) {
      return sendJson(res, 403, { error: 'Cross-origin access is not allowed.' });
    }
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, app: 'student-submission-viewer', port: PORT });
    }

    if (pathname === '/api/choose-folder' && req.method === 'POST') {
      const selected = await runPowerShell(
        path.join(SCRIPTS_DIR, 'choose-folder.ps1'),
        [],
        { sta: true, visible: true }
      );
      return sendJson(res, 200, { path: selected });
    }

    if (pathname === '/api/scan' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.folder || typeof body.folder !== 'string') {
        return sendJson(res, 400, { error: 'フォルダを指定してください。' });
      }
      const resolved = path.resolve(body.folder);
      const stat = await fsp.stat(resolved);
      if (!stat.isDirectory()) return sendJson(res, 400, { error: 'フォルダではありません。' });
      currentFolder = resolved;
      jobs.clear();
      queue.length = 0;
      files = await scanDirectory(resolved, body.recursive !== false);
      files.forEach((file) => enqueue(file));
      return sendJson(res, 200, { folder: currentFolder, files: files.map(publicFile) });
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, { folder: currentFolder, files: files.map(publicFile) });
    }

    if (pathname === '/api/prepare' && req.method === 'POST') {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      ids.forEach((id, index) => enqueue(findFile(id), index === 0));
      return sendJson(res, 202, { accepted: ids.length });
    }

    if (pathname.startsWith('/api/preview/') && req.method === 'GET') {
      const id = pathname.slice('/api/preview/'.length);
      const file = findFile(id);
      if (!file) return sendJson(res, 404, { error: 'ファイルが見つかりません。' });
      if (!file.supported) {
        return sendJson(res, 415, {
          error: `${file.ext || '拡張子なし'} はプレビュー未対応です。見落としを防ぐため一覧に表示しています。「元ファイルを開く」で確認してください。`
        });
      }
      const direct = DIRECT_PREVIEW.has(file.ext);
      const previewPath = direct ? file.path : cachePathFor(file);
      if (!fs.existsSync(previewPath)) {
        enqueue(file, true);
        const job = jobs.get(id);
        return sendJson(res, job?.status === 'error' ? 500 : 202, {
          status: job?.status || 'queued',
          error: job?.error || ''
        });
      }
      await servePreview(req, res, previewPath, direct ? file.ext : '.pdf');
      return;
    }

    if (pathname.startsWith('/api/open/') && req.method === 'POST') {
      const id = pathname.slice('/api/open/'.length);
      const file = findFile(id);
      if (!file) return sendJson(res, 404, { error: 'ファイルが見つかりません。' });
      runPowerShell(path.join(SCRIPTS_DIR, 'open-file.ps1'), ['-Path', file.path], { visible: true })
        .catch((error) => console.error(error));
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/evaluations' && req.method === 'GET') {
      return sendJson(res, 200, evaluations);
    }

    if (pathname.startsWith('/api/evaluations/') && req.method === 'PUT') {
      const id = pathname.slice('/api/evaluations/'.length);
      const file = findFile(id);
      if (!file) return sendJson(res, 404, { error: 'ファイルが見つかりません。' });
      const body = await readBody(req);
      evaluations[file.path] = {
        status: String(body.status || '未確認'),
        score: String(body.score || ''),
        note: String(body.note || ''),
        updatedAt: new Date().toISOString()
      };
      await saveEvaluations();
      return sendJson(res, 200, evaluations[file.path]);
    }

    if (pathname === '/api/evaluations.csv' && req.method === 'GET') {
      const rows = [['ファイル名', '相対パス', '状態', '点数', 'メモ', '更新日時']];
      for (const file of files) {
        const value = evaluations[file.path] || {};
        rows.push([file.name, file.relativePath, value.status || '未確認', value.score || '', value.note || '', value.updatedAt || '']);
      }
      const csv = '\uFEFF' + rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
      const body = Buffer.from(csv, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="evaluations.csv"',
        'Content-Length': body.length
      });
      res.end(body);
      return;
    }

    await serveStatic(res, pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: error.message || '処理に失敗しました。' });
    else res.destroy();
  }
});

let startPromise = null;

function startServer() {
  if (startPromise) return startPromise;
  startPromise = loadEvaluations()
    .then(() => fsp.mkdir(CACHE_DIR, { recursive: true }))
    .then(() => new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        startPromise = null;
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        activePort = server.address().port;
        fs.writeFileSync(PORT_FILE, String(activePort), 'utf8');
        const url = `http://${HOST}:${activePort}`;
        console.log(`提出物連続確認ツール: ${url}`);
        resolve({ server, url, port: activePort });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(PORT, HOST);
    }));
  return startPromise;
}

function stopServer() {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { startServer, stopServer };

process.on('exit', () => {
  try {
    if (fs.readFileSync(PORT_FILE, 'utf8').trim() === String(activePort)) fs.unlinkSync(PORT_FILE);
  } catch {
    // The port file may not exist during an early startup failure.
  }
});
