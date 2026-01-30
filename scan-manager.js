(function () {
  const DEBUG = !!window.SCAN_MANAGER_DEBUG;
  const safeLog = {
    info: (...args) => { if (DEBUG && console && console.info) console.info(...args); },
    warn: (...args) => { if (DEBUG && console && console.warn) console.warn(...args); },
    error: (...args) => { if (DEBUG && console && console.error) console.error(...args); }
  };

  const scanManager = {
    // Initialize session state
    scanSession: {
      targetPart: null,
      matchedFields: new Set(),
      requiredFields: [],
    },

    startSessionForCurrentPart() {
      try {
        // Debug: snapshot the currentSelectedRow at session start
        try { console.info && console.info('scanManager.startSessionForCurrentPart: window.currentSelectedRow=', window.currentSelectedRow); } catch (e) {}
        this.scanSession.targetPart = window.currentSelectedRow || null;
        try { console.info && console.info('scanManager.startSessionForCurrentPart: initial targetPart=', this.scanSession.targetPart); } catch (e) {}
        // If no explicit selection, try resolve from primary input value
        if (!this.scanSession.targetPart) {
          const primaryId = (typeof window.getPrimaryFieldId === 'function' && window.getPrimaryFieldId()) || (window.settings?.primaryFields?.[0]) || '';
          if (primaryId) {
            const primaryEl = document.getElementById(primaryId);
            const primaryVal = primaryEl ? (primaryEl.value || primaryEl.textContent || '') : '';
            if (primaryVal && typeof window.findPartDetails === 'function') {
              const resolved = window.findPartDetails(primaryVal);
              if (resolved) {
                this.scanSession.targetPart = resolved;
                try { console.info && console.info('scanManager.startSessionForCurrentPart: resolved targetPart from primary lookup=', resolved); } catch(e) {}
                // Populate input fields from resolved targetPart so UI and logs have values
                const fields = window.settings?.fields ?? [];
                fields.forEach(f => {
                  const fieldEl = document.getElementById(f.id);
                  try {
                    const val = (typeof window.getValueFromRow === 'function') ? window.getValueFromRow(resolved, f.id) : '';
                    if (fieldEl && val) fieldEl.value = val;
                  } catch (innerE) { /* ignore per best-effort population */ }
                });
              }
            }
          }
        }
        this.scanSession.matchedFields = new Set();
        // clear any manual active selection
        this.scanSession._manualActive = null;
        // scan sequence tracking
        this.scanSession._seqCounter = 0;
        this.scanSession._scanSequence = [];
        // Read configured primary fields robustly (support array or comma-separated string).
        // Try multiple places: window.settings.primaryFields, window.settings.primaryField (legacy),
        // finally attempt to read local settings.json file as a last-resort fallback.
        let req = [];
        const pf = window.settings?.primaryFields;
        if (Array.isArray(pf) && pf.length > 0) {
          req = pf.slice();
        } else if (typeof pf === 'string' && pf.trim()) {
          req = pf.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          const pfSing = window.settings?.primaryField ?? window.settings?.primary_field;
          if (typeof pfSing === 'string' && pfSing.trim()) req = [pfSing.trim()];
        }

        // Last resort: try loading settings.json from disk (synchronous XHR) to recover configuration
        if ((!req || req.length === 0) && typeof XMLHttpRequest !== 'undefined') {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'settings.json', false);
            xhr.send(null);
            if (xhr.status === 200) {
              try {
                const parsed = JSON.parse(xhr.responseText || '{}');
                if (Array.isArray(parsed.primaryFields) && parsed.primaryFields.length > 0) req = parsed.primaryFields.slice();
                else if (typeof parsed.primaryField === 'string' && parsed.primaryField.trim()) req = [parsed.primaryField.trim()];
              } catch (e) {
                safeLog.warn('scanManager: settings.json parse failed', e);
              }
            }
          } catch (e) {
            // Ignore network/file errors; this is best-effort
          }
        }

        // Ensure settings.fields exists; if missing, try to load settings.json (best-effort) so we can resolve labels
        let settingFields = window.settings?.fields ?? [];
        if ((!Array.isArray(settingFields) || settingFields.length === 0) && typeof XMLHttpRequest !== 'undefined') {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'settings.json', false);
            xhr.send(null);
            if (xhr.status === 200) {
              try {
                const parsed = JSON.parse(xhr.responseText || '{}');
                if (Array.isArray(parsed.fields) && parsed.fields.length > 0) {
                  window.settings = window.settings || {};
                  window.settings.fields = parsed.fields.slice();
                  settingFields = window.settings.fields;
                }
              } catch (e) { safeLog.warn('scanManager: parse settings.json failed', e); }
            }
          } catch (e) { /* ignore */ }
        }

        const originalReq = req.slice();
        if (Array.isArray(settingFields) && settingFields.length > 0) {
          const knownIds = settingFields.map(f => f.id).filter(Boolean);
          req = req.filter(id => knownIds.includes(id));
        } else {
          req = originalReq.slice();
        }

        // Detect missing DOM elements for required fields. If any are missing, try to rebuild inputs once before failing
        try {
          let missing = (req || []).filter(id => !document.getElementById(id));
          if (missing.length > 0) {
            safeLog.warn && safeLog.warn('scanManager: required primary field DOM elements missing, attempting rebuild', missing);
            // Try user-provided rebuild routine if available (best-effort)
            try {
              if (typeof window.rebuildInputUI === 'function') {
                window.rebuildInputUI();
                // re-evaluate missing after rebuild
                missing = (req || []).filter(id => !document.getElementById(id));
              }
            } catch (re) {
              safeLog.warn && safeLog.warn('scanManager: rebuildInputUI threw', re);
            }
          }

          if (missing.length > 0) {
            console.error && console.error('scanManager: required primary field DOM elements not found after rebuild attempt:', missing);
            this.scanSession._hasMissingFields = true;
            this.scanSession._missingFields = missing.slice();
          } else {
            this.scanSession._hasMissingFields = false;
            this.scanSession._missingFields = [];
          }
        } catch(e) {
          this.scanSession._hasMissingFields = false;
          this.scanSession._missingFields = [];
        }

        // Log selected required fields and settings snapshot for diagnostics, including label mapping
        try {
          // primaryFields and settings.fields info suppressed to avoid intermediate logging
          const sf = window.settings && window.settings.fields;
        } catch (e) {}
        this.scanSession.requiredFields = req;
        safeLog.info && safeLog.info('scanManager: requiredFields initialized', req);
        this._ensurePanelExists();
        // ensure panel is visible for immediate user feedback
        try {
          const p = document.getElementById('multi-scan-panel'); if (p) p.style.display = 'block';
        } catch (e) {}
        this._renderPanel(req);
        this._highlightPendingFields();

        // Broadcast session update to mobile clients (if available)
        try {
          const ipcRenderer = require && require('electron') && require('electron').ipcRenderer;
          try {
            const fieldsInfo = (settingFields || []).filter(f=>req.includes(f.id)).map(f=>({ id: f.id, label: f.label }));
            const active = this.scanSession._manualActive || (req && req.length>0 ? req[0] : null);
            ipcRenderer && ipcRenderer.invoke && ipcRenderer.invoke('broadcast-session-update', {
              selectedRowIndex: window.currentSelectedRowIndex || null,
              requiredFields: req,
              fields: fieldsInfo,
              activeField: active
            });
          } catch (e) {}
        } catch (e) {}

        // Attach click handlers to inputs so operator can manually pick active field
        try {
          (req || []).forEach((fid) => {
            const inp = document.getElementById(fid);
            if (!inp) return;
            inp.style.cursor = 'pointer';
            inp.addEventListener('click', (ev) => {
              try { this._setManualActiveField(fid); } catch (e) { console.error('manual active set error', e); }
            });
          });
        } catch (e) {}
      } catch (e) {
        console.error("scanManager.startSessionForCurrentPart error:", e);
      }
    },

    _highlightPendingFields: function () {
      const fields = this.scanSession.requiredFields || [];
      fields.forEach((fid, idx) => {
        const input = document.getElementById(fid);
        if (!input) return;
        input.classList.remove("scan-active", "scan-passed", "scan-failed");
        input.classList.add("scan-pending");
      });
      // If operator manually selected a field, honour that
      const manual = this.scanSession._manualActive;
      if (manual && fields.includes(manual) && !this.scanSession.matchedFields.has(manual)) {
        const mEl = document.getElementById(manual);
        if (mEl) {
          mEl.classList.remove('scan-pending');
          mEl.classList.add('scan-active');
          try { if (window.safeFocus) window.safeFocus(mEl); else mEl.focus && mEl.focus(); } catch (e) {}
        }
        this._updatePanelStatus();
        return;
      }

      // mark first as active
      const first = fields[0];
      if (first) {
        const firstInput = document.getElementById(first);
        if (firstInput) {
          firstInput.classList.remove("scan-pending");
          firstInput.classList.add("scan-active");
          try {
            try { if (window.safeFocus) window.safeFocus(firstInput); else firstInput.focus && firstInput.focus(); } catch (e) {}
          } catch (e) {}
        }
      }
      // notify mobile clients about active field change
      try {
        const ipcRenderer = require && require('electron') && require('electron').ipcRenderer;
        try {
          const fieldsInfo = (window.settings && window.settings.fields || []).filter(f=>fields.includes(f.id)).map(f=>({ id: f.id, label: f.label }));
          const activeField = (this.scanSession._manualActive && fields.includes(this.scanSession._manualActive)) ? this.scanSession._manualActive : first;
          ipcRenderer && ipcRenderer.invoke && ipcRenderer.invoke('broadcast-session-update', {
            selectedRowIndex: window.currentSelectedRowIndex || null,
            requiredFields: fields,
            fields: fieldsInfo,
            activeField: activeField
          });
        } catch (e) {}
      } catch (e) {}
      // update panel visuals
      this._updatePanelStatus();
    },

    _advanceToNextField: function () {
      const fields = this.scanSession.requiredFields || [];
      for (const fid of fields) {
        // if manual active is set, skip advancing past it until it's matched
        if (this.scanSession._manualActive && this.scanSession._manualActive !== fid && !this.scanSession.matchedFields.has(this.scanSession._manualActive)) {
          // keep the manual active in place
          return this.scanSession._manualActive;
        }
        if (!this.scanSession.matchedFields.has(fid)) {
          // set this as active
          fields.forEach((f) => {
            const inp = document.getElementById(f);
            if (!inp) return;
            inp.classList.remove("scan-active");
            if (!this.scanSession.matchedFields.has(f)) inp.classList.add("scan-pending");
          });
          const next = document.getElementById(fid);
          if (next) {
            next.classList.remove("scan-pending");
            next.classList.add("scan-active");
            try { if (window.safeFocus) window.safeFocus(next); else next.focus && next.focus(); } catch (e) {}
          try { const lab = (window.settings && window.settings.fields || []).find(f=>f.id===fid)?.label || fid; /* advanced to active field (silent) */ } catch(e){}
          }
          this._updatePanelStatus();
          // broadcast the new active field
          try {
            const ipcRenderer = require && require('electron') && require('electron').ipcRenderer;
            try {
              const fieldsInfo = (window.settings && window.settings.fields || []).filter(f=>fields.includes(f)).map(f=>({ id: f.id, label: f.label }));
              ipcRenderer && ipcRenderer.invoke && ipcRenderer.invoke('broadcast-session-update', {
                selectedRowIndex: window.currentSelectedRowIndex || null,
                requiredFields: fields,
                fields: fieldsInfo,
                activeField: fid
              });
            } catch(e){}
          } catch(e){}
          return fid;
        }
      }
      this._updatePanelStatus();
      return null;
    },

    _compare: function (cleanedCode, expectedValue) {
      const op = (window.settings && window.settings.scanOperation) || "equals";
      const normalize = (s) => {
        try {
          return String(s || "").normalize("NFKC").trim().toLowerCase();
        } catch (e) {
          return String(s || "").trim().toLowerCase();
        }
      };

      try {
        if (op === "regex") {
          try {
            const re = new RegExp(expectedValue, "i");
            return re.test(String(cleanedCode || ""));
          } catch (e) {
            // invalid regex -> fallback to normalized equals
            return normalize(cleanedCode) === normalize(expectedValue);
          }
        }

        const a = normalize(cleanedCode);
        const b = normalize(expectedValue);

        if (op === "equals") return a === b;
        if (op === "contains") return a.includes(b) || b.includes(a);
        if (op === "startsWith") return a.startsWith(b) || b.startsWith(a);
      } catch (e) {
        safeLog.error("scanManager compare error, falling back to equals", e);
        try { return String(cleanedCode || "") === String(expectedValue || ""); } catch (_) { return false; }
      }
      return false;
    },

    /********** Panel UI helpers **********/
    _ensurePanelExists: function () {
      try {
        if (document.getElementById('multi-scan-panel')) return;
        const container = document.createElement('div');
        container.id = 'multi-scan-panel';
        // Respect global setting to show/hide the panel by default
        try {
          const hide = (window.settings && window.settings.showMultiScanPanel === false);
          container.style.display = hide ? 'none' : 'block';
        } catch (e) { container.style.display = 'block'; }
        container.style.padding = '10px';
        container.style.marginTop = '12px';
        container.style.background = 'linear-gradient(90deg,#002b55, #003b77)';
        container.style.borderRadius = '8px';
        container.style.color = 'white';
        container.style.fontSize = '14px';
        container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
        container.innerHTML = `
          <div id="multi-scan-title" style="font-weight:700; color: #ffd54f; margin-bottom:8px">Multi-field Scan Status</div>
          <div id="multi-scan-list" style="display:flex;flex-direction:column;gap:6px"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
            <div id="multi-scan-progress" style="flex:1;height:8px;background:#07315a;border-radius:6px;margin-right:8px;overflow:hidden">
              <div id="multi-scan-progress-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#00c853,#b2ff59);"></div>
            </div>
            <div id="multi-scan-overall" style="min-width:110px;text-align:center;padding:6px 10px;border-radius:6px;background:#1f4e79;font-weight:700">READY</div>
          </div>`;

        // Try to insert into right-section or fallback to body
        const right = document.getElementById('status-section') || document.getElementById('main-content') || document.body;
          // insert panel at top of right section so it appears above datetime/info boxes
          if (right.firstChild) {
            right.prepend(container);
          } else {
            right.appendChild(container);
          }
      } catch (e) {
        console.error('scanManager._ensurePanelExists error', e);
      }
    },

    _renderPanel: function (fields) {
      try {
        this._ensurePanelExists();
        const list = document.getElementById('multi-scan-list');
        if (!list) return;
        list.innerHTML = '';
        (fields || []).forEach((fid) => {
          const label = (window.settings && (window.settings.fields || []).find(f=>f.id===fid)?.label) || fid;
          const item = document.createElement('div');
          item.className = 'multi-scan-item';
          item.dataset.fieldId = fid;
          item.style.display = 'flex';
          item.style.alignItems = 'center';
          item.style.justifyContent = 'space-between';
          item.style.padding = '6px 8px';
          item.style.borderRadius = '6px';
          item.style.background = 'rgba(255,255,255,0.03)';
          item.innerHTML = `<div style="display:flex;gap:10px;align-items:center"><div class="multi-scan-icon" style="width:14px;height:14px;border-radius:50%;background:#ffd54f"></div><div style="font-weight:600">${label}</div></div><div class="multi-scan-state" style="font-weight:700;color:#ffd54f">PENDING</div>`;
          // clicking a panel item manually activates that field for scanning
          try { item.addEventListener('click', () => { this._setManualActiveField(fid); }); } catch(e){}
          list.appendChild(item);
        });
        this._updatePanelStatus();
      } catch (e) {
        console.error('scanManager._renderPanel error', e);
      }
    },

    _setManualActiveField: function (fid) {
      try {
        if (!fid) return;
        // clear any previously active classes
        const fields = this.scanSession.requiredFields || [];
        fields.forEach((f) => {
          const inp = document.getElementById(f);
          if (!inp) return;
          inp.classList.remove('scan-active');
          if (!this.scanSession.matchedFields.has(f)) inp.classList.add('scan-pending');
        });

        // set manual active
        this.scanSession._manualActive = fid;
        const el = document.getElementById(fid);
        if (el) {
          // If this field was previously marked passed, allow re-verification by
          // removing its passed class and removing it from matchedFields set.
          try {
            if (el.classList.contains('scan-passed')) el.classList.remove('scan-passed');
          } catch (e) {}
          try {
            if (this.scanSession.matchedFields && this.scanSession.matchedFields.has(fid)) {
              try { this.scanSession.matchedFields.delete(fid); } catch (e) { /* ignore */ }
            }
          } catch (e) {}
          el.classList.remove('scan-pending', 'scan-failed');
          el.classList.add('scan-active');
          try { if (window.safeFocus) window.safeFocus(el); else el.focus && el.focus(); } catch (e) {}
        }
        try { const lab = (window.settings && window.settings.fields || []).find(f=>f.id===fid)?.label || fid; /* manual active field set (silent) */ } catch(e){}
        // ensure panel reflects manual active
        try { this._updatePanelStatus(); } catch (e) {}
        // Broadcast manual active change to mobile clients
        try {
          const ipcRenderer = require && require('electron') && require('electron').ipcRenderer;
          try {
            ipcRenderer && ipcRenderer.invoke && ipcRenderer.invoke('broadcast-session-update', {
              selectedRowIndex: window.currentSelectedRowIndex || null,
              requiredFields: this.scanSession.requiredFields || [],
              matchedFields: Array.from(this.scanSession.matchedFields || []),
              activeField: this.scanSession._manualActive || null
            });
          } catch (e) {}
        } catch (e) {}
      } catch (e) {
        console.error('scanManager._setManualActiveField error', e);
      }
    },

    _updatePanelStatus: function () {
      try {
        const fields = this.scanSession.requiredFields || [];
        const total = fields.length || 1;
        let passed = 0;
        const allPassed = fields.length > 0 && fields.every((f) => this.scanSession.matchedFields.has(f));
        fields.forEach((fid) => {
          const item = document.querySelector(`#multi-scan-list .multi-scan-item[data-field-id="${fid}"]`);
          const stateEl = item?.querySelector('.multi-scan-state');
          const icon = item?.querySelector('.multi-scan-icon');
          if (!item || !stateEl) return;
          // clear any transient manual visuals
          item.style.border = '';
          item.style.boxShadow = '';
          if (this.scanSession.matchedFields.has(fid)) {
            passed++;
            if (allPassed) {
              // Final overall pass - green
              stateEl.textContent = 'PASSED';
              stateEl.style.color = '#b2ff59';
              item.style.background = 'rgba(0,200,83,0.12)';
              if (icon) icon.style.background = '#b2ff59';
            } else {
              // Intermediate per-field pass: show yellow so operator sees progress
              stateEl.textContent = 'PASSED';
              stateEl.style.color = '#b2ff59';
              item.style.background = 'rgba(255,213,79,0.16)';
              if (icon) icon.style.background = '#b2ff59';
            }
          } else {
            const inp = document.getElementById(fid);
            if (inp && inp.classList.contains('scan-active')) {
              // Use yellow visual for active scanning (operator-friendly)
              stateEl.textContent = 'SCANNING';
              stateEl.style.color = '#ffd54f';
              item.style.background = 'rgba(255,213,79,0.16)';
              if (icon) icon.style.background = '#ffd54f';
            } else if (inp && inp.classList.contains('scan-failed')) {
              stateEl.textContent = 'FAILED';
              stateEl.style.color = '#fff';
              item.style.background = 'rgba(255,59,48,0.15)';
              if (icon) icon.style.background = '#ff3b30';
              // If this failed field is the manualActive, add a resume highlight
              if (this.scanSession._manualActive === fid) {
                item.style.border = '2px solid rgba(255,193,7,0.9)';
                item.style.boxShadow = '0 0 10px rgba(255,193,7,0.12)';
              }
            } else {
              stateEl.textContent = 'PENDING';
              stateEl.style.color = '#ffd54f';
              item.style.background = 'rgba(255,255,255,0.03)';
              if (icon) icon.style.background = '#ffd54f';
            }
          }
        });

        const pct = Math.round((passed / total) * 100);
        const fill = document.getElementById('multi-scan-progress-fill');
        if (fill) fill.style.width = pct + '%';

        const overall = document.getElementById('multi-scan-overall');
        if (overall) {
          if (passed === total) {
            overall.textContent = 'All Passed';
            overall.style.background = 'linear-gradient(90deg,#00c853,#66bb6a)';
            overall.style.color = '#022';
          } else if (passed === 0) {
            overall.textContent = 'WAITING';
            overall.style.background = '#1f4e79';
            overall.style.color = '#ffd54f';
          } else {
            overall.textContent = `${passed}/${total}`;
            overall.style.background = 'linear-gradient(90deg,#ffd54f,#ffb300)';
            overall.style.color = '#022';
          }
        }
      } catch (e) {
        console.error('scanManager._updatePanelStatus error', e);
      }
    },

    _updateVerificationUI: function (statusText, scannedValue, statusClass) {
      try {
        // clear any pending clear timer for verification UI
        try { clearTimeout(this._verificationClearTimer); } catch (e) {}
        const sdv = document.getElementById("scan-data-value");
        if (sdv) sdv.textContent = scannedValue || "";
        const sst = document.getElementById("scan-status-value");
        if (sst) {
          sst.textContent = statusText || "";
          sst.classList.remove("ok", "failed", "scanning");
          if (statusClass) sst.classList.add(statusClass);
        }
      } catch (e) { /* best-effort UI update */ }
    },

    _clearVerificationUI: function (delayMs) {
      try {
        clearTimeout(this._verificationClearTimer);
        this._verificationClearTimer = setTimeout(() => {
          try {
            const sdv = document.getElementById("scan-data-value"); if (sdv) sdv.textContent = "";
            const sst = document.getElementById("scan-status-value"); if (sst) { sst.textContent = ""; sst.classList.remove("ok","failed","scanning"); }
            const part = document.getElementById("part-code-status-value"); if (part) { part.textContent = ""; part.classList.remove("ok","failed"); }
          } catch (e) {}
        }, delayMs || 1200);
      } catch (e) { /* ignore */ }
    },

    _showReadyState: function () {
      try {
        const passEl = document.getElementById('pass-status');
        if (passEl) {
          passEl.textContent = 'READY';
          passEl.classList.remove('failed','pass-box');
          passEl.style.background = '';
          passEl.style.color = '';
          passEl.style.border = '';
          passEl.style.boxShadow = '';
        }
        // Clear verification related UI
        try {
          const sdv = document.getElementById('scan-data-value'); if (sdv) { sdv.textContent = ''; sdv.classList.remove('scanned-success'); }
          const sst = document.getElementById('scan-status-value'); if (sst) { sst.textContent = ''; sst.classList.remove('ok','failed','scanning'); sst.style.background = ''; sst.style.color = ''; }
          const part = document.getElementById('part-code-status-value'); if (part) { part.textContent = ''; part.classList.remove('ok','failed'); part.style.background = ''; part.style.color = ''; }
          const overall = document.getElementById('multi-scan-overall'); if (overall) { overall.textContent = 'READY'; overall.style.background = ''; overall.style.color = '#ffd54f'; }
        } catch (e) {}
      } catch (e) { /* ignore */ }
    },

    _clearPanelAfterDelay(delayMs, clearMatched, hidePanel = true) {
      try {
        clearTimeout(this._panelClearTimer);
        this._panelClearTimer = setTimeout(() => {
          try {
            if (clearMatched) {
              // Reset matched fields and manual active, then re-highlight first pending field
              this.scanSession.matchedFields = new Set();
              this.scanSession._manualActive = null;
              try { this._highlightPendingFields(); } catch (e) {}
              try { this._updatePanelStatus(); } catch (e) {}
            }
          } catch (innerE) { /* ignore */ }
          const panel = document.getElementById('multi-scan-panel');
          if (panel && hidePanel) panel.style.display = 'none';
        }, delayMs || 1200);
      } catch (e) {
        console.error('scanManager._clearPanelAfterDelay error', e);
      }
    },

    // Final-pass modal and proceed-on-success popup removed (redundant)


    handleScan: async function (scannedCode) {
      try {
        const cleanedCode = scannedCode;
        // Show immediate scanning state in verification UI for each incoming scan
        try { this._updateVerificationUI('SCANNING', cleanedCode, 'scanning'); } catch (e) {}
        if (!cleanedCode) return;

        // Diagnostic logging and sequence tracking for each scan
        try {
          this.scanSession._seqCounter = (this.scanSession._seqCounter || 0) + 1;
          const seqNum = this.scanSession._seqCounter;
          const seqRec = { seq: seqNum, timestamp: new Date(), scannedCode: cleanedCode };
          // attach a temporary current record for enrichment later
          this.scanSession._currentScanRecord = seqRec;
          // NOTE: per configuration, do not emit debug/console logs for intermediate scans here.
        } catch (e) {}

        // Ensure session target
        if (!this.scanSession.targetPart) {
          // attempt to start session from current selection
          this.startSessionForCurrentPart();
          if (!this.scanSession.targetPart) {
            // nothing to match against - fall back to legacy behavior by returning to main handler
            console.log("scanManager: no target part selected, falling back");
            return;
          }
        }

        // If primary/selected part changed since the last scan, reset the session so expected values update.
        try {
          const primaryId = (typeof window.getPrimaryFieldId === 'function' && window.getPrimaryFieldId()) || (window.settings?.primaryFields?.[0]) || '';
          const readPrimaryFromRow = (row) => {
            try {
              if (!row) return '';
              if (typeof window.getPrimaryValue === 'function') return window.getPrimaryValue(row) || '';
              if (typeof window.getValueFromRow === 'function') return window.getValueFromRow(row, primaryId) || '';
              return '';
            } catch (e) { return ''; }
          };

          const currentSelectedPrimary = window.currentSelectedRow ? readPrimaryFromRow(window.currentSelectedRow) : (primaryId ? (document.getElementById(primaryId)?.value || '') : '');
          const sessionPrimary = this.scanSession.targetPart ? readPrimaryFromRow(this.scanSession.targetPart) : '';
          if ((currentSelectedPrimary || '') !== (sessionPrimary || '')) {
            // selection changed -> re-init session to pick up new expected values
            try {
              this.scanSession.targetPart = null;
              this.scanSession.matchedFields = new Set();
              this.scanSession._manualActive = null;
              this.scanSession._scanSequence = [];
              this.startSessionForCurrentPart();
            } catch (e) {
              safeLog.warn && safeLog.warn('scanManager: failed to reset session after selection change', e);
            }
          }
        } catch (e) { /* best-effort */ }

        let required = this.scanSession.requiredFields || [];
        // If required fields are not yet initialized, try to start a session now
        if (!required || required.length === 0) {
          try {
            this.startSessionForCurrentPart();
            required = this.scanSession.requiredFields || [];
            // ensure panel visible
            try { const p = document.getElementById('multi-scan-panel'); if (p) p.style.display = 'block'; } catch(e){}
            try { this._renderPanel(required); this._highlightPendingFields(); } catch(e){}
          } catch (e) { console.warn('scanManager: failed to initialize session on-demand', e); }
        }

        if (!required || required.length === 0) {
          console.log("scanManager: no required fields configured");
          return;
        }

        // If session was flagged as having missing fields, abort and instruct operator
        if (this.scanSession._hasMissingFields) {
          try {
            console.error && console.error('scanManager: cannot proceed with scanning - required fields missing in DOM or settings:', this.scanSession._missingFields || []);
          } catch (e) {}
          return;
        }

        // Determine current active field:
        // - prefer manual active if set and not yet matched
        // - then prefer a DOM element that currently has the `scan-active` class (keeps UI + logic in sync)
        // - fall back to the first required field that is not yet matched
        let currentField = null;
        if (this.scanSession._manualActive && !this.scanSession.matchedFields.has(this.scanSession._manualActive)) {
          currentField = this.scanSession._manualActive;
        } else {
          try {
            // look for an active input element among required fields
            const domActive = (required || []).map(id => document.getElementById(id)).find(el => el && el.classList && el.classList.contains('scan-active'));
            if (domActive && domActive.id && !this.scanSession.matchedFields.has(domActive.id)) {
              currentField = domActive.id;
            } else {
              currentField = required.find((f) => !this.scanSession.matchedFields.has(f));
            }
          } catch (e) {
            currentField = required.find((f) => !this.scanSession.matchedFields.has(f));
          }
        }
        try {
          const fldDef = (window.settings && window.settings.fields || []).find(ff=>ff.id===currentField) || null;
          let fldLabel = fldDef ? fldDef.label : null;
          if (!fldLabel) {
            // Try DOM label fallback
            try {
              const domLabel = document.querySelector(`label[for="${currentField}"]`);
              if (domLabel && domLabel.textContent) fldLabel = domLabel.textContent.trim();
            } catch(e) {}
          }
          if (!fldLabel) fldLabel = currentField;
          // active field determined (no console info emitted per final-only logging policy)
          if (!fldDef) console.warn && console.warn('scanManager: activeField had no matching settings.fields entry', { currentField });
        } catch(e) {}
        if (!currentField) {
          // All matched already
          console.log("scanManager: all fields already matched");
          return;
        }

        // Determine expected value for this field
        let expected = "";
        // If manual active and operator requested using input value, prefer that
        try {
          if (this.scanSession._manualActive === currentField && this.scanSession._forceUseInputValueForActive) {
            const input = document.getElementById(currentField);
            expected = input ? (input.value || '') : (this.scanSession._manualExpected || '');
          } else {
            if (this.scanSession.targetPart) {
              expected = window.getValueFromRow
                ? window.getValueFromRow(this.scanSession.targetPart, currentField)
                : "";
            }
            if (!expected) {
              const input = document.getElementById(currentField);
              expected = input ? input.value : "";
            }
          }
        } catch (e) {
          try { const input = document.getElementById(currentField); expected = input ? input.value : ''; } catch (ee) { expected = ''; }
        }

        try {
          const fld = (window.settings && window.settings.fields || []).find(f=>f.id===currentField) || {};
          // Matching field (silent)
          // enrich current scan record
          try {
            const rec = this.scanSession._currentScanRecord;
            if (rec) {
              rec.fieldId = currentField;
              rec.fieldLabel = fld.label || currentField;
              rec.expected = expected;
            }
          } catch (e) {}
        } catch (e) {}

        const isMatch = this._compare(cleanedCode, expected);
        const scannerInfo = document.getElementById("scan-by")?.value || "";

        // Build a log entry (include labels). Prefer master-data lookup via getValueFromRow,
        // fallback to DOM input value if necessary.
        const logEntry = {
          timestamp: new Date(),
          scannedCode: cleanedCode,
          scannerInfo: scannerInfo,
          matchStatus: isMatch ? "MATCHED_FIELD" : "NOT_MATCHED",
        };
        (window.settings?.fields || []).forEach((field) => {
          let val = "";
          try {
            if (this.scanSession.targetPart && typeof window.getValueFromRow === 'function') {
              val = window.getValueFromRow(this.scanSession.targetPart, field.id) || "";
            }
          } catch (e) { val = ""; }
          if (!val) {
            const input = document.getElementById(field.id);
            if (input) val = input.value || "";
          }
          logEntry[field.label] = val;
        });

        if (isMatch) {
          // Mark this input as passed
          const inp = document.getElementById(currentField);
          if (inp) {
            inp.classList.remove("scan-active", "scan-pending", "scan-failed");
            inp.classList.add("scan-passed");
          }

          // Mark matched and advance
          this.scanSession.matchedFields.add(currentField);
          try { this._highlightPendingFields(); } catch(e) { /* ensure UI reflects new state */ }
          // finalize and store sequence record
          try {
            const rec = this.scanSession._currentScanRecord;
            if (rec) {
              rec.matched = true;
              rec.result = 'MATCHED';
              this.scanSession._scanSequence.push(rec);
              // do not log matched events until final pass
            }
          } catch (e) {}
          // If operator had manually selected this field, clear manual active now
          if (this.scanSession._manualActive === currentField) {
            this.scanSession._manualActive = null;
            // clear manual preference flags
            try { this.scanSession._forceUseInputValueForActive = false; this.scanSession._manualExpected = null; } catch(e){}
          }
          const next = this._advanceToNextField();
          // Broadcast updated session after successful match
          try {
            const ipcRenderer = require && require('electron') && require('electron').ipcRenderer;
            try {
              ipcRenderer && ipcRenderer.invoke && ipcRenderer.invoke('broadcast-session-update', {
                selectedRowIndex: window.currentSelectedRowIndex || null,
                requiredFields: this.scanSession.requiredFields || [],
                matchedFields: Array.from(this.scanSession.matchedFields || []),
                activeField: next || null
              });
            } catch (e) {}
          } catch (e) {}
          // Intermediate matched field — do not log to console per final-only logging policy.
          // Refresh panel after marking match
          try { this._updatePanelStatus(); } catch (e) {}

          // Update verification UI for this successful intermediate match and clear shortly
          try { this._updateVerificationUI('OK', cleanedCode, 'ok'); this._clearVerificationUI(1000); } catch (e) {}

          // Briefly show PASS on the pass-status element for intermediate matched fields (yellow)
          try {
            const passEl = document.getElementById('pass-status');
            if (passEl) {
              passEl.textContent = 'PASSED';
              passEl.classList.remove('failed');
              passEl.style.background = 'linear-gradient(90deg,#ffd54f,#ffb300)';
              passEl.style.color = '#022';
              setTimeout(() => {
                try { this._showReadyState(); } catch (inner) {}
              }, 800);
            }
          } catch (e) {}

          // If none left, final PASS
          const allPassed = required.length > 0 && required.every((f) => this.scanSession.matchedFields.has(f));
          if (allPassed) {
            // Show PASS UI similar to legacy behavior
            try {
              document.getElementById("scan-data-value").textContent = cleanedCode;
              document.getElementById("scan-status-value").textContent = "OK";
              document.getElementById("scan-status-value").classList.add("ok");
              document.getElementById("part-code-status-value").textContent = "DATA MATCHED";
              document.getElementById("part-code-status-value").classList.add("ok");
              const passEl = document.getElementById("pass-status");
              passEl.textContent = "All Passed";
              passEl.classList.remove("failed");
              passEl.style.background = 'linear-gradient(90deg,#00c853,#66bb6a)';
              passEl.style.color = '#022';

              // Also update the multi-scan overall indicator to reflect final pass
              try {
                const overall = document.getElementById('multi-scan-overall');
                if (overall) {
                  overall.textContent = 'All Passed';
                  overall.style.background = 'linear-gradient(90deg,#00c853,#66bb6a)';
                  overall.style.color = '#022';
                }
              } catch (e) {}

              // Update scan quantity
              const scanQty = document.getElementById("scan-qty");
              if (scanQty) scanQty.value = String(Number(scanQty.value) + 1).padStart(5, "0");

              // Keep the final-pass visuals displayed (do not auto-clear to ready)

              // Final save (optional)
              try {
                const finalLog = Object.assign({}, logEntry, { matchStatus: 'ALL_FIELDS_MATCHED' });
                if (typeof window.saveScanLogRealtime === 'function') window.saveScanLogRealtime(finalLog);
                // Emit consolidated sequence log now that all fields passed
                try {
                  console.info && console.info('scanManager: ALL_FIELDS_MATCHED - sequence:', this.scanSession._scanSequence || []);
                  console.info && console.info('scanManager: finalLog saved', finalLog);
                  try {
                    if (typeof window.tryClearFailureBoxForCurrentScan === 'function') {
                      try { window.tryClearFailureBoxForCurrentScan(); } catch(e) {}
                    } else if (typeof window.hideFailureRecordBox === 'function') {
                      try { window.hideFailureRecordBox(); } catch(e) {}
                    }
                  } catch (e) {}
                } catch (e) {}
              } catch (e) {
                console.error('final save failed', e);
              }
            } catch (e) {
              console.error('Error showing PASS UI:', e);
            }

            // Preserve passed highlights and keep overall/pass UI as All Passed (no modal)
            try { this._updatePanelStatus(); } catch (e) {}
            return;
          }

          // Intermediate matches update panel only; do not modify verification UI or emit logs here.

          return;
        } else {
          // Failed to match current field
          // finalize and store failed sequence record (do not emit console logs here; keep error saving unchanged)
          try {
            const rec = this.scanSession._currentScanRecord;
            if (rec) {
              rec.matched = false;
              rec.result = 'NOT_MATCHED';
              this.scanSession._scanSequence.push(rec);
            }
          } catch (e) {}
          try { console.warn && console.warn('scanManager: field NOT_MATCHED', { id: currentField, label: (window.settings && window.settings.fields || []).find(f=>f.id===currentField)?.label || currentField, scanned: cleanedCode, expected }); } catch(e){}
          const inp = document.getElementById(currentField);
          if (inp) {
            inp.classList.remove("scan-active", "scan-pending", "scan-passed");
            inp.classList.add("scan-failed");
            // keep failed field as manual active so operator knows to retry it
            try { this.scanSession._manualActive = currentField; if (window.safeFocus) window.safeFocus(inp); else inp.focus && inp.focus(); } catch (e) {}
            try { this._highlightPendingFields(); } catch(e) {}
          }
          // Update verification UI to show failed scan and clear after error handling
          try { this._updateVerificationUI('FAILED', cleanedCode, 'failed'); this._clearVerificationUI(7000); } catch (e) {}
          // Show FAILED on pass-status so operator knows (red)
          try {
            const passEl = document.getElementById('pass-status');
            if (passEl) {
              passEl.textContent = 'FAILED';
              passEl.classList.add('failed');
              passEl.style.background = 'linear-gradient(90deg,#ff3b30,#ff6b6b)';
              passEl.style.color = '#fff';
            }
          } catch (e) {}
          try { this._updatePanelStatus(); } catch(e) {}

          // Broadcast failure and active field to mobile clients
          try {
            const ipcRenderer = require && require('electron') && require('electron').ipcRenderer;
            try {
              ipcRenderer && ipcRenderer.invoke && ipcRenderer.invoke('broadcast-session-update', {
                selectedRowIndex: window.currentSelectedRowIndex || null,
                requiredFields: this.scanSession.requiredFields || [],
                matchedFields: Array.from(this.scanSession.matchedFields || []),
                activeField: this.scanSession._manualActive || currentField
              });
            } catch (e) {}
          } catch (e) {}

          try {
            // Detailed diagnostic output to help identify why NOT_MATCH occurred
            try {
              const expectedVal = expected || "";
              const scannedVal = cleanedCode || "";
              const expectedNorm = String(expectedVal).normalize('NFKC').trim();
              const scannedNorm = String(scannedVal).normalize('NFKC').trim();
              const expectedCodes = Array.from(expectedNorm).map((c) => c.charCodeAt(0));
              const scannedCodes = Array.from(scannedNorm).map((c) => c.charCodeAt(0));
              // attempt to resolve Excel row index for the current target part
              let excelRowIndex = null;
              try {
                // Prefer an explicitly stored row index on the scan session (set when a master item is selected)
                if (
                  this.scanSession &&
                  typeof this.scanSession.targetPartRowIndex !== 'undefined' &&
                  this.scanSession.targetPartRowIndex !== null
                ) {
                  const idx = Number(this.scanSession.targetPartRowIndex);
                  if (!Number.isNaN(idx) && idx >= 0) excelRowIndex = idx;
                }

                // Fallback to previous behavior only if the explicit index is not available
                if (excelRowIndex === null) {
                  const rawRows = window.masterRawRows || [];
                  if (Array.isArray(this.scanSession.targetPart)) {
                    excelRowIndex = rawRows.findIndex(r => r === this.scanSession.targetPart);
                  } else if (this.scanSession.targetPart) {
                    // try to match by primary value
                    const pid = (typeof window.getPrimaryFieldId === 'function' && window.getPrimaryFieldId()) || (window.settings?.primaryFields?.[0]) || '';
                    if (pid) {
                      const pv = (typeof window.getValueFromRow === 'function') ? window.getValueFromRow(this.scanSession.targetPart, pid) : '';
                      if (pv) {
                        excelRowIndex = rawRows.findIndex(r => {
                          try { return (typeof window.getValueFromRow === 'function' ? window.getValueFromRow(r, pid) : '') === pv; } catch(e) { return false; }
                        });
                      }
                    }
                  }
                }

              } catch (riE) { /* ignore */ }

              // Collect current input values and exact excel row values for diagnostics/logging
              const fieldsList = (window.settings && window.settings.fields) || [];
              const inputsMap = {};
              const excelMap = {};
              const mergedMap = {};
              try {
                fieldsList.forEach((f) => {
                  const label = f.label || f.id || '';
                  const id = f.id || label;
                  const inpEl = document.getElementById(id);
                  const inpVal = inpEl ? (inpEl.value || '') : '';
                  inputsMap[label] = inpVal;
                  let excelVal = '';
                  try {
                    if (excelRowIndex !== null && Array.isArray(window.masterRawRows) && window.masterRawRows[excelRowIndex]) {
                      excelVal = (typeof window.getValueFromRow === 'function') ? (window.getValueFromRow(window.masterRawRows[excelRowIndex], id) || '') : '';
                    } else if (this.scanSession.targetPart) {
                      excelVal = (typeof window.getValueFromRow === 'function') ? (window.getValueFromRow(this.scanSession.targetPart, id) || '') : '';
                    }
                  } catch (e) { excelVal = '' }
                  excelMap[label] = excelVal;
                  mergedMap[label] = excelVal || inpVal || '';
                });
                // include scan-by if present
                try { mergedMap['scan-by'] = document.getElementById('scan-by')?.value || mergedMap['scan-by'] || ''; } catch(e){}
              } catch(e) {}

              console.error('scanManager: NOT_MATCH diagnostic', {
                currentField: currentField,
                expectedRaw: expectedVal,
                expectedNorm: expectedNorm,
                expectedCharCodes: expectedCodes,
                scannedRaw: scannedVal,
                scannedNorm: scannedNorm,
                scannedCharCodes: scannedCodes,
                targetPart: this.scanSession.targetPart || null,
                excelRowIndex: excelRowIndex,
                missingFields: this.scanSession._missingFields || [],
                sessionRequired: this.scanSession.requiredFields || [],
                inputs: inputsMap,
                excelRowValues: excelMap,
                mergedValues: mergedMap
              });
              try {
                if (typeof window.renderFailureRecordBox === 'function') {
                  try {
                    window.renderFailureRecordBox({
                      excelRowIndex: excelRowIndex,
                      mergedValues: mergedMap,
                      excelRowValues: excelMap,
                      inputs: inputsMap,
                      scannedRaw: scannedVal,
                      currentField: currentField,
                      expectedRaw: expectedVal
                    });
                  } catch (e) {}
                }
              } catch (e) {}
              if (!expectedVal) {
                console.error('scanManager: NOT_MATCH reason=EMPTY_EXPECTED for field', currentField);
              } else if (expectedNorm === scannedNorm) {
                console.error('scanManager: NOT_MATCH reason=NORMALIZED_EQUAL_but_raw_differ');
              } else if (expectedNorm.toLowerCase() === scannedNorm.toLowerCase()) {
                console.error('scanManager: NOT_MATCH reason=case_mismatch');
              } else {
                console.error('scanManager: NOT_MATCH reason=value_mismatch');
              }
            } catch (diagE) {
              console.error('scanManager: NOT_MATCH diagnostic failed', diagE);
            }

            try {
              if (typeof window.saveErrorScanLogRealtime === 'function') {
                // Enrich logEntry with best available values (excel -> input -> empty)
                try {
                  const enriched = Object.assign({}, logEntry || {});
                  (Object.keys(mergedMap || {})).forEach((label) => {
                    // use label as column header in exported logs
                    enriched[label] = mergedMap[label];
                  });
                  enriched['Scanned Code'] = cleanedCode || (enriched['Scanned Code'] || '');
                  enriched['Status'] = 'NOT_MATCHED';
                  // include excel row index for traceability
                  enriched['excelRowIndex'] = excelRowIndex;
                  window.saveErrorScanLogRealtime(enriched);
                } catch (ee) {
                  // fallback to original logEntry if enrichment fails
                  window.saveErrorScanLogRealtime(logEntry);
                }
              }
            } catch (e) { console.error('calling saveErrorScanLogRealtime failed', e); }
          } catch (e) {
            console.error('saveErrorScanLogRealtime failed:', e);
          }

          // Play error sound and visuals
          try {
            const errorSound = document.getElementById("error-sound");
            if (errorSound) {
              errorSound.loop = true;
              errorSound.play();
              setTimeout(() => {
                errorSound.pause();
                errorSound.currentTime = 0;
              }, 6000);
            }
          } catch (e) {
            console.error('Error playing error sound:', e);
          }

          try {
            const blinkOverlay = document.getElementById("blink-overlay");
            if (blinkOverlay) {
              blinkOverlay.style.display = "block";
              setTimeout(() => (blinkOverlay.style.display = "none"), 6000);
            }
          } catch (e) {}

          // Show PIN verification and handle clearing failed state upon success
          try {
            const verified = await window.showPinVerification?.();
            if (verified) {
              // Clear failed indicators
              const failedInp = document.getElementById(currentField);
              if (failedInp) {
                failedInp.classList.remove("scan-failed");
                failedInp.classList.add("scan-pending");
                try { this.scanSession._manualActive = currentField; if (window.safeFocus) window.safeFocus(failedInp); else failedInp.focus && failedInp.focus(); } catch(e) {}
              }
              try { this._showReadyState(); } catch (e) { const passEl = document.getElementById("pass-status"); if (passEl) { passEl.textContent = "READY"; passEl.classList.remove("failed"); } }
              try { this._updatePanelStatus(); } catch(e) {}
            }
          } catch (e) {
            console.error('PIN verification error:', e);
          }

          return;
        }
      } catch (error) {
        console.error("scanManager.handleScan error:", error);
      }
    },
  };

  // Expose globally
  window.scanManager = scanManager;
})();

// Ensure panel exists on initial load so operators and debuggers can see it
try {
  document.addEventListener('DOMContentLoaded', function () {
    try {
      if (window.scanManager && typeof window.scanManager._ensurePanelExists === 'function') {
        window.scanManager._ensurePanelExists();
        const panel = document.getElementById('multi-scan-panel');
        if (panel) {
          // Respect settings when showing the panel on DOMContentLoaded
          try {
            const hide = (window.settings && window.settings.showMultiScanPanel === false);
            panel.style.display = hide ? 'none' : 'block';
          } catch (e) { panel.style.display = 'block'; }
          try {
            const overall = document.getElementById('multi-scan-overall');
            if (overall) overall.textContent = 'No Session';
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('scanManager: failed creating panel on DOMContentLoaded', e);
    }
  });
} catch (e) {
  /* not critical */
}
