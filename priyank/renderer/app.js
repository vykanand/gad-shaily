
// State Management
// State Management
let currentModule = null;
let currentRecord = null;
let modules = [];
let fetchedMetadata = null;
let serverRunning = false;
let currentPage = 0;
let pageSize = 50;
let totalRecords = 0;
let searchQuery = '';

// jsQR is provided as a global UMD script loaded in index.html

// Update TLS status indicator
function updateTLSStatus(enabled, text = null) {
  const tlsStatusEl = document.getElementById('tls-status');
  if (!tlsStatusEl) return;
  const indicator = tlsStatusEl.querySelector('.tls-indicator');
  if (indicator) {
    indicator.className = `tls-indicator ${enabled ? 'tls-indicator-green' : 'tls-indicator-red'}`;
  }
  tlsStatusEl.innerHTML = `<span class="tls-indicator ${enabled ? 'tls-indicator-green' : 'tls-indicator-red'}"></span>${text || (enabled ? 'TLS: enabled' : 'TLS: disabled')}`;
}

// Wait for QrScanner library to load
async function waitForQrScanner() {
  const maxWaitTime = 10000; // 10 seconds
  const checkInterval = 100; // Check every 100ms
  let waited = 0;

  console.log('Waiting for QrScanner library to load...');

  while (waited < maxWaitTime) {
    // Check if script failed to load
    if (window.qrScannerLoadError) {
      console.error('QrScanner script failed to load from CDN');
      return false;
    }

    if (typeof QrScanner !== 'undefined') {
      console.log('QrScanner library loaded after', waited, 'ms');

      // Test that it's working
      try {
        const hasCamera = await QrScanner.hasCamera();
        console.log('Camera availability check:', hasCamera);
        return true;
      } catch (error) {
        console.warn('QrScanner loaded but camera check failed:', error);
        // Still return true as the library is loaded, camera check might fail due to permissions
        return true;
      }
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
    waited += checkInterval;
  }

  console.error('QrScanner library failed to load within', maxWaitTime, 'ms');
  return false;
}
 

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  await loadModules();
  initializeEventListeners();
  relocateModalsToBody();
  // Close active modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      const active = document.querySelector('.modal.active');
      if (active) closeModal(active);
    }
  });
  await checkServerStatus();
  updateUIForEnvironment();
  // Initialize developer settings from localStorage
  initDevSettings();

  // Wait for QrScanner library to load
  await waitForQrScanner();
});

// Helper: return module field definitions (name,label,type)
function getModuleFieldDefs(module) {
  module = module || currentModule;
  if (!module) return [];
  // Prefer metadata.fields (online) if present
  if (module.config && module.config.metadata && Array.isArray(module.config.metadata.fields) && module.config.metadata.fields.length > 0) {
    return module.config.metadata.fields.map(f => ({ name: f.name, label: f.label || f.name, type: f.type || 'string' }));
  }
  // Fallback to config.fields
  if (module.config && Array.isArray(module.config.fields) && module.config.fields.length > 0) {
    return module.config.fields.map(f => ({ name: f.name, label: f.label || f.name, type: f.type || 'string' }));
  }
  return [];
}

function getModuleFieldNames(module) {
  return getModuleFieldDefs(module).map(f => f.name);
}

// Move modal elements to document.body to avoid being clipped by transformed/overflowed ancestors
function relocateModalsToBody() {
  try {
    const modals = Array.from(document.querySelectorAll('.modal'));
    modals.forEach(m => {
      if (m.parentElement !== document.body) {
        console.info('relocateModalsToBody: moving modal', m.id);
        document.body.appendChild(m);
      }
    });
  } catch (e) {
    console.warn('relocateModalsToBody: failed', e);
  }
}

// Unified modal helpers: open/close with safe guards and cleanup
function openModal(modal) {
  if (!modal) return;
  try {
    // Ensure modal is a direct child of body
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    // Remove any temporary inline hiding styles
    modal.style.removeProperty('display');
    modal.style.removeProperty('z-index');
  } catch (e) {
    console.warn('openModal failed', e);
  }
}

function closeModal(modal) {
  if (!modal) return;
  try {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    // Remove diagnostics fallback inline styles if present
    modal.style.removeProperty('display');
    modal.style.removeProperty('z-index');
  } catch (e) {
    console.warn('closeModal failed', e);
  }
}

