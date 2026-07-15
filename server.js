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
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'StudentSubmissionViewer');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const EVALUATIONS_FILE = path.join(DATA_DIR, 'evaluations.json');
const PORT_FILE = path.join(DATA_DIR, 'port.txt');
const SUPPORTED = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx']);

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
  const cached = file.ext === '.pdf' || fs.existsSync(cachePathFor(file));
  return {
    id: file.id,
    name: file.name,
    relativePath: file.relativePath,
    ext: file.ext,
    size: file.size,
    mtimeMs: file.mtimeMs,
    status: file.ext === '.pdf' || cached ? 'ready' : (job?.status || 'waiting'),
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
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED.has(ext)) continue;
      const stat = await fsp.stat(absolutePath);
      found.push({
        id: fileId(absolutePath),
        path: absolutePath,
        name: entry.name,
        relativePath: path.relative(root, absolutePath),
        ext,
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
      cwd: ROOT
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
  if (!file || file.ext === '.pdf' || fs.existsSync(cachePathFor(file))) return;
  const existing = jobs.get(file.id);
  if (existing?.status === 'converting' || existing?.status === 'queued') return;
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
      await runPowerShell(path.join(ROOT, 'scripts', 'convert-office.ps1'), [
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

async function servePdf(req, res, filePath) {
  const stat = await fsp.stat(filePath);
  const range = req.headers.range;
  res.setHeader('Content-Type', 'application/pdf');
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
    const allowedHosts = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
    if (!allowedHosts.has(req.headers.host || '')) {
      return sendJson(res, 403, { error: 'Invalid local host.' });
    }
    const origin = req.headers.origin;
    const allowedOrigins = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
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
        path.join(ROOT, 'scripts', 'choose-folder.ps1'),
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
      const previewPath = file.ext === '.pdf' ? file.path : cachePathFor(file);
      if (!fs.existsSync(previewPath)) {
        enqueue(file, true);
        const job = jobs.get(id);
        return sendJson(res, job?.status === 'error' ? 500 : 202, {
          status: job?.status || 'queued',
          error: job?.error || ''
        });
      }
      await servePdf(req, res, previewPath);
      return;
    }

    if (pathname.startsWith('/api/open/') && req.method === 'POST') {
      const id = pathname.slice('/api/open/'.length);
      const file = findFile(id);
      if (!file) return sendJson(res, 404, { error: 'ファイルが見つかりません。' });
      runPowerShell(path.join(ROOT, 'scripts', 'open-file.ps1'), ['-Path', file.path], { visible: true })
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

loadEvaluations()
  .then(() => fsp.mkdir(CACHE_DIR, { recursive: true }))
  .then(() => {
    server.listen(PORT, HOST, () => {
      fs.writeFileSync(PORT_FILE, String(PORT), 'utf8');
      console.log(`提出物連続確認ツール: http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

server.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

process.on('exit', () => {
  try {
    if (fs.readFileSync(PORT_FILE, 'utf8').trim() === String(PORT)) fs.unlinkSync(PORT_FILE);
  } catch {
    // The port file may not exist during an early startup failure.
  }
});
