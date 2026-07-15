'use strict';

const state = {
  files: [],
  filtered: [],
  currentId: null,
  evaluations: {},
  pollTimer: null,
  saveTimer: null
};

const el = Object.fromEntries([
  'chooseFolder', 'folderPath', 'recursive', 'loadFolder', 'fileCount', 'search',
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
  el.fileCount.textContent = `提出物 ${state.filtered.length}件`;
  if (!state.filtered.length) {
    el.fileList.innerHTML = '<div class="empty-list">該当する提出物がありません</div>';
    updateNavigation();
    return;
  }
  el.fileList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const file of state.filtered) {
    const button = document.createElement('button');
    button.className = `file-item${file.id === state.currentId ? ' active' : ''}`;
    button.dataset.id = file.id;
    const type = file.ext.slice(1).toUpperCase();
    button.innerHTML = `
      <span class="file-type ${file.ext.slice(1)}">${type}</span>
      <span class="file-meta">
        <strong class="file-name"></strong>
        <span class="file-path"></span>
      </span>
      <span class="status-dot ${file.status}" title="${statusLabel(file.status)}"></span>`;
    button.querySelector('.file-name').textContent = file.name;
    button.querySelector('.file-path').textContent = file.relativePath;
    button.addEventListener('click', () => selectFile(file.id));
    fragment.appendChild(button);
  }
  el.fileList.appendChild(fragment);
  updateNavigation();
}

function statusLabel(status) {
  return {
    ready: '表示準備済み', waiting: '未変換', queued: '変換待ち',
    converting: '変換中', error: '変換エラー'
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
  el.loadingMessage.textContent = file.ext === '.pdf'
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
      el.preview.src = `/api/preview/${file.id}#view=FitH`;
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
  renderList();
}

async function loadFolder() {
  const folder = el.folderPath.value.trim();
  if (!folder) return showToast('フォルダを選択してください。');
  el.loadFolder.disabled = true;
  el.loadFolder.textContent = '読み込み中…';
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
  try {
    const value = await api('/api/choose-folder', { method: 'POST', body: '{}' });
    if (value.path) el.folderPath.value = value.path;
  } catch (error) {
    showToast(error.message);
  } finally {
    el.chooseFolder.disabled = false;
  }
});

el.loadFolder.addEventListener('click', loadFolder);
el.folderPath.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadFolder(); });
el.search.addEventListener('input', renderList);
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
    await selectFile(state.files[0].id);
  } catch {
    // The screen can still be used by selecting a folder manually.
  }
}

restoreOpenFolder();