// Check if running in Electron or Web and adapt UI
function updateUIForEnvironment() {
  try {
    const isElectron = API && API.isElectron && API.isElectron();
    const serverBtn = document.getElementById('btn-start-server');
    if (!isElectron && serverBtn) serverBtn.style.display = 'none';
  } catch (e) {
    // ignore in web context
  }
// Scanner functions (ensure global access)
window.__scannerStream = null;
window.__barcodeDetector = null;
window.__scannerRunning = false;
window.__scannerAnimation = null;
window.__lastScanValue = '';
window.__scannerTargetField = null;

// Debug logging helper
window.scannerLog = function(message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${message}`;
  
  // Console log
  if (level === 'error') {
    console.error(logMessage);
  } else if (level === 'warn') {
    console.warn(logMessage);
  } else {
    console.log(logMessage);
  }
  
  // Screen log
  const debugDiv = document.getElementById('scanner-debug');
  const debugContent = document.getElementById('scanner-debug-content');
  if (debugDiv && debugContent) {
    debugDiv.style.display = 'block';
    const logEntry = document.createElement('div');
    logEntry.style.margin = '2px 0';
    logEntry.style.color = level === 'error' ? '#d32f2f' : level === 'warn' ? '#f57c00' : '#1976d2';
    logEntry.textContent = logMessage;
    debugContent.appendChild(logEntry);
    
    // Auto-scroll to bottom
    debugDiv.scrollTop = debugDiv.scrollHeight;
    
    // Limit log entries to prevent memory issues
    while (debugContent.children.length > 50) {
      debugContent.removeChild(debugContent.firstChild);
    }
  }
};

// jsQR scanner variables
let isResultHidden = true;
const scanAgainBtn = document.querySelector(".scan-again");
const scanResult = document.getElementById("scan-result");
const qrDataType = document.getElementById("qr-data-type");
const scan = document.getElementById("scan");
const video = document.getElementById("vid");
const accessMessage = document.getElementById("accessMessage");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let mediaDevices = navigator.mediaDevices;
let videoConstraints = {
  video: {
    facingMode: isMobileDevice() ? "environment" : "user"
  },
  audio: false
};
let videoStream = null;
let scanTimeout = null;
let frameCounter = 0; // used to throttle verbose frame logs

function initScanner() {
  if (scanAgainBtn) {
    scanAgainBtn.addEventListener("click", () => {
      scanResult.classList.add("d-none");
      scan.classList.remove("height-30", "height-60");
      isResultHidden = true;
      openCameraAndScan();
    });
  }
  // Camera overlay buttons removed: scanner modal uses its native controls.
  // Keep retry button handler (camera error) but point it to start scanner via modal.
  const retryCameraBtnEl = document.getElementById("retryCameraBtn");
  if (retryCameraBtnEl) retryCameraBtnEl.addEventListener("click", () => openScannerModal(window.__scannerTargetField));
  // Overlay/manual detect buttons removed: rely on modal-native controls and programmatic API.
  document.getElementById("use-scanned").addEventListener("click", function() {
    const code = document.getElementById("url-result").innerText;
    try {
      if (window.__scannerTargetField) {
        const possibleIds = [
          window.__scannerTargetField,
          `field-${window.__scannerTargetField}`
        ];
        let applied = false;
        for (const id of possibleIds) {
          const target = document.getElementById(id);
          if (target) {
            if (target.type === 'checkbox') target.checked = !!code; else target.value = code;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.focus();
            applied = true;
            showScanNotification(`Applied scanned value to ${id}`, true, false);
            scannerLog(`Applied scanned value to ${id}`, 'info');
            break;
          }
        }
        if (!applied) {
          scannerLog(`Could not find target input for scanned value: ${window.__scannerTargetField}`, 'warn');
          showScanNotification('Scanned value available — no target input found', true, true);
        }
      } else {
        showScanNotification('Scanned value available — no target field configured', true, true);
      }
    } catch (e) {
      scannerLog('Error applying scanned value via Use Scanned button: ' + (e?.message || e), 'error');
    }
    closeScannerModal();
  });
}

function openCameraAndScan() {
  // Prevent starting another stream if one already exists
  if (videoStream) {
    scannerLog('openCameraAndScan called but stream already active', 'debug');
    return;
  }
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(() => {
    if (isResultHidden) {
      scannerLog('Scan timeout', 'warn');
    }
  }, 20000);
  mediaDevices
    .getUserMedia(videoConstraints)
    .then((stream) => {
      video.srcObject = stream;
      videoStream = stream;
      video.addEventListener("loadedmetadata", () => {
        video.play();
        accessMessage.classList.add("d-none");
        // show debug panel when camera is active
        const debugDiv = document.getElementById('scanner-debug');
        if (debugDiv) { debugDiv.classList.remove('d-none'); debugDiv.classList.add('show'); }
        scannerLog('Camera stream started', 'info');
        requestAnimationFrame(scanQRCode);
      }, { once: true });
    })
    .catch((error) => {
      accessMessage.classList.remove("d-none");
      video.srcObject = null;
      scannerLog('Error accessing camera: ' + (error?.message || error), 'error');
      const cameraError = document.getElementById("cameraError");
      cameraError.classList.remove("d-none");
    });
}

// Run a single-frame detection immediately (manual or programmatic)
// Ensure `jsQR` is available in renderer by dynamically loading vendor script(s) when needed.
window.__jsQRLoaderPromise = null;
function ensureJsQRAvailable(timeout = 4000) {
  if (typeof jsQR !== 'undefined') return Promise.resolve();
  if (window.__jsQRLoaderPromise) return window.__jsQRLoaderPromise;

  window.__jsQRLoaderPromise = new Promise((resolve, reject) => {
    const candidates = [];
    try {
      if (location && location.protocol && location.protocol.startsWith('http')) {
        // Prefer local copies bundled with the app first (works offline and in dev).
        candidates.push(location.origin + '/libs/jsQR.js');
        candidates.push(location.origin + '/libs/jsQR.min.js');
        // root-relative and relative fallbacks
        candidates.push('/libs/jsQR.js');
        candidates.push('libs/jsQR.js');
        candidates.push('./libs/jsQR.js');
        // Finally try the hosted CDN / external copy as a fallback
        candidates.push('https://www.the-qrcode-generator.com/wp-content/themes/tqrcg/js/bundle/jsQR.min.js');
      } else {
        // file:// (Electron) or unknown: try relative to index.html and packaged libs first
        candidates.push('libs/jsQR.js');
        candidates.push('./libs/jsQR.js');
        candidates.push('/libs/jsQR.js');
        // try origin-based paths if available
        try { candidates.push(location.origin + '/libs/jsQR.js'); } catch(e) {}
        // external fallback last
        candidates.push('https://www.the-qrcode-generator.com/wp-content/themes/tqrcg/js/bundle/jsQR.min.js');
      }
    } catch (e) {
      candidates.push('libs/jsQR.js');
    }

    // Determine which candidates are considered 'local' (non-remote)
    const localCandidates = candidates.filter(c => {
      try {
        // treat same-origin or relative paths as local
        return (!c.startsWith('http') || (location && location.origin && c.startsWith(location.origin)));
      } catch (e) {
        return !c.startsWith('http');
      }
    });
    let localFailedCount = 0;
    let loggedLocalFallbackNotice = false;

    let tried = 0;
    function tryNext() {
      if (typeof jsQR !== 'undefined') return resolve();
      if (tried >= candidates.length) {
        // fallback: try fetching file contents and injecting as blob
        const fallbackUrl = candidates[0] || 'libs/jsQR.js';
        scannerLog('Attempting fetch+blob fallback for jsQR from ' + fallbackUrl, 'info');
        fetch(fallbackUrl + (fallbackUrl.indexOf('?') === -1 ? '?v=' + Date.now() : '&v=' + Date.now()))
          .then(res => {
            if (!res.ok) throw new Error('Fetch failed: ' + res.status);
            return res.text();
          })
          .then(text => {
            const blob = new Blob([text], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const script = document.createElement('script');
            script.src = blobUrl;
            script.onload = () => {
              URL.revokeObjectURL(blobUrl);
              if (typeof jsQR !== 'undefined') return resolve();
              if (window.jsQR && typeof window.jsQR.default === 'function') {
                window.jsQR = window.jsQR.default;
                return resolve();
              }
              // Fallback: try CommonJS require (Electron with nodeIntegration)
              try {
                if (typeof require === 'function') {
                  const mod = require('jsqr');
                  if (mod) {
                    window.jsQR = mod.default || mod;
                    scannerLog('Mapped CommonJS require("jsqr") to jsQR global', 'info');
                    return resolve();
                  }
                }
              } catch (e) {
                // ignore
              }
              return reject(new Error('Fetched jsQR but global not set'));
            };
            script.onerror = (e) => {
              URL.revokeObjectURL(blobUrl);
              reject(new Error('Failed to execute fetched jsQR'));
            };
            document.head.appendChild(script);
          })
          .catch(err => {
            window.__jsQRLoaderPromise = null;
            reject(err);
          });
        return;
      }
      const src = candidates[tried++];
      scannerLog('Attempting to load jsQR from ' + src, 'info');
      const script = document.createElement('script');
      script.src = src + (src.indexOf('?') === -1 ? '?v=' + Date.now() : '&v=' + Date.now());
      script.async = true;
      const timer = setTimeout(() => {
        script.onload = null;
        script.onerror = null;
        try { script.remove(); } catch (e) {}
        // if this was a local candidate, mark a local failure
        try {
          if (localCandidates.includes(src)) localFailedCount++;
        } catch (e) {}
        tryNext();
      }, timeout);
      script.onload = () => {
        clearTimeout(timer);
        if (typeof jsQR !== 'undefined') {
          scannerLog('Loaded jsQR from ' + src, 'info');
          return resolve();
        }
        if (window.jsQR && typeof window.jsQR.default === 'function') {
          window.jsQR = window.jsQR.default;
          scannerLog('Mapped jsQR.default to jsQR global', 'info');
          return resolve();
        }
        // Fallback: try CommonJS require (Electron with nodeIntegration)
        try {
          if (typeof require === 'function') {
            const mod = require('jsqr');
            if (mod) {
              window.jsQR = mod.default || mod;
              scannerLog('Mapped CommonJS require("jsqr") to jsQR global', 'info');
              try { script.remove(); } catch (e) {}
              return resolve();
            }
          }
        } catch (e) {
          // ignore
        }
        try { script.remove(); } catch (e) {}
        // If this is a local candidate failure, increment counter
        try {
          if (localCandidates.includes(src)) localFailedCount++;
        } catch (e) {}

        // If all local candidates have been attempted and failed, log that we are moving to external fallbacks
        try {
          if (!loggedLocalFallbackNotice && localCandidates.length > 0 && localFailedCount >= localCandidates.length) {
            scannerLog('All local jsQR candidates failed to load; attempting external fallbacks.', 'warn');
            loggedLocalFallbackNotice = true;
          }
        } catch (e) {}

        tryNext();
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        try { script.remove(); } catch (e) {}
        scannerLog('Failed to load jsQR from ' + src, 'warn');
        try {
          if (localCandidates.includes(src)) localFailedCount++;
        } catch (e) {}
        try {
          if (!loggedLocalFallbackNotice && localCandidates.length > 0 && localFailedCount >= localCandidates.length) {
            scannerLog('All local jsQR candidates failed to load; attempting external fallback(s).', 'warn');
            loggedLocalFallbackNotice = true;
          }
        } catch (e) {}
        tryNext();
      };
      document.head.appendChild(script);
    }
    tryNext();
  });
  return window.__jsQRLoaderPromise;
}

async function detectNow() {
  try {
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      scannerLog('Video not ready for detectNow()', 'warn');
      showScanNotification('Camera not ready for manual detection', true, true);
      return;
    }
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    scannerLog(`Performing single-frame jsQR detection (w:${canvas.width} h:${canvas.height})`, 'info');
    try {
      await ensureJsQRAvailable();
    } catch (e) {
      const msg = 'Failed to load jsQR for manual detection: ' + (e && e.message ? e.message : String(e));
      scannerLog(msg, 'error');
      showScanNotification(msg, true, true);
      return;
    }
    const code = (typeof jsQR !== 'undefined') ? jsQR(imageData.data, canvas.width, canvas.height) : null;
    if (code) {
      scannerLog('Manual detect: QR found: ' + code.data, 'info');
      handleDetectedCode(code);
    } else {
      scannerLog('Manual detect: no QR found in frame', 'warn');
      showScanNotification('No QR code detected in the frame', true, false);
    }
  } catch (err) {
    const msg = 'detectNow error: ' + (err?.message || err);
    scannerLog(msg, 'error');
    showScanNotification(msg, true, true);
  }
}

// Show a temporary notification near the scan area. level: isError flag styles it.
function showScanNotification(text, autoHide = true, isError = false) {
  try {
    const scanContainer = document.getElementById('scan') || document.body;
    let notif = document.getElementById('scan-notification');
    if (!notif) {
      notif = document.createElement('div');
      notif.id = 'scan-notification';
      notif.style.position = 'absolute';
      notif.style.top = '12px';
      notif.style.left = '50%';
      notif.style.transform = 'translateX(-50%)';
      notif.style.zIndex = '1250';
      notif.style.background = isError ? '#b00020' : '#222';
      notif.style.color = '#fff';
      notif.style.padding = '10px 14px';
      notif.style.borderRadius = '8px';
      notif.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
      notif.style.maxWidth = 'min(90%, 720px)';
      notif.style.overflow = 'hidden';
      notif.style.display = 'flex';
      notif.style.gap = '8px';
      notif.style.alignItems = 'center';
      const textSpan = document.createElement('span');
      textSpan.id = 'scan-notification-text';
      textSpan.style.flex = '1 1 auto';
      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.style.background = '#fff';
      copyBtn.style.color = '#000';
      copyBtn.style.border = 'none';
      copyBtn.style.padding = '6px 10px';
      copyBtn.style.borderRadius = '6px';
      copyBtn.style.cursor = 'pointer';
      copyBtn.addEventListener('click', () => {
        try { navigator.clipboard.writeText(document.getElementById('scan-notification-text').textContent); scannerLog('Copied notification text', 'info'); }
        catch(e){ scannerLog('Clipboard copy failed: '+(e?.message||e), 'warn'); }
      });
      notif.appendChild(textSpan);
      notif.appendChild(copyBtn);
      (scanContainer || document.body).appendChild(notif);
    }
    const textSpan = document.getElementById('scan-notification-text');
    if (textSpan) textSpan.textContent = text;
    notif.style.opacity = '1';
    notif.style.transition = 'opacity 0.35s ease';
    if (autoHide) setTimeout(() => { try { notif.style.opacity = '0'; setTimeout(()=>notif.remove(),400); } catch(e){} }, 6000);
  } catch (e) {
    scannerLog('showScanNotification failed: ' + (e?.message || e), 'warn');
  }
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function scanQRCode() {
  if (video.readyState === video.HAVE_ENOUGH_DATA && isResultHidden) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      frameCounter++;
      if (frameCounter % 10 === 0) {
        scannerLog(`Frame captured (w:${canvas.width} h:${canvas.height}) [frame ${frameCounter}]`, 'debug');
      }
    } catch (e) {
      // ignore frame logging errors
    }
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (typeof jsQR === 'undefined') {
      // Try to dynamically load jsQR in background (non-blocking for animation loop)
      ensureJsQRAvailable().then(() => {
        scannerLog('jsQR dynamically loaded in scan loop', 'info');
      }).catch((err) => {
        scannerLog('Failed to dynamically load jsQR in scan loop: ' + (err && err.message ? err.message : String(err)), 'error');
      });
    }
    const code = (typeof jsQR !== 'undefined') ? jsQR(imageData.data, canvas.width, canvas.height) : null;
    if (code) {
        scannerLog('QR detected: ' + code.data, 'info');
      const type = checkDataType(code.data);
      scan.classList.remove("height-30", "height-60");
      if (type === 'URL') {
        scan.classList.add("height-30");
      } else {
        scan.classList.add("height-60");
      }
      scanResult.classList.remove('d-none');
      qrDataType.innerText = `Type: ${type}`;
      const urlResultElement = document.getElementById("url-result");
      urlResultElement.innerText = code.data;
      if (type === 'URL') {
        urlResultElement.classList.add('url-result');
      } else {
        urlResultElement.classList.remove('url-result');
      }
      isResultHidden = false;
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
      }
      scan.style.background = "#1E1E1E";
    }
  }
  if (isResultHidden) {
    requestAnimationFrame(scanQRCode);
  }
}

function checkDataType(qrData) {
  if (validateEmail(qrData)) return 'EMAIL';
  if (validateUrl(qrData)) return 'URL';
  return 'TEXT';
}

function validateEmail(email) {
  const regExpForEmail = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return regExpForEmail.test(email);
}

function validateUrl(url) {
  const regExpForURL = /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
  return regExpForURL.test(url);
}

function stopScanner() {
  // Stop both stream variables for compatibility
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
  if (__scannerStream) {
    __scannerStream.getTracks().forEach(track => track.stop());
    __scannerStream = null;
  }
  __scannerRunning = false;
  if (scanTimeout) {
    clearTimeout(scanTimeout);
    scanTimeout = null;
  }
  isResultHidden = true;
  scanResult.classList.add("d-none");
  accessMessage.classList.remove("d-none");
  const cameraError = document.getElementById("cameraError");
  cameraError.classList.add("d-none");
  scan.classList.remove("height-30", "height-60");
  scannerLog('Scanner stopped', 'info');
  const debugDiv = document.getElementById('scanner-debug');
  if (debugDiv) { debugDiv.classList.remove('show'); debugDiv.classList.add('d-none'); }
}

// Unified scanner opener: supports 'qr' (jsQR/BarcodeDetector) and 'barcode' (ZXing)
window.openScannerModal = function(targetFieldName, scanType = 'qr') {
  window.__scannerTargetField = targetFieldName;
  window.__lastScanValue = '';
  window.__scannerType = scanType || 'qr';
  if (scanType === 'barcode') {
    const modal = document.getElementById('barcode-modal');
    openModal(modal);
    startBarcodeScanner();
  } else {
    const modal = document.getElementById('scanner-modal');
    openModal(modal);
    initScanner();
    startScanner(); // Start the camera for QR scanning
  }
};

window.closeScannerModal = function() {
  try {
    // Stop whichever scanner is running
    if (window.__scannerType === 'barcode') {
      stopBarcodeScanner();
      const modal = document.getElementById('barcode-modal');
      closeModal(modal);
    } else {
      stopScanner();
      const modal = document.getElementById('scanner-modal');
      closeModal(modal);
    }
  } finally {
    window.__scannerTargetField = null;
    window.__scannerType = null;
  }
};

// Desktop capture helpers
window.__desktopBuffer = '';
window.__desktopTimer = null;
window.__desktopListener = null;

function startDesktopCapture() {
  const input = document.getElementById('scanner-desktop-input');
  const status = document.getElementById('scanner-desktop-status');
  if (!input) return;
  input.value = '';
  input.focus();
  if (status) status.textContent = 'Ready to capture input. Focused.';

  // Key capture: accumulate characters until Enter or pause
  const onKey = (e) => {
    if (e.key === 'Enter') {
      handleDesktopComplete(input.value.trim());
      input.value = '';
      e.preventDefault();
      return;
    }
    // Allow normal typing/paste; we'll use input event for buffer handling
  };

  const onInput = (e) => {
    const v = input.value.trim();
    if (!v) return;
    // Debounce short bursts typical of barcode scanner
    if (window.__desktopTimer) clearTimeout(window.__desktopTimer);
    window.__desktopTimer = setTimeout(() => {
      handleDesktopComplete(v);
      input.value = '';
    }, 80);
  };

  const onPaste = (e) => {
    setTimeout(() => {
      const v = input.value.trim();
      if (v) handleDesktopComplete(v);
      input.value = '';
    }, 30);
  };

  input.addEventListener('keydown', onKey);
  input.addEventListener('input', onInput);
  input.addEventListener('paste', onPaste);

  window.__desktopListener = { onKey, onInput, onPaste, input };

  // Wire upload input
  const imgInput = document.getElementById('scanner-image-input');
  if (imgInput) {
    imgInput.addEventListener('change', handleImageUpload);
  }

  // Mini camera buttons
  document.getElementById('btn-start-mini-camera')?.addEventListener('click', startMiniCamera);
  document.getElementById('btn-stop-mini-camera')?.addEventListener('click', stopMiniCamera);
  document.getElementById('btn-clear-desktop-input')?.addEventListener('click', () => { input.value = ''; input.focus(); });
}

function stopDesktopCapture() {
  const info = document.getElementById('scanner-desktop-status');
  if (info) info.textContent = 'Stopped.';
  if (window.__desktopTimer) { clearTimeout(window.__desktopTimer); window.__desktopTimer = null; }
  if (window.__desktopListener && window.__desktopListener.input) {
    window.__desktopListener.input.removeEventListener('keydown', window.__desktopListener.onKey);
    window.__desktopListener.input.removeEventListener('input', window.__desktopListener.onInput);
    window.__desktopListener.input.removeEventListener('paste', window.__desktopListener.onPaste);
  }
  const imgInput = document.getElementById('scanner-image-input');
  if (imgInput) imgInput.removeEventListener('change', handleImageUpload);
  stopMiniCamera();
}

function handleDesktopComplete(value) {
  if (!value) return;
  window.__lastScanValue = value;
  document.getElementById('scanner-desktop-status').textContent = `Detected: ${value}`;
}

async function handleImageUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = document.getElementById('scanner-image-preview');
  img.src = url; img.style.display = 'block';
  // Try detect via BarcodeDetector if present
  if ('BarcodeDetector' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.getElementById('scanner-canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      const detector = window.__barcodeDetector || new BarcodeDetector();
      const results = await detector.detect(canvas);
      if (results && results.length) {
        handleDesktopComplete(results[0].rawValue || '');
      } else {
        document.getElementById('scanner-desktop-status').textContent = 'No code detected in image';
      }
    } catch (err) {
      console.warn('Image detection failed', err);
      document.getElementById('scanner-desktop-status').textContent = 'Image detection failed';
    }
  } else {
    document.getElementById('scanner-desktop-status').textContent = 'BarcodeDetector not available for image detection';
  }
}

let __miniStream = null;
async function startMiniCamera() {
  const vid = document.getElementById('scanner-mini-video');
  const status = document.getElementById('scanner-desktop-status');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (status) status.textContent = 'Camera API not supported';
    return;
  }
  try {
    __miniStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    vid.srcObject = __miniStream; vid.style.display = 'block'; vid.play().catch(()=>{});
    if (status) status.textContent = 'Mini camera started';
    // Try using BarcodeDetector on this video periodically
    if ('BarcodeDetector' in window) {
      window.__barcodeDetector = window.__barcodeDetector || new BarcodeDetector();
      // run small loop to detect
      const loop = async () => {
        if (!__miniStream) return;
        try {
          const results = await window.__barcodeDetector.detect(vid);
          if (results && results.length) handleDesktopComplete(results[0].rawValue || '');
        } catch (e) {}
        setTimeout(loop, 300);
      };
      loop();
    }
  } catch (err) {
    console.error('startMiniCamera', err);
    if (status) status.textContent = 'Failed to start mini camera: ' + (err.message || err);
  }
}

function stopMiniCamera() {
  // Stop the mini camera stream (if active) and clear UI
  try {
    if (window.__miniStream) {
      window.__miniStream.getTracks().forEach(t => t.stop());
      window.__miniStream = null;
    }
  } catch (e) {
    scannerLog('Error stopping mini camera: ' + (e?.message || e), 'warn');
  }
  const vid = document.getElementById('scanner-mini-video');
  if (vid) {
    try { vid.pause(); vid.srcObject = null; vid.style.display = 'none'; } catch (e) {}
  }
  const status = document.getElementById('scanner-desktop-status');
  if (status) status.textContent = 'Stopped.';
}

// Shared handler for detected QR codes (jsQR-based)
function handleDetectedCode(code) {
  try {
    // cache last scanned value globally for other helpers
    window.__lastScanValue = code && code.data ? code.data : '';
    const data = code && code.data ? code.data : '';
    const type = checkDataType(data);
    scan.classList.remove('height-30', 'height-60');
    if (type === 'URL') scan.classList.add('height-30'); else scan.classList.add('height-60');
    scanResult.classList.remove('d-none');
    qrDataType.innerText = `Type: ${type}`;
    const urlResultElement = document.getElementById('url-result');
    if (type === 'URL') {
      urlResultElement.classList.add('url-result');
      urlResultElement.href = data;
      urlResultElement.innerText = data;
      urlResultElement.target = '_blank';
      urlResultElement.rel = 'noreferrer noopener';
    } else {
      urlResultElement.classList.remove('url-result');
      urlResultElement.removeAttribute('href');
      urlResultElement.innerText = data;
    }
    isResultHidden = false;
    // stop camera stream after a short delay so UI updates are visible
    setTimeout(() => {
      try {
        if (videoStream) {
          videoStream.getTracks().forEach(track => track.stop());
          scannerLog('Camera tracks stopped after detection', 'debug');
          videoStream = null;
        }
      } catch (e) {
        scannerLog('Error stopping camera after detection: ' + (e?.message || e), 'warn');
      }
      scan.style.background = '#1E1E1E';
    }, 250);

    // Show a non-blocking notification bar with scanned text (and copy button)
    try {
      const scanContainer = document.getElementById('scan') || document.body;
      let notif = document.getElementById('scan-notification');
      if (!notif) {
        notif = document.createElement('div');
        notif.id = 'scan-notification';
        notif.style.position = 'absolute';
        notif.style.top = '12px';
        notif.style.left = '50%';
        notif.style.transform = 'translateX(-50%)';
        notif.style.zIndex = '1250';
        notif.style.background = '#222';
        notif.style.color = '#fff';
        notif.style.padding = '10px 14px';
        notif.style.borderRadius = '8px';
        notif.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
        notif.style.maxWidth = 'min(90%, 720px)';
        notif.style.overflow = 'hidden';
        notif.style.display = 'flex';
        notif.style.gap = '8px';
        notif.style.alignItems = 'center';
        const textSpan = document.createElement('span');
        textSpan.id = 'scan-notification-text';
        textSpan.style.flex = '1 1 auto';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.style.background = '#fff';
        copyBtn.style.color = '#000';
        copyBtn.style.border = 'none';
        copyBtn.style.padding = '6px 10px';
        copyBtn.style.borderRadius = '6px';
        copyBtn.style.cursor = 'pointer';
        copyBtn.addEventListener('click', () => {
          try { navigator.clipboard.writeText(data); scannerLog('Copied scanned data to clipboard', 'info'); }
          catch(e){ scannerLog('Clipboard copy failed: '+(e?.message||e), 'warn'); }
        });
        notif.appendChild(textSpan);
        notif.appendChild(copyBtn);
        (scanContainer || document.body).appendChild(notif);
      }
      const textSpan = document.getElementById('scan-notification-text');
      if (textSpan) textSpan.textContent = `${type}: ${data}`;
      notif.style.opacity = '1';
      notif.style.transition = 'opacity 0.35s ease';
      // auto-hide after 6s
      setTimeout(() => {
        try { notif.style.opacity = '0'; setTimeout(() => { notif.remove(); }, 400); }
        catch(e){}
      }, 6000);
    } catch (e) {
      scannerLog('Failed to show scan notification: ' + (e?.message || e), 'warn');
    }

    // Auto-fill target form field when scanner was opened for a specific field
    try {
      const targetFieldName = (typeof window.__scannerTargetField !== 'undefined' && window.__scannerTargetField !== null) ? window.__scannerTargetField : null;
      if (targetFieldName) {
        // Try a few common id formats: exact id, prefixed `field-` id
        const candidates = [targetFieldName, `field-${targetFieldName}`];
        let applied = false;
        for (const id of candidates) {
          const input = document.getElementById(id);
          if (input) {
            if (input.type === 'checkbox') input.checked = !!data; else input.value = data;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            showScanNotification(`Applied scanned value to ${id}`, true, false);
            scannerLog(`Applied scanned value to ${id}`, 'info');
            applied = true;
            // close scanner modal after a short delay so user sees UI
            setTimeout(() => { try { window.closeScannerModal(); } catch (e) {} }, 250);
            break;
          }
        }
        if (!applied) {
          scannerLog(`No input found for ${targetFieldName} (tried ${candidates.join(', ')})`, 'warn');
        }
      }
    } catch (e) {
      scannerLog('Auto-fill after detection failed: ' + (e?.message || e), 'warn');
    }
  } catch (e) {
    scannerLog('handleDetectedCode error: ' + (e?.message || e), 'error');
  }
}

window.__scanLoop = async function() {
  if (!window.__scannerRunning) return;
  const video = document.getElementById('scanner-video');
  const status = document.getElementById('scanner-status');
  if (!video) return;

  try {
    if (window.__barcodeDetector) {
      try {
        scannerLog('Attempting detection with BarcodeDetector...');
        const results = await window.__barcodeDetector.detect(video);
        scannerLog(`Detection results: ${results ? results.length : 0} codes found`);
        if (results && results.length > 0) {
          const newValue = results[0].rawValue || '';
          scannerLog(`Detected code: "${newValue}"`);
          if (newValue && newValue !== window.__lastScanValue) {
            window.__lastScanValue = newValue;
            scannerLog(`New code detected: "${newValue}"`);
            if (status) status.textContent = `Detected: ${window.__lastScanValue}`;
            
            // Show visual feedback
            const canvas = document.getElementById('scanner-canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = "24px Arial";
            ctx.fillStyle = "yellow";
            ctx.strokeStyle = "black";
            ctx.lineWidth = 2;
            ctx.strokeText(newValue, 10, 30);
            ctx.fillText(newValue, 10, 30);
            
            // Auto-use the scanned value for mobile
            const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(max-width:800px)').matches;
            if (isMobile) {
              scannerLog('Auto-using scanned value on mobile');
              playScanBeep();
              window.useScannedValue();
              return; // Stop scanning after successful scan
            }
          }
        } else {
          // Clear overlay if no detection
          const canvas = document.getElementById('scanner-canvas');
          if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }
      } catch (err) {
        scannerLog(`Detection error: ${err.message}`, 'warn');
        // ignore detection errors
      }
    } else {
      scannerLog('No barcode detector available', 'warn');
    }
  } catch (err) {
    scannerLog(`scanLoop error: ${err.message}`, 'error');
  } finally {
    window.__scannerAnimation = requestAnimationFrame(window.__scanLoop);
  }
};

window.scanOnce = async function() {
  const video = document.getElementById('scanner-video');
  const status = document.getElementById('scanner-status');
  if (!video) return;

  if (window.__barcodeDetector) {
    try {
      const results = await window.__barcodeDetector.detect(video);
      if (results && results.length > 0) {
        window.__lastScanValue = results[0].rawValue || '';
        if (status) status.textContent = `Detected: ${window.__lastScanValue}`;
      } else {
        if (status) status.textContent = 'No code detected in frame';
      }
    } catch (err) {
      console.error('scanOnce detect error', err);
      if (status) status.textContent = 'Error during detection';
    }
  } else {
    if (status) status.textContent = 'BarcodeDetector not available';
  }
};

window.useScannedValue = function() {
  if (!window.__scannerTargetField) {
    alert('Error: No target field selected for scanning.');
    return;
  }
  if (!window.__lastScanValue) {
    alert('Error: No barcode detected yet. Please scan a code first.');
    return;
  }
  const input = document.getElementById(`field-${window.__scannerTargetField}`);
  if (input) {
    input.value = window.__lastScanValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    alert(`Success: Scanned value "${window.__lastScanValue}" applied to ${window.__scannerTargetField} field.`);
  } else {
    alert(`Error: Could not find input field for ${window.__scannerTargetField}.`);
  }
  window.closeScannerModal();
};

// Use-barcode handler: apply scanned barcode to target field (separate button)
document.addEventListener('DOMContentLoaded', () => {
    // wire barcode modal controls
    const modalX = document.getElementById('barcode-close');
    if (modalX) modalX.addEventListener('click', () => window.closeScannerModal());
    const retryBtn = document.getElementById('barcode-retryCameraBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => {
      // Hide error message before retrying
      const errEl = document.getElementById('barcode-cameraError');
      if (errEl) errEl.classList.add('d-none');
      window.openScannerModal(window.__scannerTargetField, 'barcode');
    });
});

// Play a beep sound for successful scan
function playScanBeep() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // 800 Hz beep
    oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1); // rise to 1000 Hz
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    // Fallback: try to play a system beep or ignore
    console.warn('Beep not supported');
  }
}

// --- Scanner implementation (camera + BarcodeDetector) ---
let __scannerStream = null;
let __barcodeDetector = null;
let __scannerRunning = false;
let __scannerAnimation = null;
let __lastScanValue = '';
let __scannerTargetField = null;

// ZXing dynamic loader and barcode scanner helpers
window.__zxingLoaderPromise = null;
function ensureZXingAvailable(timeout = 8000) {
  if (window.BrowserMultiFormatReader || (window.ZXing && window.ZXing.BrowserMultiFormatReader)) return Promise.resolve();
  if (window.__zxingLoaderPromise) return window.__zxingLoaderPromise;
  window.__zxingLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    // UMD bundle from unpkg
    script.src = 'https://unpkg.com/@zxing/library@0.18.6/umd/index.min.js';
    const timer = setTimeout(() => {
      reject(new Error('ZXing load timed out'));
    }, timeout);
    script.onload = () => {
      clearTimeout(timer);
      // library exposes BrowserMultiFormatReader on global or under ZXing
      if (window.BrowserMultiFormatReader || (window.ZXing && window.ZXing.BrowserMultiFormatReader) || window.ZXingBrowser) {
        resolve();
      } else {
        // still resolve; code will check availability at runtime
        resolve();
      }
    };
    script.onerror = (e) => { clearTimeout(timer); reject(new Error('Failed to load ZXing library')); };
    document.head.appendChild(script);
  });
  return window.__zxingLoaderPromise;
}

let __zxingReader = null;
let __barcodeStream = null;

// Global variables for barcode scanner
let barcodeQrScanner = null;
let barcodeCurrentMode = 'camera';
let barcodeBeepEnabled = true;
let zxingActive = false;
let zxingReader = null;

// Check if QrScanner library is loaded
function checkQrScannerLibrary() {
  if (typeof QrScanner === 'undefined') {
    console.error('QrScanner library not loaded. Please check your internet connection and refresh the page.');
    alert('Barcode scanner library not loaded. Please refresh the page.');
    return false;
  }

  // Test basic functionality
  try {
    if (typeof QrScanner.listCameras !== 'function') {
      throw new Error('QrScanner.listCameras not available');
    }
    if (typeof QrScanner.scanImage !== 'function') {
      throw new Error('QrScanner.scanImage not available');
    }
    console.log('QrScanner library loaded successfully');
  } catch (error) {
    console.error('QrScanner library validation failed:', error);
    alert('Barcode scanner library is incomplete. Please refresh the page.');
    return false;
  }

  return true;
}

// Initialize barcode scanner when modal opens
function initBarcodeScanner() {
  console.log('Initializing barcode scanner...');

  // Set up tab switching
  document.getElementById('barcode-camerabtn').addEventListener('click', () => switchBarcodeMode('camera'));
  document.getElementById('barcode-imagebtn').addEventListener('click', () => switchBarcodeMode('image'));
  document.getElementById('barcode-paste-btn').addEventListener('click', handleBarcodePaste);

  // Set up image upload
  document.getElementById('barcode-image-uploader').addEventListener('change', handleBarcodeImageUpload);

  // Set up drag and drop
  const imageScanner = document.getElementById('barcode-qrrr');
  imageScanner.addEventListener('dragover', handleBarcodeDragOver);
  imageScanner.addEventListener('drop', handleBarcodeDrop);

  // Set up beep toggle
  document.getElementById('barcode-beep-toggle').addEventListener('change', (e) => {
    barcodeBeepEnabled = e.target.checked;
  });

  // Set up rescan button
  document.getElementById('barcode-rescanqrbtn').addEventListener('click', startBarcodeCamera);

  // Set up camera selection change
  document.getElementById('barcode-select-camera').addEventListener('change', handleCameraChange);

  // Set up clear logs button
  document.getElementById('barcode-clear-logs').addEventListener('click', clearBarcodeLogs);

  // Populate camera list
  populateBarcodeCameras();

  // Initialize console logging
  initBarcodeConsoleLogging();

  console.log('Barcode scanner initialized successfully');
}

async function handleCameraChange(event) {
  const cameraId = event.target.value;
  const selectedOption = event.target.options[event.target.selectedIndex];
  const cameraLabel = selectedOption.text;

  console.log('Camera change requested:', cameraLabel, '(ID:', cameraId, ')');

  // Show loading state
  const selectElement = event.target;
  const originalText = selectElement.options[selectElement.selectedIndex].text;
  selectElement.disabled = true;
  selectElement.options[selectElement.selectedIndex].text = 'Switching...';

  try {
    if (zxingActive) {
      console.log('Restarting ZXing with new camera id...', cameraId);
      try { stopZxingScanner(); } catch(e) { console.warn('Error stopping ZXing before restart', e); }
      // Recreate scanner with new camera by restarting the camera start routine
      await startBarcodeCamera();
      console.log('ZXing restarted with new camera');
    } else if (!barcodeQrScanner) {
      console.log('No active scanner, starting with new camera...');
      await startBarcodeCamera();
    } else {
      console.log('Switching camera on active scanner...');
      await barcodeQrScanner.setCamera(cameraId);
      console.log('Camera switched successfully to:', cameraLabel);
    }

    // Update the option text back
    selectElement.options[selectElement.selectedIndex].text = originalText;

  } catch (error) {
    console.error('Failed to switch camera:', error);

    // Reset selection and show error
    selectElement.value = barcodeQrScanner ? 'current' : '';
    selectElement.options[selectElement.selectedIndex].text = originalText;
    alert(`Failed to switch to ${cameraLabel}: ${error.message}`);
  } finally {
    selectElement.disabled = false;
  }
}

function switchBarcodeMode(mode) {
  barcodeCurrentMode = mode;

  // Update button states
  document.getElementById('barcode-camerabtn').classList.toggle('activebtn', mode === 'camera');
  document.getElementById('barcode-imagebtn').classList.toggle('activebtn', mode === 'image');

  // Show/hide scanners
  document.getElementById('barcode-camera-scanner').style.display = mode === 'camera' ? 'block' : 'none';
  document.getElementById('barcode-qrrr').style.display = mode === 'image' ? 'block' : 'none';

  // Stop camera if switching away from camera mode
  // Stop camera if switching away from camera mode
  if (mode !== 'camera') {
    if (barcodeQrScanner) {
      try { barcodeQrScanner.stop(); } catch(e) { console.warn('Error stopping QrScanner', e); }
      barcodeQrScanner = null;
    }
    if (zxingActive) {
      try { stopZxingScanner(); } catch(e) { console.warn('Error stopping ZXing', e); }
    }
  }

  // Start camera if switching to camera mode
  if (mode === 'camera') {
    startBarcodeCamera();
  }
}

async function populateBarcodeCameras() {
  try {
    console.log('Populating camera list...');

    // Check if library is loaded
    if (!checkQrScannerLibrary()) {
      return;
    }

    const cameras = await QrScanner.listCameras();
    console.log('Available cameras:', cameras);

    const select = document.getElementById('barcode-select-camera');

    if (!cameras || cameras.length === 0) {
      console.warn('No cameras found');
      select.innerHTML = '<option>No cameras found</option>';
      return;
    }

    select.innerHTML = '';
    cameras.forEach((camera, index) => {
      const option = document.createElement('option');
      option.value = camera.id;
      option.textContent = camera.label || `Camera ${index + 1}`;
      select.appendChild(option);
      console.log(`Added camera: ${camera.label} (${camera.id})`);
    });

    // Update status indicators
    const statusText = document.getElementById('scanner-status-text');
    const cameraText = document.getElementById('current-camera-text');
    if (statusText) statusText.textContent = 'Ready';
    if (cameraText) cameraText.textContent = 'None selected';

    // Add a separator and status option
    const statusOption = document.createElement('option');
    statusOption.disabled = true;
    statusOption.textContent = '──────────';
    select.appendChild(statusOption);

    const currentOption = document.createElement('option');
    currentOption.disabled = true;
    currentOption.textContent = 'Current: None selected';
    select.appendChild(currentOption);

    // Auto-select back camera by default, then environment, then front
    let selectedCamera = cameras[0];
    let priority = 3; // 1 = back, 2 = environment, 3 = front/other

    for (const camera of cameras) {
      const label = (camera.label || '').toLowerCase();
      if (label.includes('back') && priority > 1) {
        selectedCamera = camera;
        priority = 1;
      } else if (label.includes('environment') && priority > 2) {
        selectedCamera = camera;
        priority = 2;
      }
    }

    select.value = selectedCamera.id;
    console.log('Selected camera:', selectedCamera.label, '(priority:', priority, ')');

  } catch (error) {
    console.error('Error listing cameras:', error);
    const select = document.getElementById('barcode-select-camera');
    select.innerHTML = '<option>Error loading cameras</option>';
  }
}

// ZXing start/stop helpers (BrowserMultiFormatReader)
function startZxingScanner(cameraId, videoElement) {
  return new Promise((resolve, reject) => {
    try {
      const Reader = window.BrowserMultiFormatReader || (window.ZXing && window.ZXing.BrowserMultiFormatReader);
      if (!Reader) return reject(new Error('ZXing library not loaded'));

      // Clean up any existing reader
      try { if (zxingReader) { zxingReader.reset(); zxingReader = null; } } catch(e) {}

      zxingReader = new Reader();

      zxingReader.decodeFromVideoDevice(cameraId || null, videoElement, (result, err) => {
        if (result) {
          try {
            const text = result.text || (result.getText && result.getText && result.getText());
            const format = result.barcodeFormat || (result.getBarcodeFormat && result.getBarcodeFormat && result.getBarcodeFormat());
            console.log('ZXing detected:', text, format);
            handleBarcodeResult({ data: text, format: format });
          } catch (e) {
            console.warn('ZXing result handler error', e);
          }
        }
        if (err && err.name && err.name.indexOf('NotFound') === -1) {
          // NotFound is common; log other errors
          console.debug('ZXing detection error (non-blocking):', err);
        }
      });

      zxingActive = true;
      console.log('ZXing started');
      resolve();
    } catch (e) {
      console.error('startZxingScanner exception', e);
      reject(e);
    }
  });
}

function stopZxingScanner() {
  try {
    if (zxingReader) {
      try { zxingReader.reset(); } catch (e) { console.warn('zxingReader.reset failed', e); }
      zxingReader = null;
    }
  } catch (e) {
    console.warn('stopZxingScanner error', e);
  }
  zxingActive = false;
}

async function startBarcodeCamera() {
  try {
    console.log('Starting barcode camera...');

    // Check if library is loaded
    if (!checkQrScannerLibrary()) {
      return;
    }

    // Clear previous scanner
    if (barcodeQrScanner) {
      console.log('Stopping previous scanner...');
      barcodeQrScanner.stop();
      barcodeQrScanner = null;
    }

    // Hide labels and show previewer
    document.getElementById('barcode-camera-label').style.display = 'none';
    document.getElementById('barcode-camera-not-found').style.display = 'none';
    document.getElementById('barcode-rescanqrbtn').style.display = 'none';
    document.getElementById('barcode-qr-code-previewer').style.display = 'block';

    const previewer = document.getElementById('barcode-qr-code-previewer');

    // Clear any existing content in previewer
    previewer.innerHTML = '';

    // Create a video element for the scanner
    const videoElement = document.createElement('video');
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.style.objectFit = 'cover';
    videoElement.style.borderRadius = '8px';
    videoElement.muted = true; // Required for autoplay
    videoElement.playsInline = true; // Required for mobile
    videoElement.setAttribute('playsinline', ''); // Additional mobile support
    videoElement.setAttribute('webkit-playsinline', ''); // iOS Safari support
    previewer.appendChild(videoElement);

    console.log('Created video element for scanner');

    // Get selected camera
    const select = document.getElementById('barcode-select-camera');
    const cameraId = select.value;

    console.log('Selected camera:', cameraId);
    // Prefer ZXing (BrowserMultiFormatReader) for live scanning (1D + 2D)
    const useZxing = (typeof BrowserMultiFormatReader !== 'undefined' || (window.ZXing && window.ZXing.BrowserMultiFormatReader));

    if (useZxing) {
      try {
        // ZXing will use the provided video element
        await startZxingScanner(cameraId, videoElement);
        console.log('Using ZXing for live scanning');
        return;
      } catch (zErr) {
        console.warn('ZXing start failed, falling back to QrScanner:', zErr);
        // continue to QrScanner fallback
      }
    }

    console.log('QrScanner library available, creating scanner (fallback)...');

    // Create scanner with proper configuration for detailed results and multiple formats (fallback)
    barcodeQrScanner = new QrScanner(
      videoElement,
      result => {
        console.log('Barcode detected (QrScanner):', result);
        handleBarcodeResult(result);
      },
      {
        preferredCamera: cameraId || 'environment',
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        maxScansPerSecond: 10, // Increased for better detection
        onDecodeError: (error) => {
          // Ignore decode errors, they're normal when no barcode is visible
          console.debug('Decode error (normal):', error);
        }
      }
    );

    console.log('Scanner created (QrScanner), starting...');

    // Request camera permissions if needed
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop()); // Stop the test stream
      console.log('Camera permissions granted');
    } catch (permError) {
      console.warn('Camera permission error:', permError);
      throw new Error('Camera access denied. Please allow camera permissions and try again.');
    }

    // Start scanning
    await barcodeQrScanner.start();

    console.log('Camera scanner started successfully (QrScanner)');

  } catch (error) {
    console.error('Error starting camera:', error);
    document.getElementById('barcode-camera-not-found').style.display = 'block';
    document.getElementById('barcode-rescanqrbtn').style.display = 'block';
    document.getElementById('barcode-qr-code-previewer').style.display = 'none';

    // Show error message
    const errorMsg = error.message || 'Unknown camera error';
    document.getElementById('barcode-camera-not-found').textContent = `Camera error: ${errorMsg}`;
  }
}

function handleBarcodeResult(result) {
  console.log('Handling barcode result:', result);

  // Validate the result - it should be an object with data property
  if (!result || typeof result !== 'object') {
    console.warn('Received invalid barcode result');
    return;
  }

  // Extract the data from the result object
  let resultText = '';
  let codeType = 'Unknown';

  if (result.data && typeof result.data === 'string') {
    resultText = result.data;
    // Try to determine code type based on content and format
    codeType = determineBarcodeType(resultText, result);
  } else if (typeof result === 'string') {
    // Fallback for old API
    resultText = result;
    codeType = 'Legacy Format';
  } else {
    console.warn('No valid data found in barcode result:', result);
    return;
  }

  console.log('Processed barcode result:', resultText, 'Type:', codeType);

  // Play beep if enabled
  if (barcodeBeepEnabled) {
    playBarcodeBeep();
  }

  // Display result with type information
  displayBarcodeResult(resultText, codeType);

  // Stop scanning after successful detection
  // Stop QrScanner if active
  if (barcodeQrScanner) {
    try { barcodeQrScanner.stop(); } catch(e) { console.warn('Error stopping QrScanner after detection', e); }
    barcodeQrScanner = null;
  }

  // Stop ZXing if active
  try { stopZxingScanner(); } catch (e) { console.warn('Error stopping ZXing after detection', e); }

  // Show rescan button
  document.getElementById('barcode-rescanqrbtn').style.display = 'block';
}

function handleBarcodeImageUpload(event) {
  const file = event.target.files[0];
  if (file) {
    scanBarcodeFromImage(file);
  }
}

function handleBarcodePaste() {
  navigator.clipboard.read().then(clipboardItems => {
    for (const item of clipboardItems) {
      if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
        item.getType('image/png').then(blob => {
          scanBarcodeFromImage(blob);
        }).catch(() => {
          item.getType('image/jpeg').then(blob => {
            scanBarcodeFromImage(blob);
          });
        });
        break;
      }
    }
  }).catch(error => {
    console.error('Error reading clipboard:', error);
  });
}

function handleBarcodeDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
}

function handleBarcodeDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');

  const files = event.dataTransfer.files;
  if (files.length > 0) {
    scanBarcodeFromImage(files[0]);
  }
}

async function scanBarcodeFromImage(fileOrBlob) {
  try {
    console.log('Scanning barcode from image...');

    // Check if library is loaded
    if (!checkQrScannerLibrary()) {
      return;
    }

    // Show loading
    document.getElementById('barcode-image-label').style.display = 'none';
    document.getElementById('barcode-uploaded-qr-previewer').style.display = 'block';
    document.getElementById('barcode-uploaded-qr-previewer').src = URL.createObjectURL(fileOrBlob);

    console.log('Scanning image with QrScanner...');

    // Scan the image with detailed result option
    const result = await QrScanner.scanImage(fileOrBlob, {
      returnDetailedScanResult: true
    });

    console.log('Image scan result:', result);

    if (result && result.data) {
      handleBarcodeResult(result);
    } else {
      console.warn('No barcode found in image');
      document.querySelector('#barcode-qrrr .image-not-found').style.display = 'block';
    }

  } catch (error) {
    console.error('Error scanning image:', error);
    document.querySelector('#barcode-qrrr .image-not-found').style.display = 'block';
    document.querySelector('#barcode-qrrr .image-not-found').textContent = `Scan error: ${error.message}`;
  }
}

function determineBarcodeType(data, result) {
  // Try to determine barcode type based on data patterns and result metadata

  // Check for QR code patterns (URLs, text with special characters)
  if (data.includes('http') || data.includes('www.') || data.includes('://')) {
    return 'QR Code (URL)';
  }

  // Check for EAN/UPC patterns (numeric, specific lengths)
  if (/^\d{8}$/.test(data)) {
    return 'EAN-8';
  }
  if (/^\d{12}$/.test(data)) {
    return 'UPC-A';
  }
  if (/^\d{13}$/.test(data)) {
    return 'EAN-13';
  }

  // Check for Code 128/39 patterns (alphanumeric with specific characteristics)
  if (/^[A-Z0-9\-\.\s\$\/\+\%]+$/.test(data) && data.length > 3) {
    return 'Code 128/39';
  }

  // Check for other common formats
  if (data.startsWith('WIFI:') || data.startsWith('MECARD:') || data.startsWith('BEGIN:VCARD')) {
    return 'QR Code (Special)';
  }

  // Default to QR Code for now (most common with this library)
  return 'QR Code';
}

function displayBarcodeResult(data, codeType = 'Unknown') {
  const resultWrapper = document.getElementById('barcode-result-area-wrapper');
  // Save last scanned value for use by the "Use Scanned" button
  try { window.__lastBarcodeScan = data; } catch (e) {}

  resultWrapper.innerHTML = `
    <div class="result-item">
      <div class="result-type">Type: ${codeType}</div>
      <div class="result-text" id="barcode-result-text">${data}</div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button class="copy-btn" onclick="copyBarcodeResult('${data.replace(/'/g, "\\'")}')">Copy</button>
        <button class="use-scanned-btn btn btn-success" id="btn-use-scanned-barcode">Use Scanned</button>
      </div>
    </div>
  `;

  // Wire the Use Scanned button
  const useBtn = document.getElementById('btn-use-scanned-barcode');
  if (useBtn) {
    useBtn.addEventListener('click', () => {
      try { useBarcodeScannedValue(); } catch (e) { console.warn('useBarcodeScannedValue error', e); }
    });
  }


function useBarcodeScannedValue() {
  try {
    const value = window.__lastBarcodeScan || '';
    if (!value) {
      alert('No scanned value available');
      return;
    }

    const targetFieldName = window.__scannerTargetField || null;
    if (!targetFieldName) {
      // If no target field provided, just copy to clipboard
      try { navigator.clipboard.writeText(value); alert('Scanned value copied to clipboard'); } catch(e) { alert('Scanned: ' + value); }
      return;
    }

    const candidates = [targetFieldName, `field-${targetFieldName}`];
    let applied = false;
    for (const id of candidates) {
      const input = document.getElementById(id);
      if (input) {
        if (input.type === 'checkbox') input.checked = !!value; else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        applied = true;
        break;
      }
    }

    if (!applied) {
      alert('Scanned value: ' + value + '\n\nCould not find target input to apply the value.');
    }

    // Close modal after applying
    try { window.closeScannerModal(); } catch (e) {}
  } catch (e) {
    console.error('useBarcodeScannedValue failed', e);
    alert('Failed to apply scanned value: ' + (e && e.message ? e.message : e));
  }
}
  // Show result area
  document.getElementById('barcode-result-checker').checked = true;
}

function copyBarcodeResult(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Show feedback
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
}

function playBarcodeBeep() {
  // Create a simple beep sound
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);

  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.2);
}

// Modified functions to work with new scanner
async function startBarcodeScanner() {
  console.log('Starting barcode scanner modal...');

  // Initialize the scanner UI
  initBarcodeScanner();

  // Start with camera mode
  switchBarcodeMode('camera');

  console.log('Barcode scanner modal started');
}

function stopBarcodeScanner() {
  // Stop camera scanner (QrScanner)
  if (barcodeQrScanner) {
    try { barcodeQrScanner.stop(); } catch (e) { console.warn('Error stopping QrScanner', e); }
    barcodeQrScanner = null;
  }

  // Stop ZXing if running
  try {
    stopZxingScanner();
  } catch (e) {
    console.warn('stopBarcodeScanner: stopZxingScanner error', e);
  }

  // Reset UI
  document.getElementById('barcode-camera-label').style.display = 'block';
  document.getElementById('barcode-camera-not-found').style.display = 'none';
  document.getElementById('barcode-rescanqrbtn').style.display = 'none';
  document.getElementById('barcode-qr-code-previewer').style.display = 'none';
  document.getElementById('barcode-image-label').style.display = 'block';
  document.getElementById('barcode-uploaded-qr-previewer').style.display = 'none';
  document.querySelector('#barcode-qrrr .image-not-found').style.display = 'none';

  // Clear results
  document.getElementById('barcode-result-area-wrapper').innerHTML = '';
  document.getElementById('barcode-result-checker').checked = false;

  // Stop console logging
  stopBarcodeConsoleLogging();
}

// Initialize console logging functionality for barcode scanner
let originalConsoleLog = null;
let originalConsoleError = null;
let originalConsoleWarn = null;
let originalConsoleInfo = null;
let originalConsoleDebug = null;

function initBarcodeConsoleLogging() {
  console.log('Initializing barcode console logging...');

  // Store original console methods
  originalConsoleLog = console.log;
  originalConsoleError = console.error;
  originalConsoleWarn = console.warn;
  originalConsoleInfo = console.info;
  originalConsoleDebug = console.debug;

  // Override console methods to capture logs
  console.log = function(...args) {
    addBarcodeLogEntry('log', ...args);
    if (originalConsoleLog) originalConsoleLog.apply(console, args);
  };

  console.error = function(...args) {
    addBarcodeLogEntry('error', ...args);
    if (originalConsoleError) originalConsoleError.apply(console, args);
  };

  console.warn = function(...args) {
    addBarcodeLogEntry('warn', ...args);
    if (originalConsoleWarn) originalConsoleWarn.apply(console, args);
  };

  console.info = function(...args) {
    addBarcodeLogEntry('info', ...args);
    if (originalConsoleInfo) originalConsoleInfo.apply(console, args);
  };

  console.debug = function(...args) {
    addBarcodeLogEntry('debug', ...args);
    if (originalConsoleDebug) originalConsoleDebug.apply(console, args);
  };

  // Add initial log entry
  addBarcodeLogEntry('info', 'Console logging initialized for barcode scanner');
}

function stopBarcodeConsoleLogging() {
  // Restore original console methods
  if (originalConsoleLog) console.log = originalConsoleLog;
  if (originalConsoleError) console.error = originalConsoleError;
  if (originalConsoleWarn) console.warn = originalConsoleWarn;
  if (originalConsoleInfo) console.info = originalConsoleInfo;
  if (originalConsoleDebug) console.debug = originalConsoleDebug;

  // Reset stored originals
  originalConsoleLog = null;
  originalConsoleError = null;
  originalConsoleWarn = null;
  originalConsoleInfo = null;
  originalConsoleDebug = null;
}

function addBarcodeLogEntry(level, ...args) {
  const logContainer = document.getElementById('barcode-log-container');
  if (!logContainer) return;

  const timestamp = new Date().toLocaleTimeString();
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      return JSON.stringify(arg, null, 2);
    }
    return String(arg);
  }).join(' ');

  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${level}`;
  logEntry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span>${message}`;

  logContainer.appendChild(logEntry);

  // Auto-scroll to bottom
  logContainer.scrollTop = logContainer.scrollHeight;

  // Limit log entries to prevent memory issues (keep last 100 entries)
  while (logContainer.children.length > 100) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function clearBarcodeLogs() {
  const logContainer = document.getElementById('barcode-log-container');
  if (logContainer) {
    logContainer.innerHTML = '<div class="log-entry log-info"><span class="log-timestamp">[' + new Date().toLocaleTimeString() + ']</span>Logs cleared</div>';
  }
}

// Test function to verify QR scanner functionality
window.testQrScanner = async function() {
  console.log('Testing QR Scanner functionality...');

  if (!checkQrScannerLibrary()) {
    console.error('QR Scanner library not available');
    return;
  }

  try {
    // Test camera availability
    const hasCamera = await QrScanner.hasCamera();
    console.log('Camera available:', hasCamera);

    // Test camera listing
    const cameras = await QrScanner.listCameras();
    console.log('Available cameras:', cameras);

    // Test image scanning with a simple test
    console.log('QR Scanner test completed successfully');
    return { hasCamera, cameras };

  } catch (error) {
    console.error('QR Scanner test failed:', error);
    return { error: error.message };
  }
};

function handleDetectedBarcode(text) {
  try {
    window.__lastScanValue = text || '';
    // show short notification
    showScanNotification(`Barcode: ${window.__lastScanValue}`, true, false);
  } catch (e) { scannerLog('handleDetectedBarcode error: ' + (e?.message || e), 'error'); }
}

// Attach a small scan button next to any input/textarea/select by id
/* Scanner attach/picker API removed — feature was unstable. */

function openScannerModal(targetFieldName) {
  // Delegate to window-scoped implementation (handles mobile vs desktop)
  if (window.openScannerModal) return window.openScannerModal(targetFieldName);
}

function closeScannerModal() {
  if (window.closeScannerModal) return window.closeScannerModal();
}

async function startScanner() {
  const status = document.getElementById('scanner-status');
  const video = document.getElementById('scanner-video');
  if (!video) return;

  // Stop any existing stream first
  if (__scannerStream) {
    __scannerStream.getTracks().forEach(track => track.stop());
    __scannerStream = null;
  }

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (status) status.textContent = 'Camera API not supported';
      return;
    }

    __scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = __scannerStream;
    video.play().catch(()=>{});

    // Hide camera error on successful start
    const cameraError = document.getElementById("cameraError");
    if (cameraError) cameraError.classList.add("d-none");

    // Initialize BarcodeDetector if available
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        // prefer common 2D formats
        const formats = ['qr_code', 'data_matrix', 'ean_13', 'code_128'].filter(f => supported.includes(f));
        __barcodeDetector = new BarcodeDetector({ formats: formats.length ? formats : supported });
      } catch (err) {
        console.warn('BarcodeDetector init failed, will attempt default:', err);
        __barcodeDetector = new BarcodeDetector();
      }
    } else {
      __barcodeDetector = null;
      console.warn('BarcodeDetector not supported in this environment');
    }

    __scannerRunning = true;
    if (status) status.textContent = 'Camera started — looking for codes...';
    scanLoop();
  } catch (err) {
    console.error('startScanner error', err);
    if (status) status.textContent = 'Failed to start camera: ' + (err.message || err);
  }
}

// (Removed duplicate stopScanner implementation that referenced Quagga/ZXing.)

async function scanLoop() {
  if (!__scannerRunning) return;
  const video = document.getElementById('scanner-video');
  const status = document.getElementById('scanner-status');

  if (!video) return;

  try {
    if (__barcodeDetector) {
      try {
        const results = await __barcodeDetector.detect(video);
        if (results && results.length > 0) {
          __lastScanValue = results[0].rawValue || '';
          if (status) status.textContent = `Detected: ${__lastScanValue}`;
          // do not auto-close; allow user to press "Use Scanned Value"
        }
      } catch (err) {
        // detection may throw occasionally — ignore and continue
        // fallback to no-op
      }
    }
  } catch (err) {
    console.error('scanLoop error', err);
  } finally {
    __scannerAnimation = requestAnimationFrame(scanLoop);
  }
}

async function scanOnce() {
  // single-pass detection
  const video = document.getElementById('scanner-video');
  const status = document.getElementById('scanner-status');
  if (!video) return;

  if (__barcodeDetector) {
    try {
      const results = await __barcodeDetector.detect(video);
      if (results && results.length > 0) {
        __lastScanValue = results[0].rawValue || '';
        if (status) status.textContent = `Detected: ${__lastScanValue}`;
      } else {
        if (status) status.textContent = 'No code detected in frame';
      }
    } catch (err) {
      console.error('scanOnce detect error', err);
      if (status) status.textContent = 'Error during detection';
    }
  } else {
    if (status) status.textContent = 'BarcodeDetector not available';
  }
}

function useScannedValue() {
  if (!__scannerTargetField) return;
  if (!__lastScanValue) return;
  const input = document.getElementById(`field-${__scannerTargetField}`);
  if (input) {
    input.value = __lastScanValue;
    // trigger input event so any listeners update
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
  closeScannerModal();
}

// Wire scanner modal buttons now that DOM exists
document.addEventListener('DOMContentLoaded', () => {
  const start = document.getElementById('btn-start-scanner');
  const stop = document.getElementById('btn-stop-scanner');
  const scan = document.getElementById('btn-scan-once');
  const xClose = document.getElementById('scanner-close');

  if (start) start.addEventListener('click', startScanner);
  if (stop) stop.addEventListener('click', stopScanner);
  if (scan) scan.addEventListener('click', scanOnce);
  if (xClose) xClose.addEventListener('click', closeScannerModal);
});
}

// Event Listeners
function initializeEventListeners() {
  const safe = id => document.getElementById(id);

  // Module Modal
  safe('btn-new-module')?.addEventListener('click', () => openModuleModal(false));
  safe('btn-cancel-module')?.addEventListener('click', closeModuleModal);
  safe('btn-save-module')?.addEventListener('click', saveModule);
  safe('module-mode')?.addEventListener('change', toggleModeConfig);
  safe('btn-fetch-metadata')?.addEventListener('click', fetchMetadata);

  // Module search box
  safe('module-search')?.addEventListener('input', async (e) => {
    try {
      searchQuery = (e.target.value || '').trim();
      // If on module view, reload data (client-side filter applied)
      if (currentModule) await loadModuleData();
    } catch (err) {
      console.warn('module-search input handler error', err);
    }
  });

  safe('module-search-clear')?.addEventListener('click', async () => {
    try {
      const el = document.getElementById('module-search');
      if (el) { el.value = ''; }
      searchQuery = '';
      if (currentModule) await loadModuleData();
    } catch (err) {
      console.warn('module-search-clear error', err);
    }
  });
  
  // Expose quick helper to show which primary field is active (in header)
  const primaryIndicator = document.getElementById('module-primary-search-indicator');
  if (primaryIndicator) primaryIndicator.style.display = (currentModule && currentModule.config && currentModule.config.primarySearchField) ? 'inline-block' : 'none';

  // Settings button (desktop)
  safe('btn-settings')?.addEventListener('click', openSettingsModal);

  // Record Modal
  safe('btn-add-record')?.addEventListener('click', () => openRecordModal());
  safe('btn-cancel-record')?.addEventListener('click', closeRecordModal);
  safe('btn-save-record')?.addEventListener('click', saveRecord);

  // Module Actions
  safe('btn-refresh')?.addEventListener('click', refreshCurrentModule);
  safe('btn-delete-module')?.addEventListener('click', deleteCurrentModule);
  safe('btn-add-field')?.addEventListener('click', openAddFieldModal);

  // Sync Modal
  safe('btn-sync-manager')?.addEventListener('click', openSyncModal);
  safe('btn-close-sync')?.addEventListener('click', closeSyncModal);
  safe('btn-save-sync')?.addEventListener('click', saveSyncConfig);
  safe('btn-detect-mappings')?.addEventListener('click', detectMappings);

  // Add Field Modal
  safe('btn-cancel-field')?.addEventListener('click', closeAddFieldModal);
  safe('btn-save-field')?.addEventListener('click', saveCustomField);
  safe('btn-remove-field')?.addEventListener('click', removeCustomField);

  // Web Server
  safe('btn-start-server')?.addEventListener('click', startWebServer);
  safe('btn-stop-server')?.addEventListener('click', stopWebServer);
  safe('btn-close-server-modal')?.addEventListener('click', closeServerModal);
  safe('btn-copy-url')?.addEventListener('click', copyServerUrl);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = e.target.getAttribute('data-tab');
      switchTab(tabName);
    });
  });

  // Close modals on background click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  // Close buttons
  document.querySelectorAll('.close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.currentTarget.closest('.modal');
      if (modal) closeModal(modal);
    });
  });

  // Mobile nav
  safe('nav-home')?.addEventListener('click', () => {
    document.getElementById('welcome-screen').scrollIntoView({behavior:'smooth'});
    closeModal(document.getElementById('server-modal'));
    closeModal(document.getElementById('sync-modal'));
    closeModal(document.getElementById('settings-modal'));
  });

  safe('nav-settings')?.addEventListener('click', () => {
    openSettingsModal();
  });

  // Settings modal actions
  safe('settings-create-module')?.addEventListener('click', () => {
    document.getElementById('btn-new-module').click();
    closeSettingsModal();
  });
  safe('settings-sync-manager')?.addEventListener('click', () => {
    document.getElementById('btn-sync-manager').click();
    closeSettingsModal();
  });
  safe('settings-start-server')?.addEventListener('click', async () => {
    await startWebServer();
    closeSettingsModal();
  });
  

  safe('settings-close')?.addEventListener('click', closeSettingsModal);
  safe('settings-close-btn')?.addEventListener('click', closeSettingsModal);
}

// Developer settings: persist using localStorage and toggle UI
function initDevSettings() {
  try {
    const enabled = localStorage.getItem('devSettingsEnabled') === 'true';
    const checkbox = document.getElementById('settings-dev-toggle');
    if (checkbox) {
      checkbox.checked = enabled;
      checkbox.addEventListener('change', (e) => {
        const val = !!e.target.checked;
        localStorage.setItem('devSettingsEnabled', val ? 'true' : 'false');
        applyDevSettings(val);
      });
    }
    applyDevSettings(enabled);
    // If developer settings are enabled, attach input diagnostics to help
    // reproduce intermittent input/focus issues (only logs to DevTools).
    if (enabled) {
      try {
        enableInputDiagnostics();
      } catch (e) {
        console.warn('Failed to enable input diagnostics', e);
      }
    }
  } catch (err) {
    console.warn('Dev settings init failed:', err);
  }
}

// Scanner demo buttons removed - clean version

// Developer-only diagnostics: log input focus, blur and pointer events.
// Enabled when Developer Settings are toggled on to help reproduce focus/time-input bugs.
function enableInputDiagnostics() {
  if (window.__inputDiagnosticsEnabled) return;
  window.__inputDiagnosticsEnabled = true;

  console.info('[Diagnostics] Input diagnostics enabled');

  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
      console.info('[Diagnostics] focusin', { tag: t.tagName, type: t.type, id: t.id, name: t.name, value: t.value });
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) {
      console.info('[Diagnostics] focusout', { tag: t.tagName, type: t.type, id: t.id, name: t.name, value: t.value });
    }
  }, true);

  document.addEventListener('pointerdown', (e) => {
    const t = e.target;
    console.info('[Diagnostics] pointerdown', { tag: t && t.tagName, id: t && t.id, classes: t && t.className });
  }, true);

  // Log modal open/close events (class changes)
  const observer = new MutationObserver(muts => {
    muts.forEach(mut => {
      if (mut.type === 'attributes' && mut.attributeName === 'class') {
        const el = mut.target;
        if (el && el.classList) {
          if (el.classList.contains('modal') && el.classList.contains('active')) {
            console.info('[Diagnostics] modal opened', { id: el.id });
          } else if (el.classList.contains('modal') && !el.classList.contains('active')) {
            console.info('[Diagnostics] modal closed', { id: el.id });
          }
        }
      }
    });
  });

  document.querySelectorAll('.modal').forEach(m => observer.observe(m, { attributes: true }));
}

function applyDevSettings(enabled) {
  // Show/hide Add Field button in module view
  const addFieldBtn = document.getElementById('btn-add-field');
  if (addFieldBtn) addFieldBtn.style.display = enabled && currentModule?.mode === 'offline' ? 'inline-block' : 'none';

  // Show/hide Sync Manager button (header)
  const syncBtn = document.getElementById('btn-sync-manager');
  // Respect global advanced buttons flag: if advanced buttons are disabled, force-hide sync/new module
  const advancedAllowed = (typeof window.showAdvancedButtons !== 'undefined') ? !!window.showAdvancedButtons : true;
  if (syncBtn) syncBtn.style.display = (enabled && advancedAllowed) ? 'inline-block' : 'none';

  // Show/hide New Module button (header) — only available when developer settings enabled
  const newModuleBtn = document.getElementById('btn-new-module');
  if (newModuleBtn) newModuleBtn.style.display = (enabled && advancedAllowed) ? 'inline-block' : 'none';

  // Show/hide Delete Module button (same as Add Field behavior)
  const deleteBtn = document.getElementById('btn-delete-module');
  if (deleteBtn) deleteBtn.style.display = (enabled && advancedAllowed) ? 'inline-block' : 'none';

  // Also adjust module item actions if present (desktop sidebar)
  document.querySelectorAll('.module-item .module-item-mode').forEach(el => {
    el.style.display = 'block';
  });

  // Show/hide primary search field selector in module modal when dev settings enabled
  const psGroup = document.getElementById('primary-search-field-group');
  if (psGroup) psGroup.style.display = enabled ? 'block' : 'none';
  // Update header indicator when dev settings change
  try {
    const indicator = document.getElementById('module-primary-search-indicator');
    const nameEl = document.getElementById('module-primary-search-name');
    if (indicator && nameEl && currentModule) {
      const p = currentModule.config && currentModule.config.primarySearchField;
      if (p) {
        nameEl.textContent = p;
        indicator.style.display = 'inline-block';
      } else {
        indicator.style.display = 'none';
      }
    }
  } catch (e) {}
}

// Module Management
async function loadModules() {
  try {
    const result = await API.getModules();
    // API.getModules may return an array or an object { modules: [...] }
    if (Array.isArray(result)) modules = result;
    else if (result && Array.isArray(result.modules)) modules = result.modules;
    else modules = [];
    renderModulesList();
  } catch (error) {
    console.error('Error loading modules:', error);
    showError('Failed to load modules');
  }
}

function renderModulesList() {
  const sidebarContainer = document.getElementById('modules-list');

  if (sidebarContainer) {
    if (modules.length === 0) {
      sidebarContainer.innerHTML = '<p class="empty-state">No modules yet. Create one to get started!</p>';
    } else {
      sidebarContainer.innerHTML = modules.map(module => `
        <div class="module-item ${currentModule?.id === module.id ? 'active' : ''}" 
             onclick="selectModule('${module.id}')">
          <div class="module-item-name">${module.name}</div>
          <div class="module-item-mode">${module.mode === 'online' ? '🌐 Online' : '💾 Offline'}</div>
        </div>
      `).join('');
    }
  }

  // Also render module cards on the main welcome screen
  const cards = document.getElementById('modules-cards');
    if (cards) {
      if (modules.length === 0) {
        cards.innerHTML = '<p class="empty-state">No modules yet. Create one to get started!</p>';
      } else {
        cards.innerHTML = modules.map(m => `
        <div class="module-card" onclick="selectModule('${m.id}')">
          <div class="mc-title">${m.name}</div>
          <div class="mc-sub">${m.mode === 'online' ? 'Online • Remote API' : 'Offline • Local JSON/Excel'}</div>
          <div class="mc-meta">
            <div class="mc-badge">${m.mode === 'online' ? 'Online' : 'Offline'}</div>
            <div style="flex:1"></div>
          </div>
        </div>
      `).join('');
      }
    }
}

async function selectModule(moduleId) {
  try {
    currentModule = modules.find(m => m.id === moduleId);
    if (!currentModule) return;

    renderModulesList();
    // Reset paging on module switch
    currentPage = 0;
    await loadModuleData();
    showModuleView();
  } catch (error) {
    console.error('Error selecting module:', error);
    showError('Failed to load module');
  }
}

async function loadModuleData() {
  try {
    if (!currentModule) return;
    console.info('[DEBUG] loadModuleData: module=', currentModule?.id, currentModule?.name, 'mode=', currentModule?.mode, 'page=', currentPage, 'pageSize=', pageSize);
    const moduleTitleEl = document.getElementById('module-title');
    if (moduleTitleEl) moduleTitleEl.textContent = currentModule.name;
    const badge = document.getElementById('module-mode-badge');
    if (badge) {
      badge.textContent = currentModule.mode === 'online' ? 'Online' : 'Offline';
      badge.className = `badge ${currentModule.mode}`;
    }

    // Show/hide add field button for offline modules
    const addFieldBtn = document.getElementById('btn-add-field');
    try {
      const devEnabled = localStorage.getItem('devSettingsEnabled') === 'true';
      if (addFieldBtn) addFieldBtn.style.display = (devEnabled && currentModule.mode === 'offline') ? 'inline-block' : 'none';
      const deleteBtn = document.getElementById('btn-delete-module');
      if (deleteBtn) deleteBtn.style.display = devEnabled ? 'inline-block' : 'none';
    } catch (err) {
      if (addFieldBtn) addFieldBtn.style.display = currentModule.mode === 'offline' ? 'inline-block' : 'none';
    }

      // Fetch paginated data
      const offset = currentPage * pageSize;
      let result;
      if (currentModule.mode === 'online') {
        try {
          console.info('[DEBUG] API call: onlineFetchRecords', { moduleId: currentModule.id, offset, pageSize });
          result = await API.onlineFetchRecords(currentModule.id, offset, pageSize);
        } catch (err) {
          console.warn('onlineFetchRecords failed, falling back:', err && err.message);
          console.info('[DEBUG] API call: onlineFetchData', { moduleId: currentModule.id });
          result = await API.onlineFetchData(currentModule.id);
        }
      } else {
        try {
          console.info('[DEBUG] API call: offlineFetchRecords', { moduleId: currentModule.id, offset, pageSize });
          result = await API.offlineFetchRecords(currentModule.id, offset, pageSize);
        } catch (err) {
          console.warn('offlineFetchRecords failed, falling back:', err && err.message);
          console.info('[DEBUG] API call: offlineFetchData', { moduleId: currentModule.id });
          result = await API.offlineFetchData(currentModule.id);
        }
      }

    if (result && result.success) {
      totalRecords = result.total || (result.data ? result.data.length : 0);
      console.info('[DEBUG] loadModuleData: received', { total: totalRecords, sample: (result.data && result.data.length>0) ? result.data[0] : null });
      renderDataTable(result.data || []);
      renderPaginationControls();
      // Update primary-search indicator in header
      try {
        const indicator = document.getElementById('module-primary-search-indicator');
        const nameEl = document.getElementById('module-primary-search-name');
        if (indicator && nameEl && currentModule) {
          const p = currentModule.config && currentModule.config.primarySearchField;
          if (p) {
            nameEl.textContent = p;
            indicator.style.display = 'inline-block';
          } else {
            indicator.style.display = 'none';
          }
        }
      } catch (e) {}
    } else {
      showError(result.error);
    }
  } catch (error) {
    console.error('Error loading module data:', error);
    showError('Failed to load data');
  }
}

function renderDataTable(data) {
  try {
    console.info('[DEBUG] renderDataTable: module=', currentModule?.id, currentModule?.name, 'dataLength=', Array.isArray(data)?data.length:0);
    // Apply search filtering if a query is present.
    try {
      if (searchQuery && searchQuery.length > 0 && Array.isArray(data) && currentModule) {
        const primary = (currentModule.config && currentModule.config.primarySearchField) || (currentModule.config && currentModule.config.idField) || '';
        const q = searchQuery.toLowerCase();
        console.info('[Search] applying filter', { query: searchQuery, primary });
        if (primary) {
          data = data.filter(r => {
            try {
              const v = r[primary];
              return (v !== undefined && v !== null) && String(v).toLowerCase().indexOf(q) !== -1;
            } catch (e) { return false; }
          });
          console.info('[Search] matched', data.length, 'records using primary', primary);
        } else {
          // Fallback: search across top-level string fields
          data = data.filter(r => Object.keys(r).some(k => {
            try { const v = r[k]; return v !== undefined && v !== null && String(v).toLowerCase().indexOf(q) !== -1; } catch (e) { return false; }
          }));
          console.info('[Search] matched', data.length, 'records using fallback');
        }
      }
    } catch (e) {
      console.warn('Search filtering failed', e);
    }
    const tableHead = document.getElementById('table-head');
    const tableBody = document.getElementById('table-body');
    const noDataMessage = document.getElementById('no-data-message');
    const table = document.getElementById('data-table');

    // Determine module fields from current module config
    const moduleFields = currentModule?.config?.fields || [];
    console.debug('[DEBUG] renderDataTable: moduleFields=', moduleFields);

    // If no data but module fields are provided, render header from fields (omit id)
    if ((!data || data.length === 0) && moduleFields && moduleFields.length > 0) {
      const keys = moduleFields.map(f => f.name);

      // Render header only
      tableHead.innerHTML = `
        <tr>
          ${keys.map(key => `<th>${formatLabel(key)}</th>`).join('')}
          <th>Actions</th>
        </tr>
      `;

      tableBody.innerHTML = '';
      table.style.display = 'table';
      noDataMessage.style.display = 'block';
      return;
    }

    if (!data || data.length === 0) {
      table.style.display = 'none';
      noDataMessage.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    noDataMessage.style.display = 'none';

    // Determine column keys: prefer module schema fields, but include any data keys not in the schema
    const moduleFieldDefs = getModuleFieldDefs(currentModule).filter(f => !['id','created_at','updated_at'].includes(f.name));
    const schemaKeys = (moduleFieldDefs && moduleFieldDefs.length > 0) ? moduleFieldDefs.map(f => f.name) : [];
    const dataKeys = [...new Set((Array.isArray(data)?data:[]).flatMap(Object.keys))].filter(k => k !== 'id');
    console.debug('[DEBUG] renderDataTable: dataKeys=', dataKeys);

    // Keep a reference to last data for debugging in DevTools
    try { window.__lastData = Array.isArray(data) ? data : []; } catch (e) {}

    // Build a normalized map of actual data keys (from returned records)
    const normalizeKey = (s) => String(s || '').toLowerCase().replace(/[\s_]+/g, '').replace(/[^a-z0-9]/g, '');
    const dataKeyMap = new Map();
    for (const dk of dataKeys) dataKeyMap.set(normalizeKey(dk), dk);

    // Columns: preserve schema order and map headers to real data keys when possible.
    // Enforce schema-only columns by default; allow extra columns if module config opts in.
    const allowExtra = !!currentModule?.config?.allowExtraColumns;
    const seen = new Set();
    const columns = [];

    for (const sk of schemaKeys) {
      const nk = normalizeKey(sk);
      if (seen.has(nk)) continue;
      seen.add(nk);
      const mapped = dataKeyMap.get(nk) || sk;
      if (!dataKeyMap.has(nk)) {
        console.warn('[renderDataTable] schema key has no matching data key:', sk, 'module=', currentModule?.id);
      }
      columns.push({ header: sk, key: mapped });
    }

    // Append any remaining data keys not matched by schema only when allowed
    if (allowExtra) {
      for (const dk of dataKeys) {
        const nk = normalizeKey(dk);
        if (seen.has(nk)) continue;
        seen.add(nk);
        columns.push({ header: dk, key: dk });
      }
    }

    // Render header
    tableHead.innerHTML = `
      <tr>
        ${columns.map(c => `<th>${formatLabel(c.header)}</th>`).join('')}
        <th>Actions</th>
      </tr>
    `;

    // Render body using mapped data keys so values come from actual record properties
    tableBody.innerHTML = data.map(record => {
      console.debug('[DEBUG] renderDataTable: rendering record sample keys=', Object.keys(record).slice(0,6));
      const recordId = record.id || record[currentModule.config?.idField || 'id'];
      const cells = columns.map(col => {
        const value = record[col.key];
        // display human-readable time for common timestamp keys
        if (/createdAt|updatedAt|created_at|updated_at|timestamp/i.test(col.key)) {
          return `<td>${formatValue(value)}</td>`;
        }
        return `<td>${formatValue(value)}</td>`;
      }).join('');

      return `
        <tr>
          ${cells}
          <td class="actions">
            <button class="btn btn-sm btn-secondary" onclick='editRecord(${JSON.stringify(record)})'>Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteRecord('${recordId}')">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error rendering data table:', err);
    showError('Failed to render table: ' + (err.message || err));
  }
}

