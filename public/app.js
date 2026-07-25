'use strict';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.bmp', '.avif', '.apng', '.ico'
]);

const state = {
  files: [],
  filtered: [],
  currentId: null,
  evaluations: {},
  pollTimer: null,
  progressTimer: null,
  saveTimer: null,
  viewMode: localStorage.getItem('submissionViewerMode') === 'thumbnail' ? 'thumbnail' : 'list',
  galleryMode: false,
  panelWidths: {
    list: Number(localStorage.getItem('submissionViewerListWidth')) || 280,
    thumbnail: Number(localStorage.getItem('submissionViewerThumbnailWidth')) || 560
  }
};

const el = Object.fromEntries([
  'chooseFolder', 'folderPath', 'recursive', 'loadFolder', 'fileCount', 'search',
  'listView', 'thumbnailView', 'galleryMode', 'fileSplitter',
  'conversionProgress', 'progressBar', 'progressText', 'workspace',
  'fileList', 'previous', 'next', 'currentName', 'position', 'openOriginal',
  'preview', 'placeholder', 'loading', 'loadingMessage', 'previewError',
  'evaluationStatus', 'score', 'note', 'saveState', 'toast'
].map((id) => [id, document.getElementById(id)]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(value.error || value || '処理に失敗しました。');
  return value;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.add('hidden'), 2600);
}

function currentFile() {
  return state.files.find((file) => file.id === state.currentId) || null;
}

function currentIndex() {
  return state.filtered.findIndex((file) => file.id === state.currentId);
}

function renderList() {
  const query = el.search.value.trim().toLocaleLowerCase('ja');
  state.filtered = state.files.filter((file) => {
    const haystack = `${file.name} ${file.relativePath}`.toLocaleLowerCase('ja');
    return haystack.includes(query);
  });
  const unsupportedVisible = state.filtered.filter((file) => file.status === 'unsupported').length;
  el.fileCount.textContent = unsupportedVisible
    ? `提出物 ${state.filtered.length}件・未対応 ${unsupportedVisible}件`
    : `提出物 ${state.filtered.length}件`;
  el.fileList.classList.toggle('thumbnail-view', state.viewMode === 'thumbnail');
  if (!state.filtered.length) {
    el.fileList.innerHTML = '<div class="empty-list">該当する提出物がありません</div>';
    updateNavigation();
    return;
  }
  el.fileList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const file of state.filtered) {
    const button = document.createElement('button');
    button.className = `file-item${file.id === state.currentId ? ' active' : ''}${file.status === 'unsupported' ? ' unsupported-file' : ''}`;
    button.dataset.id = file.id;
    const type = file.ext ? file.ext.slice(1).toUpperCase() : 'FILE';
    button.innerHTML = `
      <span class="thumbnail-shell"><span class="file-type ${file.ext.slice(1)}">${type}</span></span>
      <span class="file-type ${file.ext.slice(1)}">${type}</span>
      <span class="file-meta">
        <strong class="file-name"></strong>
        <span class="file-path"></span>
      </span>
      <span class="status-cell">
        <span class="status-dot ${file.status}" title="${statusLabel(file.status)}"></span>
        <span class="unsupported-label">未対応</span>
      </span>`;
    button.querySelector('.file-name').textContent = file.name;
    button.querySelector('.file-path').textContent = file.relativePath;
    ensureThumbnail(button, file);
    button.addEventListener('click', () => {
      if (state.galleryMode) setGalleryMode(false);
      selectFile(file.id);
    });
    fragment.appendChild(button);
  }
  el.fileList.appendChild(fragment);
  updateNavigation();
}

function ensureThumbnail(button, file) {
  if (state.viewMode !== 'thumbnail' || file.status !== 'ready') return;
  const shell = button.querySelector('.thumbnail-shell');
  if (!shell || shell.querySelector('.thumbnail-frame')) return;
  shell.textContent = '';
  if (IMAGE_EXTENSIONS.has(file.ext)) {
    const image = document.createElement('img');
    image.className = 'thumbnail-frame';
    image.alt = '';
    image.loading = 'lazy';
    image.src = `/api/preview/${file.id}`;
    shell.appendChild(image);
  } else {
    const frame = document.createElement('iframe');
    frame.className = 'thumbnail-frame';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.loading = 'lazy';
    frame.src = `/api/preview/${file.id}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`;
    shell.appendChild(frame);
  }
}

