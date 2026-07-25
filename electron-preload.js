'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', Object.freeze({
  chooseFolder: () => ipcRenderer.invoke('desktop:choose-folder')
}));