// Utility: create a human-friendly short id for display
function formatFriendlyId(id) {
  if (!id) return '';
  // If looks like UUID, show start...end
  if (/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(id)) {
    return id.slice(0, 8) + '…' + id.slice(-4);
  }
  // For long strings, shorten
  if (id.length > 14) return id.slice(0, 6) + '…' + id.slice(-4);
  return id;
}

function copyFullId(text) {
  try {
    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showSuccess('ID copied to clipboard');
  } catch (err) {
    console.error('Copy failed', err);
    showError('Failed to copy ID');
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeJs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabel(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  // If value looks like ISO timestamp, format human-readable
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d)) return d.toLocaleString();
  }

  // If value is a numeric epoch (seconds or milliseconds)
  if (typeof value === 'number') {
    // treat as ms if large (> 1e10), else seconds
    const asMs = value > 1e10 ? value : value * 1000;
    const d = new Date(asMs);
    if (!isNaN(d) && Math.abs(Date.now() - asMs) < 1000 * 60 * 60 * 24 * 365 * 50) {
      return d.toLocaleString();
    }
  }

  return String(value);
}

// Pagination controls
function renderPaginationControls() {
  const containerId = 'pagination-controls';
  let container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil((totalRecords || 0) / pageSize));
  const info = `Page ${currentPage + 1} of ${totalPages} • ${totalRecords} records`;

  container.innerHTML = `
    <div class="pagination-row">
      <button class="btn btn-secondary" id="page-prev" ${currentPage === 0 ? 'disabled' : ''}>◀ Prev</button>
      <div class="page-info">${info}</div>
      <button class="btn btn-secondary" id="page-next" ${currentPage + 1 >= totalPages ? 'disabled' : ''}>Next ▶</button>
      <select id="page-size-select" class="page-size-select">
        <option value="20" ${pageSize===20? 'selected':''}>20</option>
        <option value="50" ${pageSize===50? 'selected':''}>50</option>
        <option value="100" ${pageSize===100? 'selected':''}>100</option>
      </select>
    </div>
  `;

  document.getElementById('page-prev').addEventListener('click', async () => {
    if (currentPage === 0) return;
    currentPage -= 1;
    await loadModuleData();
  });

  document.getElementById('page-next').addEventListener('click', async () => {
    const totalPages = Math.max(1, Math.ceil((totalRecords || 0) / pageSize));
    if (currentPage + 1 >= totalPages) return;
    currentPage += 1;
    await loadModuleData();
  });

  document.getElementById('page-size-select').addEventListener('change', async (e) => {
    pageSize = parseInt(e.target.value, 10) || 50;
    currentPage = 0;
    await loadModuleData();
  });
}