function renderProgress() {
  const total = state.files.length;
  if (!total) {
    el.conversionProgress.classList.add('hidden');
    return;
  }
  const counts = { ready: 0, waiting: 0, queued: 0, converting: 0, error: 0, unsupported: 0 };
  for (const file of state.files) counts[file.status] = (counts[file.status] || 0) + 1;
  const finished = counts.ready + counts.error + counts.unsupported;
  el.conversionProgress.classList.remove('hidden');
  el.progressBar.style.width = `${Math.round((finished / total) * 100)}%`;
  const pending = counts.waiting + counts.queued;
  const details = [`PDF準備 ${counts.ready} / ${total}`];
  if (counts.converting) details.push(`変換中 ${counts.converting}`);
  if (pending) details.push(`待機 ${pending}`);
  if (counts.error) details.push(`エラー ${counts.error}`);
  if (counts.unsupported) details.push(`未対応 ${counts.unsupported}`);
  el.progressText.textContent = details.join('・');
}

function updateListStatuses() {
  for (const file of state.files) {
    const button = el.fileList.querySelector(`.file-item[data-id="${file.id}"]`);
    if (!button) continue;
    const dot = button.querySelector('.status-dot');
    dot.className = `status-dot ${file.status}`;
    dot.title = statusLabel(file.status);
    button.classList.toggle('unsupported-file', file.status === 'unsupported');
    ensureThumbnail(button, file);
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  localStorage.setItem('submissionViewerMode', mode);
  el.listView.classList.toggle('active', mode === 'list');
  el.thumbnailView.classList.toggle('active', mode === 'thumbnail');
  el.workspace.classList.toggle('thumbnail-layout', mode === 'thumbnail');
  el.listView.setAttribute('aria-pressed', String(mode === 'list'));
  el.thumbnailView.setAttribute('aria-pressed', String(mode === 'thumbnail'));
  applyPanelWidth();
  renderList();
}

function defaultPanelWidth(mode = state.viewMode) {
  return mode === 'thumbnail' ? 560 : 280;
}

function clampPanelWidth(width) {
  const workspaceWidth = el.workspace.getBoundingClientRect().width;
  const minimum = state.viewMode === 'thumbnail' ? 360 : 230;
  const reserved = window.innerWidth <= 1050 ? 410 : 640;
  const maximum = Math.max(minimum, workspaceWidth - reserved);
  return Math.round(Math.min(Math.max(width, minimum), maximum));
}

function applyPanelWidth(width = state.panelWidths[state.viewMode]) {
  if (state.galleryMode) return;
  const value = clampPanelWidth(width);
  state.panelWidths[state.viewMode] = value;
  el.workspace.style.setProperty('--file-panel-width', `${value}px`);
  el.fileSplitter.setAttribute('aria-valuenow', String(value));
  el.fileSplitter.setAttribute('aria-valuemin', state.viewMode === 'thumbnail' ? '360' : '230');
}

function savePanelWidth() {
  const key = state.viewMode === 'thumbnail'
    ? 'submissionViewerThumbnailWidth'
    : 'submissionViewerListWidth';
  localStorage.setItem(key, String(state.panelWidths[state.viewMode]));
}

function setGalleryMode(enabled) {
  state.galleryMode = enabled;
  el.workspace.classList.toggle('gallery-mode', enabled);
  el.galleryMode.classList.toggle('active', enabled);
  el.galleryMode.setAttribute('aria-pressed', String(enabled));
  el.galleryMode.textContent = enabled ? '内容を確認' : '作品を探す';
  if (enabled && state.viewMode !== 'thumbnail') setViewMode('thumbnail');
  else renderList();
  if (!enabled) applyPanelWidth();
}

function statusLabel(status) {
  return {
    ready: '表示準備済み', waiting: '未変換', queued: '変換待ち',
    converting: '変換中', error: '変換エラー', unsupported: '未対応形式（元ファイルで確認）'
  }[status] || status;
}

function updateNavigation() {
  const index = currentIndex();
  el.previous.disabled = index <= 0;
  el.next.disabled = index < 0 || index >= state.filtered.length - 1;
  el.position.textContent = index >= 0 ? `${index + 1} / ${state.filtered.length}` : `0 / ${state.filtered.length}`;
}

function setEvaluationEnabled(enabled) {
  el.evaluationStatus.disabled = !enabled;
  el.score.disabled = !enabled;
  el.note.disabled = !enabled;
}

function loadEvaluation(file) {
  const value = state.evaluations[file.id] || {};
  el.evaluationStatus.value = value.status || '未確認';
  el.score.value = value.score || '';
  el.note.value = value.note || '';
  setEvaluationEnabled(true);
  el.saveState.textContent = '自動保存';
}

async function selectFile(id) {
  if (state.currentId === id && !el.preview.classList.contains('hidden')) return;
  clearTimeout(state.pollTimer);
  state.currentId = id;
  const file = currentFile();
  if (!file) return;
  renderList();
  document.querySelector(`.file-item[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  el.currentName.textContent = file.relativePath;
  el.openOriginal.disabled = false;
  loadEvaluation(file);
  showPreparing(file);

  const index = state.files.findIndex((item) => item.id === id);
  const ids = state.files.slice(index, index + 4).map((item) => item.id);
  api('/api/prepare', { method: 'POST', body: JSON.stringify({ ids }) }).catch(() => {});
  await waitForPreview(file);
}

function showPreparing(file) {
  el.preview.style.display = 'none';
  el.preview.removeAttribute('src');
  el.placeholder.classList.add('hidden');
  el.previewError.classList.add('hidden');
  el.loading.classList.remove('hidden');
  el.loadingMessage.textContent = IMAGE_EXTENSIONS.has(file.ext)
    ? '画像を読み込んでいます'
    : file.ext === '.pdf'
      ? 'PDFを読み込んでいます'
      : `${file.ext.startsWith('.doc') ? 'Word' : 'PowerPoint'}をPDFに変換中です`;
}

async function waitForPreview(file) {
  if (state.currentId !== file.id) return;
  try {
    const response = await fetch(`/api/preview/${file.id}`, { cache: 'no-store' });
    if (state.currentId !== file.id) return;
    if (response.status === 200) {
      await refreshStatus();
      el.loading.classList.add('hidden');
      el.previewError.classList.add('hidden');
      el.preview.src = IMAGE_EXTENSIONS.has(file.ext)
        ? `/api/preview/${file.id}`
        : `/api/preview/${file.id}#view=FitH`;
      el.preview.style.display = 'block';
      return;
    }
    const value = await response.json();
    if (response.status >= 400) throw new Error(value.error || 'プレビューを作成できませんでした。');
    await refreshStatus();
    state.pollTimer = setTimeout(() => waitForPreview(file), 700);
  } catch (error) {
    el.loading.classList.add('hidden');
    el.previewError.textContent = `表示できませんでした。元ファイルを開いて確認してください。\n${error.message}`;
    el.previewError.classList.remove('hidden');
  }
}

