const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Module Management
  getModules: () => ipcRenderer.invoke('get-modules'),
  createModule: (moduleData) => ipcRenderer.invoke('create-module', moduleData),
  updateModule: (moduleId, moduleData) => ipcRenderer.invoke('update-module', moduleId, moduleData),
  deleteModule: (moduleId) => ipcRenderer.invoke('delete-module', moduleId),
  getModule: (moduleId) => ipcRenderer.invoke('get-module', moduleId),

  // Online Operations
  fetchApiMetadata: (apiUrl, headers) => ipcRenderer.invoke('fetch-api-metadata', apiUrl, headers),
  onlineFetchData: (moduleId) => ipcRenderer.invoke('online-fetch-data', moduleId),
  onlineFetchRecords: (moduleId, offset, limit) => ipcRenderer.invoke('online-fetch-records', moduleId, offset, limit),
  onlineCreateRecord: (moduleId, data) => ipcRenderer.invoke('online-create-record', moduleId, data),
  onlineUpdateRecord: (moduleId, recordId, data) => ipcRenderer.invoke('online-update-record', moduleId, recordId, data),
  onlineDeleteRecord: (moduleId, recordId) => ipcRenderer.invoke('online-delete-record', moduleId, recordId),

  // Offline Operations
  offlineFetchData: (moduleId) => ipcRenderer.invoke('offline-fetch-data', moduleId),
  offlineFetchRecords: (moduleId, offset, limit) => ipcRenderer.invoke('offline-fetch-records', moduleId, offset, limit),
  offlineCreateRecord: (moduleId, data) => ipcRenderer.invoke('offline-create-record', moduleId, data),
  offlineUpdateRecord: (moduleId, recordId, data) => ipcRenderer.invoke('offline-update-record', moduleId, recordId, data),
  offlineDeleteRecord: (moduleId, recordId) => ipcRenderer.invoke('offline-delete-record', moduleId, recordId),
  offlineAddField: (moduleId, fieldName, fieldType) => ipcRenderer.invoke('offline-add-field', moduleId, fieldName, fieldType),

  // Sync Operations
  getSyncMappings: (sourceModuleId, targetModuleId) => ipcRenderer.invoke('get-sync-mappings', sourceModuleId, targetModuleId),
  saveSyncConfig: (syncConfig) => ipcRenderer.invoke('save-sync-config', syncConfig),
  getSyncConfigs: () => ipcRenderer.invoke('get-sync-configs'),
  executeSync: (syncConfigId) => ipcRenderer.invoke('execute-sync', syncConfigId),
  getSyncStatus: (syncConfigId) => ipcRenderer.invoke('get-sync-status', syncConfigId),

  // Web Server Operations
  startWebServer: (displayAddress) => ipcRenderer.invoke('start-web-server', displayAddress),
  stopWebServer: () => ipcRenderer.invoke('stop-web-server'),
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  getLocalIPs: () => ipcRenderer.invoke('get-local-ips'),
  regenerateServerInfo: (displayAddress) => ipcRenderer.invoke('regenerate-server-info', displayAddress),
  setWebServerTLS: (tlsOptions) => ipcRenderer.invoke('set-web-server-tls', tlsOptions),
  regenerateWebServerTLS: () => ipcRenderer.invoke('regenerate-web-server-tls'),
  getCACert: () => ipcRenderer.invoke('get-ca-cert'),

  // Utility
  getDataDir: () => ipcRenderer.invoke('get-data-dir'),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options)
});