// Module Modal
function openModuleModal(editMode = false) {
  const modal = document.getElementById('module-modal');
  const title = document.getElementById('module-modal-title');
  
  if (editMode && currentModule) {
    title.textContent = 'Edit Module';
    document.getElementById('module-name').value = currentModule.name;
    document.getElementById('module-mode').value = currentModule.mode;
    document.getElementById('module-mode').disabled = true; // Can't change mode
    
    if (currentModule.mode === 'online') {
      document.getElementById('api-list').value = currentModule.config.apiEndpoints.list;
      document.getElementById('api-create').value = currentModule.config.apiEndpoints.create;
      document.getElementById('api-update').value = currentModule.config.apiEndpoints.update;
      document.getElementById('api-delete').value = currentModule.config.apiEndpoints.delete;
      document.getElementById('api-headers').value = JSON.stringify(currentModule.config.headers, null, 2);
      document.getElementById('api-id-field').value = currentModule.config.idField;
      // Populate primary search field input/datalist if configured or metadata available
      try {
        const input = document.getElementById('primary-search-field-input');
        const list = document.getElementById('primary-search-field-list');
        if (input && list) {
          const meta = currentModule.config.metadata || fetchedMetadata || { fields: [] };
          const options = (meta.fields || []).map(f => `<option value="${f.name}">${f.label || f.name}</option>`).join('');
          list.innerHTML = options;
          const currentPrimary = currentModule.config.primarySearchField || '';
          input.value = currentPrimary;
        }
      } catch (e) {
        console.warn('openModuleModal: failed populating primary search field', e);
      }
    }
    // Also populate primary-search-field input for offline modules
    try {
      if (currentModule.mode === 'offline') {
        const input = document.getElementById('primary-search-field-input');
        const list = document.getElementById('primary-search-field-list');
        if (input && list) {
          const fields = (currentModule.config && Array.isArray(currentModule.config.fields)) ? currentModule.config.fields : [];
          list.innerHTML = fields.map(f => `<option value="${f.name}">${f.label || f.name}</option>`).join('');
          input.value = (currentModule.config && currentModule.config.primarySearchField) || '';
        }
      }
    } catch (e) {}
    
    toggleModeConfig();
  } else {
    title.textContent = 'Create Module';
    document.getElementById('module-form')?.reset();
    if (document.getElementById('module-mode')) document.getElementById('module-mode').disabled = false;
    toggleModeConfig();
  }
  
  openModal(modal);
}