async function refreshStatus() {
  const value = await api('/api/status');
  const map = new Map(value.files.map((file) => [file.id, file]));
  state.files = state.files.map((file) => map.get(file.id) || file);
  updateListStatuses();
  renderProgress();
}

function startProgressPolling() {
  clearTimeout(state.progressTimer);
  const poll = async () => {
    try {
      await refreshStatus();
      const pending = state.files.some((file) => ['waiting', 'queued', 'converting'].includes(file.status));
      if (pending) state.progressTimer = setTimeout(poll, 800);
    } catch {
      state.progressTimer = setTimeout(poll, 1600);
    }
  };
  poll();
}

async function loadFolder() {
  const folder = el.folderPath.value.trim();
  if (!folder) return showToast('フォルダを選択してください。');
  el.loadFolder.disabled = true;
  el.loadFolder.textContent = '読み込み中…';
  clearTimeout(state.progressTimer);
  try {
    const result = await api('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ folder, recursive: el.recursive.checked })
    });
    state.files = result.files;
    state.evaluations = {};
    for (const file of state.files) {
      state.evaluations[file.id] = file.evaluation || {};
    }
    state.currentId = null;
    el.folderPath.value = result.folder;
    el.currentName.textContent = '提出物を選択してください';
    el.preview.style.display = 'none';
    el.placeholder.classList.remove('hidden');
    el.loading.classList.add('hidden');
    el.previewError.classList.add('hidden');
    setEvaluationEnabled(false);
    renderList();
    renderProgress();
    startProgressPolling();
    const unsupportedCount = state.files.filter((file) => file.status === 'unsupported').length;
    if (unsupportedCount) {
      showToast(`未対応形式が${unsupportedCount}件あります。紫の印のファイルも必ず確認してください。`);
    }
    if (state.files.length) await selectFile(state.files[0].id);
    else showToast('対応するファイルが見つかりませんでした。');
  } catch (error) {
    showToast(error.message);
  } finally {
    el.loadFolder.disabled = false;
    el.loadFolder.textContent = '読み込む';
  }
}

