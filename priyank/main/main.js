const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fsSync = require('fs');
const ModuleManager = require('./modules/ModuleManager');
const OnlineService = require('./services/OnlineService');
const OfflineService = require('./services/OfflineService');
const SyncService = require('./services/SyncService');
const WebServerService = require('./services/WebServerService');
const { createDbClient } = require('./db/sqliteWasm');

// Disable Chromium cache to avoid permission issues on Windows
app.commandLine.appendSwitch('--disable-cache');
app.commandLine.appendSwitch('--disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('--disable-background-timer-throttling');

let mainWindow = null;
let moduleManager = null;
let onlineService = null;
let offlineService = null;
let syncService = null;
let webServerService = null;

const DATA_DIR = path.join(app.getPath('userData'), 'data');
// Use the renderer folder's sakila.db file as the single SQLite store
const DB_PATH = path.join(__dirname, '..', 'renderer', 'sakila.db');

// Ensure DB file exists (touch) so services can open it
try {
  const dbDir = path.dirname(DB_PATH);
  if (!fsSync.existsSync(dbDir)) fsSync.mkdirSync(dbDir, { recursive: true });
  if (!fsSync.existsSync(DB_PATH)) {
    // create empty file; better-sqlite3 will initialize the DB
    fsSync.writeFileSync(DB_PATH, '');
  }
} catch (e) {
  console.warn('Could not ensure sakila.db exists:', e?.message || e);
}

// Ensure data directory exists
if (!fsSync.existsSync(DATA_DIR)) {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  // Initialize sql.js backed DB client and services
  const dbClient = await createDbClient(DB_PATH);

  // Pass dbClient into services that need storage access
  moduleManager = new ModuleManager(dbClient);
  onlineService = new OnlineService();
  offlineService = new OfflineService(dbClient);
  syncService = new SyncService(onlineService, offlineService);
  webServerService = new WebServerService(moduleManager, onlineService, offlineService, syncService);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Module Management
ipcMain.handle('get-modules', () => {
  return moduleManager.getAllModules();
});

ipcMain.handle('create-module', (event, moduleData) => {
  return moduleManager.createModule(moduleData);
});

ipcMain.handle('update-module', (event, moduleId, moduleData) => {
  return moduleManager.updateModule(moduleId, moduleData);
});

ipcMain.handle('delete-module', (event, moduleId) => {
  return moduleManager.deleteModule(moduleId);
});

ipcMain.handle('get-module', (event, moduleId) => {
  return moduleManager.getModule(moduleId);
});

// Online Operations
ipcMain.handle('fetch-api-metadata', (event, apiUrl, headers) => {
  return onlineService.fetchMetadata(apiUrl, headers);
});

ipcMain.handle('online-fetch-data', async (event, moduleId) => {
  const module = await moduleManager.getModule(moduleId);
  return onlineService.fetchData(module);
});

// Paginated fetch for online data (fetch all then slice as a fallback)
ipcMain.handle('online-fetch-records', async (event, moduleId, offset = 0, limit = 100) => {
  const module = await moduleManager.getModule(moduleId);
  const result = await onlineService.fetchData(module);
  if (!result?.success) return result;
  const all = result.data || [];
  const total = all.length;
  const page = all.slice(offset, offset + limit);
  return { success: true, data: page, total };
});

ipcMain.handle('online-create-record', async (event, moduleId, data) => {
  const module = await moduleManager.getModule(moduleId);
  return onlineService.createRecord(module, data);
});

ipcMain.handle('online-update-record', async (event, moduleId, recordId, data) => {
  const module = await moduleManager.getModule(moduleId);
  return onlineService.updateRecord(module, recordId, data);
});

ipcMain.handle('online-delete-record', async (event, moduleId, recordId) => {
  const module = await moduleManager.getModule(moduleId);
  return onlineService.deleteRecord(module, recordId);
});

// Offline Operations
ipcMain.handle('offline-fetch-data', async (event, moduleId) => {
  const module = await moduleManager.getModule(moduleId);
  return offlineService.fetchData(module);
});

// Paginated fetch for offline data
ipcMain.handle('offline-fetch-records', async (event, moduleId, offset = 0, limit = 100) => {
  const module = await moduleManager.getModule(moduleId);
  return offlineService.fetchRecords(module, offset, limit);
});

ipcMain.handle('offline-create-record', async (event, moduleId, data) => {
  const module = await moduleManager.getModule(moduleId);
  return offlineService.createRecord(module, data);
});

ipcMain.handle('offline-update-record', async (event, moduleId, recordId, data) => {
  const module = await moduleManager.getModule(moduleId);
  return offlineService.updateRecord(module, recordId, data);
});

ipcMain.handle('offline-delete-record', async (event, moduleId, recordId) => {
  const module = await moduleManager.getModule(moduleId);
  return offlineService.deleteRecord(module, recordId);
});

ipcMain.handle('offline-add-field', async (event, moduleId, fieldName, fieldType) => {
  const module = await moduleManager.getModule(moduleId);
  const result = await offlineService.addField(module, fieldName, fieldType);
  // Persist updated module config back to storage
  if (result?.success) {
    try {
      await moduleManager.updateModule(moduleId, module);
    } catch (err) {
      console.error('Failed to persist module after addField:', err);
      return { success: true, field: result.field, warning: 'Field added but failed to persist module config' };
    }
  }

  return result;
});

// Sync Operations
ipcMain.handle('get-sync-mappings', (event, sourceModuleId, targetModuleId) => {
  return syncService.detectMappings(sourceModuleId, targetModuleId, moduleManager);
});

ipcMain.handle('save-sync-config', (event, syncConfig) => {
  return syncService.saveSyncConfig(syncConfig);
});

ipcMain.handle('get-sync-configs', () => {
  return syncService.getSyncConfigs();
});

ipcMain.handle('execute-sync', (event, syncConfigId) => {
  return syncService.executeSync(syncConfigId, moduleManager);
});

ipcMain.handle('get-sync-status', (event, syncConfigId) => {
  return syncService.getSyncStatus(syncConfigId);
});

// Utility
ipcMain.handle('get-data-dir', () => {
  return DATA_DIR;
});

// Web Server Operations
ipcMain.handle('start-web-server', (event, displayAddress) => {
  // Allow optional displayAddress (selected by user) which will be used for URL/QR generation
  if (displayAddress && typeof webServerService.setDisplayAddress === 'function') {
    webServerService.setDisplayAddress(displayAddress);
  } else if (displayAddress) {
    // fallback assignment
    webServerService.displayAddress = displayAddress;
  }
  return webServerService.startServer();
});

ipcMain.handle('set-web-server-tls', (event, tlsOptions) => {
  try {
    if (!webServerService) return { success: false, error: 'WebServerService not initialized' };
    const result = webServerService.setTLSOptions(tlsOptions || {});
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('regenerate-web-server-tls', async () => {
  try {
    if (!webServerService) return { success: false, error: 'WebServerService not initialized' };
    const result = await webServerService.regenerateTLS();
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-web-server', () => {
  return webServerService.stopServer();
});

ipcMain.handle('get-server-status', () => {
  return webServerService.getServerStatus();
});

// Regenerate server info (URL/QR) using a selected display address without restarting
ipcMain.handle('regenerate-server-info', async (event, displayAddress) => {
  try {
    if (displayAddress && typeof webServerService.setDisplayAddress === 'function') {
      webServerService.setDisplayAddress(displayAddress);
    } else if (displayAddress) {
      webServerService.displayAddress = displayAddress;
    }
    const status = await webServerService.getServerStatus();
    return status;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-ca-cert', () => {
  try {
    const caCertPath = path.join(DATA_DIR, 'ca-cert.pem');
    if (fsSync.existsSync(caCertPath)) {
      const cert = fsSync.readFileSync(caCertPath, 'utf-8');
      return { success: true, cert };
    } else {
      return { success: false, error: 'CA certificate not found' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-local-ips', () => {
  try {
    if (!webServerService) return { success: false, error: 'Service not ready' };
    return { success: true, ips: webServerService.getLocalIPAddresses() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  } catch (err) {
    return { canceled: true, error: err.message };
  }
});