function closeModuleModal() {
  const modal = document.getElementById('module-modal');
  closeModal(modal);
  document.getElementById('module-form')?.reset();
  fetchedMetadata = null;
  if (document.getElementById('metadata-preview')) document.getElementById('metadata-preview').style.display = 'none';
}

// Sidebar toggle for mobile
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const isVisible = sidebar.style.display !== 'none' && getComputedStyle(sidebar).display !== 'none';
  if (window.innerWidth <= 600) {
    sidebar.style.display = isVisible ? 'none' : 'block';
    sidebar.style.position = isVisible ? '' : 'fixed';
    sidebar.style.zIndex = isVisible ? '' : '1300';
    sidebar.style.left = isVisible ? '' : '0';
    sidebar.style.top = isVisible ? '' : '64px';
    sidebar.style.height = isVisible ? '' : 'calc(100% - 64px)';
    sidebar.style.boxShadow = isVisible ? '' : '0 8px 24px rgba(0,0,0,0.15)';
  }
}

function toggleModeConfig() {
  const mode = document.getElementById('module-mode').value;
  const onlineConfig = document.getElementById('online-config');
  const offlineConfig = document.getElementById('offline-config');

  if (mode === 'online') {
    onlineConfig.style.display = 'block';
    offlineConfig.style.display = 'none';
  } else {
    onlineConfig.style.display = 'none';
    offlineConfig.style.display = 'block';
  }
}

