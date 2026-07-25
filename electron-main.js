'use strict';

const path = require('path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');

process.env.PORT = '0';
const { startServer, stopServer } = require('./server');

let mainWindow = null;
let serverUrl = '';

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createWindow() {
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
    properties: ['openDirectory']
  });
  return result.canceled ? '' : result.filePaths[0];
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