function move(delta) {
  const index = currentIndex();
  const target = state.filtered[index + delta];
  if (target) selectFile(target.id);
}

function scheduleSave() {
  const file = currentFile();
  if (!file) return;
  el.saveState.textContent = '保存中…';
  clearTimeout(state.saveTimer);
  const id = file.id;
  const value = {
    status: el.evaluationStatus.value,
    score: el.score.value,
    note: el.note.value
  };
  state.evaluations[id] = value;
  state.saveTimer = setTimeout(async () => {
    try {
      await api(`/api/evaluations/${id}`, { method: 'PUT', body: JSON.stringify(value) });
      if (state.currentId === id) el.saveState.textContent = '保存済み';
    } catch (error) {
      el.saveState.textContent = '保存失敗';
      showToast(error.message);
    }
  }, 450);
}

el.chooseFolder.addEventListener('click', async () => {
  el.chooseFolder.disabled = true;
  const originalLabel = el.chooseFolder.textContent;
  el.chooseFolder.textContent = '選択画面を開いています…';
  showToast('フォルダ選択画面を開いています。表示されない場合は、この画面の後ろも確認してください。');
  try {
    const value = window.desktopApi
      ? { path: await window.desktopApi.chooseFolder() }
      : await api('/api/choose-folder', { method: 'POST', body: '{}' });
    if (value.path) {
      el.folderPath.value = value.path;
      await loadFolder();
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    el.chooseFolder.disabled = false;
    el.chooseFolder.textContent = originalLabel;
  }
});

el.loadFolder.addEventListener('click', loadFolder);
el.folderPath.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadFolder(); });
el.search.addEventListener('input', renderList);
el.listView.addEventListener('click', () => { setGalleryMode(false); setViewMode('list'); });
el.thumbnailView.addEventListener('click', () => { setGalleryMode(false); setViewMode('thumbnail'); });
el.galleryMode.addEventListener('click', () => setGalleryMode(!state.galleryMode));
el.fileSplitter.addEventListener('pointerdown', (event) => {
  if (state.galleryMode) return;
  event.preventDefault();
  el.fileSplitter.setPointerCapture(event.pointerId);
  el.workspace.classList.add('resizing');
});
el.fileSplitter.addEventListener('pointermove', (event) => {
  if (!el.fileSplitter.hasPointerCapture(event.pointerId)) return;
  const bounds = el.workspace.getBoundingClientRect();
  applyPanelWidth(event.clientX - bounds.left);
});
el.fileSplitter.addEventListener('pointerup', (event) => {
  if (!el.fileSplitter.hasPointerCapture(event.pointerId)) return;
  el.fileSplitter.releasePointerCapture(event.pointerId);
  el.workspace.classList.remove('resizing');
  savePanelWidth();
});
el.fileSplitter.addEventListener('dblclick', () => {
  state.panelWidths[state.viewMode] = defaultPanelWidth();
  applyPanelWidth();
  savePanelWidth();
});
el.fileSplitter.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home'
    ? defaultPanelWidth()
    : state.panelWidths[state.viewMode] + (event.key === 'ArrowRight' ? 20 : -20);
  applyPanelWidth(next);
  savePanelWidth();
});
window.addEventListener('resize', () => applyPanelWidth());
el.previous.addEventListener('click', () => move(-1));
el.next.addEventListener('click', () => move(1));
el.openOriginal.addEventListener('click', async () => {
  const file = currentFile();
  if (!file) return;
  try { await api(`/api/open/${file.id}`, { method: 'POST', body: '{}' }); }
  catch (error) { showToast(error.message); }
});

[el.evaluationStatus, el.score, el.note].forEach((input) => input.addEventListener('input', scheduleSave));

document.addEventListener('keydown', (event) => {
  if (!event.altKey) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
});

async function restoreOpenFolder() {
  try {
    const result = await api('/api/status');
    if (!result.folder || !result.files.length) return;
    el.folderPath.value = result.folder;
    state.files = result.files;
    state.evaluations = {};
    for (const file of state.files) state.evaluations[file.id] = file.evaluation || {};
    renderList();
    renderProgress();
    startProgressPolling();
    await selectFile(state.files[0].id);
  } catch {
    // The screen can still be used by selecting a folder manually.
  }
}

setViewMode(state.viewMode);
restoreOpenFolder();