async function fetchMetadata() {
  const apiUrl = document.getElementById('api-list').value;
  const headersText = document.getElementById('api-headers').value;

  if (!apiUrl) {
    showError('Please enter the List API URL');
    return;
  }

  let headers = {};
  if (headersText.trim()) {
    try {
      headers = JSON.parse(headersText);
    } catch (error) {
      showError('Invalid JSON in headers');
      return;
    }
  }

  try {
    const result = await API.fetchApiMetadata(apiUrl, headers);
    
    if (result.success) {
      fetchedMetadata = result.metadata;
      displayMetadata(result.metadata);
      showSuccess('Metadata fetched successfully');
    } else {
      showError(result.error);
    }
  } catch (error) {
    console.error('Error fetching metadata:', error);
    showError('Failed to fetch metadata');
  }
}

function displayMetadata(metadata) {
  const preview = document.getElementById('metadata-preview');
  const fieldsList = document.getElementById('metadata-fields-list');

  fieldsList.innerHTML = metadata.fields.map(field => 
    `<li>${field.label || field.name} (${field.name}) - ${field.type || 'string'}</li>`
  ).join('');

  // Populate primary search datalist/input if present
  try {
    const list = document.getElementById('primary-search-field-list');
    const input = document.getElementById('primary-search-field-input');
    if (list) {
      list.innerHTML = metadata.fields.map(f => `<option value="${f.name}">${f.label || f.name}</option>`).join('');
    }
    if (input && !input.value) {
      // leave existing input value if user already typed
      input.value = '';
    }
  } catch (e) {
    console.warn('populate primary search field failed', e);
  }

  preview.style.display = 'block';
}

