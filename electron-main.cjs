const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const nodePath = require('path');

/**
 * electron-main.cjs — Tactical Suite Entry Point
 * Configures "Local Folder Mode" for zero-install portability.
 */

// Force "Next to EXE" Data Storage for 100% USB Portability
// This MUST happen before app.whenReady()
const exeDirPath = nodePath.dirname(app.getPath('exe'));
const portableDataPath = nodePath.join(exeDirPath, 'pinvault_data');

if (!fs.existsSync(portableDataPath)) {
  try {
    fs.mkdirSync(portableDataPath, { recursive: true });
  } catch (err) {
    console.error('Failed to create portable data directory:', err);
  }
}

app.setPath('userData', portableDataPath);
console.log('[PinVault] Portability Active. Data Path:', portableDataPath);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#0a0e1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // Required for physical local tile loading without a server
    },
    title: "PinVault Tactical Suite",
    icon: nodePath.join(__dirname, 'dist', 'icon.png')
  });

  // Load the built app
  win.loadFile(nodePath.join(__dirname, 'dist', 'index.html'));
  
  // DevTools disabled for production (Ctrl+Shift+I emergency hotkey below)
  // win.webContents.openDevTools();
  
  // Log renderer crashes to help with diagnostics
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('RENDERER CRASH:', details);
  });
  
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('LOAD FAILED:', errorCode, errorDescription);
  });

  // Emergency DevTools Hotkey
  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
