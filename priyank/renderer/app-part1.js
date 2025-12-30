// API Wrapper - Access preload API safely
const API = window.API || {
  isElectron: () => false,
  getModules: () => Promise.resolve([]),
  createModule: () => Promise.reject(new Error("API not available")),
  updateModule: () => Promise.reject(new Error("API not available")),
  deleteModule: () => Promise.reject(new Error("API not available")),
  onlineFetchRecords: () => Promise.reject(new Error("API not available")),
  offlineFetchRecords: () => Promise.reject(new Error("API not available")),
  onlineCreateRecord: () => Promise.reject(new Error("API not available")),
  offlineCreateRecord: () => Promise.reject(new Error("API not available")),
  onlineUpdateRecord: () => Promise.reject(new Error("API not available")),
  offlineUpdateRecord: () => Promise.reject(new Error("API not available")),
  onlineDeleteRecord: () => Promise.reject(new Error("API not available")),
  offlineDeleteRecord: () => Promise.reject(new Error("API not available")),
  fetchApiMetadata: () => Promise.reject(new Error("API not available")),
  offlineAddField: () => Promise.reject(new Error("API not available")),
  startWebServer: () => Promise.reject(new Error("API not available")),
  stopWebServer: () => Promise.reject(new Error("API not available")),
  getServerStatus: () => Promise.resolve({ success: true, isRunning: false }),
  getSyncConfigs: () => Promise.resolve({ success: true, configs: [] }),
  saveSyncConfig: () => Promise.reject(new Error("API not available")),
  executeSync: () => Promise.reject(new Error("API not available")),
  getSyncMappings: () => Promise.reject(new Error("API not available")),
  getLocalIPs: () => Promise.resolve({ success: true, ips: [] }),
  setWebServerTLS: () => Promise.reject(new Error("API not available")),
  regenerateWebServerTLS: () => Promise.reject(new Error("API not available")),
  showOpenDialog: () => Promise.reject(new Error("API not available")),
  getCACert: () => Promise.reject(new Error("API not available"))
};

// State Management
let currentModule = null;
let currentRecord = null;
let modules = [];
let fetchedMetadata = null;
let serverRunning = false;
let currentPage = 0;
let pageSize = 50;
let totalRecords = 0;

// Initialize App
document.addEventListener("DOMContentLoaded", async () => {
  await loadModules();
  initializeEventListeners();
  relocateModalsToBody();
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Esc") {
      const active = document.querySelector(".modal.active");
      if (active) closeModal(active);
    }
  });
  
  await checkServerStatus();
  updateUIForEnvironment();
  initDevSettings();
});

function relocateModalsToBody() {
  try {
    const modals = Array.from(document.querySelectorAll(".modal"));
    modals.forEach(m => {
      if (m.parentElement !== document.body) {
        document.body.appendChild(m);
      }
    });
  } catch (e) {
    console.warn("relocateModalsToBody failed:", e);
  }
}

function openModal(modal) {
  if (!modal) return;
  try {
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
  } catch (e) {
    console.warn("openModal failed:", e);
  }
}

function closeModal(modal) {
  if (!modal) return;
  try {
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
  } catch (e) {
    console.warn("closeModal failed:", e);
  }
}

function updateUIForEnvironment() {
  try {
    const isElectron = API?.isElectron?.();
    const serverBtn = document.getElementById("btn-start-server");
    if (!isElectron && serverBtn) {
      serverBtn.style.display = "none";
    }
  } catch (e) {
    // Ignore
  }
}

// Continue with rest of functions...
function initializeEventListeners() {
  const safe = (id) => document.getElementById(id);
  
  safe("btn-new-module")?.addEventListener("click", () => openModuleModal(false));
  safe("btn-cancel-module")?.addEventListener("click", closeModuleModal);
  safe("btn-save-module")?.addEventListener("click", saveModule);
  safe("module-mode")?.addEventListener("change", toggleModeConfig);
  safe("btn-fetch-metadata")?.addEventListener("click", fetchMetadata);
  safe("btn-settings")?.addEventListener("click", openSettingsModal);
  safe("settings-close")?.addEventListener("click", closeSettingsModal);
  safe("settings-close-btn")?.addEventListener("click", closeSettingsModal);
  safe("btn-add-record")?.addEventListener("click", () => openRecordModal());
  safe("btn-cancel-record")?.addEventListener("click", closeRecordModal);
  safe("btn-save-record")?.addEventListener("click", saveRecord);
  safe("btn-refresh")?.addEventListener("click", refreshCurrentModule);
  safe("btn-delete-module")?.addEventListener("click", deleteCurrentModule);
  safe("btn-add-field")?.addEventListener("click", openAddFieldModal);
  safe("btn-sync-manager")?.addEventListener("click", openSyncModal);
  safe("btn-close-sync")?.addEventListener("click", closeSyncModal);
  safe("btn-save-sync")?.addEventListener("click", saveSyncConfig);
  safe("btn-detect-mappings")?.addEventListener("click", detectMappings);
  safe("btn-cancel-field")?.addEventListener("click", closeAddFieldModal);
  safe("btn-save-field")?.addEventListener("click", saveCustomField);
  safe("btn-start-server")?.addEventListener("click", startWebServer);
  safe("btn-stop-server")?.addEventListener("click", stopWebServer);
  safe("btn-close-server-modal")?.addEventListener("click", closeServerModal);
  safe("btn-copy-url")?.addEventListener("click", copyServerUrl);
  
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const tabName = e.target.getAttribute("data-tab");
      switchTab(tabName);
    });
  });
  
  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });
  
  document.querySelectorAll(".close").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const modal = e.currentTarget.closest(".modal");
      if (modal) closeModal(modal);
    });
  });
  
  safe("nav-home")?.addEventListener("click", () => {
    document.getElementById("welcome-screen")?.scrollIntoView({ behavior: "smooth" });
  });
  
  safe("nav-settings")?.addEventListener("click", openSettingsModal);
}