async function saveModule() {
  const name = document.getElementById('module-name').value;
  const mode = document.getElementById('module-mode').value;

  if (!name) {
    showError('Please enter module name');
    return;
  }

  const moduleData = { name, mode };

  if (mode === 'online') {
    const apiList = document.getElementById('api-list').value;
    const apiCreate = document.getElementById('api-create').value;
    const apiUpdate = document.getElementById('api-update').value;
    const apiDelete = document.getElementById('api-delete').value;
    const headersText = document.getElementById('api-headers').value;
    const idField = document.getElementById('api-id-field').value || 'id';

    if (!apiList || !apiCreate || !apiUpdate || !apiDelete) {
      showError('Please fill all API endpoints');
      return;
    }

    let headers = {};
    if (headersText.trim()) {
      try {
        headers = JSON.parse(headersText);
      } catch (error) {
        showError('Invalid JSON in headers');
        return;
      }
    }

    moduleData.config = {
      apiEndpoints: {
        list: apiList,
        create: apiCreate,
        update: apiUpdate,
        delete: apiDelete
      },
      headers,
      idField,
      metadata: fetchedMetadata,
      primarySearchField: (document.getElementById('primary-search-field-input') && document.getElementById('primary-search-field-input').value) || (currentModule && currentModule.config && currentModule.config.primarySearchField) || ''
    };
  }

  try {
    let result;
    if (currentModule && document.getElementById('module-modal-title').textContent === 'Edit Module') {
      result = await API.updateModule(currentModule.id, moduleData);
    } else {
      result = await API.createModule(moduleData);
    }

    await loadModules();
    closeModuleModal();
    showSuccess('Module saved successfully');
    
    if (result.id) {
      selectModule(result.id);
    }
  } catch (error) {
    console.error('Error saving module:', error);
    showError('Failed to save module');
  }
}

async function editCurrentModule() {
  if (currentModule) {
    openModuleModal(true);
  }
}

async function deleteCurrentModule() {
  if (!currentModule) return;

  if (confirm(`Are you sure you want to delete "${currentModule.name}"? This action cannot be undone.`)) {
    try {
      await API.deleteModule(currentModule.id);
      currentModule = null;
      await loadModules();
      showSuccess('Module deleted successfully');
      // Reload the page so UI/state is cleared and modules list refreshes
      setTimeout(() => location.reload(), 300);
    } catch (error) {
      console.error('Error deleting module:', error);
      showError('Failed to delete module');
    }
  }
}

async function refreshCurrentModule() {
  if (currentModule) {
    await loadModuleData();
    showSuccess('Data refreshed');
  }
}

// Record Management
function openRecordModal(record = null) {
  if (!currentModule) return;

  const modal = document.getElementById('record-modal');
  const title = document.getElementById('record-modal-title');
  const form = document.getElementById('record-form');

  currentRecord = record;

  console.info('[DEBUG] openRecordModal: module=', currentModule?.id, currentModule?.name, 'isEdit=', !!record);

  if (record) {
    title.textContent = 'Edit Record';
  } else {
    title.textContent = 'Add Record';
  }

  // Get fields from module schema (metadata or config). Always exclude id/created/updated.
  let fields = getModuleFieldDefs(currentModule).filter(f => !['id','created_at','updated_at'].includes(f.name));

  // Generate form
  // Determine whether barcode/QR scan buttons should be shown.
  const barcodeEnabled = (typeof window.showAdvancedBarcode !== 'undefined')
    ? !!window.showAdvancedBarcode
    : (typeof window['show advanced barcode'] !== 'undefined')
      ? !!window['show advanced barcode']
      : false;

  form.innerHTML = fields.map(field => {
    const value = record ? (record[field.name] || '') : '';
    
    switch (field.type) {
      case 'number':
        return `
          <div class="form-group">
            <label for="field-${field.name}">${field.label || field.name}</label>
            <input type="number" id="field-${field.name}" name="${field.name}" value="${value}">
          </div>
        `;
      case 'boolean':
        return `
          <div class="form-group">
            <label>
              <input type="checkbox" id="field-${field.name}" name="${field.name}" ${value ? 'checked' : ''}>
              ${field.label || field.name}
            </label>
          </div>
        `;
      case 'date':
        return `
          <div class="form-group">
            <label for="field-${field.name}">${field.label || field.name}</label>
            <input type="date" id="field-${field.name}" name="${field.name}" value="${value}">
          </div>
        `;
      default:
        // Add scan buttons only when barcode/QR features are enabled
        return `
          <div class="form-group">
            <label for="field-${field.name}">${field.label || field.name}</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="text" id="field-${field.name}" name="${field.name}" value="${value}" style="flex:1">
              ${barcodeEnabled ? `
              <div class="btn-group" role="group">
                <button type="button" class="btn btn-sm btn-outline-primary scan-btn" data-field="${field.name}" data-type="qr" title="Scan QR Code">
                  <i class="fas fa-qrcode" style="font-size:12px;"></i> QR
                </button>
                <button type="button" class="btn btn-sm btn-outline-success scan-btn" data-field="${field.name}" data-type="barcode" title="Scan Barcode">
                  <i class="fas fa-barcode" style="font-size:12px;"></i> Barcode
                </button>
              </div>
              ` : ''}
            </div>
          </div>
        `;
    }
  }).join('');

  console.debug('[DEBUG] openRecordModal: renderedFields=', fields.map(f => ({ name: f.name, type: f.type })));

  // Attach listeners to dynamically created scan buttons
  document.querySelectorAll('.scan-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const field = e.currentTarget.dataset.field;
      const scanType = e.currentTarget.dataset.type || 'qr';
      openScannerModal(field, scanType);
    });
  });

  openModal(modal);
}

function closeRecordModal() {
  const modal = document.getElementById('record-modal');
  closeModal(modal);
  currentRecord = null;
}

async function saveRecord() {
  if (!currentModule) return;

  const form = document.getElementById('record-form');
  // Build data object only from module-defined fields
  const data = {};
  const fieldDefs = getModuleFieldDefs(currentModule).filter(f => !['id','created_at','updated_at'].includes(f.name));
  for (const f of fieldDefs) {
    const input = form.querySelector(`#field-${f.name}`) || form.querySelector(`[name="${f.name}"]`);
    if (!input) continue;
    if (input.type === 'checkbox') data[f.name] = input.checked;
    else if (input.type === 'number') data[f.name] = parseFloat(input.value) || 0;
    else data[f.name] = input.value;
  }

  console.info('[DEBUG] saveRecord: prepared payload for module=', currentModule?.id, currentModule?.name, 'payload=', data, 'isEdit=', !!currentRecord);

  try {
    let result;
    if (currentRecord) {
      const recordId = currentRecord.id || currentRecord[currentModule.config?.idField || 'id'];
      if (currentModule.mode === 'online') {
        result = await API.onlineUpdateRecord(currentModule.id, recordId, data);
      } else {
        result = await API.offlineUpdateRecord(currentModule.id, recordId, data);
      }
    } else {
      if (currentModule.mode === 'online') {
        result = await API.onlineCreateRecord(currentModule.id, data);
      } else {
        result = await API.offlineCreateRecord(currentModule.id, data);
      }
    }

    if (result.success) {
      closeRecordModal();
      await loadModuleData();
      showSuccess('Record saved successfully');
    } else {
      showError(result.error);
    }
  } catch (error) {
    console.error('Error saving record:', error);
    showError('Failed to save record');
  }
}

function editRecord(record) {
  openRecordModal(record);
}

async function deleteRecord(recordId) {
  if (!currentModule) return;

  if (confirm('Are you sure you want to delete this record?')) {
    try {
      let result;
      if (currentModule.mode === 'online') {
        result = await API.onlineDeleteRecord(currentModule.id, recordId);
      } else {
        result = await API.offlineDeleteRecord(currentModule.id, recordId);
      }

      if (result.success) {
        await loadModuleData();
        showSuccess('Record deleted successfully');
      } else {
        showError(result.error);
      }
    } catch (error) {
      console.error('Error deleting record:', error);
      showError('Failed to delete record');
    }
  }
}

// Add Field functionality
function openAddFieldModal() {
  if (!currentModule || currentModule.mode !== 'offline') {
    console.info('openAddFieldModal: aborted, currentModule:', currentModule);
    return;
  }

  // Be defensive: the form/modal may not exist in some DOM states
  const form = document.getElementById('add-field-form');
  const modal = document.getElementById('add-field-modal');
  console.info('openAddFieldModal: called, currentModule:', currentModule, 'form:', !!form, 'modal:', !!modal);
  form?.reset();

  // Populate remove-field select with current module custom fields (if available)
  try {
    const removeSelect = document.getElementById('remove-field-select');
    const removeBtn = document.getElementById('btn-remove-field');
    if (removeSelect && removeBtn) {
      // Clear existing options
      removeSelect.innerHTML = '';
      if (currentModule && currentModule.config && Array.isArray(currentModule.config.fields) && currentModule.config.fields.length > 0) {
        // Use module config fields; exclude id/created/updated
        const candidates = currentModule.config.fields.map(f => f.name).filter(n => n && !['id','created_at','updated_at'].includes(n));
        if (candidates.length > 0) {
          candidates.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name; removeSelect.appendChild(opt);
          });
          removeSelect.style.display = '';
          removeBtn.style.display = '';
        } else {
          removeSelect.style.display = 'none';
          removeBtn.style.display = 'none';
        }
      } else {
        removeSelect.style.display = 'none';
        removeBtn.style.display = 'none';
      }
    }
  } catch (e) {
    console.warn('openAddFieldModal: failed to populate remove-field select', e);
  }

  if (modal) {
    // Normal path: use unified opener which also ensures modal is attached to body
    openModal(modal);

    // No inline fallback; rely on CSS and relocateModalsToBody to ensure visibility
  } else {
    console.warn('openAddFieldModal: modal element not found');
  }
}

function closeAddFieldModal() {
  const modal = document.getElementById('add-field-modal');
  closeModal(modal);
}

async function saveCustomField() {
  const fieldName = document.getElementById('field-name').value;
  const fieldType = document.getElementById('field-type').value;

  if (!fieldName) {
    showError('Please enter field name');
    return;
  }

  try {
    const result = await API.offlineAddField(currentModule.id, fieldName, fieldType);
    
    if (result.success) {
      closeAddFieldModal();
      await loadModuleData();
      showSuccess('Field added successfully');
      // Reload the page so UI and module lists reflect the new field/schema
      setTimeout(() => location.reload(), 300);
    } else {
      showError(result.error);
    }
  } catch (error) {
    console.error('Error adding field:', error);
    showError('Failed to add field');
  }
}

async function removeCustomField() {
  const select = document.getElementById('remove-field-select');
  if (!select) return;
  const fieldName = select.value;
  if (!fieldName) {
    showError('No field selected to remove');
    return;
  }

  if (!currentModule) {
    showError('No module selected');
    return;
  }

  if (!confirm(`Are you sure you want to remove the field "${fieldName}" from module "${currentModule.name}"? This may delete data.`)) return;

  try {
    const result = await API.offlineRemoveField(currentModule.id, fieldName);
    if (result && result.success) {
      closeAddFieldModal();
      await loadModuleData();
      showSuccess('Field removed successfully');
      setTimeout(() => location.reload(), 300);
    } else {
      showError(result && result.error ? result.error : 'Failed to remove field');
    }
  } catch (e) {
    console.error('removeCustomField error', e);
    showError('Failed to remove field');
  }
}

// Sync Management
async function openSyncModal() {
  const modal = document.getElementById('sync-modal');
  openModal(modal);
  
  // Load modules for sync
  await populateSyncModules();
  await loadSyncConfigs();
}

function closeSyncModal() {
  closeModal(document.getElementById('sync-modal'));
}

async function populateSyncModules() {
  const sourceSelect = document.getElementById('sync-source-module');
  const targetSelect = document.getElementById('sync-target-module');

  const options = modules.map(m => 
    `<option value="${m.id}">${m.name} (${m.mode})</option>`
  ).join('');

  sourceSelect.innerHTML = '<option value="">Select Source Module</option>' + options;
  targetSelect.innerHTML = '<option value="">Select Target Module</option>' + options;
}

async function loadSyncConfigs() {
  try {
    const result = await API.getSyncConfigs();
    
    if (result.success) {
      renderSyncConfigs(result.configs);
    }
  } catch (error) {
    console.error('Error loading sync configs:', error);
  }
}

function renderSyncConfigs(configs) {
  const container = document.getElementById('sync-configs-list');

  if (!configs || configs.length === 0) {
    container.innerHTML = '<p class="empty-state">No sync configurations yet</p>';
    return;
  }

  container.innerHTML = configs.map(config => {
    const sourceModule = modules.find(m => m.id === config.sourceModuleId);
    const targetModule = modules.find(m => m.id === config.targetModuleId);

    return `
      <div class="sync-config-item">
        <div class="sync-config-info">
          <h4>${config.name}</h4>
          <p>Source: ${sourceModule?.name || 'Unknown'} → Target: ${targetModule?.name || 'Unknown'}</p>
          <p>Bidirectional: ${config.bidirectional ? 'Yes' : 'No'} | Mappings: ${config.mappings?.length || 0}</p>
          <p style="font-size: 0.85rem; color: #999;">Last Sync: ${config.lastSyncAt ? new Date(config.lastSyncAt).toLocaleString() : 'Never'}</p>
        </div>
        <div class="sync-config-actions">
          <button class="btn btn-sm btn-success" onclick="executeSync('${config.id}')">Sync Now</button>
        </div>
      </div>
    `;
  }).join('');
}

async function detectMappings() {
  const sourceModuleId = document.getElementById('sync-source-module').value;
  const targetModuleId = document.getElementById('sync-target-module').value;

  if (!sourceModuleId || !targetModuleId) {
    showError('Please select both source and target modules');
    return;
  }

  if (sourceModuleId === targetModuleId) {
    showError('Source and target modules must be different');
    return;
  }

  try {
    const result = await API.getSyncMappings(sourceModuleId, targetModuleId);
    
    if (result.success) {
      renderMappings(result);
      document.getElementById('btn-save-sync').style.display = 'inline-block';
    } else {
      showError(result.error);
    }
  } catch (error) {
    console.error('Error detecting mappings:', error);
    showError('Failed to detect mappings');
  }
}

