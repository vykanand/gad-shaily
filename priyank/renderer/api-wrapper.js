// API Wrapper - Works in both Electron and Web Browser
const API = (() => {
  const isElectron = window.electronAPI !== undefined;
  const baseURL = isElectron ? '' : '';

  // Helper function for web API calls
  async function fetchAPI(endpoint, options = {}) {
    const response = await fetch(baseURL + endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    return await response.json();
  }

  return {
    // Module Management
    getModules: async () => {
      if (isElectron) return await window.electronAPI.getModules();
      const result = await fetchAPI('/api/modules');
      return result.modules || [];
    },

    createModule: async (moduleData) => {
      if (isElectron) return await window.electronAPI.createModule(moduleData);
      const result = await fetchAPI('/api/modules', {
        method: 'POST',
        body: JSON.stringify(moduleData)
      });
      return result.module;
    },

    updateModule: async (moduleId, moduleData) => {
      if (isElectron) return await window.electronAPI.updateModule(moduleId, moduleData);
      const result = await fetchAPI(`/api/modules/${moduleId}`, {
        method: 'PUT',
        body: JSON.stringify(moduleData)
      });
      return result.module;
    },

    deleteModule: async (moduleId) => {
      if (isElectron) return await window.electronAPI.deleteModule(moduleId);
      return await fetchAPI(`/api/modules/${moduleId}`, {
        method: 'DELETE'
      });
    },

    getModule: async (moduleId) => {
      if (isElectron) return await window.electronAPI.getModule(moduleId);
      const result = await fetchAPI(`/api/modules/${moduleId}`);
      return result.module;
    },

    // Online Operations
    fetchApiMetadata: async (apiUrl, headers) => {
      if (isElectron) return await window.electronAPI.fetchApiMetadata(apiUrl, headers);
      return await fetchAPI('/api/online/metadata', {
        method: 'POST',
        body: JSON.stringify({ apiUrl, headers })
      });
    },

    onlineFetchData: async (moduleId) => {
      if (isElectron) return await window.electronAPI.onlineFetchData(moduleId);
      return await fetchAPI(`/api/online/${moduleId}/data`);
    },

    // Paginated online fetch
    onlineFetchRecords: async (moduleId, offset = 0, limit = 100) => {
      if (isElectron) {
        try {
          if (window.electronAPI && typeof window.electronAPI.onlineFetchRecords === 'function') {
            return await window.electronAPI.onlineFetchRecords(moduleId, offset, limit);
          }
        } catch (err) {
          console.warn('onlineFetchRecords IPC not available, falling back:', err && err.message);
        }
        // Fallback to non-paginated online fetch
        return await (window.electronAPI && typeof window.electronAPI.onlineFetchData === 'function'
          ? window.electronAPI.onlineFetchData(moduleId)
          : fetchAPI(`/api/online/${moduleId}/data`));
      }
      return await fetchAPI(`/api/online/${moduleId}/records?offset=${offset}&limit=${limit}`);
    },

    onlineCreateRecord: async (moduleId, data) => {
      if (isElectron) return await window.electronAPI.onlineCreateRecord(moduleId, data);
      return await fetchAPI(`/api/online/${moduleId}/data`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    onlineUpdateRecord: async (moduleId, recordId, data) => {
      if (isElectron) return await window.electronAPI.onlineUpdateRecord(moduleId, recordId, data);
      return await fetchAPI(`/api/online/${moduleId}/data/${recordId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    onlineDeleteRecord: async (moduleId, recordId) => {
      if (isElectron) return await window.electronAPI.onlineDeleteRecord(moduleId, recordId);
      return await fetchAPI(`/api/online/${moduleId}/data/${recordId}`, {
        method: 'DELETE'
      });
    },

    // Offline Operations
    offlineFetchData: async (moduleId) => {
      if (isElectron) return await window.electronAPI.offlineFetchData(moduleId);
      return await fetchAPI(`/api/offline/${moduleId}/data`);
    },

    // Paginated offline fetch
    offlineFetchRecords: async (moduleId, offset = 0, limit = 100) => {
      if (isElectron) {
        try {
          if (window.electronAPI && typeof window.electronAPI.offlineFetchRecords === 'function') {
            return await window.electronAPI.offlineFetchRecords(moduleId, offset, limit);
          }
        } catch (err) {
          console.warn('offlineFetchRecords IPC not available, falling back:', err && err.message);
        }
        // Fallback to non-paginated offline fetch
        return await (window.electronAPI && typeof window.electronAPI.offlineFetchData === 'function'
          ? window.electronAPI.offlineFetchData(moduleId)
          : fetchAPI(`/api/offline/${moduleId}/data`));
      }
      return await fetchAPI(`/api/offline/${moduleId}/records?offset=${offset}&limit=${limit}`);
    },

    offlineCreateRecord: async (moduleId, data) => {
      if (isElectron) return await window.electronAPI.offlineCreateRecord(moduleId, data);
      return await fetchAPI(`/api/offline/${moduleId}/data`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    offlineUpdateRecord: async (moduleId, recordId, data) => {
      if (isElectron) return await window.electronAPI.offlineUpdateRecord(moduleId, recordId, data);
      return await fetchAPI(`/api/offline/${moduleId}/data/${recordId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    offlineDeleteRecord: async (moduleId, recordId) => {
      if (isElectron) return await window.electronAPI.offlineDeleteRecord(moduleId, recordId);
      return await fetchAPI(`/api/offline/${moduleId}/data/${recordId}`, {
        method: 'DELETE'
      });
    },

    offlineAddField: async (moduleId, fieldName, fieldType) => {
      if (isElectron) return await window.electronAPI.offlineAddField(moduleId, fieldName, fieldType);
      return await fetchAPI(`/api/offline/${moduleId}/field`, {
        method: 'POST',
        body: JSON.stringify({ fieldName, fieldType })
      });
    },

    // Sync Operations
    getSyncMappings: async (sourceModuleId, targetModuleId) => {
      if (isElectron) return await window.electronAPI.getSyncMappings(sourceModuleId, targetModuleId);
      return await fetchAPI(`/api/sync/mappings/${sourceModuleId}/${targetModuleId}`);
    },

    saveSyncConfig: async (syncConfig) => {
      if (isElectron) return await window.electronAPI.saveSyncConfig(syncConfig);
      return await fetchAPI('/api/sync/config', {
        method: 'POST',
        body: JSON.stringify(syncConfig)
      });
    },

    getSyncConfigs: async () => {
      if (isElectron) return await window.electronAPI.getSyncConfigs();
      const result = await fetchAPI('/api/sync/configs');
      return result;
    },

    executeSync: async (syncConfigId) => {
      if (isElectron) return await window.electronAPI.executeSync(syncConfigId);
      return await fetchAPI(`/api/sync/execute/${syncConfigId}`, {
        method: 'POST'
      });
    },

    getSyncStatus: async (syncConfigId) => {
      if (isElectron) return await window.electronAPI.getSyncStatus(syncConfigId);
      return await fetchAPI(`/api/sync/status/${syncConfigId}`);
    },

    // Web Server (Electron only)
    startWebServer: async (displayAddress) => {
      if (isElectron) return await window.electronAPI.startWebServer(displayAddress);
      return { success: false, error: 'Server control only available in desktop app' };
    },

    stopWebServer: async () => {
      if (isElectron) return await window.electronAPI.stopWebServer();
      return { success: false, error: 'Server control only available in desktop app' };
    },

    getServerStatus: async () => {
      if (isElectron) return await window.electronAPI.getServerStatus();
      return { success: false, error: 'Server control only available in desktop app' };
    },

    getLocalIPs: async () => {
      if (isElectron) return await window.electronAPI.getLocalIPs();
      // In web mode, try fetching from REST endpoint
      try {
        const res = await fetch('/api/local-ips');
        return await res.json();
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    regenerateServerInfo: async (displayAddress) => {
      if (isElectron) return await window.electronAPI.regenerateServerInfo(displayAddress);
      // Not available in web mode (server runs on desktop)
      return { success: false, error: 'Regenerate server info only available in desktop app' };
    },

    // TLS management
    setWebServerTLS: async (tlsOptions) => {
      if (isElectron) return await window.electronAPI.setWebServerTLS(tlsOptions);
      return { success: false, error: 'TLS management only available in desktop app' };
    },

    regenerateWebServerTLS: async () => {
      if (isElectron) return await window.electronAPI.regenerateWebServerTLS();
      return { success: false, error: 'TLS regeneration only available in desktop app' };
    },

    getCACert: async () => {
      if (isElectron) return await window.electronAPI.getCACert();
      return { success: false, error: 'CA cert download only available in desktop app' };
    },

    // Utility
    getDataDir: async () => {
      if (isElectron) return await window.electronAPI.getDataDir();
      return '/data';
    },

    showOpenDialog: async (options) => {
      if (isElectron) return await window.electronAPI.showOpenDialog(options);
      return { canceled: true, error: 'File dialog only available in desktop app' };
    },

    isElectron: () => isElectron
  };
})();

// Expose the API globally so app.js can use it
window.API = API;
