'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');

process.env.PORT = '0';
const { startServer, stopServer } = require('./server');

let mainWindow = null;
let serverUrl = '';
let lastSubmissionFolder = '';

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadLastSubmissionFolder() {
  try {
    const settings = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
    if (typeof settings.lastSubmissionFolder === 'string' && fs.existsSync(settings.lastSubmissionFolder)) {
      lastSubmissionFolder = settings.lastSubmissionFolder;
    }
  } catch {
    // 初回起動時や設定ファイルが壊れている場合は、既定のダウンロードフォルダを使う。
  }
}

function saveLastSubmissionFolder(folderPath) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify({ lastSubmissionFolder: folderPath }), 'utf8');
  } catch {
    // 設定を保存できなくても、今回起動中のフォルダ選択は継続する。
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createWindow() {
  loadLastSubmissionFolder();
  const started = await startServer();
  serverUrl = started.url;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    show: false,
    title: '提出物連続確認ツール',
    icon: path.join(__dirname, 'assets', 'submission-viewer.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(serverUrl);
}

ipcMain.handle('desktop:choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '提出物フォルダを選択',
    buttonLabel: 'このフォルダを選択',
    defaultPath: lastSubmissionFolder || app.getPath('downloads'),
    properties: ['openDirectory']
  });
  if (result.canceled) return '';

  lastSubmissionFolder = result.filePaths[0];
  saveLastSubmissionFolder(lastSubmissionFolder);
  return lastSubmissionFolder;
});

app.on('second-instance', focusMainWindow);

app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox('起動できませんでした', error.message || String(error));
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => app.quit());
  else focusMainWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (serverUrl) stopServer().catch(() => {});
});