function renderMappings(mappingResult) {
  const container = document.getElementById('mappings-container');
  const mappingsList = document.getElementById('mappings-list');

  const { sourceModule, targetModule, suggestedMappings } = mappingResult;

  mappingsList.innerHTML = suggestedMappings.map((mapping, index) => `
    <div class="mapping-item">
      <select id="source-field-${index}" data-mapping-index="${index}">
        ${sourceModule.fields.map(field => 
          `<option value="${field.name}" ${field.name === mapping.sourceField ? 'selected' : ''}>
            ${field.label || field.name}
          </option>`
        ).join('')}
      </select>
      <span class="mapping-arrow">→</span>
      <select id="target-field-${index}" data-mapping-index="${index}">
        ${targetModule.fields.map(field => 
          `<option value="${field.name}" ${field.name === mapping.targetField ? 'selected' : ''}>
            ${field.label || field.name}
          </option>`
        ).join('')}
      </select>
      <span style="font-size: 0.85rem; color: ${mapping.autoMapped ? 'green' : 'orange'};">
        ${mapping.autoMapped ? '✓ Auto' : '⚠ Manual'}
      </span>
    </div>
  `).join('');

  container.style.display = 'block';
  container.dataset.sourceModuleId = sourceModule.id;
  container.dataset.targetModuleId = targetModule.id;
}

async function saveSyncConfig() {
  const name = document.getElementById('sync-name').value;
  const sourceModuleId = document.getElementById('sync-source-module').value;
  const targetModuleId = document.getElementById('sync-target-module').value;
  const bidirectional = document.getElementById('sync-bidirectional').checked;

  if (!name || !sourceModuleId || !targetModuleId) {
    showError('Please fill all required fields');
    return;
  }

  // Collect mappings
  const mappings = [];
  const mappingItems = document.querySelectorAll('.mapping-item');
  
  mappingItems.forEach((item, index) => {
    const sourceField = document.getElementById(`source-field-${index}`).value;
    const targetField = document.getElementById(`target-field-${index}`).value;
    
    mappings.push({
      sourceField,
      targetField
    });
  });

  if (mappings.length === 0) {
    showError('Please detect field mappings first');
    return;
  }

  const syncConfig = {
    name,
    sourceModuleId,
    targetModuleId,
    bidirectional,
    mappings
  };

  try {
    const result = await API.saveSyncConfig(syncConfig);
    
    if (result.success) {
      await loadSyncConfigs();
      switchTab('sync-list');
      document.getElementById('sync-form')?.reset();
      if (document.getElementById('mappings-container')) document.getElementById('mappings-container').style.display = 'none';
      if (document.getElementById('btn-save-sync')) document.getElementById('btn-save-sync').style.display = 'none';
      showSuccess('Sync configuration saved successfully');
    } else {
      showError(result.error);
    }
  } catch (error) {
    console.error('Error saving sync config:', error);
    showError('Failed to save sync configuration');
  }
}

async function executeSync(syncConfigId) {
  if (!confirm('Are you sure you want to execute this sync?')) return;

  try {
    showSuccess('Sync in progress...');
    const result = await API.executeSync(syncConfigId);
    
    if (result.success) {
      await loadSyncConfigs();
      showSuccess(`Sync completed! Created: ${result.results.created}, Updated: ${result.results.updated}, Errors: ${result.results.errors.length}`);
      
      if (result.results.errors.length > 0) {
        console.error('Sync errors:', result.results.errors);
      }
    } else {
      showError(result.error);
    }
  } catch (error) {
    console.error('Error executing sync:', error);
    showError('Failed to execute sync');
  }
}

// UI Helpers
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabName);
  });
}

function showWelcomeScreen() {
  const welcomeEl = document.getElementById('welcome-screen');
  const moduleViewEl = document.getElementById('module-view');
  if (welcomeEl) welcomeEl.style.display = 'block';
  if (moduleViewEl) moduleViewEl.style.display = 'none';
}

function showModuleView() {
  const welcomeEl = document.getElementById('welcome-screen');
  const moduleViewEl = document.getElementById('module-view');
  if (welcomeEl) welcomeEl.style.display = 'none';
  if (moduleViewEl) moduleViewEl.style.display = 'block';
}

function showError(message) {
  // Simple alert for now, can be replaced with toast notifications
  alert('Error: ' + message);
}

function showSuccess(message) {
  // Simple alert for now, can be replaced with toast notifications
  console.log('Success:', message);
}

// Web Server Management
async function checkServerStatus() {
  try {
    const result = await API.getServerStatus();
    if (result.success && result.isRunning) {
      serverRunning = true;
      updateServerButton(true);
    } else {
      serverRunning = false;
      updateServerButton(false);
    }
  } catch (error) {
    console.error('Error checking server status:', error);
  }
}

function updateServerButton(isRunning) {
  const btn = document.getElementById('btn-start-server');
  if (isRunning) {
    btn.textContent = '🌐 Server Running';
    btn.className = 'btn btn-success';
    btn.style.cursor = 'pointer';
  } else {
    btn.textContent = '🌐 Start Server';
    btn.className = 'btn btn-success';
    btn.style.cursor = 'pointer';
  }
}

async function startWebServer() {
  if (serverRunning) {
    // Server already running, show modal
    await showServerModal();
    return;
  }

  try {
    const btn = document.getElementById('btn-start-server');
    btn.textContent = '⏳ Starting...';
    btn.disabled = true;

    // If user has selected a preferred IP in the modal, pass it to the backend
    const ipSelect = document.getElementById('server-ip-select');
    const selectedIp = ipSelect && ipSelect.value ? ipSelect.value : null;
    // If TLS fields populated in modal, apply before starting
    try {
      if (selectedKeyPath && selectedCertPath) {
        await API.setWebServerTLS({ keyPath: selectedKeyPath, certPath: selectedCertPath });
      }
    } catch (e) {
      console.warn('Failed to apply TLS files before start:', e);
    }

    const result = await API.startWebServer(selectedIp);
    
    if (result.success) {
      serverRunning = true;
      updateServerButton(true);
      await showServerModal(result);
      showSuccess('Web server started successfully!');
    } else {
      showError(result.error || 'Failed to start server');
      updateServerButton(false);
    }
  } catch (error) {
    console.error('Error starting server:', error);
    showError('Failed to start server');
    updateServerButton(false);
  } finally {
    document.getElementById('btn-start-server').disabled = false;
  }
}

async function stopWebServer() {
  try {
    const result = await API.stopWebServer();
    
    if (result.success) {
      serverRunning = false;
      updateServerButton(false);
      closeServerModal();
      showSuccess('Web server stopped');
    } else {
      showError(result.error || 'Failed to stop server');
    }
  } catch (error) {
    console.error('Error stopping server:', error);
    showError('Failed to stop server');
  }
}

async function showServerModal(serverInfo = null) {
  const modal = document.getElementById('server-modal');
  
  // Get server info if not provided
  if (!serverInfo) {
    const result = await API.getServerStatus();
    if (result.success && result.isRunning) {
      serverInfo = result;
      // Generate QR code
      // server already running; serverInfo may include qrCode
      if (!serverInfo.qrCode) {
        // ensure QR present by generating via start (pass no-op)
        const qrResult = await API.startWebServer();
        if (qrResult.success && qrResult.qrCode) {
          serverInfo.qrCode = qrResult.qrCode;
        }
      }
    } else {
      showError('Server is not running');
      return;
    }
  }

  // Populate IP select with local IPv4 addresses
  try {
    const ipsResult = await API.getLocalIPs();
    const ipSelect = document.getElementById('server-ip-select');
    ipSelect.innerHTML = '';

    if (ipsResult && ipsResult.success && Array.isArray(ipsResult.ips)) {
      const ips = ipsResult.ips;
      // Group by type
      const wifi = ips.filter(i => i.type === 'wifi');
      const lan = ips.filter(i => i.type === 'lan');
      const other = ips.filter(i => i.type === 'other');

      const addOptions = (list, label) => {
        if (list.length === 0) return;
        const group = document.createElement('optgroup');
        group.label = label;
        list.forEach(item => {
          const opt = document.createElement('option');
          opt.value = item.address;
          opt.textContent = `${item.interface} — ${item.address}`;
          group.appendChild(opt);
        });
        ipSelect.appendChild(group);
      };

      addOptions(wifi, 'Wi-Fi');
      addOptions(lan, 'LAN');
      addOptions(other, 'Other');

      // Preselect the serverInfo.ipAddress if present
      if (serverInfo.ipAddress) {
        ipSelect.value = serverInfo.ipAddress;
      }
    }
  } catch (err) {
    console.error('Error populating IP select:', err);
  }

    // When user changes selected IP, regenerate URL and QR for the selected address
    try {
      const ipSelectEl = document.getElementById('server-ip-select');
      ipSelectEl.addEventListener('change', async (e) => {
        const selected = e.target.value;
        if (!selected) return;
        try {
          const newInfo = await API.regenerateServerInfo(selected);
          if (newInfo && newInfo.success) {
            document.getElementById('server-url').value = newInfo.url || document.getElementById('server-url').value;
            document.getElementById('server-ip').textContent = newInfo.ipAddress || selected;
            document.getElementById('server-port').textContent = newInfo.port || document.getElementById('server-port').textContent;
            if (newInfo.qrCode) document.getElementById('qr-code-image').src = newInfo.qrCode;
          } else {
            console.error('Failed to regenerate server info:', newInfo.error);
          }
        } catch (err) {
          console.error('Error regenerating server info:', err);
        }
      });
    } catch (err) {
      // ignore if select not found
    }

  // Populate modal with server info
  document.getElementById('server-url').value = serverInfo.url;
  document.getElementById('server-ip').textContent = serverInfo.ipAddress;
  document.getElementById('server-port').textContent = serverInfo.port;
  
  if (serverInfo.qrCode) {
    document.getElementById('qr-code-image').src = serverInfo.qrCode;
  }

  // TLS status update
  try {
    // Ask backend for status via getServerStatus
    const status = await API.getServerStatus();
    if (status && status.isRunning && status.url && status.url.startsWith('https')) {
      updateTLSStatus(true);
    } else {
      updateTLSStatus(false, 'TLS: unknown');
    }
  } catch (e) {
    // ignore
  }

  // Wire TLS UI buttons
  try {
    const keyBrowse = document.getElementById('btn-browse-key');
    const certBrowse = document.getElementById('btn-browse-cert');
    const keyDisplay = document.getElementById('tls-key-display');
    const certDisplay = document.getElementById('tls-cert-display');
    const applyBtn = document.getElementById('btn-apply-tls');
    const regenBtn = document.getElementById('btn-regenerate-tls');
    const tlsStatusEl = document.getElementById('tls-status');

    let selectedKeyPath = null;
    let selectedCertPath = null;

    keyBrowse.addEventListener('click', async () => {
      try {
        const result = await API.showOpenDialog({
          title: 'Select TLS Private Key File',
          filters: [{ name: 'PEM Files', extensions: ['pem', 'key'] }],
          properties: ['openFile']
        });
        if (!result.canceled && result.filePaths && result.filePaths[0]) {
          selectedKeyPath = result.filePaths[0];
          keyDisplay.textContent = selectedKeyPath;
        }
      } catch (e) {
        console.error('Error selecting key file:', e);
      }
    });

    certBrowse.addEventListener('click', async () => {
      try {
        const result = await API.showOpenDialog({
          title: 'Select TLS Certificate File',
          filters: [{ name: 'PEM Files', extensions: ['pem', 'crt', 'cert'] }],
          properties: ['openFile']
        });
        if (!result.canceled && result.filePaths && result.filePaths[0]) {
          selectedCertPath = result.filePaths[0];
          certDisplay.textContent = selectedCertPath;
        }
      } catch (e) {
        console.error('Error selecting cert file:', e);
      }
    });

    applyBtn.addEventListener('click', async () => {
      try {
        if (!selectedKeyPath || !selectedCertPath) {
          showError('Select both key and cert files before applying');
          return;
        }
        const res = await API.setWebServerTLS({ keyPath: selectedKeyPath, certPath: selectedCertPath });
        if (res && res.success) {
          updateTLSStatus(true);
          showSuccess('TLS files applied');

          // If server is running, restart it to apply TLS changes
          if (serverRunning) {
            try {
              await API.stopWebServer();
              const startResult = await API.startWebServer();
              if (startResult.success) {
                // Update modal UI with new URL and QR
                document.getElementById('server-url').value = startResult.url;
                document.getElementById('server-ip').textContent = startResult.ipAddress;
                document.getElementById('server-port').textContent = startResult.port;
                if (startResult.qrCode) {
                  document.getElementById('qr-code-image').src = startResult.qrCode;
                }
                showSuccess('Server restarted with TLS');
              } else {
                showError('Failed to restart server with TLS: ' + startResult.error);
                serverRunning = false;
                updateServerButton(false);
              }
            } catch (e) {
              console.error('Error restarting server:', e);
              showError('Failed to restart server with TLS');
              serverRunning = false;
              updateServerButton(false);
            }
          }
        } else {
          showError(res.error || 'Failed to apply TLS files');
        }
      } catch (e) {
        console.error('Error applying TLS files:', e);
        showError('Failed to apply TLS files');
      }
    });

    regenBtn.addEventListener('click', async () => {
      try {
        regenBtn.disabled = true;
        regenBtn.textContent = '⏳ Generating...';
        const res = await API.regenerateWebServerTLS();
        if (res && res.success) {
          keyDisplay.textContent = res.keyPath;
          certDisplay.textContent = res.certPath;
          selectedKeyPath = res.keyPath;
          selectedCertPath = res.certPath;
          updateTLSStatus(true);
          showSuccess('Self-signed certs generated');

          // If server is running, restart it to apply new TLS certs
          if (serverRunning) {
            try {
              await API.stopWebServer();
              const startResult = await API.startWebServer();
              if (startResult.success) {
                // Update modal UI with new URL and QR
                document.getElementById('server-url').value = startResult.url;
                document.getElementById('server-ip').textContent = startResult.ipAddress;
                document.getElementById('server-port').textContent = startResult.port;
                if (startResult.qrCode) {
                  document.getElementById('qr-code-image').src = startResult.qrCode;
                }
                showSuccess('Server restarted with new TLS certs');
              } else {
                showError('Failed to restart server with new TLS: ' + startResult.error);
                serverRunning = false;
                updateServerButton(false);
              }
            } catch (e) {
              console.error('Error restarting server:', e);
              showError('Failed to restart server with new TLS');
              serverRunning = false;
              updateServerButton(false);
            }
          }
        } else {
          showError(res.error || 'Failed to generate certs');
        }
      } catch (e) {
        console.error('Error regenerating TLS:', e);
        showError('Failed to regenerate TLS');
      } finally {
        regenBtn.disabled = false;
        regenBtn.textContent = 'Regenerate Self-Signed';
      }
    });

    const downloadCABtn = document.getElementById('btn-download-ca');
    downloadCABtn.addEventListener('click', async () => {
      try {
        const result = await API.getCACert();
        if (result && result.success && result.cert) {
          // Create a blob and download
          const blob = new Blob([result.cert], { type: 'application/x-pem-file' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'billion-desktop-ca.pem';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showSuccess('CA certificate downloaded. Import it into your browser/OS trust store.');
        } else {
          showError(result.error || 'Failed to get CA certificate');
        }
      } catch (e) {
        console.error('Error downloading CA cert:', e);
        showError('Failed to download CA certificate');
      }
    });
  } catch (e) {
    // ignore UI wiring failures
  }

  openModal(modal);
}

function closeServerModal() {
  closeModal(document.getElementById('server-modal'));
}

function openSettingsModal() {
  openModal(document.getElementById('settings-modal'));
}

function closeSettingsModal() {
  closeModal(document.getElementById('settings-modal'));
}

async function copyServerUrl() {
  const urlInput = document.getElementById('server-url');
  urlInput.select();
  
  try {
    await navigator.clipboard.writeText(urlInput.value);
    const btn = document.getElementById('btn-copy-url');
    const originalText = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
    // Fallback for older browsers
    document.execCommand('copy');
  }
}

